"""Reviewed source edits. The feature workflow applies these once and removes the script."""
from pathlib import Path
import json

def edit(file,old,new):
    p=Path(file);s=p.read_text()
    if old not in s:raise RuntimeError(f'Expected source changed: {file}: {old[:100]}')
    p.write_text(s.replace(old,new,1))

# Inline response variants must follow the same accepted-Run contract as the named schema.
p=Path('docs/api/openapi.json');c=json.loads(p.read_text());changed=[]
def accepted(value,where=''):
    if isinstance(value,dict):
        properties=value.get('properties',{})
        if 'run_id' in properties and 'session_id' in properties and 'events_url' in properties:
            properties['worker_id']={'type':['string','null'],'format':'uuid'}
            changed.append(where)
        for key,child in value.items():accepted(child,where+'/'+key)
    elif isinstance(value,list):
        for i,child in enumerate(value):accepted(child,where+'/'+str(i))
accepted(c)
print('UPDATED_ACCEPTED_RUN_SCHEMAS',changed)
keypaths=[route for route,methods in c['paths'].items() if any(isinstance(op,dict) and op.get('operationId')=='createKey' for op in methods.values())]
assert len(keypaths)==1,keypaths
p.write_text(json.dumps(c,indent=2)+'\n')
p=Path('tests/integration/workers-api.test.ts');s=p.read_text();s=s.replace("'POST','/v1/keys'", "'POST',"+repr(keypaths[0]));p.write_text(s)
print('KEY_CREATE_ENDPOINT',keypaths[0])

edit('packages/cli/src/commands.ts', "import { handlers as", "import { handlers as") if False else None
p=Path('packages/cli/src/commands.ts');s=p.read_text()
s="import { workerCommands, workerRunOptions } from './workers';\n"+s
marker='export const handlers: Record<string, Handler> = {'
assert marker in s
s=s.replace(marker,marker+'\n  ...workerCommands,',1)
marker='...ctx.execution(),'
# Compute selection is a Run concern, never a SessionCreate configuration.
run_start=s.index("  run:") if '  run:' in s else s.index("  'run':")
idx=s.index(marker,run_start)
s=s[:idx]+s[idx:].replace(marker,marker+'\n        ...(await workerRunOptions(ctx)),',1)
p.write_text(s)

p=Path('packages/cli/src/chat.ts');s=p.read_text();s="import { workerRunOptions } from './workers';\n"+s
# Resolve an optional Worker for each submitted turn without mutating Session configuration.
needle='prompt,'
# Add only to the sendMessage body; display strings and input loops remain unchanged.
loc=s.index("'sendMessage'") if "'sendMessage'" in s else s.index('"sendMessage"')
body=s.index('body:',loc)
brace=s.index('{',body)
s=s[:brace+1]+"\n          ...(await workerRunOptions(ctx)),"+s[brace+1:]
p.write_text(s)

p=Path('packages/cli/src/index.ts');s=p.read_text()
needle='const commonFlags = {'
if needle not in s:needle='const commonFlags = {'
assert needle in s
flags="""
  worker: Flags.string({ description: 'Optional reusable Worker ID or exact name' }),
  compute: Flags.string({ options: ['server', 'sandbox'], description: 'Worker economic offering' }),
  dedicated: Flags.boolean({ exclusive: ['pooled'], description: 'Reserve exclusive Worker capacity' }),
  pooled: Flags.boolean({ exclusive: ['dedicated'], description: 'Use metered capacity rather than whole allocations' }),
  'shared-runs': Flags.boolean({ exclusive: ['isolated-runs'], description: 'Permit trusted sibling Runs to share an environment' }),
  'isolated-runs': Flags.boolean({ exclusive: ['shared-runs'], description: 'Require isolated sibling execution' }),
  'min-instances': Flags.integer({ min: 0, description: 'Dedicated baseline capacity' }),
  'max-instances': Flags.integer({ min: 1, description: 'Dedicated allocation ceiling' }),
  'max-concurrency': Flags.integer({ min: 1, description: 'Worker-wide occupied execution ceiling' }),
  'idle-timeout': Flags.integer({ min: 0, exclusive: ['keep-alive'], description: 'Idle scale-down grace in seconds' }),
  'keep-alive': Flags.boolean({ exclusive: ['idle-timeout'], description: 'Retain idle dedicated capacity while enabled and funded' }),
  'max-hourly-cost': Flags.string({ description: 'Aggregate Worker compute rate ceiling in USD, e.g. 1.50' }),
  'expires-at': Flags.string({ description: 'Optional Worker retirement time in UTC RFC3339 format' }),
  runtime: Flags.string({ description: 'Accepted managed runtime version' }),
  region: Flags.string({ description: 'Required advertised compute region' }),
  size: Flags.string({ description: 'Optional fixed resource shape; otherwise select automatically' }),
  revision: Flags.integer({ min: 1, description: 'Expected Worker configuration revision' }),
  'memory-mib': Flags.integer({ min: 128, description: 'Advanced per-Run memory allocation; requires --worker' }),
  'cpu-millis': Flags.integer({ min: 1, description: 'Advanced per-Run CPU millicores; requires --worker' }),
"""
# Existing --name remains the canonical update label if already defined.
if not __import__('re').search(r'^\s+name:\s*Flags\.',s,__import__('re').M):flags+="  name: Flags.string({ description: 'Resource display name' }),\n"
s=s.replace(needle,needle+flags,1)
# Read exact command-registration layout to make a verified second small wiring edit if necessary.
p.write_text(s)
print('CLI_REGISTRATION_SOURCE',s[s.index('const commands'):] if 'const commands' in s else s[-9000:])

# Quote-scoped management keys may never create capacity outside their authorized Worker set.
edit('packages/core/src/workers.ts', "  authorizeWorker(p, 'workers:write');\n  await lock(tx, `workers:${p.organizationId}`);", "  authorizeWorker(p, 'workers:write');\n  assert(!p.workerIds?.length,403,'worker_management_forbidden','A Worker-restricted credential cannot create another Worker.');\n  await lock(tx, `workers:${p.organizationId}`);")
