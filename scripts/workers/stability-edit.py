from pathlib import Path
edits={}
def read(p): return edits[p] if p in edits else Path(p).read_text()
def replace(p,a,b):
    s=read(p)
    if s.count(a)!=1: raise RuntimeError(f'{p}: reviewed anchor changed ({s.count(a)}): {a[:110]}')
    edits[p]=s.replace(a,b)

p='packages/core/src/files.ts'
replace(p,'async function saveCheckpoint(tx: Tx, p: Principal, data: Awaited<ReturnType<typeof prepareCheckpoint>>) {', '''/** Publish already-prepared immutable bytes. The caller owns the storage guard,
 * authorization, writer/lease fence and source-revision check. No object I/O here. */
export async function saveCheckpoint(tx: Tx, p: Principal, data: Awaited<ReturnType<typeof prepareCheckpoint>>) {''')

p='packages/core/src/engine.ts'
replace(p,"import { checkpointState, checkpoint, normalizePath, type FileRecord } from './files';", "import { checkpointState, prepareCheckpoint, saveCheckpoint, normalizePath, type FileRecord } from './files';\nimport { storagePreparation } from './storage-preparation';")
anchor='''    await transaction(org, async (tx) => {
      await lock(tx, `worktree:${run.worktree_id}`);
      if(run.config.worker_id) await lock(tx,`worker:${run.config.worker_id}`);
      const current = await getRun(tx, runId);'''
replace(p,anchor,'''    const publication = await storagePreparation(org, async tx => {
      const current = await getRun(tx, runId);
      assert(current.lease_generation === run.lease_generation && !terminal(current.status),
        409, 'lease_lost', 'Execution no longer owns its publication.');
      return resources.get(tx, 'worktrees', run.worktree_id);
    });
    try {
      const baseline = publication.value;
      const output = guardedToolsRequired(run.config.permission_layers || [])
        ? permissionOutput(run.config.permission_layers || [], baseline.files || [], saved) : saved;
      // Hash verification and Git export may be expensive. Keep them outside the
      // five-connection domain pool and recheck ownership at the small commit boundary.
      const preparedCheckpoint = await prepareCheckpoint(org, baseline, output, 'Run completed', undefined, baseline.files || []);
      await transaction(org, async (tx) => {
      await lock(tx, `worktree:${run.worktree_id}`);
      if(run.config.worker_id) await lock(tx,`worker:${run.config.worker_id}`);
      const current = await getRun(tx, runId);''')
a='''      const previousFiles = (await resources.get(tx, 'worktrees', run.worktree_id)).files || [];
      const cp = await checkpoint(
        tx,
        p,
        run.worktree_id,
        'Run completed',
        guardedToolsRequired(run.config.permission_layers || [])
          ? permissionOutput(
              run.config.permission_layers || [],
              (await resources.get(tx, 'worktrees', run.worktree_id)).files || [],
              saved,
            )
          : saved,
      );'''
replace(p,a,'''      await publication.assertActive(tx);
      const currentWorktree = await resources.get(tx, 'worktrees', run.worktree_id);
      assert(currentWorktree.revision === baseline.revision, 409, 'publication_revision_changed',
        'Worktree state changed while preparing execution output.');
      const previousFiles = baseline.files || [];
      const cp = await saveCheckpoint(tx, p, preparedCheckpoint);''')
replace(p,'''    stopped = true;
    return true;
  } catch (error) {''', '''    } finally {
      await publication.dispose().catch(() => console.warn(JSON.stringify({ code: 'publication_guard_cleanup_failed', run_id: runId })));
    }
    stopped = true;
    return true;
  } catch (error) {''')

