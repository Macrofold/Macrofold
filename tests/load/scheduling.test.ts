import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { afterAll, expect, it } from 'vitest';
import { pool, authPool, transaction } from '../../packages/db';
import { fixtureAccount } from '../fixtures/account';
import { createWorkspace } from '../../packages/core/src/files';
import * as resources from '../../packages/core/src/resources';
import { admitRun, cancelRun, getRun } from '../../packages/core/src/runs';
import { maintainRuns } from '../../packages/core/src/engine';
import {
  schedulingReport,
  pendingRunCandidates,
  schedulingSQL,
  schedulingParameters,
} from '../../packages/core/src/scheduling';
import { config } from '../../packages/core/src/config';
import { updateExecutionPolicy } from '../../packages/core/src/organizations';

type Account = Awaited<ReturnType<typeof fixtureAccount>>;
const processes: ChildProcess[] = [];
const starts: { run: string; organization: string; pid: number; at: number }[] = [];
const errors: string[] = [];
const loopMeasurements: Record<string, number> = {};
const before = process.env.GLOBAL_CONCURRENT_RUN_LIMIT;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => Promise<boolean> | boolean, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Load condition timed out');
    await pause(30);
  }
}
async function worker(mode: 'batch' | 'continuous' = 'continuous') {
  const child = fork(new URL('../fixtures/scheduler-worker.ts', import.meta.url), [], {
    execArgv: ['--import', 'tsx'],
    env: { ...process.env, LOAD_DISPATCH_MODE: mode },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  processes.push(child);
  child.stderr?.on('data', (value) => errors.push(String(value)));
  let ready = false;
  child.on('message', (value) => {
    const message = value as {
      type: string;
      run: string;
      organization: string;
      pid: number;
      message: string;
    };
    if (message.type === 'ready') ready = true;
    if (message.type === 'started') starts.push({ ...message, at: Date.now() });
    if (message.type === 'error') errors.push(message.message);
  });
  await until(() => ready);
  return child;
}
async function stop(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill(signal);
  await exited;
}
async function account(plan = 'scale', cap = 4) {
  const a = await fixtureAccount('Load ' + plan);
  await pool.query('UPDATE organizations SET plan=$2 WHERE id=$1', [a.p.organizationId, plan]);
  await transaction(a.p.organizationId, (tx) => updateExecutionPolicy(tx, a.p, { concurrency_limit: cap }));
  return a;
}
async function submit(a: Account, duration: number, interactive = false) {
  return transaction(a.p.organizationId, async (tx) => {
    const project = await resources.create(tx, 'projects', a.p.organizationId, { name: 'Load fixture' });
    const ws = await createWorkspace(tx, a.p, project.id, { name: 'main', branch: 'main' });
    return admitRun(tx, a.p, {
      workspace_id: String((ws.result as { workspace_id: string }).workspace_id),
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: JSON.stringify({ duration }),
      scheduling_class: interactive ? 'interactive' : 'background',
    });
  });
}
afterAll(async () => {
  await Promise.all(processes.map((p) => stop(p, 'SIGKILL')));
  if (before === undefined) delete process.env.GLOBAL_CONCURRENT_RUN_LIMIT;
  else process.env.GLOBAL_CONCURRENT_RUN_LIMIT = before;
  await pool.end();
  await authPool.end();
});

it.each(['batch', 'continuous'] as const)(
  'measures local dispatch head-of-line blocking: %s loop',
  async (mode) => {
    process.env.GLOBAL_CONCURRENT_RUN_LIMIT = '4';
    const a = await account();
    const old = await submit(a, 2500);
    const child = await worker(mode);
    await until(() => starts.some((s) => s.run === old.run_id));
    const fresh = await submit(a, 20, true);
    await until(() => starts.some((s) => s.run === fresh.run_id));
    const row = await transaction(a.p.organizationId, (tx) => getRun(tx, fresh.run_id));
    const wait = row.started_at!.getTime() - row.created_at.getTime();
    if (mode === 'batch') expect(wait).toBeGreaterThan(1800);
    else expect(wait).toBeLessThan(1200);
    loopMeasurements[mode] = wait;
    console.log(
      JSON.stringify({
        experiment: mode,
        new_interactive_wait_ms: wait,
        long_run_ms: 2500,
        ceiling: 4,
        idle_slots: 3,
      }),
    );
    await stop(child);
  },
  30000,
);

it('sustains bursts with three workers, respects caps, gives new accounts turns, and recovers after worker loss', async () => {
  process.env.GLOBAL_CONCURRENT_RUN_LIMIT = '8';
  const beginning = new Date();
  const tenants = [await account('scale', 4), await account('pro', 3), await account('payg', 2)];
  const jobs: { run: string; account: Account; cancelled?: boolean; expired?: boolean }[] = [];
  for (const a of tenants)
    for (let i = 0; i < 12; i++)
      jobs.push({ run: (await submit(a, i % 4 === 0 ? 1600 : 250)).run_id, account: a });
  const children = await Promise.all([worker(), worker(), worker()]);
  let peak = 0,
    violations = 0,
    sampleCount = 0,
    sampling = true;
  const samples = (async () => {
    while (sampling) {
      const rows = (
        await pool.query(`SELECT organization_id,workspace_id,count(*)::integer AS n FROM reporting.runs
        WHERE status IN ('provisioning','running','waiting_for_input','persisting') GROUP BY organization_id,workspace_id`)
      ).rows;
      const total = rows.reduce((s, r) => s + r.n, 0);
      peak = Math.max(peak, total);
      sampleCount++;
      if (total > 8 || rows.some((r) => r.n > 1)) violations++;
      for (let i = 0; i < tenants.length; i++)
        if (
          rows.filter((r) => r.organization_id === tenants[i].p.organizationId).reduce((s, r) => s + r.n, 0) >
          [4, 3, 2][i]
        )
          violations++;
      await pause(30);
    }
  })();
  try {
    await until(
      () => starts.filter((s) => tenants.some((a) => a.p.organizationId === s.organization)).length >= 8,
    );
    const arriving: { run: string; account: Account; wait: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const a = await account('payg', 2),
        fresh = await submit(a, 150, i % 2 === 0);
      jobs.push({ run: fresh.run_id, account: a });
      arriving.push({ run: fresh.run_id, account: a, wait: 0 });
    }
    // Sustained traffic for 12 seconds, mixed with the initial heavier burst.
    for (let i = 0; i < 48; i++) {
      const a = tenants[i % 3];
      jobs.push({ run: (await submit(a, 200 + (i % 5) * 50)).run_id, account: a });
      await pause(250);
    }
    for (const job of arriving) {
      await until(() => starts.some((s) => s.run === job.run));
      const r = await transaction(job.account.p.organizationId, (tx) => getRun(tx, job.run));
      job.wait = r.started_at!.getTime() - r.created_at.getTime();
      const turnsBefore = Number(
        (
          await pool.query('SELECT count(*) FROM reporting.runs WHERE started_at >= $1 AND started_at < $2', [
            r.created_at,
            r.started_at,
          ])
        ).rows[0].count,
      );
      // Opportunities at free slots, not a hardware-dependent wall-clock promise.
      expect(turnsBefore).toBeLessThanOrEqual(12);
    }
    // Queue two follow-ups behind a real running agent, then cancel one and expire one.
    const owner = tenants[0],
      long = await submit(owner, 1500);
    jobs.push({ run: long.run_id, account: owner });
    await until(() => starts.some((s) => s.run === long.run_id));
    const follow = async () =>
      transaction(owner.p.organizationId, (tx) =>
        admitRun(tx, owner.p, {
          session_id: long.session_id,
          prompt: JSON.stringify({ duration: 20 }),
          queue_if_busy: true,
        }),
      );
    const cancelled = await follow(),
      expired = await follow();
    jobs.push(
      { run: cancelled.run_id, account: owner, cancelled: true },
      { run: expired.run_id, account: owner, expired: true },
    );
    await transaction(owner.p.organizationId, (tx) => cancelRun(tx, owner.p, cancelled.run_id));
    await transaction(owner.p.organizationId, (tx) =>
      tx.query("UPDATE runs SET queue_expires_at=now()-interval '1 second' WHERE id=$1", [expired.run_id]),
    );
    await maintainRuns();
    await until(
      async () =>
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM reporting.runs WHERE id=ANY($1::uuid[]) AND status IN ('queued','provisioning','running','waiting_for_input','persisting')",
              [jobs.map((j) => j.run)],
            )
          ).rows[0].count,
        ) === 0,
      45000,
    );
    expect(violations).toBe(0);
    expect(peak).toBe(8);
    // Kill the actual process during execution, age only its heartbeat to exercise the
    // normal 90-second watchdog without making acceptance idle for 90 seconds.
    const crash = await submit(owner, 8000);
    await until(() => starts.some((s) => s.run === crash.run_id));
    const executing = starts.find((s) => s.run === crash.run_id)!;
    await stop(
      children.find((p) => p.pid === executing.pid)!,
      'SIGKILL',
    );
    await transaction(owner.p.organizationId, (tx) =>
      tx.query("UPDATE runs SET heartbeat_at=now()-interval '91 seconds' WHERE id=$1", [crash.run_id]),
    );
    await Promise.all([maintainRuns(), maintainRuns()]);
    expect(
      (await transaction(owner.p.organizationId, (tx) => getRun(tx, crash.run_id))).result.failure_code,
    ).toBe('worker_lost');
    await worker();
    const recovery = await submit(owner, 50);
    jobs.push({ run: recovery.run_id, account: owner });
    await until(
      async () =>
        (await transaction(owner.p.organizationId, (tx) => getRun(tx, recovery.run_id))).status ===
        'succeeded',
    );
    expect(starts.filter((s) => s.run === crash.run_id)).toHaveLength(1);
    const duplicate = (
      await pool.query(
        'SELECT id FROM reporting.runs WHERE id=ANY($1::uuid[]) GROUP BY id HAVING count(*)>1',
        [jobs.map((j) => j.run)],
      )
    ).rowCount;
    expect(duplicate).toBe(0);
    for (const job of jobs) {
      const run = await transaction(job.account.p.organizationId, (tx) => getRun(tx, job.run));
      expect(run.status).toBe(job.cancelled ? 'cancelled' : job.expired ? 'failed' : 'succeeded');
      if (job.expired) expect(run.result.failure_code).toBe('queue_expired');
      if (!job.cancelled && !job.expired) expect(starts.filter((s) => s.run === job.run)).toHaveLength(1);
    }
    const end = new Date();
    const report = await transaction(null, (tx) =>
      schedulingReport(tx, beginning.toISOString(), end.toISOString()),
    );
    const queryTimes: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      await pendingRunCandidates();
      queryTimes.push(performance.now() - start);
    }
    const explain = (
      await pool.query(
        `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${schedulingSQL} SELECT * FROM eligible WHERE account_order=1 ORDER BY service,created_at LIMIT 1`,
        schedulingParameters(),
      )
    ).rows[0]['QUERY PLAN'];
    const measured = {
      dispatch_loop_wait_ms: loopMeasurements,
      profile:
        'local PostgreSQL, restricted runtime role, three independent Node workers, simulated agents; no cloud/provider calls',
      jobs: jobs.length + 1,
      duration_seconds: (end.getTime() - beginning.getTime()) / 1000,
      peak_active: peak,
      capacity_violations: violations,
      samples: sampleCount,
      new_account_wait_ms: arriving.map((j) => j.wait),
      scheduler_query_ms: queryTimes,
      report,
      explain,
    };
    await writeFile(config.dataDir + '/scheduling-load-report.json', JSON.stringify(measured, null, 2));
    if (process.env.SCHEDULING_REPORT_PATH)
      await writeFile(process.env.SCHEDULING_REPORT_PATH, JSON.stringify(measured, null, 2));
    console.log(JSON.stringify({ ...measured, report: undefined, explain: undefined }));
    expect(errors).toEqual([]);
  } finally {
    sampling = false;
    await samples;
    await Promise.all(processes.map((p) => stop(p, 'SIGKILL')));
  }
}, 120000);

