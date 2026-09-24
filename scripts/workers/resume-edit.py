from pathlib import Path

edits = {}
def read(name): return edits.get(name, Path(name).read_text())
def replace(name, old, new, count=1):
    text=read(name)
    if text.count(old)!=count: raise RuntimeError(f'{name}: changed anchor {old[:100]} ({text.count(old)}/{count})')
    edits[name]=text.replace(old,new)

# A changed runtime is not evidence that a paid allocation stopped.
name='packages/providers/src/docker.ts'
replace(name, '  async environmentRunning(binding: MachineBinding) {', '''  async generationRunning(binding: MachineBinding) {
    const current = await this.lookup(binding.name);
    if (!current || !current.State.Running) return false;
    assert(current.Id === binding.sessionId && current.State.StartedAt === binding.createdAt,
      409, 'host_generation_changed', 'The allocation is still running but its original execution generation was replaced.');
    return true;
  }
  async environmentRunning(binding: MachineBinding) {''')
name='packages/providers/src/vercel.ts'
replace(name, '  async environmentRunning(binding: MachineBinding) {', '''  async generationRunning(binding: MachineBinding) {
    paid();
    let sandbox: Sandbox;
    try { sandbox = await Sandbox.get({ name: binding.name, resume: false }); }
    catch (error) { if (providerCode(error) === 404) return false; throw error; }
    const session = sandbox.currentSession();
    if (session.status !== 'running') return false;
    assert(session.sessionId === binding.sessionId, 409, 'host_generation_changed',
      'The allocation is still running but its original execution generation was replaced.');
    return true;
  }
  async environmentRunning(binding: MachineBinding) {''')
name='packages/providers/src/hosts.ts'
replace(name, '  exists(binding: HostBinding, _secret: string) { return this.machines.environmentRunning(binding); }', '''  async exists(binding: HostBinding, secret: string) {
    if (!await this.machines.generationRunning(binding)) return false;
    const health = hostHealth.parse(await this.machines.hostControl({ ...binding, controlBootId: undefined }, secret, { action: 'health' }));
    assert(!binding.controlBootId || health.boot_id === binding.controlBootId, 409, 'host_generation_changed',
      'The Host controller restarted; running compute must be stopped before releasing its financial reservation.');
    return true;
  }''', count=2)
replace(name, '    return health.boot_id === binding.controlBootId;', '''    assert(health.boot_id === binding.controlBootId, 409, 'host_generation_changed',
      'The Host controller restarted; the provider allocation is not confirmed stopped.');
    return true;''')
name='packages/contracts/host-control.ts'
replace(name, '  exists(binding: HostBinding, secret: string): Promise<boolean>;', '''  /** False means confirmed stopped/absent. A changed live generation throws instead of releasing liability. */
  exists(binding: HostBinding, secret: string): Promise<boolean>;''')

name='packages/core/src/worker-reconciler.ts'
replace(name, '    let meters: ComputeMeters | undefined;', '''    // A restarted controller cannot prove ownership of its old process trees. Stop the
    // allocation, not just its DB lease; Run recovery then releases the fenced claims.
    if (host.failure_code === 'host_generation_changed' && !host.stopped_at) {
      if (!await provider.destroy(host.provider_name, host.binding)) return;
      await mutateHost(org, hostId, leaseId, async tx => {
        await tx.query("UPDATE hosts SET status='draining',stopped_at=now(),updated_at=now() WHERE id=$1", [hostId]);
        await tx.query(`UPDATE dispatch_jobs SET available_at=now() WHERE kind='run' AND resource_id IN
          (SELECT run_id FROM host_runs WHERE host_id=$1 AND released_at IS NULL)`, [hostId]);
      });
      host = await transaction(org, tx => getHost(tx, hostId));
    }
    let meters: ComputeMeters | undefined;''')
replace(name, '        warm_memory_mib: Math.floor(host.memory_mib / 4), warm_idle_seconds: 300 });',
 '        warm_memory_mib: host.offering.isolate_runs ? 0 : Math.floor(host.memory_mib / 4), warm_idle_seconds: 300 });')