p='packages/core/src/cloud-engine.ts'
replace(p,"import { transaction, afterCommit, type Tx }", "import { transaction, afterCommit, lock, type Tx }")
replace(p,"import { checkpoint, checkpointState, type FileRecord } from './files';", "import { prepareCheckpoint, saveCheckpoint, checkpointState, type FileRecord } from './files';\nimport { storagePreparation } from './storage-preparation';")
a=s=read(p)
start=s.index('async function publishCloudRun(')
transaction_start=s.index("  await transaction(org, async (tx) => {\n    await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE'",start)
new='''async function publishCloudRun(org: string, runId: string, state: ExecutionState) {
  const verified = !state.error && state.result?.persistence === 'captured';
  const publication = await storagePreparation(org, async tx => {
    const run = await getNativeRun(tx, runId);
    if (terminal(run.status)) return null;
    assert((run.execution_binding as ExecutionState | null)?.lock === state.lock,
      409, 'lease_lost', 'Execution publication is owned by another controller step.');
    const worktree = await resources.get(tx, 'worktrees', run.worktree_id);
    const objects = verified ? (await tx.query<{ data: SnapshotEntry & { record: FileRecord } }>(
      "SELECT data FROM execution_objects WHERE run_id=$1 AND kind='output_entry' AND processed", [runId])).rows : [];
    await tx.query("UPDATE runs SET status='persisting' WHERE id=$1", [runId]);
    return { run, worktree, objects };
  });
  try {
    if (!publication.value) return;
    const { run: expectedRun, worktree: baseline, objects } = publication.value;
    let files = objects.filter(o => o.data.namespace === 'workspace' && !o.data.path.split('/').includes('.git')).map(o => o.data.record);
    const gitFiles = objects.filter(o => o.data.namespace === 'workspace' && o.data.path.split('/').includes('.git')).map(o => o.data.record);
    const home = objects.filter(o => o.data.namespace === 'home').map(o => o.data.record);
    const guarded = guardedToolsRequired(expectedRun.config.permission_layers || []);
    if (guarded) files = permissionOutput(expectedRun.config.permission_layers || [], baseline.files || [], files);
    // Verified object bytes and Git preparation are independent from the short SQL
    // publication. The storage guard protects them while no connection is held.
    const preparedCheckpoint = verified ? await prepareCheckpoint(org, baseline, files, 'Agent run',
      guarded ? baseline.git_files : gitFiles) : null;
    await settleOrphanModelRequests(org, runId);
    await transaction(org, async (tx) => {
      await lock(tx, `worktree:${expectedRun.worktree_id}`);
      if (expectedRun.config.worker_id) await lock(tx, `worker:${expectedRun.config.worker_id}`);
'''
# Keep the already-reviewed accounting/public response tail, replacing only I/O preparation.
edits[p]=s[:start]+new+s[transaction_start+len('  await transaction(org, async (tx) => {\n'):]
replace(p,'''    const ws = await resources.get(tx, 'worktrees', run.worktree_id);
    const verified = !state.error && state.result?.persistence === 'captured';''', '''    assert(run.lease_generation === expectedRun.lease_generation &&
      (run.execution_binding as ExecutionState | null)?.lock === state.lock,
      409, 'lease_lost', 'Execution ownership changed before publication.');
    await publication.assertActive(tx);
    const ws = await resources.get(tx, 'worktrees', run.worktree_id);
    assert(ws.revision === baseline.revision, 409, 'publication_revision_changed',
      'Worktree state changed while preparing execution output.');''')
s=read(p)
start=s.index('    if (verified) {',s.index('async function publishCloudRun'))
end=s.index("      await resources.update(tx, 'checkpoints', cp.id",start)
edits[p]=s[:start]+'''    if (verified) {
      assert(preparedCheckpoint, 500, 'checkpoint_missing', 'Verified execution requires prepared durable state.');
      const cp = await saveCheckpoint(tx, principalFor(run), preparedCheckpoint);
'''+s[end:]
s=read(p)
assert s.endswith('  });\n}') or s.endswith('  });\n}\n')
end=s.rfind('  });\n}')
edits[p]=s[:end]+'''    });
  } finally {
    await publication.dispose().catch(() => console.warn(JSON.stringify({ code: 'publication_guard_cleanup_failed', run_id: runId })));
  }
}
'''

p='docs/maintainers/TODO.md'
edits[p]=read(p)+'''
- [ ] Cover Run publication read/prepare/commit: large object and Git work holds no database connection, GC guard expiry prevents commit, a changed Worktree revision or execution-step/lease fence cannot publish, and duplicate terminal publication is idempotent. Exercise simulator and native cold paths and retain Worktree/Session atomicity.
'''
for p,s in edits.items():Path(p).write_text(s)
print('APPLIED_SOURCE_FILES',', '.join(edits))
