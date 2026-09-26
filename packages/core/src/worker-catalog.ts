import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Tx } from '../../db';
import { config, isLocal } from './config';
import { computeRate } from './catalog';
import { getExecutionPolicy } from './plans';
import { assert } from './errors';
import { workerHourlyExposure } from './worker-pricing';
import type { ComputeOffering, WorkerPolicyLimits } from './worker-types';

const money = z.string().regex(/^(0|[1-9]\d{0,14})$/);
export const offeringSchema = z.object({
  id: z.string().min(1).max(160), revision: z.string().min(1).max(160),
  compute: z.enum(['server', 'sandbox']), dedicated: z.boolean(), isolate_runs: z.boolean(),
  region: z.string().min(1).max(160), runtime: z.string().min(1).max(160), size: z.string().min(1).max(160),
  resources: z.object({ memory_mib: z.number().int().positive().max(1048576), cpu_millis: z.number().int().positive().max(1024000) }),
  concurrency: z.number().int().positive().max(1024),
  max_host_lifetime_seconds: z.number().int().min(300).max(86400).nullable(),
  price: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('allocation'), hourly_micro_usd: money }),
    z.object({ kind: z.literal('resource'), cpu_hour_micro_usd: money, gib_hour_micro_usd: money }),
  ]),
  driver: z.enum(['simulator', 'docker', 'vercel', 'render']),
  driver_size: z.string().min(1).max(160).optional(),
});
export type HostOffering = z.infer<typeof offeringSchema>;

function quoted(input: Omit<HostOffering, 'revision'>): HostOffering {
  return offeringSchema.parse({ ...input, revision: createHash('sha256').update(JSON.stringify(input)).digest('hex') });
}
/** Built-ins reuse existing published deployment rates. New commercial shapes require a reviewed catalog entry. */
function builtins(): HostOffering[] {
  const local = isLocal();
  const driver = local ? (config.execution === 'simulator' ? 'simulator' : 'docker') : 'vercel';
  const region = local ? 'local' : (process.env.WORKER_REGION || 'iad1');
  const runtime = process.env.WORKER_RUNTIME_VERSION || 'managed-1';
  const base = { region, runtime, size: '2cpu-4g', resources: { cpu_millis: 2000, memory_mib: 4096 } };
  const entries: HostOffering[] = [];
  for (const dedicated of [false, true]) {
    entries.push(quoted({ ...base, id: `sandbox-${dedicated ? 'dedicated' : 'metered'}`, driver,
      compute: 'sandbox', dedicated, isolate_runs: true, concurrency: 1, max_host_lifetime_seconds: 84600,
      price: { kind: 'allocation', hourly_micro_usd: local ? '0' : (BigInt(computeRate()) * 60n).toString() } }));
  }
  if (local) {
    for (const dedicated of [false, true]) for (const isolated of [false, true]) {
      entries.push(quoted({ ...base, id: `server-${dedicated ? 'dedicated' : 'metered'}-${isolated ? 'isolated' : 'shared'}`,
        driver, compute: 'server', dedicated, isolate_runs: isolated, concurrency: isolated ? 1 : 16,
        max_host_lifetime_seconds: null,
        price: dedicated ? { kind: 'allocation', hourly_micro_usd: '0' } : { kind: 'resource', cpu_hour_micro_usd: '0', gib_hour_micro_usd: '0' } }));
    }
  } else if (process.env.RENDER_WORKER_ENABLED === 'true') {
    const rate = process.env.RENDER_COMPUTE_MICRO_USD_PER_MINUTE;
    if (rate && /^(0|[1-9]\d{0,12})$/.test(rate) && BigInt(rate) > 0n) {
      for (const isolated of [false, true]) entries.push(quoted({ ...base,
        id: `server-dedicated-${isolated ? 'isolated' : 'shared'}`, driver: 'render', driver_size: process.env.RENDER_COMPUTE_PLAN || '2c-4g',
        region: process.env.RENDER_REGION || 'virginia', compute: 'server', dedicated: true, isolate_runs: isolated,
        concurrency: isolated ? 1 : 16, max_host_lifetime_seconds: null,
        price: { kind: 'allocation', hourly_micro_usd: (BigInt(rate) * 60n).toString() } }));
    }
  }
  return entries;
}
export async function workerOfferings(tx: Tx): Promise<HostOffering[]> {
  const rows = (await tx.query<{ definition: unknown }>(
    'SELECT DISTINCT ON(id) definition FROM worker_offerings WHERE enabled ORDER BY id,created_at DESC,revision DESC',
  )).rows;
  const reviewed = rows.map(row => offeringSchema.parse(row.definition));
  // A simulation cannot invoke an accidentally configured paid provider.
  const eligible = reviewed.filter(item => isLocal() ? item.driver === (config.execution === 'simulator' ? 'simulator' : 'docker') : !['simulator','docker'].includes(item.driver));
  const byId = new Map(builtins().map(item => [item.id, item]));
  for (const item of eligible) byId.set(item.id, item);
  for (const item of byId.values()) {
    assert(!item.isolate_runs || item.concurrency === 1, 503, 'invalid_worker_offering',
      'The current provider boundary requires one active execution per isolated Host.');
    workerHourlyExposure(item.price, item.resources);
  }
  return [...byId.values()];
}
export async function workerPolicyLimits(tx: Tx, organizationId: string, offerings: readonly ComputeOffering[]): Promise<WorkerPolicyLimits> {
  const policy = await getExecutionPolicy(tx, organizationId);
  const preferred = offerings.find(item => item.compute === 'sandbox' && !item.dedicated);
  assert(preferred, 503, 'compute_unavailable', 'No automatic Worker offering is configured.');
  const maximum = Math.max(1, Math.min(64, policy.concurrency_limit));
  const defaults = Math.min(4, maximum);
  return {
    region: preferred.region, runtime: preferred.runtime,
    default_hourly_compute_cost_micro_usd: (workerHourlyExposure(preferred.price, preferred.resources) * BigInt(defaults)).toString(),
    default_max_instances: defaults, max_instances: maximum,
    default_max_concurrency: policy.concurrency_limit, max_concurrency: policy.concurrency_limit,
  };
}
export function publicOffering(value: HostOffering): ComputeOffering {
  const { driver: _driver, driver_size: _shape, ...publicValue } = value;
  return publicValue;
}
