from pathlib import Path
import json,re,subprocess
edits={}; removed=set()
def read(name): return edits.get(name,Path(name).read_text())
def replace(name,old,new,count=1):
    text=read(name)
    if text.count(old)!=count: raise RuntimeError(f'{name}: anchor changed ({text.count(old)}/{count}): {old[:100]}')
    edits[name]=text.replace(old,new)
def cut(name,start,end):
    text=read(name)
    if text.count(start)!=1 or text.count(end)!=1: raise RuntimeError(f'{name}: section changed {start}')
    a=text.index(start); b=text.index(end,a)
    edits[name]=text[:a]+text[b:]

name='docs/api/openapi.json'; spec=json.loads(read(name))
for route in list(spec['paths']):
    if route=='/v1/sandboxes' or route.startswith('/v1/sandboxes/'):
        del spec['paths'][route]
for key in list(spec['components']['schemas']):
    if key.startswith('Sandbox'): del spec['components']['schemas'][key]
for key in list(spec['components'].get('parameters',{})):
    if key.lower().startswith('sandbox'): del spec['components']['parameters'][key]
legacy_fields={'sandbox_id','sandbox_max_cost_micro_usd','keep_warm_seconds'}
def clean(value):
    if isinstance(value,dict):
        if isinstance(value.get('properties'),dict):
            for key in legacy_fields: value['properties'].pop(key,None)
        if isinstance(value.get('required'),list): value['required']=[key for key in value['required'] if key not in legacy_fields]
        for child in value.values(): clean(child)
    elif isinstance(value,list):
        for child in value: clean(child)
clean(spec)
spec['tags']=[tag for tag in spec.get('tags',[]) if tag.get('name','').lower()!='sandboxes']
# Worker filtering does not confer access to the content of other Worktrees.
worker_query={'name':'worker_id','in':'query','required':False,'schema':{'type':'string','format':'uuid'},'description':'Only Runs or compute usage associated with this Worker. Normal context permissions still apply.'}
for methods in spec['paths'].values():
    for operation in methods.values():
        if isinstance(operation,dict) and operation.get('operationId') in ['listRuns','getBillingUsage']:
            operation.setdefault('parameters',[]).append(worker_query)
spec['components']['schemas']['BillingUsageEntry']['properties']['worker_id']={'type':['string','null'],'format':'uuid','description':'Worker charged for shared compute. Whole-Worker compute is not attributed to an individual Run.'}
spec['components']['schemas']['BillingUsageEntry']['properties']['compute_allocation_id']={'type':['string','null'],'format':'uuid','description':'Financial allocation identifier; not a controllable physical-machine API resource.'}
edits[name]=json.dumps(spec,indent=2)+'\n'

name='packages/core/src/api-handlers.ts'
replace(name,"import * as sandboxes from './sandboxes';\n",'')
cut(name,'  createSandbox: c =>','  createRun: async (c) =>')
replace(name,"    if (c.query.has('cursor')) {\n      args.push(c.query.get('cursor'));", "    if (c.query.has('worker_id')) {\n      args.push(c.query.get('worker_id'));\n      where.push(`config->>'worker_id'=$${args.length}`);\n    }\n    if (c.query.has('cursor')) {\n      args.push(c.query.get('cursor'));")
replace(name,"features: ['streaming', 'sessions', 'worktrees', 'transfers', 'checkpoint_exports'],", "features: ['streaming', 'sessions', 'worktrees', 'transfers', 'checkpoint_exports', 'workers'],")

name='packages/core/src/runs.ts'
replace(name,"import * as sandboxes from './sandboxes';\n",'')
replace(name,"import type { SandboxProviderKind } from '../../contracts/sandbox-control';\n",'')
replace(name,'  sandbox_id?: string;\n  sandbox_provider?: SandboxProviderKind;\n  keep_warm_seconds?: number | null;\n','')
replace(name,"    sandbox_id: row.kind === 'native_agent' ? row.config.sandbox_id || null : null,\n",'')
replace(name,"  assert(!worker || (!input.sandbox_id && input.keep_warm_seconds === undefined),400,'conflicting_compute',\n    'Select one explicit Worker without a per-Run compute lifetime override.');\n",'')
cut(name,'  let sandbox = input.sandbox_id ?', '  const rate = worker || sandbox')
replace(name,"  const rate = worker || sandbox ? '0' : computeRate();", "  const rate = worker ? '0' : computeRate();")
replace(name,'    sandbox_id: sandbox?.id,\n    sandbox_provider: sandbox?.provider,\n    keep_warm_seconds: input.keep_warm_seconds,\n','')
replace(name,'    sandbox_id: sandbox?.id || null,\n','')

