"""Inspect affected contracts and callers before the coordinated Worker cutover."""
from pathlib import Path
import json, subprocess
for command in [
 ['git','grep','-n','SandboxMachines'],
 ['git','grep','-n','sandbox_id','--','packages/cli','apps/web','packages/core/src/http-contract.ts','packages/core/src/api-types.ts','scripts'],
 ['git','ls-files','*AGENTS.md'],
]:
 print('INSPECTION', ' '.join(command), flush=True)
 subprocess.run(command, check=False)
api=json.loads(Path('docs/api/openapi.json').read_text())
for name in ['Sandbox','SandboxCreate','RunCreate','Run','RunAccepted','MessageCreate','Capabilities']:
 print('API_SCHEMA',name,json.dumps(api['components']['schemas'].get(name)))
for path,methods in api['paths'].items():
 if 'sandbox' in path:
  print('API_PATH',path,json.dumps(methods))
print('SCOPES',json.dumps(api['components']['securitySchemes']))
for filename in ['packages/core/src/worker.ts','packages/core/src/execution.ts','packages/core/src/composition.ts','apps/web/AGENTS.md','packages/providers/AGENTS.md','packages/contracts/AGENTS.md','tests/AGENTS.md','packages/cli/AGENTS.md','tests/integration/gateway.test.ts','tests/integration/ledger-boundaries.test.ts']:
 p=Path(filename)
 if p.is_file(): print('FILE',filename,'\n'+p.read_text())
