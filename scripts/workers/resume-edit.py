from pathlib import Path
edits={}
def read(p):return edits.get(p,Path(p).read_text())
def replace(p,a,b,count=1):
 s=read(p)
 if s.count(a)!=count:raise RuntimeError(f'{p}: changed anchor {a[:100]}')
 edits[p]=s.replace(a,b)
replace('apps/web/components/workers.tsx', "import { useState } from 'react';", "import { useState } from 'react';\nimport type { Result } from 'macrofold';")
replace('apps/web/components/workers.tsx', "Schema['WorkerOfferingList']['limits']", "Result<'listWorkerOfferings'>['limits']")
replace('scripts/workers/native-load.mjs', "permission_view: 'native-load-authorized-view', compatibility_key: `native-load-${harness}`,", "permission_view: createHash('sha256').update('native-load-authorized-view').digest('hex'),\n      compatibility_key: createHash('sha256').update(`native-load-${harness}`).digest('hex'),")
replace('packages/runtime/src/host-control.ts', "      const code=error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:'host_control_failed';", """      const code=error instanceof z.ZodError ? 'invalid_host_request' :
        error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:'host_control_failed';
      // Never log request bodies, credentials, prompts, file contents, or exception
      // messages containing user data. Codes and schema paths are enough to triage.
      const systemCode = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^E[A-Z_]+$/.test(error.code) ? error.code : undefined;
      console.error(JSON.stringify({ event: 'host.control_failed', code, system_code: systemCode,
        issues: error instanceof z.ZodError ? error.issues.slice(0, 8).map(issue => ({ path: issue.path.join('.'), code: issue.code })) : undefined }));""")
for p,s in edits.items():Path(p).write_text(s)
print('APPLIED_SOURCE_FILES',', '.join(edits))
