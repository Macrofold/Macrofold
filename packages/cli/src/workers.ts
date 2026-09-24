import type { Schema } from '../../../sdk/typescript/src/client';
import type { Handler } from './commands';
import { Context, stringOption, type Options, uuid } from './context';
import { CliError, confirm, terminalText } from './output';

function decimalMicroUsd(value: string) {
  if (!/^(0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(value))
    throw new CliError('Use a nonnegative USD amount with at most six decimal places.');
  const [whole, fraction = ''] = value.split('.');
  return (BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))).toString();
}
export async function workerId(context: Context, selector: string): Promise<string> {
  // UUID targeting needs only workers:use; resolving a display name additionally requires workers:read.
  if (uuid(selector)) return selector;
  let cursor: string | undefined;
  let found: string | undefined;
  do {
    const page = await context.client.request('listWorkers', { params: { query: { limit: 100, cursor } } });
    for (const worker of page.data)
      if (worker.name === selector) {
        if (found) throw new CliError('Worker name is ambiguous; use its ID.');
        found = worker.id;
      }
    cursor = page.next_cursor || undefined;
  } while (cursor);
  if (!found) throw new CliError('Worker not found. Inspect macrofold worker list.', 5);
  return found;
}
export async function workerRunOptions(
  context: Context,
): Promise<Pick<Schema['RunCreate'], 'worker_id' | 'memory_mib' | 'cpu_millis'>> {
  const selector = stringOption(context.flags, 'worker');
  const memory = context.flags['memory-mib'];
  const cpu = context.flags['cpu-millis'];
  if (!selector && (memory !== undefined || cpu !== undefined))
    throw new CliError('Per-Run resource overrides require --worker.');
  return {
    worker_id: selector ? await workerId(context, selector) : undefined,
    memory_mib: typeof memory === 'number' ? memory : undefined,
    cpu_millis: typeof cpu === 'number' ? cpu : undefined,
  };
}
function input(flags: Options): Schema['WorkerCreate'] {
  const value: Schema['WorkerCreate'] = {};
  const compute = stringOption(flags, 'compute');
  if (compute === 'server' || compute === 'sandbox') value.compute = compute;
  if (flags.dedicated) value.dedicated = true;
  if (flags.pooled) value.dedicated = false;
  if (flags['shared-runs']) value.isolate_runs = false;
  if (flags['isolated-runs']) value.isolate_runs = true;
  for (const [flag, field] of [
    ['min-instances', 'min_instances'],
    ['max-instances', 'max_instances'],
    ['max-concurrency', 'max_concurrency'],
    ['idle-timeout', 'idle_timeout_seconds'],
  ] as const)
    if (typeof flags[flag] === 'number') value[field] = flags[flag];
  if (flags['keep-alive']) value.idle_timeout_seconds = null;
  for (const field of ['region', 'runtime', 'size'] as const) {
    const selected = stringOption(flags, field);
    if (selected !== undefined) value[field] = selected;
  }
  if (flags['auto-size']) value.size = null;
  if (flags['no-expiry']) value.expires_at = null;
  const expiration = stringOption(flags, 'expires-at');
  if (expiration !== undefined) value.expires_at = expiration;
  const cost = stringOption(flags, 'max-hourly-cost');
  if (cost !== undefined) value.max_hourly_compute_cost_micro_usd = decimalMicroUsd(cost);
  return value;
}
async function selected(context: Context, args: string[]) {
  const selector = args[0] || stringOption(context.flags, 'worker');
  if (!selector) throw new CliError('Provide a Worker ID or exact name.');
  return workerId(context, selector);
}
export const workerCommands: Record<string, Handler> = {
  'worker offerings': async ({ context }) => ({
    data: await (await context()).client.request('listWorkerOfferings'),
  }),
  'worker list': async ({ context, flags }) => ({
    data: await (
      await context()
    ).client.request('listWorkers', {
      params: {
        query: {
          limit: typeof flags.limit === 'number' ? flags.limit : 25,
          cursor: stringOption(flags, 'cursor'),
        },
      },
    }),
  }),
  'worker show': async ({ context, args }) => {
    const ctx = await context();
    return {
      data: await ctx.client.request('getWorker', {
        params: { path: { worker_id: await selected(ctx, args) } },
      }),
    };
  },
  'worker create': async ({ context, args, flags }) => {
    const ctx = await context();
    return { data: await ctx.client.request('createWorker', { body: { ...input(flags), name: args[0] } }) };
  },
  'worker update': async ({ context, args, flags }) => {
    const ctx = await context();
    const worker = await selected(ctx, args);
    const current = await ctx.client.request('getWorker', { params: { path: { worker_id: worker } } });
    return {
      data: await ctx.client.request('patchWorker', {
        params: { path: { worker_id: worker } },
        body: {
          ...input(flags),
          name: stringOption(flags, 'name'),
          expected_revision: typeof flags.revision === 'number' ? flags.revision : current.revision,
        },
      }),
    };
  },
  'worker pause': async ({ context, args, flags }) => {
    const ctx = await context();
    const worker = await selected(ctx, args);
    if (flags.force)
      await confirm(`Cancel active Runs and pause Worker ${terminalText(worker)}?`, Boolean(flags.yes));
    return {
      data: await ctx.client.request('pauseWorker', {
        params: { path: { worker_id: worker } },
        body: { force: !!flags.force },
      }),
    };
  },
  'worker resume': async ({ context, args }) => {
    const ctx = await context();
    return {
      data: await ctx.client.request('resumeWorker', {
        params: { path: { worker_id: await selected(ctx, args) } },
      }),
    };
  },
  'worker destroy': async ({ context, args, flags }) => {
    const ctx = await context();
    const worker = await selected(ctx, args);
    await confirm(
      `${flags.force ? 'Cancel active Runs and destroy' : 'Gracefully destroy'} Worker ${terminalText(worker)}? Durable files are preserved.`,
      Boolean(flags.yes),
    );
    return {
      data: await ctx.client.request('destroyWorker', {
        params: { path: { worker_id: worker } },
        body: { force: !!flags.force },
      }),
    };
  },
};
