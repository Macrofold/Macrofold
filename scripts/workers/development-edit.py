"""Reviewed Worker API and authorization integration. The branch runner applies and removes this file."""
from pathlib import Path
from copy import deepcopy
import json

def edit(file,old,new):
    p=Path(file);s=p.read_text()
    if old not in s:raise RuntimeError(f'Expected source changed: {file}: {old[:100]}')
    p.write_text(s.replace(old,new,1))

def obj(properties, required=()):return {'type':'object','properties':properties,'required':list(required),'additionalProperties':False}
def ref(name):return {'$ref':'#/components/schemas/'+name}
def integer(minimum=0,maximum=None):
    value={'type':'integer','minimum':minimum}
    if maximum is not None:value['maximum']=maximum
    return value
string={'type':'string'}
uuid={'type':'string','format':'uuid'}
nullable_uuid={'type':['string','null'],'format':'uuid'}
money={'type':'string','pattern':'^(0|[1-9][0-9]{0,14})$'}
nullable_string={'type':['string','null']}
time={'type':'string','format':'date-time'}
nullable_time={'type':['string','null'],'format':'date-time'}
resources=obj({'memory_mib':integer(1,1048576),'cpu_millis':integer(1,1024000)},['memory_mib','cpu_millis'])
price={'oneOf':[
    obj({'kind':{'type':'string','const':'allocation'},'hourly_micro_usd':money},['kind','hourly_micro_usd']),
    obj({'kind':{'type':'string','const':'resource'},'cpu_hour_micro_usd':money,'gib_hour_micro_usd':money},['kind','cpu_hour_micro_usd','gib_hour_micro_usd'])
]}
settings={
 'name':{'type':'string','minLength':1,'maxLength':100},
 'compute':{'type':'string','enum':['server','sandbox'],'description':'Economic offering, not a placement hint. Macrofold never silently switches this choice.'},
 'dedicated':{'type':'boolean','description':'Exclusive capacity for this Worker. Independent of sibling Run isolation.'},
 'isolate_runs':{'type':'boolean','description':'Require the advertised boundary between sibling Runs. False permits trusted sharing only within this Worker.'},
 'region':{'type':'string','minLength':1,'maxLength':160},'runtime':{'type':'string','minLength':1,'maxLength':160},
 'size':{'type':'string','minLength':1,'maxLength':160,'description':'Optional fixed shape. Omitted uses a fitting accepted catalog shape.'},
 'min_instances':integer(0,64),'max_instances':integer(1,64),'max_concurrency':integer(1,1024),
 'idle_timeout_seconds':{'type':['integer','null'],'minimum':0,'maximum':86400,'description':'Idle scale-down grace. Null retains idle dedicated capacity while enabled and funded.'},
 'expires_at':nullable_time,
 'max_hourly_compute_cost_micro_usd':{**money,'description':'Maximum aggregate committed compute rate, including starting and draining allocations. This is not a model budget or a daily spending budget.'}
}
create=obj(settings)
create['description']='Create an autoscaling execution target independent of Worktrees and Sessions. Defaults resolve from enabled offerings. Instance counts apply only to dedicated capacity.'
patch=obj({**settings,'expected_revision':integer(1)},['expected_revision'])
patch['description']='Revision-checked configuration edit. Changing compute, isolation, runtime, shape or region requires a fully paused Worker.'
offering_props={'id':string,'revision':string,'compute':settings['compute'],'dedicated':{'type':'boolean'},'isolate_runs':{'type':'boolean'},
 'region':string,'runtime':string,'size':string,'resources':ref('WorkerResources'),'concurrency':integer(1,1024),
 'max_host_lifetime_seconds':{'type':['integer','null'],'minimum':1},'price':ref('WorkerPrice')}
worker_props={**deepcopy(settings),'id':uuid,'organization_id':uuid,'revision':integer(1),'name':nullable_string,'size':nullable_string,
 'max_instances':{'type':['integer','null'],'minimum':1},
 'desired_state':{'type':'string','enum':['enabled','paused','destroyed']},
 'status':{'type':'string','enum':['sleeping','starting','ready','draining','paused','destroyed','expired']},
 'active_runs':integer(),'occupied_slots':integer(),'queued_runs':integer(),'ready_instances':integer(),'starting_instances':integer(),'draining_instances':integer(),
 'committed_hourly_compute_cost_micro_usd':money,'cost_micro_usd':{'type':'string','pattern':'^[0-9]+$'},
 'reserved_micro_usd':{'type':'string','pattern':'^[0-9]+$'},'accepted_offerings':{'type':'array','items':ref('WorkerOffering')},
 'failure_code':nullable_string,'created_at':time,'updated_at':time,'observed_at':time}
