from pathlib import Path
import json

# Collect and validate every edit before touching tracked source.
edits = {}
def read(name):
    return edits.get(name, Path(name).read_text())
def replace(name, before, after, count=1):
    text = read(name)
    actual = text.count(before)
    if actual != count:
        raise RuntimeError(f'{name}: expected {count} matching anchors, found {actual}: {before[:90]}')
    edits[name] = text.replace(before, after)

name = 'docs/api/openapi.json'
spec = json.loads(read(name))
worker_id = {'type': ['string', 'null'], 'format': 'uuid', 'description': 'Explicit reusable compute target, independent of the Run context.'}
for schema in ['RunAccepted', 'Run']:
    spec['components']['schemas'][schema]['properties']['worker_id'] = worker_id
edits[name] = json.dumps(spec, indent=2) + '\n'

replace('infra/runtime.Dockerfile',
 'COPY packages/contracts/model-transport.ts packages/contracts/sandbox-control.ts packages/contracts/',
 'COPY packages/contracts/model-transport.ts packages/contracts/host-control.ts packages/contracts/sandbox-control.ts packages/contracts/')

replace('packages/cli/src/index.ts', "const executionFlags = {", """const executionFlags = {
  worker: Flags.string({ description: 'Reusable Worker ID or exact name; omitted for automatic compute' }),
  'memory-mib': Flags.integer({ min: 1, max: 1048576, description: 'Per-Run memory allocation on the selected Worker' }),
  'cpu-millis': Flags.integer({ min: 1, max: 1024000, description: 'Per-Run CPU allocation in thousandths of a core' }),""")
replace('packages/cli/src/index.ts', 'const specialFlags: Record<string, Interfaces.FlagInput> = {', """const workerFlags = {
  compute: Flags.string({ options: ['server', 'sandbox'], description: 'Compute economics; not a provider override' }),
  dedicated: Flags.boolean({ exclusive: ['pooled'], description: 'Exclusive compute allocation' }),
  pooled: Flags.boolean({ exclusive: ['dedicated'], description: 'Resource-priced managed capacity where available' }),
  'shared-runs': Flags.boolean({ exclusive: ['isolated-runs'], description: 'Allow this Worker’s trusted Runs to share an execution environment' }),
  'isolated-runs': Flags.boolean({ exclusive: ['shared-runs'] }),
  'min-instances': Flags.integer({ min: 0 }),
  'max-instances': Flags.integer({ min: 1 }),
  'max-concurrency': Flags.integer({ min: 1 }),
  'idle-timeout': Flags.integer({ min: 0, exclusive: ['keep-alive'] }),
  'keep-alive': Flags.boolean({ exclusive: ['idle-timeout'] }),
  'max-hourly-cost': Flags.string({ description: 'Aggregate compute ceiling in USD/hour, e.g. 1.00' }),
  'expires-at': Flags.string({ exclusive: ['no-expiry'] }),
  'no-expiry': Flags.boolean({ exclusive: ['expires-at'] }),
  region: Flags.string(), runtime: Flags.string(), size: Flags.string(),
};
const specialFlags: Record<string, Interfaces.FlagInput> = {
  'worker create': workerFlags,
  'worker update': { ...workerFlags, name: Flags.string(), revision: Flags.integer({ min: 1 }) },
  'worker pause': { force: Flags.boolean(), yes: Flags.boolean() },
  'worker destroy': { force: Flags.boolean(), yes: Flags.boolean() },""")
replace('packages/cli/src/index.ts', 'const listCommands = new Set([', "const listCommands = new Set([\n  'worker list',")
replace('packages/cli/src/index.ts', 'const noArgs = new Set([', "const noArgs = new Set([\n  'worker list', 'worker offerings',")
replace('packages/cli/src/index.ts', 'const examples: Record<string, string> = {', """const examples: Record<string, string> = {
  'worker create': 'macrofold worker create openlegend --compute server --dedicated --shared-runs --min-instances 1 --max-hourly-cost 1.00',
  'worker update': 'macrofold worker update WORKER_ID --max-hourly-cost 2.00 --revision 3',
  'worker pause': 'macrofold worker pause WORKER_ID',""")
replace('packages/cli/src/commands.ts', "import { chat } from './chat';", "import { chat } from './chat';\nimport { workerCommands, workerRunOptions } from './workers';")
replace('packages/cli/src/commands.ts', 'export const handlers: Record<string, Handler> = {', 'export const handlers: Record<string, Handler> = {\n  ...workerCommands,')
replace('packages/cli/src/commands.ts', "session = await ctx.session();\n    let run: Schema['RunAccepted'];", "session = await ctx.session();\n    const placement = await workerRunOptions(ctx);\n    let run: Schema['RunAccepted'];")
replace('packages/cli/src/commands.ts', '          prompt: text,', '          ...placement,\n          prompt: text,', count=2)
replace('packages/cli/src/chat.ts', "import { Context, execution, limits, scheduling } from './context';", "import { Context, execution, limits, scheduling } from './context';\nimport { workerRunOptions } from './workers';")
replace('packages/cli/src/chat.ts', '    settings = execution(context.flags);', '    settings = execution(context.flags);\n  const placement = await workerRunOptions(context);')
# Both terminal modes send the same explicit placement; Session creation remains compute-independent.
replace('packages/cli/src/chat.ts', '...scheduling(context.flags),', '...scheduling(context.flags),\n          ...placement,', count=2)
replace('packages/cli/src/workers.ts', "  const expiration=stringOption(flags,'expires-at');", "  if(flags['no-expiry'])value.expires_at=null;\n  const expiration=stringOption(flags,'expires-at');")

