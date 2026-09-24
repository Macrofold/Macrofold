# Reviewed source patch; the feature-branch workflow applies and removes this file.
from pathlib import Path
import subprocess
assert subprocess.check_output(['git', 'branch', '--show-current'], text=True).strip() == 'feat/worker-economics-autoscaling'

def replace(path, old, new):
    p = Path(path)
    source = p.read_text()
    assert source.count(old) == 1, f'Expected one unchanged target: {path}'
    p.write_text(source.replace(old, new))

replace('packages/core/src/maintenance.ts',
    '+coalesce((SELECT sum(reserved_micro_usd) FROM sandboxes),0)', '')
replace('packages/core/src/storage-maintenance.ts',
    '''          "SELECT 1 FROM runs WHERE status IN ('queued','provisioning','running','waiting_for_input','persisting') UNION ALL SELECT 1 FROM storage_preparations WHERE expires_at>now() LIMIT 1",''',
    '''          // A terminal Run may still own a writer while Host cleanup finishes.
          "SELECT 1 FROM runs WHERE status IN ('queued','provisioning','running','waiting_for_input','persisting') UNION ALL SELECT 1 FROM host_runs WHERE released_at IS NULL UNION ALL SELECT 1 FROM storage_preparations WHERE expires_at>now() LIMIT 1",''')
replace('packages/core/src/scheduling.ts',
    ' * behind a busy worktree or a full global ceiling. */',
    ' * behind a busy worktree or a full global ceiling. Runnable hints are capped by\n * observed free slots; a full deployment should not repeatedly claim doomed work. */')
replace('packages/core/src/scheduling.ts',
    '''      `${schedulingSQL}
    SELECT organization_id,id AS resource_id FROM (
      SELECT q.organization_id,q.id,0 AS class,0::double precision AS score,q.created_at FROM queue q
      WHERE q.cancel_requested OR q.queue_expires_at<=now() OR q.unavailable OR q.worker_waiting_reason IN ('worker_destroyed','worker_expired','worker_lifetime')
      UNION ALL
      SELECT organization_id,id,CASE scheduling_class WHEN 'interactive' THEN 1 ELSE 2 END,
        service-age_bonus+(account_order-1)::double precision/scheduler_weight,created_at FROM eligible
    ) candidates ORDER BY class,score,created_at,id LIMIT $2`,
      [...schedulingParameters(), limit],''',
    '''      `${schedulingSQL}, runnable AS (
      SELECT organization_id,id,CASE scheduling_class WHEN 'interactive' THEN 1 ELSE 2 END AS class,
        service-age_bonus+(account_order-1)::double precision/scheduler_weight AS score,created_at
      FROM eligible WHERE account_order<=greatest(0,account_limit-account_active)
      ORDER BY class,score,created_at,id
      LIMIT greatest(0,least($2::integer,$3::integer-(SELECT coalesce(sum(n),0)::integer FROM active)))
    )
    SELECT organization_id,id AS resource_id FROM (
      SELECT q.organization_id,q.id,0 AS class,0::double precision AS score,q.created_at FROM queue q
      WHERE q.cancel_requested OR q.queue_expires_at<=now() OR q.unavailable OR q.worker_waiting_reason IN ('worker_destroyed','worker_expired','worker_lifetime')
      UNION ALL
      SELECT organization_id,id,class,score,created_at FROM runnable
    ) candidates ORDER BY class,score,created_at,id LIMIT $2`,
      [...schedulingParameters(), limit, globalRunLimit()],''')
replace('docs/features/execution/workers/implementation.md',
    '`automatic-machines.ts`, `host-machines.ts`',
    '`automatic-machines.ts`, `worker-machines.ts`')
replace('docs/features/execution/workers/implementation.md',
    'Direct inference retains its in-transaction admission semantics.',
    'Direct inference retains its in-transaction admission semantics. Runnable dispatch hints are limited by observed free global/account slots; cancellation and expiry cleanup remain discoverable at full capacity.\n\nFinancial reconciliation derives outstanding liability from active Runs and Host reservations. Storage maintenance treats unreleased HostRuns as active writers even after the public Run is terminal, so it cannot delete Session or Worktree state still needed by cleanup.')
p = Path('docs/maintainers/TODO.md')
p.write_text(p.read_text() + '''
- [ ] Add candidate-hint regressions for full global/account capacity: return only actionable free-slot starts while cancellation/expiry/deletion cleanup remains discoverable. Prove successive capacity release refills fairly across organizations and that stale hints still cannot exceed SQL-authoritative caps.

- [ ] Exercise financial reconciliation after the Worker-only cutover: expected reservations are active Run budgets plus live Host holds, without querying retired compute tables; confirmed stop and repeated settlement preserve exact wallet/journal totals.
- [ ] Cover storage maintenance while a publicly terminal Run still owns an unreleased HostRun: no Workspace/Session purge, history pruning, or object collection until cleanup releases its writer. Resume normal collection after release, including failed/uncertain cleanup.
''')
subprocess.run(['pnpm', 'exec', 'prettier', '--write', 'packages/core/src/scheduling.ts'], check=True)
print('Applied Worker reconciliation, retained-writer, and capacity-aware dispatch fixes.')