limits_props={'region':string,'runtime':string,'default_hourly_compute_cost_micro_usd':money,'default_max_instances':integer(1),
 'max_instances':integer(1),'default_max_concurrency':integer(1),'max_concurrency':integer(1)}
p=Path('docs/api/openapi.json');c=json.loads(p.read_text());schemas=c['components']['schemas']
schemas.update({
 'WorkerCreate':create,'WorkerPatch':patch,'WorkerResources':resources,'WorkerPrice':price,
 'WorkerOffering':obj(offering_props,offering_props),'Worker':obj(worker_props,worker_props),
 'WorkerAction':obj({'force':{'type':'boolean','description':'Explicitly cancel active Runs. Cleanup and accounting still complete before release.'}}),
 'WorkerPage':obj({'data':{'type':'array','items':ref('Worker')},'next_cursor':nullable_uuid},['data','next_cursor']),
 'WorkerPolicyLimits':obj(limits_props,limits_props),
 'WorkerOfferings':obj({'data':{'type':'array','items':ref('WorkerOffering')},'limits':ref('WorkerPolicyLimits')},['data','limits']),
})
orgparam=next(x for x in c['paths']['/v1/sandboxes']['get']['parameters'] if x.get('name')=='X-Organization-Id')
pageparams=[{'name':'cursor','in':'query','schema':uuid},{'name':'limit','in':'query','schema':{**integer(1,100),'default':25}}]
def operation(name,summary,scope,response,status=200,body=None,param=False,paged=False,optional=False):
    value={'operationId':name,'summary':summary,'description':summary+'. Worker state, not a transport response, records lifecycle progress. Durable files and conversations are independent of compute.',
      'tags':['Workers'],'security':[{'ApiKeyAuth':[]},{'DashboardSession':[]},{'CustomerOAuth':[scope]}],
      'x-required-scopes':[scope],'parameters':[deepcopy(orgparam)],
      'responses':{str(status):{'description':'Accepted' if status==202 else 'OK','content':{'application/json':{'schema':ref(response)}}},
        'default':{'description':'Error','content':{'application/json':{'schema':ref('Error')}}}}}
    if param:value['parameters'].insert(0,{'name':'worker_id','in':'path','required':True,'schema':uuid})
    if paged:value['parameters']+=pageparams
    if body is not None:value['requestBody']={'required':not optional,'content':{'application/json':{'schema':ref(body)}}}
    if scope=='workers:write':value['parameters'].append({'$ref':'#/components/parameters/Idempotency'})
    return value
c['paths']['/v1/workers']={'get':operation('listWorkers','List authorized compute Workers','workers:read','WorkerPage',paged=True),
 'post':operation('createWorker','Create a cost-controlled Worker','workers:write','Worker',202,'WorkerCreate')}
c['paths']['/v1/workers/{worker_id}']={'get':operation('getWorker','Read Worker configuration and capacity','workers:read','Worker',param=True),
 'patch':operation('patchWorker','Change a Worker configuration revision','workers:write','Worker',body='WorkerPatch',param=True)}
for action in ['pause','resume','destroy']:
    c['paths']['/v1/workers/{worker_id}/'+action]={'post':operation(action+'Worker',action.capitalize()+' Worker execution capacity','workers:write','Worker',202,
      None if action=='resume' else 'WorkerAction',param=True,optional=True)}
c['paths']['/v1/worker-offerings']={'get':operation('listWorkerOfferings','Inspect enabled economic offerings and effective limits','workers:read','WorkerOfferings')}
if not any(t['name']=='Workers' for t in c.get('tags',[])):c.setdefault('tags',[]).append({'name':'Workers','description':'Optional reusable compute, spending and scaling controls.'})
scopes={'workers:read':'Read authorized Worker configuration and aggregate compute usage','workers:use':'Execute authorized Runs using granted Worker capacity','workers:write':'Manage Worker lifecycle, economic contracts and spending limits'}
c['components']['securitySchemes']['CustomerOAuth']['flows']['authorizationCode']['scopes'].update(scopes)
for name in ['RunCreate','MessageCreate']:
    schemas[name]['properties'].update({'worker_id':uuid,
      'memory_mib':{**integer(128,1048576),'description':'Advanced per-Run memory allocation on an explicit Worker. Omitted uses the managed harness estimate.'},
      'cpu_millis':{**integer(1,1024000),'description':'Advanced per-Run CPU allocation in millicores on an explicit Worker.'}})
for name in ['Run','RunAccepted']:
    schemas[name]['properties']['worker_id']=nullable_uuid