name='packages/core/src/engine.ts'
replace(name,"import { acquireSandbox, changeSandbox, getSandbox, sandboxCost } from './sandboxes';\n",'')
cut(name,"    let sandbox = run.kind === 'native_agent'", "    const worker = run.kind === 'native_agent'")
replace(name,'subscriptionUnavailable || sandboxUnavailable || workerUnavailable','subscriptionUnavailable || workerUnavailable')
replace(name,"              : sandboxUnavailable\n                ? 'sandbox_unavailable'\n",'')
replace(name,"    if (sandbox?.status === 'pausing') return null;\n",'')
replace(name,"    if (sandbox && ((sandbox.active_run_id && sandbox.active_run_id !== runId) || (sandbox.lease_until && sandbox.lease_until.getTime() > Date.now()))) return null;\n",'')
replace(name,"    if (sandbox && run.kind === 'native_agent') await acquireSandbox(tx, sandbox.id, runId, run.worktree_id);\n",'')

name='packages/core/src/cloud-engine.ts'
replace(name,"import { releaseSandbox } from './sandboxes';\n",'')
cut(name,'        ...(run.config.sandbox_id','        harness: run.config.harness,')
replace(name,"      if (!state.machine && run.config.sandbox_id)\n        await releaseSandbox(org, run.config.sandbox_id, runId, 0, true);\n",'''      if (!state.machine && run.config.worker_id) {
        // No runtime was ever prepared. Its SQL claim still must be released.
        const { activeHostRun, releaseHostRun } = await import('./host-allocations');
        await transaction(org, async tx => {
          const assignment = await activeHostRun(tx, runId);
          if (assignment && !assignment.launched_at) await releaseHostRun(tx, assignment, false, null);
        });
      }
''')
replace(name,"error.code === 'sandbox_starting'", "error.code === 'worker_starting'")

name='packages/providers/src/machines.ts'
replace(name,"import { SandboxMachines } from '../../core/src/sandbox-machines';\n",'')
replace(name,"import { sandboxProvider } from './sandboxes';\n",'')
replace(name,"  if (run?.config.sandbox_id) return new SandboxMachines(run, run.config.sandbox_id, sandboxProvider(run.config.sandbox_provider || 'vercel'));\n",'')
name='packages/core/src/git-jobs.ts'
replace(name,"    ['sandboxes', async () => (await import('./sandboxes')).dispatchSandboxes()],\n",'')

# Current financial reporting follows allocation ownership, never Worktree ownership.
name='packages/core/src/billing-usage.ts'
text=read(name)
a=text.index("  const sandboxFilters = "); b=text.index('  const entryFilters:',a)
edits[name]=text[:a]+'''  const worker = query.get('worker_id');
  const workerBind = worker ? bind(worker) : undefined;
  if (workerBind) runFilters.push(`r.config->>'worker_id'=${workerBind}`);
  // A machine can serve several Worktrees/Sessions; a context filter cannot charge it all to one.
  const includeAllocations = !['workspace_id','worktree_id','session_id','run_id','customer_id','agent_key','billing_mode'].some(field => query.has(field));
'''+text[b:]
replace(name,"        b.customer_id,b.agent_key\n", "        b.customer_id,b.agent_key,r.config->>'worker_id' AS worker_id\n")
a=read(name).index("      SELECT l.id,l.created_at,'compute',NULL,s.provider")
b=read(name).index("      SELECT s.id,s.observed_at,'storage'",a)
edits[name]=read(name)[:a]+'''      SELECT l.id,l.created_at,'compute',NULL,h.provider,NULL,l.amount_micro_usd::text,
        jsonb_build_object('worker_id',h.worker_id,'compute_allocation_id',h.id)
      FROM ledger l JOIN hosts h ON split_part(l.reference,':',2)=h.id::text AND split_part(l.reference,':',1)='host'
      WHERE ${includeAllocations ? 'true' : 'false'} AND h.organization_id=$1
        ${workerBind ? `AND h.worker_id=${workerBind}::uuid` : ''}
        AND l.organization_id=$1 AND l.account='consumption' AND l.created_at>=$2 AND l.created_at<$3
      UNION ALL
      SELECT l.id,l.created_at,'compute',NULL,h.provider,NULL,l.amount_micro_usd::text,
        jsonb_build_object('compute_allocation_id',h.id)
      FROM ledger l JOIN compute_history h ON split_part(l.reference,':',2)=h.id::text AND split_part(l.reference,':',1)=h.reference_kind
      WHERE ${includeAllocations && !worker ? 'true' : 'false'} AND h.organization_id=$1
        AND l.organization_id=$1 AND l.account='consumption' AND l.created_at>=$2 AND l.created_at<$3
      UNION ALL
'''+read(name)[b:]
replace(name,"      'run_id',e.run_id,'workspace_id'", "      'worker_id',r.worker_id,'run_id',e.run_id,'workspace_id'")