replace(name, "['host_isolation_unavailable','host_meter_unavailable','host_stopped','host_funding_exhausted'].includes(code)",
 "['host_isolation_unavailable','host_meter_unavailable','host_stopped','host_funding_exhausted','host_generation_changed'].includes(code)")

# Strong isolated execution uses a fresh allocation for each assignment. Different
# UIDs alone cannot remove arbitrary world-readable scratch files from an old Run.
name='packages/core/src/host-allocations.ts'
replace(name, "  await tx.query(`UPDATE hosts SET idle_since=CASE WHEN NOT EXISTS(SELECT 1 FROM host_runs WHERE host_id=$1 AND released_at IS NULL)",
 "  await tx.query(`UPDATE hosts SET status=CASE WHEN (offering->>'isolate_runs')::boolean THEN 'draining' ELSE status END,\n    idle_since=CASE WHEN NOT EXISTS(SELECT 1 FROM host_runs WHERE host_id=$1 AND released_at IS NULL)")
name='packages/runtime/src/host-control.ts'
replace(name, '  children: Set<ChildProcess>; released: boolean; recovery: boolean;',
 '  children: Set<ChildProcess>; restoration?: Promise<string>; released: boolean; recovery: boolean;')
replace(name, '      rotation_requested: this.tombstones.size >= 90000,',
 '      rotation_requested: this.tombstones.size >= 90000 || !!(this.configuration?.isolate_runs && this.tombstones.size),')
replace(name, '    const active = [...this.assignments.values()].filter(item=>!item.released).reduce((sum,item)=>sum+item.request.resources.memory_mib,0);',
 '    const active = [...this.assignments.values()].filter(item=>!item.released).reduce((sum,item)=>sum+item.request.resources.memory_mib,0);\n    const headroom = Math.min(512, Math.ceil(config.resources.memory_mib / 8));')
replace(name, 'active + memory + requiredMiB > config.resources.memory_mib - 512',
 'active + memory + requiredMiB > config.resources.memory_mib - headroom')
replace(name, "      if (!(await lstat(value)).isDirectory()) throw new Error('unsafe_runtime_root');\n      await new Promise<void>((resolve,reject)=>{", '''      const current = await lstat(value);
      if (!current.isDirectory()) throw new Error('unsafe_runtime_root');
      // A warm handle already owns its tree. Avoid recursively visiting a large
      // unchanged Worktree on every turn; cold identity handoff still repairs it.
      if (current.uid !== uid || current.gid !== uid) await new Promise<void>((resolve,reject)=>{''')
replace(name, "    if (!config || this.tombstones.size >= 100000) throw new Error('host_rotation_required');", """    if (!config || this.tombstones.size >= 100000 || (config.isolate_runs && this.tombstones.size > 0))
      throw new Error('host_rotation_required');""")
replace(name, "          if (value.supervision) throw new Error('assignment_already_launched');", "          if (value.supervision || value.restoration) throw new Error('assignment_already_restoring');")
replace(name, "          const task=this.command(value,'restore');\n          void task.result.catch(()=>{});", """          // An acknowledgement may be lost. Retrying restore must never create a
          // second writer or truncate files while the original restore is active.
          if (!value.restoration) {
            value.restoration = this.command(value,'restore').result;
            void value.restoration.catch(()=>{});
          }""")

name='docs/maintainers/TODO.md'
replace(name, '## Worker cutover regression obligations\n', '''## Worker cutover regression obligations

- [ ] Cover a live provider allocation whose container/session/controller generation changes: stop confirmed compute before releasing the hold, recover old Run claims without replay, and retain unknown metering tails for reconciliation.
- [ ] Cover isolated allocation retirement after one Run, restore acknowledgement loss, staging after restore starts, and warm ownership handoff without recursive filesystem traversal.
''')
for name, text in edits.items(): Path(name).write_text(text)
print('APPLIED_SOURCE_FILES', ', '.join(edits))