reasons=['worker_paused','worker_destroyed','worker_expired','worker_concurrency','worker_cost_limit','worker_instance_limit','worker_starting','worker_capacity','worker_lifetime','compute_unavailable','insufficient_credits']
def update_enums(value):
    if isinstance(value,dict):
        enum=value.get('enum')
        if isinstance(enum,list):
            if 'runs:read' in enum and 'runs:write' in enum:
                value['enum']=enum+[scope for scope in scopes if scope not in enum]
            if 'scheduler_turn' in enum:
                value['enum']=enum+[reason for reason in reasons if reason not in enum]
        for child in value.values():update_enums(child)
    elif isinstance(value,list):
        for child in value:update_enums(child)
update_enums(c)
for name in ['Key','KeyCreate']:
    if name in schemas:schemas[name]['properties']['worker_ids']={'type':'array','items':uuid,'uniqueItems':True,'maxItems':100,'description':'Restrict Worker authority to these IDs. Empty/omitted means all otherwise authorized Workers; it never grants data access.'}
p.write_text(json.dumps(c,indent=2)+'\n')

edit('packages/core/src/api-handlers.ts', "import * as sandboxes from './sandboxes';", "import * as sandboxes from './sandboxes';\nimport * as workers from './workers';\nimport { workerOfferings, workerPolicyLimits, publicOffering } from './worker-catalog';")
edit('packages/core/src/api-handlers.ts', "  createSandbox: c =>", """  createWorker: c => workers.createWorker(c.tx,c.p,input<'WorkerCreate'>(c)),
  getWorker: async c => workers.presentWorker(c.tx,await workers.getWorker(c.tx,c.params.worker_id,c.p)),
  listWorkers: c => workers.listWorkers(c.tx,c.p,c.query),
  patchWorker: c => workers.patchWorker(c.tx,c.p,c.params.worker_id,input<'WorkerPatch'>(c)),
  pauseWorker: c => workers.changeWorker(c.tx,c.p,c.params.worker_id,'pause',input<'WorkerAction'>(c)?.force ?? false),
  resumeWorker: c => workers.changeWorker(c.tx,c.p,c.params.worker_id,'resume'),
  destroyWorker: c => workers.changeWorker(c.tx,c.p,c.params.worker_id,'destroy',input<'WorkerAction'>(c)?.force ?? false),
  listWorkerOfferings: async c => {
    workers.authorizeWorker(c.p,'workers:read');
    const offerings=await workerOfferings(c.tx);
    return {data:offerings.map(publicOffering),limits:await workerPolicyLimits(c.tx,c.p.organizationId,offerings)};
  },
  createSandbox: c =>""")
# A temporary dual-route period exists only within this unmerged implementation branch.
edit('packages/core/src/runs.ts', "import * as sandboxes from './sandboxes';", "import * as sandboxes from './sandboxes';\nimport { workerForRun } from './workers';\nimport { validateWorkerResources } from './worker-pricing';")
edit('packages/core/src/runs.ts', "  let sandbox = input.sandbox_id", """  const worker = input.worker_id ? await workerForRun(tx,p,input.worker_id) : undefined;
  assert(!worker || (!input.sandbox_id && input.keep_warm_seconds === undefined),400,'conflicting_compute',
    'Select one explicit Worker without a per-Run compute lifetime override.');
  assert(worker || (input.memory_mib === undefined && input.cpu_millis === undefined),400,'worker_required',
    'Per-Run compute allocations require an explicit worker_id.');
  const workerResources = worker ? {memory_mib:input.memory_mib ?? 1024,cpu_millis:input.cpu_millis ?? 250} : undefined;
  if(workerResources) validateWorkerResources(workerResources);
  if(worker && worker.settings.expires_at_ms !== null) assert(
    worker.settings.expires_at_ms >= Date.now() + (configured.limits.timeout_seconds + 180) * 1000,
    409,'worker_lifetime','This Run cannot finish inside the Worker expiration window.');
  let sandbox = input.sandbox_id""")
edit('packages/core/src/runs.ts', "  const rate = sandbox ? '0' : computeRate();", "  const rate = worker || sandbox ? '0' : computeRate();")
edit('packages/core/src/runs.ts', '    sandbox_id: sandbox?.id,', '    worker_id: worker?.id,\n    worker_resources: workerResources,\n    sandbox_id: sandbox?.id,')
edit('packages/core/src/runs.ts', '    sandbox_id: sandbox?.id || null,', '    worker_id: worker?.id || null,\n    sandbox_id: sandbox?.id || null,')
edit('packages/core/src/runs.ts', "    sandbox_id: row.kind === 'native_agent' ?", "    worker_id: row.kind === 'native_agent' ? row.config.worker_id || null : null,\n    sandbox_id: row.kind === 'native_agent' ?")

