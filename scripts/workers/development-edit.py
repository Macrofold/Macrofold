"""Reviewed source-only integration applied once by the isolated branch runner."""
from pathlib import Path

def edit(file,old,new):
    p=Path(file);s=p.read_text()
    if old not in s:raise RuntimeError(f'Expected source changed: {file}: {old[:90]}')
    p.write_text(s.replace(old,new,1))

for file in ['packages/contracts/host-control.ts','packages/core/src/worker-reconciler.ts','packages/providers/src/hosts.ts','packages/runtime/src/host-meter.ts']:
    p=Path(file);p.write_text(p.read_text().replace('cpu_core_ms','cpu_ms'))
edit('packages/runtime/src/agent-processes.ts', "env: { PATH: '/usr/bin:/bin' }", "env: { PATH: '/usr/bin:/bin', NODE_ENV: 'production' }")
edit('packages/runtime/src/host-control.ts', "process.env.PORT||8080", "process.env.PORT||10000")
edit('scripts/build-runtime.ts', "    'packages/runtime/src/entry.ts',", "    'packages/runtime/src/entry.ts',\n    'packages/runtime/src/host-control.ts',\n    'packages/runtime/src/host-control-cli.ts',")
edit('packages/core/src/ports.ts', 'Promise<void | { reused: boolean }>', "Promise<void | { reused: boolean; restoreNamespaces?: ('workspace' | 'home')[] }>")
edit('packages/core/src/cloud-engine.ts', '  inputOffset?: number;', "  inputOffset?: number;\n  workerPrepared?: boolean;\n  restoreNamespaces?: ('workspace' | 'home')[];")
edit('packages/core/src/cloud-engine.ts', "    phase: 'input',", "    phase: run.config.worker_id ? 'provision' : 'input',")
edit('packages/core/src/cloud-engine.ts', "].filter((file) => !isNativeAuthPath(file.namespace, file.path));", "].filter((file) => !isNativeAuthPath(file.namespace, file.path) &&\n          (!state.restoreNamespaces || state.restoreNamespaces.includes(file.namespace)));")
edit('packages/core/src/cloud-engine.ts', "if (state.inputOffset >= source.length) state.phase = 'provision';", "if (state.inputOffset >= source.length) state.phase = state.workerPrepared ? 'hydrate' : 'provision';")
edit('packages/core/src/cloud-engine.ts', "      state.phase = prepared?.reused ? 'launch' : 'hydrate';", "      state.restoreNamespaces = prepared?.restoreNamespaces;\n      state.workerPrepared = Boolean(run.config.worker_id);\n      state.phase = prepared?.reused ? 'launch' : state.workerPrepared ? 'input' : 'hydrate';")

p=Path('packages/runtime/src/host-control.ts');s=p.read_text()
s=s.replace('directory: string; filesReused: boolean;', 'directory: string; filesReused: boolean; sessionReused: boolean;')
s=s.replace('preparation?: Promise<{ reused: boolean }>', "preparation?: Promise<{ reused: boolean; restoreNamespaces: ('workspace'|'home')[] }>")
s=s.replace('directory:paths.control,filesReused,finished:false', 'directory:paths.control,filesReused,sessionReused:!!handle.runtime.child,finished:false')
s=s.replace('return {reused:filesReused};', "const restoreNamespaces: ('workspace'|'home')[] = value.sessionReused ? [] : filesReused ? ['home'] : ['workspace','home'];\n      return {reused:value.sessionReused,restoreNamespaces};")
s=s.replace("if(value.filesReused)return 'started';", "if(value.sessionReused)return 'started';")
s=s.replace("if(value.filesReused)return 'success';", "if(value.sessionReused)return 'success';")
s=s.replace("          if(value.children.size)throw new Error('assignment_preparing');", """          if(value.children.size)throw new Error('assignment_preparing');
          try { await readFile(`${value.directory}/cancel`); throw new Error('run_stopped'); }
          catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error; }
          if(!value.sessionReused) {
            const restored=JSON.parse(await readFile(`${value.directory}/restore-result.json`,'utf8'));
            if(!restored.ok)throw new Error('restore_failed');
          }""")
s=s.replace("for (const old of this.handles.values()) if (old.worktree===request.worktree_id && old!==handle) await this.evict(old);", "for (const old of this.handles.values()) if (old!==handle && (old.worktree===request.worktree_id || config.isolate_runs)) await this.evict(old);")
p.write_text(s)
edit('tests/integration/workers.test.ts', "    const after=await tx(t=>presentWorker(t,getWorkerPlaceholder()));\n    function getWorkerPlaceholder():never{throw new Error('unreachable');}\n    expect(after).toBeDefined();", "    const after=await tx(async t=>presentWorker(t,await getWorker(t,created.id)));\n    expect(after.status).toBe('destroyed');")
