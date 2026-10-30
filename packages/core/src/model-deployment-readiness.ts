import { z } from 'zod';
import { modelEndpointFetch } from '../../providers/src/network';
import { boundedJSON } from './body';
import { mapConcurrent } from './concurrent';
import { AppError } from './errors';
import type { ModelReadinessTarget } from './model-deployment-types';

const models = z
  .object({ data: z.array(z.object({ id: z.string() })).max(1000) })
  .transform((value) => value.data.map((model) => model.id));
const nativeModels = z.union([
  z
    .object({ models: z.array(z.object({ name: z.string() })).max(1000) })
    .transform((value) => value.models.map((model) => model.name)),
  models,
]);
const proof = z.object({ id: z.string(), generation: z.string(), checked_at: z.number().finite() });
const startupFailureCodes = ['model_downloading_failed', 'model_loading_failed'] as const;
const startupFailure = z.object({ error: z.object({ code: z.enum(startupFailureCodes) }) });
// Prefer actionable observed failures over loading or silence. One code owner
// defines both the allowed projection and deterministic concurrent precedence.
const probeCodes = [
  'model_authentication_failed',
  'model_worker_identity_mismatch',
  'model_identity_mismatch',
  'model_response_too_large',
  'model_response_invalid',
  ...startupFailureCodes,
  'model_endpoint_not_found',
  'model_http_error',
  'model_endpoint_unavailable',
  'model_rate_limited',
  'model_loading',
  'model_readiness_timeout',
  'model_readiness_unavailable',
  'model_waiting_for_worker',
  'model_ready',
] as const;
export const modelReadinessProbeSchema = z
  .object({
    checked_at: z.string().datetime(),
    stage: z.enum(['worker', 'transport', 'authentication', 'worker_identity', 'model_identity', 'response']),
    code: z.enum(probeCodes),
    duration_ms: z.number().int().nonnegative(),
    http_status: z.number().int().min(100).max(599).optional(),
  })
  .strict();
type Probe = z.infer<typeof modelReadinessProbeSchema>;
const evidence = z.object({
  cursor: z.number().int().nonnegative(),
  verified: z.array(proof).max(1000),
  last_probe: modelReadinessProbeSchema.optional(),
});
type Evidence = z.infer<typeof evidence>;
const PROOF_MS = 60_000;
const MIN_PROBES_PER_PASS = 16;

/** Background-only, bounded lower-bound measurement. Previously proven live
 * workers survive short passes; restart/version changes invalidate proof now.
 * See docs/projects/hugging-face-model-deployments-tech-design.md#14-managed-native-decision-hosting. */
