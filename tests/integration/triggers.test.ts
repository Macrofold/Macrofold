import { createHmac } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { pool, authPool, transaction } from '../../packages/db';
import { Macrofold } from '../../sdk/typescript/src/index';
import { config } from '../../packages/core/src/config';
import { handleApi } from '../../packages/core/src/http';
import { triggerIngress } from '../../packages/core/src/trigger-ingress';
import {
  dispatchTriggerDelivery,
  fireSchedule,
  dispatchTriggers,
} from '../../packages/core/src/trigger-dispatch';
import { claimRun, executeRun } from '../../packages/core/src/engine';
import { cancelRun, getRun } from '../../packages/core/src/runs';
import { id } from '../../packages/core/src/crypto';
import { SlackClient, SlackError } from '../../packages/providers/src/slack';
import { fixtureAccount } from '../fixtures/account';
import * as catalog from '../../packages/core/src/catalog';
import { credit } from '../../packages/core/src/ledger';
import { purgeProjects } from '../../packages/core/src/deletion';

const ownedAccounts: Awaited<ReturnType<typeof fixtureAccount>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const account of ownedAccounts.splice(0))
    await transaction(account.p.organizationId, async (tx) => {
      // Maintenance is global. Retire this test's fixtures so later fairness tests do not inherit work.
      const runs = await tx.query("SELECT id FROM runs WHERE status='queued'");
      for (const run of runs.rows) await cancelRun(tx, account.p, run.id);
      await tx.query('UPDATE triggers SET enabled=false');
      await tx.query(
        "UPDATE dispatch_jobs SET state='done' WHERE organization_id=$1 AND kind IN ('trigger','trigger_schedule')",
        [account.p.organizationId],
      );
    });
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
async function setup(kind: 'webhook' | 'schedule' | 'slack' = 'webhook') {
  const account = await fixtureAccount('Trigger fixture');
  ownedAccounts.push(account);
  const client = new Macrofold({
    apiKey: account.key,
    baseURL: config.origin,
    fetch: async (url, init) => handleApi(new Request(url, init)),
  });
  const project = await client.projects.create({ name: 'Persistent trigger files' });
  const agent = await client.agents.create({
    name: 'Trigger agent',
    harness: 'codex',
    model: 'fixture-model',
    billing_mode: 'managed',
  });
  let connection: Awaited<ReturnType<typeof client.slackConnections.create>> | undefined;
  if (kind === 'slack') {
    vi.spyOn(SlackClient.prototype, 'identity').mockResolvedValue({ team_id: 'T123', bot_user_id: 'UBOT' });
    connection = await client.slackConnections.create({
      name: 'Fixture bot',
      bot_token: 'fixture-only-bot-token',
      signing_secret: 'fixture-only-signing-secret',
    });
  }
  const trigger = await client.triggers.create({
    name: 'Test automation',
    kind,
    project_id: project.id,
    agent_id: agent.id,
    prompt: 'Create hello.txt containing Hello world.',
    ...(kind === 'schedule' ? { cron: '* * * * *', timezone: 'UTC' } : {}),
    ...(connection ? { slack_connection_id: connection.id, channel_id: 'C123' } : {}),
  });
  const query = (sql: string, values: unknown[] = []) =>
    transaction(account.p.organizationId, (tx) => tx.query(sql, values));
  return { account, client, project, agent, trigger, connection, query };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function incoming(
  f: Fixture,
  body: unknown = { prompt: 'Hello' },
  key = id(),
  secret = f.trigger.webhook_secret!,
) {
  return triggerIngress(
    new Request(`${config.origin}/events/webhook/${f.trigger.id}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify(body),
    }),
    'webhook',
    f.trigger.id,
  );
}
async function slackEvent(
  f: Fixture,
  patch: Record<string, unknown> = {},
  envelope: Record<string, unknown> = {},
) {
  const body = JSON.stringify({
    type: 'event_callback',
    team_id: 'T123',
    event_id: 'Ev123',
    event: {
      type: 'message',
      user: 'U123',
      channel: 'C123',
      text: 'Write a greeting',
      ts: '1234.5678',
      ...patch,
    },
    ...envelope,
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature =
    'v0=' +
    createHmac('sha256', 'fixture-only-signing-secret').update(`v0:${timestamp}:${body}`).digest('hex');
  return triggerIngress(
    new Request(f.connection!.events_url, {
      method: 'POST',
      body,
      headers: { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature },
    }),
    'slack',
    f.connection!.id,
  );
}
async function dispatch(f: Fixture, deliveryId: string, provider?: SlackClient) {
  await f.query(
    "UPDATE dispatch_jobs SET available_at=now()-interval '1 second',lease_until=NULL WHERE kind='trigger' AND resource_id=$1",
    [deliveryId],
  );
  await dispatchTriggerDelivery(f.account.p.organizationId, deliveryId, provider);
}

describe('complete trigger admission and simulation journeys', () => {
  it('deduplicates concurrent incoming webhook retries, admits once, persists files and retains historical run output', async () => {
    const f = await setup();
    const key = id();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => incoming(f, { prompt: 'Continue writing' }, key)),
    );
    expect(responses.map((r) => r.status)).toEqual([202, 202, 202, 202, 202]);
    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(new Set(bodies.map((d) => d.id)).size).toBe(1);
    await Promise.all(
      Array.from({ length: 4 }, () => dispatchTriggerDelivery(f.account.p.organizationId, bodies[0].id)),
    );
    const d = (await f.client.triggers.listDeliveries(f.trigger.id)).data[0];
    expect(d).toMatchObject({ status: 'accepted', error_code: null });
    expect((await f.query('SELECT id FROM runs')).rowCount).toBe(1);
    await executeRun(f.account.p.organizationId, d.run_id!);
    const run = await f.client.runs.get(d.run_id!);
    expect(run).toMatchObject({
      status: 'succeeded',
      client_type: 'webhook',
      persistence_status: 'verified',
    });
    const result = await f.client.runs.wait(d.run_id!);
    expect(result.output_text).toBeTruthy();
    expect((await f.query('SELECT id FROM checkpoints')).rowCount).toBeGreaterThan(0);
    expect(
      (await f.query('SELECT sequence FROM run_events WHERE run_id=$1', [run.id])).rowCount,
    ).toBeGreaterThan(3);
    expect(
      (
        await f.query('SELECT reserved_micro_usd FROM organizations WHERE id=$1', [
          f.account.p.organizationId,
        ])
      ).rows[0].reserved_micro_usd,
    ).toBe('0');
    expect((await incoming(f, { prompt: 'Different payload' }, key)).status).toBe(409);
    await dispatch(f, d.id);
    expect((await f.query('SELECT id FROM runs')).rowCount).toBe(1);
  });
  it('serializes persistent workspace deliveries, waits without reservations, and starts after capacity is available', async () => {
    const f = await setup();
    const a = await (await incoming(f)).json(),
      b = await (await incoming(f)).json();
    await dispatch(f, a.id);
    await dispatch(f, b.id);
    let rows = (await f.client.triggers.listDeliveries(f.trigger.id)).data;
    expect(rows.find((d) => d.id === b.id)).toMatchObject({
      status: 'pending',
      run_id: null,
      error_code: 'workspace_busy',
    });
    const first = rows.find((d) => d.id === a.id)!;
    await f.client.runs.cancel(first.run_id!);
    await dispatch(f, b.id);
    rows = (await f.client.triggers.listDeliveries(f.trigger.id)).data;
    expect(rows.find((d) => d.id === b.id)?.status).toBe('accepted');
    expect((await f.query('SELECT id FROM runs')).rowCount).toBe(2);
    await f.client.runs.cancel(rows.find((d) => d.id === b.id)!.run_id!);
  });
  it('coalesces an outage, claims one cron occurrence across workers, skips overlap and runs a scheduled prompt', async () => {
    const f = await setup('schedule'),
      now = new Date();
    await f.query('UPDATE triggers SET next_fire_at=$2 WHERE id=$1', [
      f.trigger.id,
      new Date(now.getTime() - 86400000),
    ]);
    await Promise.all(
      Array.from({ length: 4 }, () => fireSchedule(f.account.p.organizationId, f.trigger.id, now)),
    );
    const deliveries = (await f.client.triggers.listDeliveries(f.trigger.id)).data;
    expect(deliveries).toHaveLength(1);
    expect(Date.parse((await f.client.triggers.get(f.trigger.id)).next_fire_at!)).toBeGreaterThan(
      now.getTime(),
    );
    await f.query('UPDATE triggers SET next_fire_at=$2 WHERE id=$1', [
      f.trigger.id,
      new Date(now.getTime() - 1000),
    ]);
    await fireSchedule(f.account.p.organizationId, f.trigger.id, now);
    expect((await f.client.triggers.get(f.trigger.id)).last_error_code).toBe('previous_run_unfinished');
    await dispatch(f, deliveries[0].id);
    const d = (await f.client.triggers.listDeliveries(f.trigger.id)).data[0];
    await executeRun(f.account.p.organizationId, d.run_id!);
    expect(await f.client.runs.get(d.run_id!)).toMatchObject({
      status: 'succeeded',
      client_type: 'scheduled',
    });
    await f.client.triggers.update(f.trigger.id, { enabled: false });
    await expect(f.client.triggers.run(f.trigger.id)).rejects.toMatchObject({ status: 409 });
    await f.client.triggers.update(f.trigger.id, { enabled: true });
    expect((await f.client.triggers.run(f.trigger.id)).status).toBe('pending');
  });
  it('verifies a Slack challenge, filters irrelevant messages, runs a human message and replies to its original thread', async () => {
    const f = await setup('slack');
    const challenge = await slackEvent(f, {}, { type: 'url_verification', challenge: 'verify-me' });
    expect(await challenge.json()).toEqual({ challenge: 'verify-me' });
    for (const event of [
      { user: 'UBOT' },
      { bot_id: 'B123' },
      { subtype: 'message_changed' },
      { channel: 'COTHER' },
    ])
      expect(await (await slackEvent(f, event)).json()).toEqual({ ignored: true });
    expect((await slackEvent(f, {}, { team_id: 'TOTHER' })).status).toBe(403);
    expect((await slackEvent(f, { thread_ts: '1000.0001' })).status).toBe(200);
    expect((await slackEvent(f, { type: 'app_mention', thread_ts: '1000.0001' })).status).toBe(200);
    const deliveries = (await f.client.triggers.listDeliveries(f.trigger.id)).data;
    expect(deliveries).toHaveLength(1);
    await dispatch(f, deliveries[0].id);
    const d = (await f.client.triggers.listDeliveries(f.trigger.id)).data[0];
    await executeRun(f.account.p.organizationId, d.run_id!);
    const reply = vi.spyOn(SlackClient.prototype, 'reply').mockResolvedValue('2000.0001');
    await f.client.triggers.update(f.trigger.id, { channel_id: 'CNEW' });
    await dispatch(f, d.id);
    expect(reply).toHaveBeenCalledExactlyOnceWith(
      'fixture-only-bot-token',
      'C123',
      '1000.0001',
      expect.stringContaining(`/runs/${d.run_id}`),
      d.id,
    );
    expect((await f.client.triggers.listDeliveries(f.trigger.id)).data[0].reply_state).toBe('sent');
    expect(
      (await f.query('SELECT secret_ciphertext FROM slack_connections')).rows[0].secret_ciphertext,
    ).not.toContain('fixture-only');
    expect(JSON.stringify(await f.client.slackConnections.list())).not.toContain('fixture-only');
  });
});

describe('trigger authorization, limits and recovery', () => {
  it('fences a late reply completion after recovery and an explicit retry', async () => {
    const f = await setup('slack');
    await slackEvent(f);
    const d = (await f.client.triggers.listDeliveries(f.trigger.id)).data[0];
    await dispatch(f, d.id);
    const accepted = (await f.client.triggers.listDeliveries(f.trigger.id)).data[0];
    await f.client.runs.cancel(accepted.run_id!);
    let finishOld!: (ts: string) => void;
    const oldResponse = new Promise<string>((resolve) => {
      finishOld = resolve;
    });
    const replies = vi
      .spyOn(SlackClient.prototype, 'reply')
      .mockImplementationOnce(() => oldResponse)
      .mockResolvedValue('new.123');
    const sending = dispatch(f, d.id);
    try {
      await expect
        .poll(async () => (await f.client.triggers.listDeliveries(f.trigger.id)).data[0].reply_state)
        .toBe('sending');
      await dispatchTriggerDelivery(
        f.account.p.organizationId,
        d.id,
        undefined,
        new Date(Date.now() + 61000),
      );
      expect((await f.client.triggers.listDeliveries(f.trigger.id)).data[0].reply_state).toBe('uncertain');
      await f.client.triggers.retryReply(f.trigger.id, d.id);
      await dispatch(f, d.id);
      finishOld('old.123');
      await sending;
      expect(
        (await f.query('SELECT reply_state,reply_ts FROM trigger_deliveries WHERE id=$1', [d.id])).rows[0],
      ).toEqual({ reply_state: 'sent', reply_ts: 'new.123' });
      expect(replies).toHaveBeenCalledTimes(2);
    } finally {
      finishOld('old.123');
      await sending;
    }
  });
  it('keeps a trigger in its original project and allows administrators to stop, but not assume, another creator’s automation', async () => {
    const a = await setup(),
      b = await setup();
    await a.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'member')", [
      a.account.p.organizationId,
      b.account.p.userId,
    ]);
    const member = new Macrofold({
      sessionAuth: true,
      baseURL: config.origin,
      organization: a.account.p.organizationId,
      fetch: async (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set('cookie', b.account.cookie);
        headers.set('origin', config.origin);
        return handleApi(new Request(url, { ...init, headers }));
      },
    });
    expect((await member.triggers.get(a.trigger.id)).id).toBe(a.trigger.id);
    await expect(
      member.triggers.update(a.trigger.id, { prompt: 'Hijacked instructions' }),
    ).rejects.toMatchObject({ status: 403 });
    await a.query("UPDATE memberships SET role='admin' WHERE organization_id=$1 AND user_id=$2", [
      a.account.p.organizationId,
      b.account.p.userId,
    ]);
    const stopKey = await member.apiKeys.create({
      name: 'Stop automation only',
      scopes: ['triggers:write'],
      project_id: a.project.id,
    });
    const stopper = new Macrofold({
      apiKey: stopKey.secret,
      baseURL: config.origin,
      fetch: async (url, init) => handleApi(new Request(url, init)),
    });
    await expect(stopper.triggers.get(a.trigger.id)).rejects.toMatchObject({ status: 403 });
    expect((await stopper.triggers.update(a.trigger.id, { enabled: false })).enabled).toBe(false);
    await expect(member.triggers.update(a.trigger.id, { enabled: true })).rejects.toMatchObject({
      status: 403,
    });
    const next = await a.client.projects.create({ name: 'Another project' });
    await expect(a.client.triggers.update(a.trigger.id, { project_id: next.id })).rejects.toMatchObject({
      status: 400,
    });
    await expect(a.client.triggers.list({ cursor: 'not-a-cursor' })).rejects.toMatchObject({ status: 400 });
    await expect(
      a.client.triggers.listDeliveries(a.trigger.id, { cursor: 'not-a-cursor' }),
    ).rejects.toMatchObject({ status: 400 });
    await stopper.triggers.delete(a.trigger.id);
    await expect(a.client.triggers.get(a.trigger.id)).rejects.toMatchObject({ status: 404 });
  });
  it('manages Slack discovery through the SDK, rejects scoped discovery, and disconnects credentials and intake', async () => {
    const f = await setup('slack');
    const connections = await f.client.slackConnections.list();
    expect(connections.data).toEqual([f.connection]);
    expect(connections.data[0]).not.toHaveProperty('secret_ciphertext');
    const channels = vi.spyOn(SlackClient.prototype, 'channels').mockResolvedValue({
      data: [{ id: 'C123', name: 'agent-inbox' }],
      next_cursor: 'next-page',
    });
    expect(
      await f.client.slackConnections.listChannels(f.connection!.id, { cursor: 'current-page' }),
    ).toEqual({
      data: [{ id: 'C123', name: 'agent-inbox' }],
      next_cursor: 'next-page',
    });
    expect(channels).toHaveBeenCalledWith('fixture-only-bot-token', 'current-page');
    const key = await f.client.apiKeys.create({
      name: 'Project-restricted connection access',
      scopes: ['connections:write'],
      project_id: f.project.id,
    });
    const scoped = new Macrofold({
      apiKey: key.secret,
      baseURL: config.origin,
      fetch: async (url, init) => handleApi(new Request(url, init)),
    });
    await expect(scoped.slackConnections.listChannels(f.connection!.id)).rejects.toMatchObject({
      status: 403,
    });
    channels.mockRejectedValue(new SlackError('missing_scope'));
    await expect(f.client.slackConnections.listChannels(f.connection!.id)).rejects.toMatchObject({
      status: 502,
      code: 'slack_missing_scope',
    });
    await f.client.slackConnections.delete(f.connection!.id);
    expect((await f.client.slackConnections.list()).data).toEqual([]);
    expect((await f.client.triggers.get(f.trigger.id)).enabled).toBe(false);
    expect((await slackEvent(f)).status).toBe(404);
    expect(
      (await f.query('SELECT secret_ciphertext FROM slack_connections WHERE id=$1', [f.connection!.id]))
        .rows[0].secret_ciphertext,
    ).toBe('');
  });
  it('purges incoming prompt content and routing when its project is permanently deleted', async () => {
    const f = await setup();
    const d = await (await incoming(f, { prompt: 'Private incoming text' })).json();
    await f.query(
      "UPDATE projects SET data=data||jsonb_build_object('deletion_due_at',now()-interval '1 second') WHERE id=$1",
      [f.project.id],
    );
    await transaction(f.account.p.organizationId, (tx) => purgeProjects(tx, new Date()), {
      exclusiveStorage: true,
    });
    expect(
      (await f.query('SELECT prompt_ciphertext,status FROM trigger_deliveries WHERE id=$1', [d.id])).rows[0],
    ).toEqual({ prompt_ciphertext: '', status: 'failed' });
    expect((await incoming(f)).status).toBe(404);
    await expect(f.client.triggers.get(f.trigger.id)).rejects.toMatchObject({ status: 404 });
  });
  it.each([true, false])(
    'preserves exact reservation accounting across trigger admission (funded=%s)',
    async (funded) => {
      const f = await setup();
      await f.client.agents.update(f.agent.id, {
        limits: { timeout_seconds: 60, max_cost_micro_usd: '10000' },
      });
      if (funded)
        await transaction(f.account.p.organizationId, (tx) =>
          credit(tx, f.account.p.organizationId, 50000n, `fixture:${id()}`),
        );
      const models = catalog.models(),
        previous = {
          execution: config.execution,
          allowPaid: config.allowPaid,
          orchestration: config.orchestration,
        };
      vi.spyOn(catalog, 'models').mockReturnValue(models);
      config.execution = 'docker';
      config.allowPaid = true;
      config.orchestration = 'poller';
      try {
        // Admission only: no sandbox or provider is invoked by this accounting fixture.
        const d = await (await incoming(f)).json();
        await f.query(
          "UPDATE dispatch_jobs SET available_at=now()-interval '1 second' WHERE kind='trigger' AND resource_id=$1",
          [d.id],
        );
        await Promise.all(
          Array.from({ length: 3 }, () => dispatchTriggerDelivery(f.account.p.organizationId, d.id)),
        );
        const delivery = (await f.client.triggers.listDeliveries(f.trigger.id)).data[0];
        if (!funded) {
          expect(delivery).toMatchObject({
            status: 'failed',
            run_id: null,
            error_code: 'insufficient_credit',
          });
          expect((await f.query('SELECT id FROM runs')).rowCount).toBe(0);
        } else {
          expect(delivery.status).toBe('accepted');
          expect(
            (
              await f.query('SELECT reserved_micro_usd FROM organizations WHERE id=$1', [
                f.account.p.organizationId,
              ])
            ).rows[0].reserved_micro_usd,
          ).toBe('10000');
          await f.query("UPDATE runs SET queue_expires_at=now()-interval '1 second' WHERE id=$1", [
            delivery.run_id,
          ]);
          await claimRun(f.account.p.organizationId, delivery.run_id!);
          await claimRun(f.account.p.organizationId, delivery.run_id!);
          expect((await f.client.runs.get(delivery.run_id!)).status).toBe('failed');
          expect((await f.query('SELECT id FROM runs')).rowCount).toBe(1);
        }
        expect(
          (
            await f.query('SELECT reserved_micro_usd,balance_micro_usd FROM organizations WHERE id=$1', [
              f.account.p.organizationId,
            ])
          ).rows[0],
        ).toEqual({ reserved_micro_usd: '0', balance_micro_usd: funded ? '50000' : '0' });
      } finally {
        config.execution = previous.execution;
        config.allowPaid = previous.allowPaid;
        config.orchestration = previous.orchestration;
      }
    },
  );
  it('survives actual worker death after the sending lease commits without replaying execution or a reply', async () => {
    const f = await setup('slack');
    await slackEvent(f);
    const d = (await f.client.triggers.listDeliveries(f.trigger.id)).data[0];
    await dispatch(f, d.id);
    const admitted = (await f.client.triggers.listDeliveries(f.trigger.id)).data[0];
    await f.client.runs.cancel(admitted.run_id!);
    await f.query(
      "UPDATE dispatch_jobs SET available_at=now()-interval '1 second' WHERE kind='trigger' AND resource_id=$1",
      [d.id],
    );
    const child = fork(
      new URL('../fixtures/trigger-crash-worker.ts', import.meta.url),
      [f.account.p.organizationId, d.id],
      { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
    );
    const exited = once(child, 'exit');
    try {
      const [message] = await Promise.race([
        once(child, 'message'),
        exited.then(() => {
          throw new Error('Worker exited before the requested boundary');
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Worker boundary timed out')), 10000).unref(),
        ),
      ]);
      expect(message).toEqual({ boundary: 'reply-request' });
      child.kill('SIGKILL');
      await exited;
      expect((await f.client.triggers.listDeliveries(f.trigger.id)).data[0].reply_state).toBe('sending');
      const reply = vi.spyOn(SlackClient.prototype, 'reply');
      await f.query(
        "UPDATE dispatch_jobs SET lease_until=now()-interval '1 second' WHERE kind='trigger' AND resource_id=$1",
        [d.id],
      );
      await dispatchTriggerDelivery(f.account.p.organizationId, d.id);
      expect((await f.client.triggers.listDeliveries(f.trigger.id)).data[0].reply_state).toBe('uncertain');
      expect(reply).not.toHaveBeenCalled();
      expect((await f.query('SELECT id FROM runs')).rows).toEqual([{ id: admitted.run_id }]);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
    }
  });
  it('requires a secret and event identity, rotates without overlap and enforces intake limits', async () => {
    const f = await setup();
    expect((await incoming(f, {}, id(), 'wrong')).status).toBe(401);
    expect((await incoming(f, {}, '')).status).toBe(400);
    const rotation = await f.client.triggers.rotateSecret(f.trigger.id);
    expect((await incoming(f)).status).toBe(401);
    await f.client.triggers.update(f.trigger.id, { max_runs_per_day: 1 });
    expect((await incoming(f, {}, id(), rotation.webhook_secret)).status).toBe(202);
    expect((await incoming(f, {}, id(), rotation.webhook_secret)).status).toBe(429);
    expect((await incoming(f, { prompt: 'x'.repeat(70000) }, id(), rotation.webhook_secret)).status).toBe(
      413,
    );
  });
  it.each(['expired', 'revoked', 'changed', 'deleted'] as const)(
    'rejects %s pending delivery before reserving funds or launching',
    async (mode) => {
      const f = await setup();
      const d = await (await incoming(f)).json();
      if (mode === 'expired')
        await f.query("UPDATE trigger_deliveries SET expires_at=now()-interval '1 second' WHERE id=$1", [
          d.id,
        ]);
      if (mode === 'revoked')
        await f.query('UPDATE api_keys SET revoked_at=now() WHERE user_id=$1', [f.account.p.userId]);
      if (mode === 'changed')
        await f.client.triggers.update(f.trigger.id, { prompt: 'Changed instructions' });
      if (mode === 'deleted') await f.client.triggers.delete(f.trigger.id);
      await dispatch(f, d.id);
      const row = (
        await f.query('SELECT status,run_id,error_code FROM trigger_deliveries WHERE id=$1', [d.id])
      ).rows[0];
      expect(row).toMatchObject({
        status: 'failed',
        run_id: null,
        error_code: {
          expired: 'trigger_delivery_expired',
          revoked: 'authorization_revoked',
          changed: 'trigger_configuration_changed',
          deleted: 'trigger_deleted',
        }[mode],
      });
      expect((await f.query('SELECT id FROM runs')).rowCount).toBe(0);
      expect(
        (
          await f.query('SELECT reserved_micro_usd FROM organizations WHERE id=$1', [
            f.account.p.organizationId,
          ])
        ).rows[0].reserved_micro_usd,
      ).toBe('0');
    },
  );
  it('isolates tenant and project access in API and RLS', async () => {
    const a = await setup(),
      b = await setup();
    await expect(b.client.triggers.get(a.trigger.id)).rejects.toMatchObject({ status: 404 });
    await expect(b.client.triggers.listDeliveries(a.trigger.id)).rejects.toMatchObject({ status: 404 });
    expect((await b.query('SELECT id FROM triggers WHERE id=$1', [a.trigger.id])).rows).toEqual([]);
    const restrictedProject = await a.client.projects.create({ name: 'Other allowed project' });
    const key = await a.client.apiKeys.create({
      name: 'Wrong project',
      scopes: ['triggers:read', 'triggers:write', 'runs:read', 'runs:write', 'projects:read'],
      project_id: restrictedProject.id,
    });
    const scoped = new Macrofold({
      apiKey: key.secret,
      baseURL: config.origin,
      fetch: async (url, init) => handleApi(new Request(url, init)),
    });
    await expect(scoped.triggers.get(a.trigger.id)).rejects.toMatchObject({ status: 404 });
    expect((await scoped.triggers.list()).data).toEqual([]);
  });
  it('recovers a committed run without duplicate admission, and marks an interrupted reply uncertain', async () => {
    const f = await setup('slack');
    await slackEvent(f);
    const d = (await f.client.triggers.listDeliveries(f.trigger.id)).data[0];
    await dispatch(f, d.id);
    const accepted = (await f.client.triggers.listDeliveries(f.trigger.id)).data[0];
    await f.client.runs.cancel(accepted.run_id!);
    const reply = vi
      .spyOn(SlackClient.prototype, 'reply')
      .mockRejectedValue(new SlackError('unreachable', true));
    await dispatch(f, d.id);
    expect((await f.client.triggers.listDeliveries(f.trigger.id)).data[0].reply_state).toBe('uncertain');
    await dispatch(f, d.id);
    expect(reply).toHaveBeenCalledTimes(1);
    await f.client.triggers.retryReply(f.trigger.id, d.id);
    await f.query("UPDATE trigger_deliveries SET reply_state='sending' WHERE id=$1", [d.id]);
    await f.query(
      "UPDATE dispatch_jobs SET state='running',lease_until=now()-interval '1 second',available_at=now() WHERE kind='trigger' AND resource_id=$1",
      [d.id],
    );
    await dispatchTriggers();
    expect((await f.client.triggers.listDeliveries(f.trigger.id)).data[0]).toMatchObject({
      reply_state: 'uncertain',
      error_code: 'reply_outcome_unknown',
    });
    expect(reply).toHaveBeenCalledTimes(1);
    expect((await f.query('SELECT id FROM runs')).rowCount).toBe(1);
    expect((await transaction(f.account.p.organizationId, (tx) => getRun(tx, accepted.run_id!))).status).toBe(
      'cancelled',
    );
  });
});
