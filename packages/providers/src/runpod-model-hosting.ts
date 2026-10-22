import { z } from 'zod';
import { boundedJSON } from '../../core/src/body';
import type { ModelHostingProvider } from '../../core/src/model-deployment-types';

const ORIGIN = 'https://api.runpod.io';
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const timestamp = z.string().datetime({ offset: true });
const endpointSchema = z.object({
  id: identifier,
  type: z.literal('LOAD_BALANCER'),
  image: z.string().min(1).max(1024),
  requestUrls: z.object({ base: z.string().url() }),
  env: z.record(z.string(), z.string()),
  workers: z.object({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
    idleTimeout: z.number().int().optional(),
  }),
  gpu: z.object({ pools: z.array(z.string()).max(100), count: z.number().int().positive() }),
  scaling: z.object({ type: z.string(), requestCount: z.number().optional() }),
  timeout: z.number().int(),
  disk: z.number().int().optional(),
});
const workerSchema = z.object({
  id: identifier,
  status: z.enum(['RUNNING', 'IDLE', 'INITIALIZING', 'THROTTLED', 'UNHEALTHY']),
  isStale: z.boolean(),
  version: z.number().int().nullish(),
  gpuCount: z.number().int().nonnegative(),
  image: z.string().nullish(),
  gpuTypeId: z.string().nullish(),
  dataCenterId: z.string().nullish(),
  startedAt: timestamp.nullish(),
});
const workersSchema = z.object({
  workers: z.array(workerSchema).max(1000),
  endpointVersion: z.number().int().nullish(),
});
const paginationSchema = z.object({ nextCursor: z.string().max(4096).nullable(), hasNextPage: z.boolean() });
const endpointsSchema = z.object({
  // Accounts may also contain queue endpoints; inspect only our correlated entries.
  endpoints: z
    .array(
      z
        .object({ id: identifier, type: z.string(), env: z.record(z.string(), z.string()).optional() })
        .passthrough(),
    )
    .max(200),
  pagination: paginationSchema,
});
const catalogSchema = z.object({
  gpus: z
    .array(
      z.object({
        id: z.string().min(1).max(256),
        name: z.string().min(1).max(256),
        pool: z.string().nullable(),
        memory: z.number().int().positive().max(8192),
        price: z.object({ serverless: z.number().finite().nonnegative().optional() }),
        dataCenters: z
          .array(z.object({ id: z.string() }))
          .max(1000)
          .optional(),
      }),
    )
    .max(1000),
});
const costsSchema = z.object({
  records: z
    .array(
      z.object({
        serverlessId: identifier,
        startTime: timestamp,
        endTime: timestamp,
        totalAmount: z.number().finite().nonnegative(),
      }),
    )
    .max(10000),
});

/** REST v2 publishes decimal USD as JSON numbers. Convert their decimal form
 * with integer arithmetic and round up only the sub-micro remainder. */
export function runpodUsdToMicro(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid RunPod amount.');
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match) throw new Error('Invalid RunPod amount.');
  const numerator = BigInt(match[1] + (match[2] || ''));
  const scale = Number(match[3] || 0) - (match[2]?.length || 0) + 6;
  const denominator = scale < 0 ? 10n ** BigInt(-scale) : 1n;
  const result = scale >= 0 ? numerator * 10n ** BigInt(scale) : (numerator + denominator - 1n) / denominator;
  if (result > 9_223_372_036_854_775_807n) throw new Error('RunPod amount exceeds its storage limit.');
  return result.toString();
}

function endpointURL(endpoint: z.infer<typeof endpointSchema>): string {
  const url = new URL(endpoint.requestUrls.base);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== `${endpoint.id}.api.runpod.ai` ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('RunPod returned an invalid serving origin.');
  return url.origin;
}

/** Official schema: runpod/docs api-reference-v2/openapi.json, blob
 * f3307d0f67413279fb242ad0276fc749528c67e4. Only fixed management URLs receive
 * account credentials; these requests never follow redirects or retry POST. */
