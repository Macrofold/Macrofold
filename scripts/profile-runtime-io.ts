import { withFixtureDatabase } from './fixture-database';
import { command } from './coverage/processes';

// Private synthetic fixtures only; no provider calls, shared preview changes,
// prompts, event bodies or object keys appear in the report.
if (!process.argv.includes('--fixture')) {
  await withFixtureDatabase((env) =>
    command(['exec', 'tsx', 'scripts/profile-runtime-io.ts', '--fixture'], env),
  );
} else {
  const [
    { fixtureAccount, retireFixtureRuns },
    { transaction, pool, authPool },
    resources,
    { createWorktree },
    { admitRun },
    { emitBatch, emit },
  ] = await Promise.all([
    import('../tests/fixtures/account'),
    import('../packages/db'),
    import('../packages/core/src/resources'),
    import('../packages/core/src/files'),
    import('../packages/core/src/runs'),
    import('../packages/core/src/events'),
  ]);
  const account = await fixtureAccount('Runtime I/O profile');
  const org = account.p.organizationId;
  try {
    const run = await transaction(org, async (tx) => {
      const workspace = await resources.create(tx, 'workspaces', org, { name: 'Synthetic event profile' });
      const operation = await createWorktree(tx, account.p, workspace.id, { name: 'main', branch: 'main' });
      const worktree = operation.result.worktree_id;
      if (typeof worktree !== 'string') throw new Error('Missing fixture Worktree');
      return admitRun(tx, account.p, {
        worktree_id: worktree,
        harness: 'codex',
        model: 'fixture-model',
        billing_mode: 'managed',
        prompt: 'Synthetic local profile',
      });
    });
    const count = 128,
      iterations = 10;
    const summary = (samples: number[]) => {
      const sorted = [...samples].sort((a, b) => a - b);
      return {
        mean_ms: samples.reduce((a, b) => a + b, 0) / samples.length,
        p50_ms: sorted[Math.floor(sorted.length * 0.5)],
        p95_ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
      };
    };
    const sequential: number[] = [],
      batched: number[] = [];
    for (let sample = 0; sample < iterations + 1; sample++)
      for (const mode of ['sequential', 'batch'] as const) {
        const events = Array.from({ length: count }, (_, sequence) => ({
          type: 'output.delta',
          data: { text: 'synthetic fragment' },
          producer: { id: `${mode}:${sample}`, sequence },
        }));
        const start = performance.now();
        await transaction(org, async (tx) => {
          if (mode === 'batch') await emitBatch(tx, org, run.run_id, events);
          else
            for (const event of events)
              await emit(tx, org, run.run_id, event.type, event.data, event.producer);
        });
        if (sample) (mode === 'batch' ? batched : sequential).push(performance.now() - start);
      }
    const facts = await transaction(
      org,
      async (tx) =>
        (
          await tx.query(
            'SELECT event_sequence,(SELECT count(*)::integer FROM run_events WHERE run_id=$1) AS events FROM runs WHERE id=$1',
            [run.run_id],
          )
        ).rows[0],
    );
    if (facts.events !== 1 + 2 * (iterations + 1) * count || Number(facts.event_sequence) !== facts.events)
      throw new Error('Event profile lost a durable event');
    console.log(
      JSON.stringify(
        {
          fixture: 'restricted_local_postgres',
          events_per_page: count,
          measured_samples: iterations,
          sequential: summary(sequential),
          batch: summary(batched),
          saved_events: facts.events,
        },
        null,
        2,
      ),
    );
  } finally {
    await retireFixtureRuns(org);
    await pool.end();
    await authPool.end();
  }
}