it('runs a 50-slot cohort without exceeding a Scale account or global ceiling', async () => {
  process.env.GLOBAL_CONCURRENT_RUN_LIMIT = '50';
  const a = await account('scale', 50);
  const jobs: string[] = [];
  for (let i = 0; i < 60; i++) jobs.push((await submit(a, -1)).run_id);
  const cohort = await Promise.all([worker(), worker(), worker()]);
  let released = false;
  let peak = 0,
    violations = 0;
  const start = Date.now();
  try {
    await until(async () => {
      const active = Number(
        (
          await pool.query(
            "SELECT count(*) FROM reporting.runs WHERE status IN ('provisioning','running','waiting_for_input','persisting')",
          )
        ).rows[0].count,
      );
      peak = Math.max(peak, active);
      if (active > 50) violations++;
      if (active === 50 && !released) {
        released = true;
        for (const child of cohort) child.send({ type: 'release' });
      }
      return (
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM reporting.runs WHERE id=ANY($1::uuid[]) AND status='succeeded'",
              [jobs],
            )
          ).rows[0].count,
        ) === 60
      );
    }, 60000);
    expect(peak).toBe(50);
    expect(violations).toBe(0);
    const measured = {
      jobs: 60,
      ceiling: 50,
      peak_active: peak,
      violations,
      duration_seconds: (Date.now() - start) / 1000,
    };
    if (process.env.SCHEDULING_REPORT_PATH)
      await writeFile(
        process.env.SCHEDULING_REPORT_PATH.replace(/\.json$/, '-50.json'),
        JSON.stringify(measured, null, 2),
      );
  } finally {
    await Promise.all(processes.map((p) => stop(p, 'SIGKILL')));
  }
}, 90000);