export function runpodModelHosting(transport: typeof fetch = fetch): ModelHostingProvider {
  async function request(
    path: string,
    secret: string,
    options: { method?: string; body?: Record<string, unknown>; absent?: boolean; signal?: AbortSignal } = {},
  ): Promise<unknown | null> {
    const signal = options.signal || AbortSignal.timeout(20_000);
    const response = await transport(ORIGIN + path, {
      method: options.method || 'GET',
      redirect: 'error',
      signal,
      headers: {
        authorization: `Bearer ${secret}`,
        accept: 'application/json',
        ...(options.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    if (response.status === 404 && options.absent) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      // Do not retain the raw provider body: env and credentials can be echoed.
      throw new Error(`RunPod management request failed (${response.status}).`);
    }
    if (response.status === 204 && options.method === 'DELETE') {
      await response.body?.cancel();
      return null;
    }
    if (response.status === 204) throw new Error('RunPod returned an unexpected empty response.');
    return boundedJSON(response, 8 * 1024 * 1024, signal);
  }

  return {
    async catalog(secret) {
      const catalog = catalogSchema.parse(
        await request('/v2/catalog/gpus?include=AVAILABILITY&product=SERVERLESS', secret),
      );
      return catalog.gpus.flatMap((gpu) =>
        gpu.pool
          ? [
              {
                pool: gpu.pool,
                id: gpu.id,
                name: gpu.name,
                memory_bytes: (BigInt(gpu.memory) * 1024n ** 3n).toString(),
                hourly_micro_usd:
                  gpu.price.serverless === undefined ? null : runpodUsdToMicro(gpu.price.serverless),
                region_ids: gpu.dataCenters?.map((region) => region.id) || [],
              },
            ]
          : [],
      );
    },
    async create(secret, config) {
      // A shared template is not owned by this deployment; delete would remove it.
      if (
        config.type !== 'LOAD_BALANCER' ||
        'templateId' in config ||
        typeof config.image !== 'string' ||
        !/@sha256:[a-f0-9]{64}$/.test(config.image)
      )
        throw new Error('Managed serving requires an owned load balancer with a pinned image.');
      const endpoint = endpointSchema.parse(
        await request('/v2/serverless', secret, { method: 'POST', body: config }),
      );
      return { id: endpoint.id, endpoint_url: endpointURL(endpoint) };
    },
    async inspect(secret, providerId) {
      const id = identifier.parse(providerId);
      const value = await request(`/v2/serverless/${id}`, secret, { absent: true });
      if (value === null) return null;
      const endpoint = endpointSchema.parse(value);
      if (endpoint.id !== id) throw new Error('RunPod returned a different endpoint.');
      const observation = workersSchema.parse(await request(`/v2/serverless/${id}/workers`, secret));
      const ready = observation.workers.filter(
        (worker) =>
          ['RUNNING', 'IDLE'].includes(worker.status) &&
          !worker.isStale &&
          worker.image === endpoint.image &&
          worker.gpuCount === endpoint.gpu.count &&
          (observation.endpointVersion == null || worker.version === observation.endpointVersion),
      );
      return {
        id,
        endpoint_url: endpointURL(endpoint),
        ready_replicas: ready.length,
        workers: observation.workers.map((worker) => ({
          id: worker.id,
          pool: null,
          started_at: worker.startedAt || null,
          stopped_at: null,
        })),
        config: {
          image: endpoint.image,
          gpu: endpoint.gpu,
          workers: endpoint.workers,
          scaling: endpoint.scaling,
          timeout: endpoint.timeout,
          ...(endpoint.disk === undefined ? {} : { disk: endpoint.disk }),
          env: Object.fromEntries(
            Object.entries(endpoint.env).filter(([key]) =>
              ['MF_ATTEMPT_ID', 'MF_REVISION_ID', 'MF_MODEL_CONFIG'].includes(key),
            ),
          ),
          observed_workers: observation.workers,
          endpoint_version: observation.endpointVersion ?? null,
        },
      };
    },
    async findAttempt(secret, attemptId) {
      const correlation = identifier.parse(attemptId);
      const signal = AbortSignal.timeout(60_000);
      const seen = new Set<string>();
      const matches: { id: string; endpoint_url: string }[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 20; page++) {
        const query = new URLSearchParams({ limit: '200', ...(cursor ? { cursor } : {}) });
        const inventory = endpointsSchema.parse(await request(`/v2/serverless?${query}`, secret, { signal }));
        for (const candidate of inventory.endpoints) {
          if (candidate.env?.MF_ATTEMPT_ID !== correlation) continue;
          const endpoint = endpointSchema.parse(candidate);
          matches.push({ id: endpoint.id, endpoint_url: endpointURL(endpoint) });
        }
        if (!inventory.pagination.hasNextPage) return matches;
        cursor = inventory.pagination.nextCursor;
        if (!cursor || seen.has(cursor))
          throw new Error('RunPod endpoint inventory pagination did not finish.');
        seen.add(cursor);
      }
      // Empty inventory is an observation, not proof that an ambiguous POST failed.
      throw new Error('RunPod endpoint inventory exceeds its reconciliation limit.');
    },
    async update(secret, providerId, config) {
      identifier.parse(providerId);
      // The domain may rotate credentials while preserving its immutable
      // recipe. Model/image changes still require drain and replacement.
      if (Object.keys(config).some((key) => !['workers', 'scaling', 'timeout', 'env'].includes(key)))
        throw new Error('Serving revision changes require drain and replacement.');
      await request(`/v2/serverless/${providerId}`, secret, { method: 'PATCH', body: config });
    },
    async delete(secret, providerId) {
      identifier.parse(providerId);
      await request(`/v2/serverless/${providerId}`, secret, { method: 'DELETE', absent: true });
    },
    async costs(secret, providerId, start, end) {
      const id = identifier.parse(providerId);
      timestamp.parse(start);
      timestamp.parse(end);
      if (Date.parse(end) <= Date.parse(start) || Date.parse(end) - Date.parse(start) > 31 * 86_400_000)
        throw new Error('RunPod billing observation requires a bounded interval.');
      const query = new URLSearchParams({
        serverlessId: id,
        startTime: start,
        endTime: end,
        bucketSize: 'hour',
      });
      const observation = costsSchema.parse(await request(`/v2/billing/serverless?${query}`, secret));
      const seen = new Set<string>();
      return observation.records.map((record) => {
        const identity = `${record.startTime}/${record.endTime}`;
        if (
          record.serverlessId !== id ||
          Date.parse(record.endTime) <= Date.parse(record.startTime) ||
          seen.has(identity)
        )
          throw new Error('RunPod billing returned an invalid resource or duplicate interval.');
        seen.add(identity);
        return {
          start: record.startTime,
          end: record.endTime,
          micro_usd: runpodUsdToMicro(record.totalAmount),
        };
      });
    },
  };
}