export async function probeModelReadiness(
  input: {
    url: string;
    alias: string;
    protocol: string;
    headers: Record<string, string>;
    providerReadyReplicas: number;
    targets?: ModelReadinessTarget[];
    previous?: unknown;
  },
  fetchEndpoint: typeof modelEndpointFetch = modelEndpointFetch,
) {
  const prior = evidence.safeParse(input.previous);
  const now = Date.now();
  const targets =
    input.targets === undefined
      ? input.providerReadyReplicas > 0
        ? [{ id: '', generation: '', headers: {}, expected_headers: {} }]
        : []
      : [...new Map(input.targets.map((target) => [target.id, target])).values()].sort((left, right) =>
          left.id.localeCompare(right.id),
        );
  const identities = new Map(targets.map((target) => [target.id, target.generation]));
  const verified = new Map(
    (prior.success ? prior.data.verified : [])
      .filter(
        (item) =>
          item.generation !== '' &&
          identities.get(item.id) === item.generation &&
          now - item.checked_at < PROOF_MS &&
          item.checked_at <= now,
      )
      .map((item) => [item.id, item]),
  );
  const cursor = targets.length ? (prior.success ? prior.data.cursor : 0) % targets.length : 0;
  const selected = Array.from(
    // Refresh a healthy large pool within three normal reconciliation cycles,
    // rather than letting a fixed small batch permanently undercount capacity.
    { length: Math.min(Math.max(MIN_PROBES_PER_PASS, Math.ceil(targets.length / 3)), targets.length) },
    (_, index) => targets[(cursor + index) % targets.length],
  );
  const signal = AbortSignal.timeout(10_000);
  let attempted = 0;
  const observations = await mapConcurrent(selected, 16, async (target) => {
    if (signal.aborted) return;
    attempted++;
    const startedAt = performance.now();
    let httpStatus: number | undefined;
    const diagnostic = (stage: Probe['stage'], code: Probe['code'], failureCode = 'model_loading') => ({
      id: target.id,
      failureCode,
      probe: {
        checked_at: new Date().toISOString(),
        stage,
        code,
        duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        ...(httpStatus === undefined ? {} : { http_status: httpStatus }),
      } satisfies Probe,
    });
    try {
      const headers = new Headers(target.headers);
      for (const [header, value] of Object.entries(input.headers)) headers.set(header, value);
      const response = await fetchEndpoint(
        input.url,
        {
          method: 'GET',
          signal,
          // Provider affinity cannot replace the lifecycle's current credentials.
          headers,
        },
        { timeoutMs: 10_000, maximumResponseBytes: 1024 * 1024 },
      );
      httpStatus = response.status;
      if (!response.ok) {
        verified.delete(target.id);
        if ([401, 403].includes(response.status)) {
          void response.body?.cancel().catch(() => {});
          return diagnostic('authentication', 'model_authentication_failed', 'model_authentication_failed');
        }
        if (response.status === 503) {
          // The protected wrapper exposes only these stable startup stages.
          // Invalid or unavailable error bodies cannot erase the observed HTTP status.
          try {
            const failed = startupFailure.safeParse(await boundedJSON(response, 16 * 1024, signal));
            if (failed.success) return diagnostic('response', failed.data.error.code);
          } catch {
            // Keep the safe HTTP fallback; never retain arbitrary response content.
          }
        } else void response.body?.cancel().catch(() => {});
        return diagnostic(
          'response',
          response.status === 404
            ? 'model_endpoint_not_found'
            : response.status === 429
              ? 'model_rate_limited'
              : response.status === 503
                ? 'model_loading'
                : response.status >= 500
                  ? 'model_endpoint_unavailable'
                  : 'model_http_error',
        );
      }
      const identityHeaders = Object.entries(target.expected_headers);
      const expectedWorker =
        (input.targets === undefined || identityHeaders.length > 0) &&
        identityHeaders.every(([header, value]) => response.headers.get(header) === value);
      if (!expectedWorker) {
        void response.body?.cancel().catch(() => {});
        verified.delete(target.id);
        return diagnostic('worker_identity', 'model_worker_identity_mismatch', 'model_identity_mismatch');
      }
      const raw = await boundedJSON(response, 1024 * 1024, signal);
      const aliases = (input.protocol === 'systemone' ? nativeModels : models).parse(raw);
      if (!aliases.includes(input.alias)) {
        verified.delete(target.id);
        return diagnostic('model_identity', 'model_identity_mismatch', 'model_identity_mismatch');
      }
      verified.set(target.id, { id: target.id, generation: target.generation, checked_at: Date.now() });
      return diagnostic('model_identity', 'model_ready');
    } catch (error) {
      // Strict affinity may wait behind an active inference. Transport loss
      // contradicts no existing proof; its original freshness bound still wins.
      // Malformed/oversized model data is an observed failure, not mere silence.
      const oversized =
        error instanceof AppError && ['body_too_large', 'response_too_large'].includes(error.code);
      const invalid =
        error instanceof z.ZodError ||
        (error instanceof AppError && ['upstream_invalid_json', 'body_not_progressing'].includes(error.code));
      if (oversized || invalid) {
        verified.delete(target.id);
        return diagnostic(
          'response',
          oversized ? 'model_response_too_large' : 'model_response_invalid',
          'model_readiness_unavailable',
        );
      }
      const timeout =
        signal.aborted ||
        (error instanceof Error && error.name === 'TimeoutError') ||
        (error instanceof AppError && error.code === 'body_read_timeout');
      return diagnostic(
        'transport',
        timeout ? 'model_readiness_timeout' : 'model_readiness_unavailable',
        'model_readiness_unavailable',
      );
    }
  });
  for (const [id, item] of verified) if (Date.now() - item.checked_at >= PROOF_MS) verified.delete(id);
  const observed = observations
    .filter((observation) => observation !== undefined)
    .sort(
      (left, right) =>
        probeCodes.indexOf(left.probe.code) - probeCodes.indexOf(right.probe.code) ||
        left.id.localeCompare(right.id),
    )[0];
  const next: Evidence = {
    cursor: targets.length ? (cursor + attempted) % targets.length : 0,
    verified: [...verified.values()],
    // Worker churn must not replace the final actual endpoint failure with a
    // synthetic waiting record. Its timestamp distinguishes history from now.
    last_probe: observed?.probe ??
      (prior.success && prior.data.last_probe?.stage !== 'worker' ? prior.data.last_probe : undefined) ?? {
        checked_at: new Date().toISOString(),
        stage: 'worker',
        code: 'model_waiting_for_worker',
        duration_ms: 0,
      },
  };
  return {
    readyReplicas:
      input.targets === undefined ? (verified.size ? input.providerReadyReplicas : 0) : verified.size,
    failureCode: observed?.failureCode ?? 'model_loading',
    complete: attempted === targets.length,
    evidence: next,
  };
}
