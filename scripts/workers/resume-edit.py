from pathlib import Path
import json,subprocess
edits={};removed=set()
def read(p):return edits.get(p,Path(p).read_text())
def replace(p,a,b,count=1):
 s=read(p)
 if s.count(a)!=count:raise RuntimeError(f'{p}: changed anchor {a[:100]} ({s.count(a)}/{count})')
 edits[p]=s.replace(a,b)

for p in ['packages/providers/src/docker.ts','packages/providers/src/vercel.ts']:
 replace(p,"import type { SandboxBinding, SandboxControlRequest } from '../../contracts/sandbox-control';\n",'')
 replace(p,"entry: 'sandbox-control' | 'host-control' = 'sandbox-control'", "entry: 'host-control' = 'host-control'")
 replace(p,"  control(binding: SandboxBinding, secret: string, request: SandboxControlRequest) { return this.controlRequest(binding, secret, request, 'sandbox-control-cli'); }\n",'')
 replace(p,"binding: SandboxBinding | HostBinding, _secret: string, request: SandboxControlRequest | HostControlRequest, entry: 'sandbox-control-cli' | 'host-control-cli'", "binding: HostBinding, _secret: string, request: HostControlRequest, entry: 'host-control-cli'")
replace('packages/providers/src/vercel.ts',"'sandbox_control_failed'", "'host_control_failed'")
for p in ['packages/core/src/worker-catalog.ts','packages/providers/src/hosts.ts']:
 s=read(p);assert 'RENDER_SANDBOX_ENABLED' in s;edits[p]=s.replace('RENDER_SANDBOX_ENABLED','RENDER_WORKER_ENABLED')
replace('infra/runtime.Dockerfile', ' packages/contracts/sandbox-control.ts', '')
p='scripts/build-runtime.ts';s=read(p)
for line in s.splitlines(True):
 if "'sandbox-control'" in line or "'sandbox-control-cli'" in line:s=s.replace(line,'')
edits[p]=s
p='tests/unit/docker-machines.test.ts';s=read(p)
for line in s.splitlines(True):
 if '/opt/platform/sandbox-control-cli.mjs' in line:s=s.replace(line,'')
edits[p]=s
removed.update(['packages/providers/src/render.ts','packages/contracts/sandbox-control.ts',
 'packages/runtime/src/sandbox-control.ts','packages/runtime/src/sandbox-control-cli.ts','tests/fixtures/sandbox-native.mjs'])
# The current native runner retains individual harness/stdio coverage, not an obsolete resource API.
p='scripts/test-native.ts';s=read(p)
s=s.replace("const sandboxes = process.argv.includes('--sandboxes');\n",'')
a=s.index('for (const harness of sandboxes');b=s.index(' {',a)
s=s[:a]+"for (const harness of stdio ? ['stdio'] : selected.length ? selected : harnessNames)"+s[b:]
s=s.replace("        '--sandboxes',\n",'').replace("[...harnessNames, 'stdio', 'sandbox']", "[...harnessNames, 'stdio']")
s=s.replace("        ...(sandboxes ? ['sandbox-control', 'sandbox-control-cli', 'snapshot-page', 'stdio-call'] : []),", "        'snapshot-page', 'stdio-call',")
s=s.replace("sandboxes ? '/tests/sandbox-native.mjs' : stdio ? '/tests/stdio-native.mjs' : '/tests/native-mock.mjs'", "stdio ? '/tests/stdio-native.mjs' : '/tests/native-mock.mjs'")
assert 'sandboxes' not in s;edits[p]=s
# The helper's completion marker precedes its process exit. Await the real handoff
# so a completed restore cannot spuriously fail the launch acknowledgement.
replace('packages/runtime/src/host-control.ts', "          if(value.supervision)return 'started';\n          if(value.children.size)", "          if(value.supervision)return 'started';\n          await value.restoration;\n          if(value.children.size)")
# Existing model fixture supports a scoped workspace; Codex calls must use it too.
replace('tests/fixtures/native-model.mjs', "workdir: '/workspace'", 'workdir: workspace',count=2)
# Optional cache reuse must match every configuration field that affects a native turn.
replace('packages/runtime/src/supervisor.ts', '    model: c.model,', '    model: c.model,\n    modelParameters: c.modelParameters,\n    harnessPromptMode: c.harnessPromptMode,')
p='docs/maintainers/TODO.md'
replace(p,'## Worker cutover regression obligations\n','''## Worker cutover regression obligations

- [ ] Cover restore-marker-before-process-exit handoff: launch waits for the restore child, without touching another Run or spuriously failing an acknowledged restoration.
- [ ] Cover warm harness incompatibility when model parameters or harness prompt mode change; old scoped runtime-control operations must not remain discoverable.
''')
p='package.json';package=json.loads(read(p));package['scripts']['perf:workers']='tsx scripts/workers/stress.ts';edits[p]=json.dumps(package,indent=2)+'\n'
for p,s in edits.items():Path(p).write_text(s)
for p in removed:
 assert Path(p).is_file(),p;Path(p).unlink()
print('APPLIED_SOURCE_FILES',', '.join(edits));print('REMOVED',', '.join(sorted(removed)))
for p in subprocess.check_output(['git','ls-files'],text=True).splitlines():
 f=Path(p)
 if f.is_file() and p.startswith(('packages/','scripts/','tests/','apps/web/')) and f.suffix in ['.ts','.tsx','.mjs'] and not p.endswith(('api.d.ts','schema.d.ts')):
  for i,line in enumerate(f.read_text().splitlines()):
   if any(term in line for term in ['sandbox-control','SandboxBinding','SandboxControl','SandboxProvider','sandbox_id','RENDER_SANDBOX']):print('FOLLOWUP',p,i+1,line[:200])
