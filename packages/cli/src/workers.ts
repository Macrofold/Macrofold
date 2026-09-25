import type { components } from './api';
import type { Context } from './core';
import { CliError, confirmation, object, requiredString } from './core';
import type { Handler, Options } from './handlers-common';
import { idOrName, stringOption, uuidLike } from './handlers-common';

type WorkerCreate = components['schemas']['WorkerCreate'];
export function usdMicros(value: string): string {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) throw new CliError('USD must be nonnegative with at most six decimal places.');
  const [whole, fraction = ''] = value.split('.');
  return (BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))).toString();
}
export async function workerId(context: Context, selector: string): Promise<string> {
  if (uuidLike(selector)) return selector;
  let cursor: string | undefined;
  let found: string | undefined;
  do {
    const page = await context.client.request('listWorkers', { params: { query: { limit: 100, cursor } } });
    for (const worker of page.data)
      if (worker.name === selector && worker.desired_state !== 'destroyed') {
        if (found) throw new CliError('Worker name is ambiguous; use its ID.');
        found = worker.id;
      }
    cursor = page.next_cursor || undefined;
  } while (cursor);
  if (!found) throw new CliError('Worker not found. Inspect macrofold worker list; use a UUID for a destroyed Worker.', 5);
  return found;
}
export async function workerRunOptions(
  context: Context,
  flags: Options,
): Promise<Pick<components['schemas']['RunCreate'], 'worker_id' | 'worker_resources'>> {
  const selector = stringOption(flags, 'worker');
  const memory = flags['memory-mib'];
  const cpu = flags['cpu-millis'];
  if (memory !== undefined || cpu !== undefined) {
    if (!selector || typeof memory !== 'number' || typeof cpu !== 'number')
      throw new CliError('--memory-mib and --cpu-millis require each other and an explicit --worker.');
  }
  return {
    worker_id: selector ? await workerId(context, selector) : undefined,
    worker_resources: typeof memory === 'number' && typeof cpu === 'number' ? { memory_mib: memory, cpu_millis: cpu } : undefined,
  };
}
function input(flags: Options): WorkerCreate {
  return {
    name: stringOption(flags, 'name'),
    compute: stringOption(flags, 'compute') as WorkerCreate['compute'],
    dedicated: typeof flags.dedicated === 'boolean' ? flags.dedicated : undefined,
    isolate_runs: typeof flags['isolate-runs'] === 'boolean' ? flags['isolate-runs'] : undefined,
    size: flags['auto-size'] ? null : stringOption(flags, 'size'),
    runtime: stringOption(flags, 'runtime'),
    region: stringOption(flags, 'region'),
    min_instances: typeof flags['min-instances'] === 'number' ? flags['min-instances'] : undefined,
    max_instances: typeof flags['max-instances'] === 'number' ? flags['max-instances'] : undefined,
    max_concurrency: typeof flags['max-concurrency'] === 'number' ? flags['max-concurrency'] : undefined,
    idle_timeout_seconds: flags['keep-running'] ? null : typeof flags['idle-timeout'] === 'number' ? flags['idle-timeout'] : undefined,
    expires_at: flags['no-expiration'] ? null : stringOption(flags, 'expires-at'),
    max_hourly_compute_cost_micro_usd: typeof flags['max-hourly-usd'] === 'string'
      ? usdMicros(flags['max-hourly-usd']) : stringOption(flags, 'max-hourly-micro-usd'),
  };
}
async function selected(context: Context, args: string[]) {
  return workerId(context, requiredString(args[0], 'worker'));
}
export const workerHandlers: Record<string, Handler> = {
  'worker list': async ({ context, flags }) => {
    const ctx = await context();
    return { data: await ctx.client.request('listWorkers', { params: { query: {
      cursor: stringOption(flags, 'cursor'), limit: typeof flags.limit === 'number' ? flags.limit : 25,
    } } }) };
  },
  'worker offerings': async ({ context }) => ({ data: await (await context()).client.request('listWorkerOfferings') }),
  'worker show': async ({ context, args }) => {
    const ctx = await context();
    return { data: await ctx.client.request('getWorker', { params: { path: { worker_id: await selected(ctx, args) } } }) };
  },
  'worker create': async ({ context, flags }) => {
    const ctx = await context();
    return {
      data: await ctx.client.request('createWorker', { body: input(flags),
        headers: { 'Idempotency-Key': stringOption(flags, 'idempotency-key') || ctx.idempotencyKey } }),
    };
  },
  'worker run': async ({ context, args, flags }) => {
    const ctx = await context();
    const workspace = stringOption(flags, 'workspace') || ctx.profile?.workspace;
    const worktree = stringOption(flags, 'worktree') || ctx.profile?.worktree;
    const session = stringOption(flags, 'session');
    if (!session && !workspace && !worktree) throw new CliError('Choose --workspace, --worktree, or --session.');
    if (worktree && !uuidLike(worktree) && !workspace) throw new CliError('Worktree names require --workspace.');
    const workspaceId = workspace ? await idOrName(ctx, 'workspaces', workspace) : undefined;
    const body = {
      ...await workerRunOptions(ctx, { ...flags, worker: requiredString(args[0], 'worker') }),
      prompt: requiredString(stringOption(flags, 'prompt') || args.slice(1).join(' '), 'prompt'),
      workspace_id: workspaceId,
      worktree_id: worktree ? await idOrName(ctx, 'worktrees', worktree, workspaceId) : undefined,
      session_id: session,
      harness: stringOption(flags, 'harness') as components['schemas']['RunCreate']['harness'],
      model: stringOption(flags, 'model'),
      billing_mode: flags.byok ? 'byok' as const : 'managed' as const,
    };
    return { data: await ctx.client.request('createRun', { body,
      headers: { 'Idempotency-Key': stringOption(flags, 'idempotency-key') || ctx.idempotencyKey } }) };
  },
  'worker update': async ({ context, args, flags }) => {
    const ctx = await context();
    const worker = await selected(ctx, args);
    const revision = typeof flags.revision === 'number' ? flags.revision
      : (await ctx.client.request('getWorker', { params: { path: { worker_id: worker } } })).revision;
    return {
      data: await ctx.client.request('patchWorker', {
        params: { path: { worker_id: worker } },
        body: {
          ...input(flags),
          name: stringOption(flags, 'name'),
          expected_revision: revision,
        },
      }),
    };
  },
  'worker runs': async ({ context, args, flags }) => {
    const ctx = await context();
    const result = await ctx.client.request('listRuns', { params: { query: {
      worker_id: await selected(ctx, args), limit: typeof flags.limit === 'number' ? flags.limit : 25,
      cursor: stringOption(flags, 'cursor'),
    } } });
    return { data: result };
  },
  'worker pause': async ({ context, args, flags, io }) => {
    const ctx = await context();
    const worker = await selected(ctx, args);
    if (flags.force) await confirmation(ctx, io, `Interrupt active Runs on Worker ${worker}?`);
    return { data: await ctx.client.request('pauseWorker', { params: { path: { worker_id: worker } }, body: { force: Boolean(flags.force) },
      headers: { 'Idempotency-Key': stringOption(flags, 'idempotency-key') || ctx.idempotencyKey } }) };
  },
  'worker resume': async ({ context, args, flags }) => {
    const ctx = await context();
    return { data: await ctx.client.request('resumeWorker', { params: { path: { worker_id: await selected(ctx, args) } },
      headers: { 'Idempotency-Key': stringOption(flags, 'idempotency-key') || ctx.idempotencyKey } }) };
  },
  'worker destroy': async ({ context, args, flags, io }) => {
    const ctx = await context();
    const worker = await selected(ctx, args);
    await confirmation(ctx, io, `Destroy Worker ${worker}${flags.force ? ' and interrupt its active Runs' : ''}?`);
    return { data: await ctx.client.request('destroyWorker', { params: { path: { worker_id: worker } }, body: { force: Boolean(flags.force) },
      headers: { 'Idempotency-Key': stringOption(flags, 'idempotency-key') || ctx.idempotencyKey } }) };
  },
};
export function workerFromResponse(value: unknown): string {
  return requiredString(object(value).id, 'worker ID');
}