name = 'packages/core/src/workers.ts'
text = read(name)
start = text.index('export async function workerObservation(')
end = text.index('export async function presentWorker(', start)
edits[name] = text[:start] + '''type WorkerObservation = {
  counts: { ready: number; provisioning: number; draining: number; occupied_slots: number };
  active_runs: number; queued_runs: number; charged_micro_usd: string;
  reserved_micro_usd: string; committed_hourly_compute_cost_micro_usd: string;
};
/** One bounded batch per resource kind; listing 100 Workers must not issue 200 extra queries. */
async function workerObservations(tx: Tx, rows: readonly WorkerRow[]): Promise<Map<string, WorkerObservation>> {
  const observations = new Map<string, WorkerObservation>(rows.map(row => [row.id, {
    counts: { ready: 0, provisioning: 0, draining: 0, occupied_slots: 0 },
    active_runs: 0, queued_runs: 0, charged_micro_usd: '0', reserved_micro_usd: '0',
    committed_hourly_compute_cost_micro_usd: '0',
  }]));
  if (!rows.length) return observations;
  const ids = rows.map(row => row.id);
  const hosts = (await tx.query<{ worker_id: string; status: 'ready' | 'provisioning' | 'draining'; offering: HostOffering; reserved_micro_usd: string }>(
    "SELECT worker_id,status,offering,reserved_micro_usd FROM hosts WHERE worker_id=ANY($1::uuid[]) AND status<>'stopped'", [ids],
  )).rows;
  for (const host of hosts) {
    const observation = observations.get(host.worker_id)!;
    observation.counts[host.status]++;
    observation.reserved_micro_usd = (BigInt(observation.reserved_micro_usd) + BigInt(host.reserved_micro_usd)).toString();
    observation.committed_hourly_compute_cost_micro_usd = (BigInt(observation.committed_hourly_compute_cost_micro_usd) + workerHourlyExposure(host.offering.price, host.offering.resources)).toString();
  }
  const occupied = (await tx.query<{ worker_id: string; occupied: number; active: number }>(
    `SELECT a.worker_id,count(*)::integer AS occupied,
      count(*) FILTER(WHERE r.status IN ('provisioning','running','waiting_for_input','persisting'))::integer AS active
      FROM host_runs a JOIN runs r ON r.id=a.run_id
      WHERE a.worker_id=ANY($1::uuid[]) AND a.released_at IS NULL GROUP BY a.worker_id`, [ids],
  )).rows;
  for (const row of occupied) {
    const observation = observations.get(row.worker_id)!;
    observation.counts.occupied_slots = row.occupied;
    observation.active_runs = row.active;
  }
  const queued = (await tx.query<{ worker_id: string; queued: number }>(
    `SELECT config->>'worker_id' AS worker_id,count(*)::integer AS queued FROM runs
      WHERE config->>'worker_id'=ANY($1::text[]) AND status='queued' GROUP BY config->>'worker_id'`, [ids],
  )).rows;
  for (const row of queued) observations.get(row.worker_id)!.queued_runs = row.queued;
  const costs = (await tx.query<{ worker_id: string; total: string }>(
    'SELECT worker_id,coalesce(sum(charged_micro_usd),0)::text AS total FROM hosts WHERE worker_id=ANY($1::uuid[]) GROUP BY worker_id', [ids],
  )).rows;
  for (const row of costs) observations.get(row.worker_id)!.charged_micro_usd = row.total;
  return observations;
}
export async function workerObservation(tx: Tx, row: WorkerRow): Promise<WorkerObservation> {
  return (await workerObservations(tx, [row])).get(row.id)!;
}
''' + text[end:]
replace(name, 'export async function presentWorker(tx: Tx, row: WorkerRow) {\n  const observation = await workerObservation(tx, row);',
 'export async function presentWorker(tx: Tx, row: WorkerRow, observed?: WorkerObservation) {\n  const observation = observed ?? await workerObservation(tx, row);')
replace(name, '  const data = [];\n  for (const row of rows.slice(0, limit)) data.push(await presentWorker(tx,row));',
 '  const selected = rows.slice(0, limit);\n  const observations = await workerObservations(tx, selected);\n  const data = await Promise.all(selected.map(row => presentWorker(tx, row, observations.get(row.id))));')

name = 'docs/maintainers/TODO.md'
text = read(name)
section = '''## Worker cutover regression obligations

No unit or integration suites are written or run for this continuation, as requested. Runtime execution and bounded performance exercises are recorded separately.

- [ ] Cover Worker response projection (`worker_id` on accepted and retrieved Runs), independent Worker/Workspace restrictions, non-escalating child keys, and the actual `/v1/api-keys` route.
- [ ] Cover CLI create/update/pause/resume/destroy, human USD conversion, mutually exclusive flags, name-versus-ID permissions, resource overrides, and both chat modes. Session creation must not acquire or inherit compute implicitly.
- [ ] Cover batched Worker observations with multiple tenants, pagination, active-versus-cleaning assignments, empty lists, historical charges, and no observation-query growth proportional to page length.
- [ ] Cover cold native continuation and hidden Git/session files while excluding credentials; repeat from a fresh Host rather than relying on warm-process reuse.
- [ ] Cover spending ceilings during provisioning and draining, same-Worker concurrent writers, late generation callbacks, graceful pause, and pool/instance resource exhaustion.

'''
if '## Worker cutover regression obligations' not in text:
    edits[name] = text.replace('# Engineering TODO\n', '# Engineering TODO\n\n' + section, 1)

for name, text in edits.items():
    Path(name).write_text(text)
old = Path('scripts/workers/development-edit.py')
if old.exists(): old.unlink()
print('APPLIED_SOURCE_FILES', ', '.join(edits))