# Independent Worker key restrictions remain orthogonal to Workspace restrictions.
edit('packages/core/src/auth.ts', '  workspaceIds: string[];', '  workspaceIds: string[];\n  workerIds?: string[];')
edit('packages/core/src/auth.ts', '    workspaces: string[] = [],', '    workspaces: string[] = [],\n    workers: string[] = [],')
edit('packages/core/src/auth.ts', '    workspaces = key.workspace_ids;', '    workspaces = key.workspace_ids;\n    workers = key.worker_ids || [];')
edit('packages/core/src/auth.ts', '    workspaceIds: workspaces,', '    workspaceIds: workspaces,\n    workerIds: workers,')
edit('packages/core/src/keys.ts', 'scopes: string[]; workspace_ids: string[];', 'scopes: string[]; workspace_ids: string[]; worker_ids?: string[];')
edit('packages/core/src/keys.ts', '    scopes: row.scopes,', '    scopes: row.scopes,\n    worker_ids: row.worker_ids || [],')
edit('packages/core/src/keys.ts', '  if (input.expires_at)', """  if (p.workerIds?.length) assert(input.worker_ids?.length && input.worker_ids.every(value=>p.workerIds?.includes(value)),
    403,'scope_escalation','A Worker-restricted key cannot create an unrestricted Worker key.');
  if (input.worker_ids?.length) {
    const allowed = await tx.query('SELECT id FROM workers WHERE id=ANY($1::uuid[])',[input.worker_ids]);
    assert(allowed.rowCount === input.worker_ids.length,404,'not_found','One or more Workers are not authorized.');
  }
  if (input.expires_at)""")
edit('packages/core/src/keys.ts', 'scopes,workspace_ids,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', 'scopes,workspace_ids,expires_at,worker_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)')
edit('packages/core/src/keys.ts', '      input.expires_at || null,', '      input.expires_at || null,\n      input.worker_ids || [],')
edit('packages/core/src/workers.ts', "  if (p) authorizeWorker(p, scope);", "  if (p) {\n    authorizeWorker(p, scope);\n    assert(!p.workerIds?.length || p.workerIds.includes(workerId),404,'not_found','Worker not found.');\n  }")
edit('packages/core/src/workers.ts', "SELECT * FROM workers WHERE ($1::uuid IS NULL OR id<$1) ORDER BY id DESC LIMIT $2", "SELECT * FROM workers WHERE ($1::uuid IS NULL OR id<$1) AND (cardinality($3::uuid[])=0 OR id=ANY($3::uuid[])) ORDER BY id DESC LIMIT $2")
edit('packages/core/src/workers.ts', "[query.get('cursor'), limit + 1]", "[query.get('cursor'), limit + 1,p.workerIds || []]")
edit('packages/core/src/workers.ts', '  const worker = await getWorker(tx, workerId, p, \'workers:use\');', "  await lock(tx, `worker:${workerId}`);\n  const worker = await getWorker(tx, workerId, p, 'workers:use');")
edit('packages/db/044_worker_admission.sql', 'GRANT SELECT ON reporting.worker_placement TO platform_app;\n','')

# Keep resource grants checked after queuing and on external actions, not just on initial admission.
edit('packages/core/src/actor-authorization.ts', "    >;", "    > & { worker_id?: string }; ")
edit('packages/core/src/actor-authorization.ts', "AND (cardinality(workspace_ids)=0 OR $4=ANY(workspace_ids))`,", "AND (cardinality(workspace_ids)=0 OR $4=ANY(workspace_ids)) AND ($6::uuid IS NULL OR\n        ('workers:use'=ANY(scopes) AND (cardinality(worker_ids)=0 OR $6=ANY(worker_ids))))`,")
edit('packages/core/src/actor-authorization.ts', 'run.workspace_id, scope],', 'run.workspace_id, scope,run.config.worker_id || null],')
edit('packages/core/src/actor-authorization.ts', "AND t.revoked IS NULL AND c.disabled=false", "AND ($4::uuid IS NULL OR (t.scopes::jsonb ? 'workers:use' AND c.scopes::jsonb ? 'workers:use')) AND t.revoked IS NULL AND c.disabled=false")
edit('packages/core/src/actor-authorization.ts', '`${config.origin}/v1`, scope],', '`${config.origin}/v1`, scope,run.config.worker_id || null],')

# Prove request/response schema generation, not handwritten client copies.
for file in ['packages/core/src/git-jobs.ts','packages/core/src/maintenance.ts']:
    lines=Path(file).read_text().splitlines()
    for i,line in enumerate(lines):
        if 'sandbox' in line.lower() or 'dispatchRuns' in line:print('INTEGRATION_POINT',file,i+1,'\n'.join(lines[max(0,i-3):i+5]))
