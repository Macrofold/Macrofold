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
const evidence = z.object({ cursor: z.number().int().nonnegative(), verified: z.array(proof).max(1000) });
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
  let failureCode = 'model_loading';
  let attempted = 0;
  await mapConcurrent(selected, 16, async (target) => {
    if (signal.aborted) return;
    attempted++;
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
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status)) failureCode = 'model_authentication_failed';
        verified.delete(target.id);
        return;
      }
      const identityHeaders = Object.entries(target.expected_headers);
      const expectedWorker =
        (input.targets === undefined || identityHeaders.length > 0) &&
        identityHeaders.every(([header, value]) => response.headers.get(header) === value);
      const raw = await boundedJSON(response, 1024 * 1024, signal);
      const aliases = (input.protocol === 'systemone' ? nativeModels : models).parse(raw);
      if (!expectedWorker || !aliases.includes(input.alias)) {
        failureCode = 'model_identity_mismatch';
        verified.delete(target.id);
        return;
      }
      verified.set(target.id, { id: target.id, generation: target.generation, checked_at: Date.now() });
    } catch (error) {
      failureCode = 'model_readiness_unavailable';
      // Strict affinity may wait behind an active inference. Transport loss
      // contradicts no existing proof; its original freshness bound still wins.
      // Malformed/oversized model data is an observed failure, not mere silence.
      if (
        error instanceof z.ZodError ||
        (error instanceof AppError && ['upstream_invalid_json', 'body_too_large'].includes(error.code))
      )
        verified.delete(target.id);
    }
  });
  for (const [id, item] of verified) if (Date.now() - item.checked_at >= PROOF_MS) verified.delete(id);
  const next: Evidence = {
    cursor: targets.length ? (cursor + attempted) % targets.length : 0,
    verified: [...verified.values()],
  };
  return {
    readyReplicas:
      input.targets === undefined ? (verified.size ? input.providerReadyReplicas : 0) : verified.size,
    failureCode,
    complete: attempted === targets.length,
    evidence: input.targets === undefined ? undefined : next,
  };
}
