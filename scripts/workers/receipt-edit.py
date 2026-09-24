from pathlib import Path
import re

# Reviewed, one-shot edits. Validate every anchor before writing source files.
edits = {}
def read(name):
    return edits[name] if name in edits else Path(name).read_text()
def replace(name, before, after, count=1):
    text = read(name)
    if text.count(before) != count:
        raise RuntimeError(f'{name}: expected {count} reviewed anchors, got {text.count(before)}: {before[:100]}')
    edits[name] = text.replace(before, after)

p = 'packages/contracts/host-control.ts'
replace(p, "  z.object({ action: z.literal('health') }),", "  z.object({ action: z.literal('health') }),\n  z.object({ action: z.literal('quiesce') }),")
replace(p, 'configured: z.boolean(), rotation_requested:', 'configured: z.boolean(), quiesced: z.boolean().optional(), rotation_requested:')
replace(p, '  provision(spec: HostProvisionSpec): Promise<HostBinding | null>;', '''  provision(spec: HostProvisionSpec): Promise<HostBinding | null>;
  /** Idempotent controller startup, after the domain has persisted the billable allocation receipt. */
  start?(binding: HostBinding, secret: string): Promise<void>;''')

p = 'packages/providers/src/hosts.ts'
replace(p, "    if (request.action === 'health') return {", "    if (request.action === 'health' || request.action === 'quiesce') return {\n      quiesced: request.action === 'quiesce',")
replace(p, '''    await this.machines.startHostControl(binding, spec.secret);
    const health = hostHealth.parse(await this.machines.hostControl(binding, spec.secret, { action: 'health' }));
    return { ...binding, controlBootId: health.boot_id };''', '''    return binding;''', count=2)
replace(p, '''  async exists(binding: HostBinding, secret: string) {
    if (!await this.machines.generationRunning(binding)) return false;''', '''  start(binding: HostBinding, secret: string) { return this.machines.startHostControl(binding, secret); }
  async exists(binding: HostBinding, secret: string) {
    if (!await this.machines.generationRunning(binding)) return false;''', count=2)

p = 'packages/core/src/automatic-machines.ts'
replace(p, "    if (!binding) throw new AppError(503, 'worker_starting', 'Isolated execution capacity is starting.');\n    return binding;", '''    if (!binding) throw new AppError(503, 'worker_starting', 'Isolated execution capacity is starting.');
    await this.provider.start?.(binding, await this.secret());
    const health = hostHealth.parse(await this.provider.control(binding, await this.secret(), { action: 'health' }));
    return { ...binding, controlBootId: health.boot_id };''')

p = 'packages/runtime/src/host-control.ts'
replace(p, "import { HostMeter } from './host-meter';", "import { HostMeter, type HostResourceMeters } from './host-meter';")
replace(p, '  private metered: boolean | undefined;', '''  private metered: boolean | undefined;
  private quiesced = false;
  private finalMeters: HostResourceMeters | null = null;''')
replace(p, '''    let meters = null;
    try { meters = await this.meter.sample(); this.metered = true; }
    catch { this.metered = false; }''', '''    let meters = this.finalMeters;
    if (!this.quiesced) {
      try { meters = await this.meter.sample(); this.metered = true; }
      catch { this.metered = false; }
    }''')
replace(p, 'started_at: this.startedAt, configured: !!this.configuration,', 'started_at: this.startedAt, configured: !!this.configuration, quiesced: this.quiesced,')
replace(p, '    if (!config || this.tombstones.size >= 100000', '    if (!config || this.quiesced || this.tombstones.size >= 100000')
replace(p, "    if (request.action==='configure') return this.commands.run('allocation',async()=>{", '''    if (request.action==='quiesce') return this.commands.run('allocation',async()=>{
      if (this.quiesced) return this.health();
      if ([...this.assignments.values()].some(value => !value.released)) throw new Error('runtime_not_quiescent');
      for (const handle of [...this.handles.values()]) await this.evict(handle);
      // This immutable receipt survives lost acknowledgements. Once sealed, this
      // generation cannot admit another assignment or accrue customer workload usage.
      const health = await this.health();
      this.finalMeters = health.meters;
      this.quiesced = true;
      return { ...health, quiesced: true };
    });
    if (request.action==='configure') return this.commands.run('allocation',async()=>{
      if (this.quiesced) throw new Error('host_rotation_required');''')

p = 'packages/core/src/host-allocations.ts'
replace(p, '  funded_until: Date; started_at: Date | null;', '  usage_finalized_at: Date | null;\n  funded_until: Date; started_at: Date | null;')
replace(p, '''  return rows.map(row => ({
    id: row.id''', '''  const byHost = new Map<string, HostSnapshot['worktrees']>();
  for (const cache of caches) {
    const entries = byHost.get(cache.host_id) || [];
    entries.push({ worktree_id: cache.worktree_id, revision: cache.checkpoint_id || 'empty',
      permission_view: cache.permission_view, state: cache.state });
    byHost.set(cache.host_id, entries);
  }
  return rows.map(row => ({
    id: row.id''')