# Migration history is immutable. Upgrade refuses to orphan live resources or holds,
# archives only financial attribution, and removes the retired operational table.
edits['packages/db/045_worker_cutover.sql']='''-- Retire worktree-owned compute only after the previous deployment has drained it.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM sandboxes WHERE status<>'destroyed' OR active_run_id IS NOT NULL OR reserved_micro_usd<>0)
 OR EXISTS(SELECT 1 FROM runs WHERE config ? 'sandbox_id' AND status NOT IN ('succeeded','failed','cancelled','timed_out')) THEN
  RAISE EXCEPTION 'Drain and destroy previous compute allocations before applying Worker cutover; files and sessions remain durable.';
 END IF;
END $$;

-- Financial journals stay append-only. This small archive contains no credentials,
-- provider binding, executable policy, or resumable compute state.
CREATE TABLE compute_history (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES organizations(id),
 reference_kind text NOT NULL,
 provider text NOT NULL,
 name text,
 created_at timestamptz NOT NULL,
 retired_at timestamptz NOT NULL,
 UNIQUE(organization_id,id)
);
INSERT INTO compute_history(id,organization_id,reference_kind,provider,name,created_at,retired_at)
 SELECT id,organization_id,'sandbox',provider,name,created_at,updated_at FROM sandboxes;
ALTER TABLE compute_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE compute_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON compute_history USING(organization_id::text=current_setting('app.organization_id',true));
CREATE POLICY reporting_read ON compute_history FOR SELECT TO platform_reporting USING(true);
GRANT SELECT ON compute_history TO platform_reporting;
CREATE INDEX compute_history_tenant ON compute_history(organization_id,id);
DROP VIEW reporting.sandbox_schedule;
DROP TABLE sandboxes;

CREATE INDEX hosts_worker_history ON hosts(organization_id,worker_id,id);
CREATE INDEX runs_worker_history ON runs(organization_id,(config->>'worker_id'),id DESC) WHERE config ? 'worker_id';
-- Dormant targets need no polling. Admission/resume wakes a target through existing
-- queue records; live allocations continue reconciliation even after destruction.
CREATE OR REPLACE VIEW reporting.worker_schedule WITH(security_barrier=true) AS
 SELECT w.id,w.organization_id,w.next_check_at FROM workers w
 WHERE EXISTS(SELECT 1 FROM hosts h WHERE h.worker_id=w.id AND h.status<>'stopped')
 OR (w.desired_state='enabled' AND (w.expires_at IS NULL OR w.expires_at>now()) AND
   ((w.settings->>'min_instances')::integer>0 OR EXISTS(
     SELECT 1 FROM runs r WHERE r.organization_id=w.organization_id AND r.config->>'worker_id'=w.id::text
       AND r.status='queued' AND NOT r.cancel_requested AND r.queue_expires_at>now())));
ALTER VIEW reporting.worker_schedule OWNER TO platform_reporting;
'''
replace('scripts/migrate.ts', '    await client.query(\'COMMIT\');', "  await client.query(`REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON compute_history FROM ${role}`);\n  await client.query('COMMIT');")

# The retired ownership model has no compatibility runtime or public aliases.
removed.update(['packages/core/src/sandboxes.ts','packages/core/src/sandbox-machines.ts',
 'packages/providers/src/sandboxes.ts','tests/integration/sandboxes.test.ts','tests/unit/render-sandboxes.test.ts'])

name='packages/core/src/customer-mcp-catalog.ts'
text=read(name)
lines=text.splitlines()
for i,line in enumerate(lines):
    if 'For repeated native runs, createSandbox' in line:
        lines[i]='For reusable compute, createWorker with an economic offering, independent dedicated/isolate_runs choices, finite hourly ceiling and optional scaling bounds. Send worker_id on Runs, not on Worktrees or Sessions. Manual pause drains and stays paused; idle sleep may wake. listWorkerOfferings reveals accepted resources/rates; getWorker reveals capacity and commitments. Read the Workers guide for billing and capability boundaries.'
edits[name]='\n'.join(lines)+'\n'

name='docs/maintainers/TODO.md'
replace(name, '## Worker cutover regression obligations\n', '''## Worker cutover regression obligations

- [ ] Cover the forward-only cutover with closed historical charges and refusal when old compute or reserved funds remain. Verify the financial archive retains itemized journal attribution without credentials or operational state.
- [ ] Cover Worker-filtered Run/usage pagination and ensure individual Worktree/Session filters do not attribute the full shared allocation to a single Run.
''')

# Report unexpected source consumers so cleanup is driven by actual uses, not renaming vendor APIs.
for name,text in edits.items():
    Path(name).parent.mkdir(parents=True,exist_ok=True);Path(name).write_text(text)
for name in removed:
    if not Path(name).is_file(): raise RuntimeError(f'Missing retired file {name}')
    Path(name).unlink()
print('APPLIED_SOURCE_FILES',', '.join(edits));print('REMOVED',', '.join(sorted(removed)))
paths=subprocess.check_output(['git','ls-files'],text=True).splitlines()
for name in paths:
    p=Path(name)
    if p.is_file() and name.startswith(('packages/','scripts/','tests/','apps/web/')) and p.suffix in ('.ts','.tsx','.mjs') and not name.endswith(('api.d.ts','schema.d.ts')):
        for i,line in enumerate(p.read_text().splitlines()):
            if any(term in line for term in ["'./sandboxes'", "'/sandboxes'",'sandbox_id','SandboxMachines','SandboxTools']):
                print('FOLLOWUP',name,i+1,line[:220])
