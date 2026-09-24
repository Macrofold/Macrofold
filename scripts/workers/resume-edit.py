from pathlib import Path
import subprocess

expected = {
    'packages/runtime/src/host-control.ts': 'c777a60ea1680f0c9f757496ea718d578b582825',
    'packages/runtime/src/supervisor.ts': 'b7c24492b4ac731bb9edaf8533254bb395115f7c',
    'docs/maintainers/TODO.md': '30e0384bc34d5f607ebcea043d83459936c7fa3c',
}
for name, sha in expected.items():
    if subprocess.check_output(['git', 'hash-object', name], text=True).strip() != sha:
        raise RuntimeError(f'Concurrent edit: {name}')

p=Path('packages/runtime/src/host-control.ts')
s=p.read_text()
s=s.replace('children: Set<ChildProcess>; restoration?: Promise<string>; released: boolean; recovery: boolean;', 'children: Set<ChildProcess>; restoration?: Promise<string>; released: boolean; recovery: boolean; meterClaimed: boolean;')
s=s.replace('private async evict(handle: Handle) {\n    if (handle.active)', 'private async evict(handle: Handle, releasingAssignment?: string) {\n    if (handle.active && handle.active !== releasingAssignment)')
s=s.replace('if (!this.writers.has(handle.worktree)) {', 'if (!this.writers.has(handle.worktree) || this.writers.get(handle.worktree) === releasingAssignment) {')
s=s.replace('children:new Set(),released:false,recovery:false};', 'children:new Set(),released:false,recovery:false,meterClaimed:false};')
s=s.replace('if (this.metered) await this.meter.claim(value.id,request.resources.memory_mib);', '''if (this.metered) {
        await this.meter.claim(value.id,request.resources.memory_mib);
        value.meterClaimed = true;
      }''')
s=s.replace("            }).finally(()=>{value.finished=true;});\n          return 'started';", "            }).finally(()=>{value.finished=true;});\n          void value.supervision.catch(()=>{});\n          return 'started';")
start=s.index('          value.handle.active=null;')
end=s.index('          value.released=true;',start)
s=s[:start]+'''          // Keep the writer and resource claim until every fallible cleanup step
          // succeeds. A retry must not race a new Run against unconfirmed writers.
          const retain = clean && value.handle.runtime.child && value.handle.runtime.child.exitCode === null;
          const memoryMiB = retain ? await agentMemoryMiB(value.handle.uid) : 0;
          if (!retain) await this.evict(value.handle, value.id);
          if (value.meterClaimed) await this.meter.release(value.id);
          value.meterClaimed = false;
          value.handle.active = null;
          value.handle.lastUsed = Date.now();
          this.writers.delete(value.request.worktree_id);
          if (clean) {
            this.files.set(value.request.worktree_id, { checkpoint: request.checkpoint_id, permission: value.request.permission_view,
              bytes: typeof result.snapshotBytes === 'number' ? result.snapshotBytes : 0, lastUsed: Date.now() });
            value.handle.checkpoint = request.checkpoint_id;
            value.handle.sessionRevision = request.session_revision;
            value.handle.runtime.checkpointId = request.checkpoint_id;
            value.handle.memoryMiB = memoryMiB;
          }
'''+s[end:]
pos=s.index('  private async own(')
s=s[:pos]+'''  async sweep(): Promise<void> {
    if (!this.configuration || this.quiesced) return;
    await this.commands.run('allocation', async () => {
      if (!this.quiesced) await this.trimCaches();
    });
  }
'''+s[pos:]
s=s.replace('  server.requestTimeout=60000;server.headersTimeout=10000;', '''  let sweeping = false;
  const maintenance = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    void controller.sweep().catch(() => {
      console.error(JSON.stringify({ event: 'host.cache_cleanup_failed' }));
    }).finally(() => { sweeping = false; });
  }, 10000);
  maintenance.unref();
  server.once('close', () => clearInterval(maintenance));
  server.requestTimeout=60000;server.headersTimeout=10000;''')
p.write_text(s)
p=Path('packages/runtime/src/supervisor.ts')
s=p.read_text()
s=s.replace('  let stopAt: number | undefined,\n    checking = false;', '  let stopAt: number | undefined;\n  let checking: Promise<void> | undefined;')
s=s.replace('    checking = true;\n    void (async () => {','    checking = (async () => {')
s=s.replace('        checking = false;', '        checking = undefined;')
s=s.replace('  let retained = false;', '''  const stopChecking = async () => {
    clearInterval(timer);
    // A timer callback may already be awaiting /proc or an input file. It must
    // finish before this UID can be retained and assigned to the next turn.
    await checking;
  };
  let retained = false;''')
s=s.replace('      await finished;\n      await dispatch;', '      await finished;\n      await dispatch;\n      await stopChecking();')
s=s.replace('    clearInterval(timer);\n    lines.close();', '    await stopChecking();\n    lines.close();')
p.write_text(s)
p=Path('docs/maintainers/TODO.md')
s=p.read_text().replace('## Worker cutover regression obligations\n', '''## Worker cutover regression obligations

- [ ] Cover release failures during process discard, filesystem cleanup and final resource metering: keep Worktree and capacity ownership until cleanup succeeds, retry idempotently, and never advertise an unpublished cache. A transient health-meter failure must not skip releasing an already-metered assignment.
- [ ] Cover a pending supervisor timer at the native result boundary and ensure it cannot cancel a later turn reusing the same UID. Cover bounded idle-cache maintenance without subsequent traffic and no unhandled supervisor-cleanup rejection.
''')
p.write_text(s)
subprocess.run(['pnpm','exec','prettier','--write','packages/runtime/src/host-control.ts','packages/runtime/src/supervisor.ts'],check=True)
print('Applied reviewed runtime ownership fixes; regression obligations recorded, no test suite invoked.')