replace(p, '''    worktrees: caches.filter(cache => cache.host_id === row.id).map(cache => ({ worktree_id: cache.worktree_id,
      revision: cache.checkpoint_id || 'empty', permission_view: cache.permission_view, state: cache.state })), warm_harnesses: [],''', '''    worktrees: byHost.get(row.id) || [], warm_harnesses: [],''')
replace(p, "status='stopped',stopped_at=now(),reserved_micro_usd=0", "status='stopped',stopped_at=coalesce(stopped_at,now()),reserved_micro_usd=0")

p = 'packages/core/src/worker-reconciler.ts'
replace(p, "import { getNativeRun, type NativeRunRow } from './runs';", "import type { NativeRunRow } from './runs';")
replace(p, "    if (host.status === 'stopped' || (host.lease_until", "    if (host.status === 'stopped' || host.next_check_at.getTime() > Date.now() || (host.lease_until")
replace(p, "      const health = hostHealth.parse(await provider.control(binding, secret, { action: 'health' }));", "      await provider.start?.(binding, secret);\n      const health = hostHealth.parse(await provider.control(binding, secret, { action: 'health' }));")
replace(p, "      } else if (host.offering.price.kind === 'resource') {", "      } else {")
replace(p, '''        assert(health.boot_id === host.binding.controlBootId && health.meters, 503, 'host_usage_unknown',
          'The current generation did not provide its required resource meter. Funding is retained for reconciliation.');
        meters = health.meters;''', '''        assert(health.boot_id === host.binding.controlBootId, 409, 'host_generation_changed',
          'The Host controller changed; stop the old allocation before releasing claims.');
        if (health.rotation_requested || health.quiesced) await mutateHost(org, hostId, leaseId, async tx => {
          await tx.query("UPDATE hosts SET status='draining',next_check_at=now() WHERE id=$1", [hostId]);
        });
        if (host.offering.price.kind === 'resource') {
          assert(health.meters, 503, 'host_usage_unknown',
            'The current generation did not provide its required resource meter. Funding is retained for reconciliation.');
          meters = health.meters;
        }''')
replace(p, '        if (workerHourlyExposure(host.offering.price,host.offering.resources) > 0n) throw', '        if (!host.usage_finalized_at && workerHourlyExposure(host.offering.price,host.offering.resources) > 0n) throw')
replace(p, '''      if (count) return;
      const released =''', '''      if (count) return;
      if (host.binding && !host.stopped_at && host.offering.price.kind === 'resource' && !host.usage_finalized_at) {
        const receipt = hostHealth.parse(await provider.control(host.binding, secret, { action: 'quiesce' }));
        assert(receipt.boot_id === host.binding.controlBootId && receipt.quiesced && receipt.active_assignments === 0 && receipt.meters,
          503, 'host_usage_unknown', 'A stopped workload and final cumulative meter must be confirmed before deallocation.');
        const finalMeters = receipt.meters;
        await mutateHost(org, hostId, leaseId, async (tx, current) => {
          await settleHostSample(tx, current, finalMeters);
          await tx.query('UPDATE hosts SET usage_finalized_at=now() WHERE id=$1', [hostId]);
        });
        host = await transaction(org, tx => getHost(tx, hostId));
      }
      const released =''')
replace(p, '''  const rows = (await tx.query<{ id: string }>(`SELECT r.id FROM runs r WHERE''', '''  return (await tx.query<NativeRunRow>(`SELECT r.* FROM runs r WHERE''')
replace(p, '''  const runs: NativeRunRow[] = [];
  for (const row of rows) runs.push(await getNativeRun(tx,row.id));
  return runs;
''', '')

# Append a new migration; never rewrite deployed schema/financial history.
migrations = [int(p.name[:3]) for p in Path('packages/db').glob('[0-9][0-9][0-9]_*.sql')]
number = max(migrations) + 1
assert number < 999
migration = f'packages/db/{number:03d}_host_usage_finalization.sql'
assert not Path(migration).exists()
edits[migration] = '''-- Retain the definitive metering boundary across lost shutdown acknowledgements.
ALTER TABLE hosts ADD COLUMN usage_finalized_at timestamptz;
'''

p = 'docs/maintainers/TODO.md'
edits[p] = read(p) + '''

### Worker allocation receipt and metering regressions

Formal test additions remain deferred at the user's request; runtime/load checks are separate.

- [ ] Verify controller startup failure after physical provisioning retains the accepted provider identity/start time and permits idempotent cleanup without double provisioning or released liability.
- [ ] Cover runtime-requested rotation, provider-observation pacing, idle and manually paused Workers, and capacity handoff while old Hosts drain.
- [ ] Cover metered graceful shutdown with a lost quiesce acknowledgement, crash after the final receipt but before provider deletion, duplicate finalization, and confirmation of the same controller generation. No missing usage tail may silently settle as zero.
- [ ] Cover one-query queued-demand hydration and authorized materialization grouping at the configured Worker/Host limits.
'''
for name, text in edits.items():
    Path(name).write_text(text)
print('APPLIED_SOURCE_FILES', ', '.join(edits))
