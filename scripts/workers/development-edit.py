"""Reviewed changes for real API/native acceptance; applied once on the feature branch."""
from pathlib import Path
import json,re

def edit(file,old,new):
    p=Path(file);s=p.read_text()
    if old not in s:raise RuntimeError(f'Expected source changed: {file}: {old[:100]}')
    p.write_text(s.replace(old,new,1))

edit('tests/fixtures/native-model.mjs', '  journey = false,', "  journey = false,\n  workspace = '/workspace',")
edit('tests/fixtures/native-model.mjs', "const bypassCommand = 'cat /workspace/private.env; printf escaped > /workspace/bypass.txt';", 'const bypassCommand = `cat ${workspace}/private.env; printf escaped > ${workspace}/bypass.txt`;')
edit('tests/fixtures/native-model.mjs', "hasWorkspaceContext: system.includes('/workspace')", 'hasWorkspaceContext: system.includes(workspace)')
edit('tests/fixtures/native-model.mjs', "{ file_path: '/workspace/' + filename, content }", "{ file_path: workspace + '/' + filename, content }")
edit('tests/fixtures/worker-native.mjs', 'readFile, writeFile, readdir', 'readFile, writeFile')
edit('tests/integration/workers.test.ts', 'afterAll, beforeAll,', 'afterAll, afterEach, beforeAll,')
edit('tests/integration/workers.test.ts', 'afterAll(async()=>{', "afterEach(async()=>{\n  await tx(t=>t.query(\"UPDATE runs SET cancel_requested=true WHERE config ? 'worker_id' AND status='queued'\").then(()=>{}));\n});\nafterAll(async()=>{")
p=Path('package.json');s=json.loads(p.read_text());s['scripts']['test:workers:native']='tsx scripts/test-workers-native.ts';p.write_text(json.dumps(s,indent=2)+'\n')
# Tests own every native fixture container, including timeout cleanup.
edit('scripts/test-workers-native.ts', "import { spawn }", "import { randomUUID } from 'node:crypto';\nimport { spawn }")
edit('scripts/test-workers-native.ts', "  const args=['run','--rm',", "  const name=`worker-acceptance-${randomUUID()}`;\n  const args=['run','--rm','--name',name,")
edit('scripts/test-workers-native.ts', '  await new Promise<void>((resolve,reject)=>{', '  try { await new Promise<void>((resolve,reject)=>{')
edit('scripts/test-workers-native.ts', "  });\n}\nfor(const harness", "  }); } finally {\n    await new Promise<void>(resolve=>{\n      const cleanup=spawn('docker',['rm','-f',name],{stdio:'ignore'});\n      cleanup.once('error',()=>resolve());cleanup.once('close',()=>resolve());\n    });\n  }\n}\nfor(const harness")
# Historical private local assets are not valid repository links. Retain their provenance as unavailable evidence.
for p in Path('docs/product').rglob('*.md'):
    s=p.read_text()
    def evidence(match):
        label,target=match.group(1),match.group(2)
        resolved=(p.parent/target.split('#')[0]).resolve()
        if '/output/' in str(resolved) and not resolved.exists():
            return f'{label} (`{target}`, local historical evidence not included in this repository)'
        return match.group(0)
    s=re.sub(r'\[([^\]]+)\]\(([^\s)]+)\)',evidence,s)
    p.write_text(s)
