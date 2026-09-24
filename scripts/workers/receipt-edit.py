from pathlib import Path
edits={}
def read(p):return edits[p] if p in edits else Path(p).read_text()
def replace(p,a,b):
 s=read(p)
 if s.count(a)!=1:raise RuntimeError(f'{p}: expected one anchor: {a[:100]} ({s.count(a)})')
 edits[p]=s.replace(a,b)

p='packages/db/index.ts'
edits[p]=read(p)+'''
/** Background work can defer immediately instead of occupying a connection while
 * another claimant holds the same admission boundary. Ownership remains in SQL. */
export async function tryLock(tx: Tx, value: string): Promise<boolean> {
  const result = await tx.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired', [value]);
  return result.rows[0].acquired;
}
'''
p='packages/core/src/engine.ts'
replace(p,'pool, transaction, lock, type Tx','pool, transaction, lock, tryLock, type Tx')
replace(p,'  return transaction(org, (tx) => claimRunInTransaction(tx, org, runId));', '''  return transaction(org, async tx => {
    // A burst of queued Runs must not fill every connection waiting for the
    // same organization lock while active Runs need connections to finish.
    if (!await tryLock(tx, `organization:${org}`)) return null;
    return claimRunInTransaction(tx, org, runId);
  });''')
replace(p,"    await lock(tx, run.kind === 'native_agent' ? `worktree:${run.worktree_id}` : `run:${run.id}`);", '''    const contextLock = run.kind === 'native_agent' ? `worktree:${run.worktree_id}` : `run:${run.id}`;
    if (direct) await lock(tx, contextLock);
    else if (!await tryLock(tx, contextLock)) return null;''')
replace(p,"    await lock(tx, 'capacity:global');", '''    if (direct) await lock(tx, 'capacity:global');
    else if (!await tryLock(tx, 'capacity:global')) return null;''')
p='scripts/workers/stress.ts'
replace(p,'const { pool, authPool, transaction }', 'const { pool, authPool, credentialPool, transaction }')
replace(p,"  } catch (error) { failure = error instanceof Error ? error.message : String(error); throw error; }", '''  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    // Independent diagnostic connection: the domain pool may itself be saturated.
    // This workload is guarded to a disposable unpaid database with synthetic data.
    console.log('WORKER_POOL_STATE', JSON.stringify({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }));
    await credentialPool.query(`SELECT pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers,
      left(query,240) AS statement FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid() AND state<>'idle' ORDER BY pid`)
      .then(value => console.log('WORKER_DATABASE_WAIT', JSON.stringify(value.rows)))
      .catch(() => console.log('WORKER_DATABASE_WAIT_UNAVAILABLE'));
    throw error;
  }''')
replace(p,'await pool.end(); await authPool.end();', 'await pool.end(); await authPool.end(); await credentialPool.end();')
p='docs/maintainers/TODO.md'
edits[p]=read(p)+'''
- [ ] Exercise nonblocking background organization/worktree/global admission under a pool smaller than the queued burst. Verify that contended work defers without losing durable jobs, deadline cleanup still progresses, active persistence/heartbeats retain database access, and direct inference preserves its transaction boundary.
'''
for p,s in edits.items():Path(p).write_text(s)
print('APPLIED_SOURCE_FILES', ', '.join(edits))
