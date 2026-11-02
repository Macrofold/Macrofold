import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixtureAccount, retireFixtureRuns } from '../fixtures/account';
import { memoryServiceFixture } from '../fixtures/memory-service';
import { pool, authPool, transaction } from '../../packages/db';
import { Client } from '../../sdk/typescript/src/client';
import { handleApi } from '../../packages/core/src/http';
import { config } from '../../packages/core/src/config';
import { admitRun, getNativeRun } from '../../packages/core/src/runs';
import { settle } from '../../packages/core/src/ledger';
import { prepareIntegrationContext, getIntegration } from '../../packages/core/src/agent-integrations';
import { queueIntegrationCapture, dispatchIntegrationJobs } from '../../packages/core/src/integration-memory';
import { emitBatch } from '../../packages/core/src/events';
import { purgeWorkspaces } from '../../packages/core/src/deletion';

let account: Awaited<ReturnType<typeof fixtureAccount>>, client: Client;
const services: Awaited<ReturnType<typeof memoryServiceFixture>>[] = [];
const originalOrigins = process.env.LOCAL_MEMORY_SERVICE_ALLOWED_ORIGINS;
beforeAll(async () => {
  account = await fixtureAccount('Memory service account');
  client = new Client({
    token: account.key,
    baseURL: config.origin,
    fetch: (input, init) => handleApi(new Request(input, init)),
  });
});
afterAll(async () => {
  if (account) await retireFixtureRuns(account.p.organizationId);
  if (originalOrigins === undefined) delete process.env.LOCAL_MEMORY_SERVICE_ALLOWED_ORIGINS;
  else process.env.LOCAL_MEMORY_SERVICE_ALLOWED_ORIGINS = originalOrigins;
  await Promise.all(services.map((service) => service.close()));
  await pool.end();
  await authPool.end();
});

async function installation(provider: 'hindsight' | 'claude-mem', required = false) {
  const service = await memoryServiceFixture(provider);
  services.push(service);
  process.env.LOCAL_MEMORY_SERVICE_ALLOWED_ORIGINS = services.map((fixture) => fixture.baseURL).join(',');
  const workspace = await client.request('createWorkspace', {
    body: { name: `Memory ${provider} ${randomUUID()}` },
  });
  const tree = workspace.default_worktree_id!;
  const connection = await client.request('createConnection', {
    body: {
      name: 'Fixture memory service',
      kind: 'memory_service',
      provider,
      url: service.baseURL,
      auth_method: 'bearer',
      secret: 'fixture-memory-key',
    },
  });
  const installed = await client.request('createAgentIntegration', {
    body: {
      workspace_id: workspace.id,
      worktree_id: tree,
      pack_id: provider,
      service: {
        connection_id: connection.id,
        namespace: `fixture-${randomUUID()}`,
        namespace_is_dedicated: true,
        external_cost_acknowledged: true,
        required,
      },
    },
  });
  return { service, workspace, tree, connection, installed };
}

async function nativeRun(worktreeId: string, complete = false) {
  return transaction(account.p.organizationId, async (tx) => {
    const accepted = await admitRun(tx, account.p, {
      worktree_id: worktreeId,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Synthetic user preference: concise summaries.',
    });
    let run = await getNativeRun(tx, accepted.run_id);
    if (complete) {
      await settle(tx, account.p.organizationId, run.id, BigInt(run.reservation_micro_usd), 0n);
      await tx.query("UPDATE runs SET status='succeeded',completed_at=now(),result=$2 WHERE id=$1", [
        run.id,
        {
          output_text: 'Confirmed: concise summaries are preferred.',
          execution_outcome: 'success',
          persistence_status: 'not_required',
        },
      ]);
      await tx.query("UPDATE dispatch_jobs SET state='done' WHERE kind='run' AND resource_id=$1", [run.id]);
      run = await getNativeRun(tx, run.id);
    }
    return run;
  });
}

async function dispatch() {
  await transaction(account.p.organizationId, (tx) =>
    tx.query(
      "UPDATE dispatch_jobs SET available_at=now() WHERE kind='integration' AND state IN ('pending','running') AND lease_until IS NULL",
    ),
  );
  await dispatchIntegrationJobs();
}

for (const provider of ['hindsight', 'claude-mem'] as const)
  it(`${provider}: real public API setup, committed capture, frozen recall, source export and generation-fenced purge`, async () => {
    const fixture = await installation(provider);
    const run = await nativeRun(fixture.tree, true);
    const original = run.config.prompt;
    await transaction(account.p.organizationId, async (tx) => {
      await queueIntegrationCapture(tx, run);
      await queueIntegrationCapture(tx, run);
    });
    await dispatch();
    await dispatch();
    const activity = await client.request('listAgentIntegrationActivity', {
      params: { path: { integration_id: fixture.installed.id } },
    });
    expect(activity.data).toHaveLength(1);
    expect(activity.data[0].state).toBe('complete');
    expect(fixture.service.documents.size).toBe(1);
    const first = await prepareIntegrationContext(run);
    expect(first.context).toContain('concise summaries');
    const recalled = fixture.service.requests.filter(
      (item) => item.path.includes('recall') || item.path === '/v1/context',
    ).length;
    expect(await prepareIntegrationContext(run)).toEqual(first);
    expect(
      fixture.service.requests.filter((item) => item.path.includes('recall') || item.path === '/v1/context'),
    ).toHaveLength(recalled);
    expect(run.config.prompt).toBe(original);
    const exported = await client.request('exportAgentIntegrationMemory', {
      params: { path: { integration_id: fixture.installed.id } },
    });
    expect(exported.export_scope).toBe('captured_sources');
    expect(exported.files[0].content).toContain('Confirmed: concise');
    const forgotten = await client.request('forgetAgentIntegrationMemory', {
      params: {
        path: { integration_id: fixture.installed.id },
        header: { 'If-Match': `"${fixture.installed.revision}"` },
      },
      body: { confirm_delete_all: true },
    });
    expect(forgotten.recall_disabled).toBe(true);
    await expect(prepareIntegrationContext(run)).rejects.toMatchObject({
      code: 'integration_configuration_changed',
    });
    await dispatch();
    expect(fixture.service.documents.size).toBe(0);
    const current = await client.request('getAgentIntegration', {
      params: { path: { integration_id: fixture.installed.id } },
    });
    expect(current.last_error_code).toBe('memory_forgotten');
    await expect(
      client.request('updateAgentIntegration', {
        params: { path: { integration_id: current.id }, header: { 'If-Match': `"${current.revision}"` } },
        body: { state: 'active' },
      }),
    ).rejects.toMatchObject({ code: 'memory_collection_retired' });
  });

it('does not resubmit a Claude-mem capture after an uncertain acknowledgement', async () => {
  const fixture = await installation('claude-mem');
  const run = await nativeRun(fixture.tree, true);
  fixture.service.loseNextCapture();
  await transaction(account.p.organizationId, (tx) => queueIntegrationCapture(tx, run));
  await dispatch();
  await dispatch();
  expect(fixture.service.requests.filter((item) => item.path.startsWith('/v1/events?'))).toHaveLength(1);
  const activity = await client.request('listAgentIntegrationActivity', {
    params: { path: { integration_id: fixture.installed.id } },
  });
  expect(activity.data[0].state).toBe('unknown');
});

it('distinguishes optional/required retrieval failure, and refuses to replay an uncertain lookup', async () => {
  const optional = await installation('hindsight');
  const run = await nativeRun(optional.tree, true);
  optional.service.failRecall(true);
  expect(await prepareIntegrationContext(run)).toEqual({});
  const count = optional.service.requests.length;
  expect(await prepareIntegrationContext(run)).toEqual({});
  expect(optional.service.requests).toHaveLength(count);
  const required = await installation('hindsight', true);
  const strictRun = await nativeRun(required.tree, true);
  required.service.failRecall(true);
  await expect(prepareIntegrationContext(strictRun)).rejects.toMatchObject({
    code: 'memory_service_http_503',
  });
});

it('rejects a namespace shared with another installation, and stops capture after connection revocation', async () => {
  const fixture = await installation('hindsight');
  const other = await client.request('createWorkspace', { body: { name: 'Separate customer memory' } });
  await expect(
    client.request('createAgentIntegration', {
      body: {
        workspace_id: other.id,
        worktree_id: other.default_worktree_id!,
        pack_id: 'hindsight',
        service: {
          connection_id: fixture.connection.id,
          namespace: fixture.installed.service!.namespace,
          namespace_is_dedicated: true,
          external_cost_acknowledged: true,
        },
      },
    }),
  ).rejects.toMatchObject({ code: 'integration_already_installed' });
  const run = await nativeRun(fixture.tree, true);
  await transaction(account.p.organizationId, async (tx) => {
    await queueIntegrationCapture(tx, run);
    await tx.query('UPDATE connections SET data=data||\'{"status":"error"}\'::jsonb WHERE id=$1', [
      fixture.connection.id,
    ]);
  });
  await dispatch();
  expect(
    fixture.service.requests.filter((item) => item.path.endsWith('/memories') && item.method === 'POST'),
  ).toHaveLength(0);
  expect(await prepareIntegrationContext(run)).toEqual({});
  expect(
    (await transaction(account.p.organizationId, (tx) => getIntegration(tx, account.p, fixture.installed.id)))
      .last_error_code,
  ).toBe('memory_connection_unavailable');
});

it('claims simultaneous manual searches once, replays a lost HTTP result, and revokes plaintext after forgetting', async () => {
  const fixture = await installation('hindsight');
  fixture.service.delayRecall(30);
  const key = randomUUID();
  const args = {
    idempotencyKey: key,
    params: { path: { integration_id: fixture.installed.id } },
    body: { query: 'Synthetic preference' },
  };
  const results = await Promise.allSettled([
    client.request('searchAgentIntegrationMemory', args),
    client.request('searchAgentIntegrationMemory', args),
  ]);
  expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
  const replay = await client.request('searchAgentIntegrationMemory', args);
  expect(replay.receipt.external_cost_micro_usd).toBe('17');
  expect(
    fixture.service.requests.filter((request) => request.path.endsWith('/memories/recall')),
  ).toHaveLength(1);
  // Remove only the HTTP envelope to simulate losing publication after the
  // paid request receipt committed. The durable owner still forbids resubmit.
  await transaction(account.p.organizationId, (tx) =>
    tx.query('DELETE FROM idempotency WHERE key=$1', [key]),
  );
  expect(await client.request('searchAgentIntegrationMemory', args)).toEqual(replay);
  expect(
    fixture.service.requests.filter((request) => request.path.endsWith('/memories/recall')),
  ).toHaveLength(1);
  await client.request('forgetAgentIntegrationMemory', {
    params: {
      path: { integration_id: fixture.installed.id },
      header: { 'If-Match': `"${fixture.installed.revision}"` },
    },
    body: { confirm_delete_all: true },
  });
  await expect(client.request('searchAgentIntegrationMemory', args)).rejects.toMatchObject({
    code: 'memory_context_revoked',
    status: 410,
  });
  const copies = await transaction(account.p.organizationId, (tx) =>
    tx.query(
      "SELECT count(*) AS count FROM operations WHERE data->>'memory_integration_id'=$1 AND data ? 'memory_context_ciphertext'",
      [fixture.installed.id],
    ),
  );
  expect(Number(copies.rows[0].count)).toBe(0);
});

it('never resends a paid manual query after an uncertain service response', async () => {
  const fixture = await installation('hindsight');
  fixture.service.loseNextRecall();
  const args = {
    idempotencyKey: randomUUID(),
    params: { path: { integration_id: fixture.installed.id } },
    body: { query: 'Synthetic query' },
  };
  await expect(client.request('searchAgentIntegrationMemory', args)).rejects.toThrow();
  await expect(client.request('searchAgentIntegrationMemory', args)).rejects.toMatchObject({
    code: 'memory_search_outcome_unknown',
  });
  expect(
    fixture.service.requests.filter((request) => request.path.endsWith('/memories/recall')),
  ).toHaveLength(1);
});

it('fences rotated service identity, respects No tools, and retains detached cleanup controls', async () => {
  const fixture = await installation('hindsight');
  const run = await nativeRun(fixture.tree, true);
  await transaction(account.p.organizationId, (tx) =>
    tx.query("UPDATE connections SET data=data||jsonb_build_object('url',$2::text) WHERE id=$1", [
      fixture.connection.id,
      fixture.service.baseURL + '/other',
    ]),
  );
  expect(await prepareIntegrationContext(run)).toEqual({});
  expect(fixture.service.requests.filter((request) => request.path.includes('recall'))).toHaveLength(0);
  const denied = await installation('hindsight');
  const noTools = await transaction(account.p.organizationId, async (tx) => {
    const accepted = await admitRun(tx, account.p, {
      worktree_id: denied.tree,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Synthetic question',
      connection_grants: [],
    });
    return getNativeRun(tx, accepted.run_id);
  });
  expect(await prepareIntegrationContext(noTools)).toEqual({});
  expect(denied.service.requests.filter((request) => request.path.includes('recall'))).toHaveLength(0);
  const events = await transaction(account.p.organizationId, (tx) =>
    tx.query("SELECT data FROM run_events WHERE run_id=$1 AND type='memory.omitted'", [noTools.id]),
  );
  expect(events.rows).toHaveLength(1);
  await client.request('deleteAgentIntegration', {
    params: { path: { integration_id: fixture.installed.id } },
  });
  const detached = await client.request('getAgentIntegration', {
    params: { path: { integration_id: fixture.installed.id } },
  });
  expect(detached.detached).toBe(true);
  expect(
    (
      await client.request('exportAgentIntegrationMemory', {
        params: { path: { integration_id: detached.id } },
      })
    ).export_scope,
  ).toBe('captured_sources');
  await expect(
    client.request('updateAgentIntegration', {
      params: { path: { integration_id: detached.id }, header: { 'If-Match': `"${detached.revision}"` } },
      body: { state: 'active' },
    }),
  ).rejects.toMatchObject({ code: 'integration_detached' });
});

it('soft deletion stops new capture and permanent Workspace purge erases independent local memory copies', async () => {
  const fixture = await installation('hindsight');
  const first = await nativeRun(fixture.tree, true);
  await transaction(account.p.organizationId, (tx) => queueIntegrationCapture(tx, first));
  await dispatch();
  await dispatch();
  await prepareIntegrationContext(first);
  await client.request('searchAgentIntegrationMemory', {
    params: { path: { integration_id: fixture.installed.id } },
    body: { query: 'Synthetic preference' },
  });
  const next = await nativeRun(fixture.tree, true);
  await transaction(account.p.organizationId, (tx) => queueIntegrationCapture(tx, next));
  const posted = fixture.service.requests.filter(
    (request) => request.method === 'POST' && request.path.endsWith('/memories'),
  ).length;
  await client.request('scheduleWorkspaceDeletion', {
    params: { path: { workspace_id: fixture.workspace.id } },
    body: { confirmation: fixture.workspace.name },
  });
  await dispatch();
  expect(
    fixture.service.requests.filter(
      (request) => request.method === 'POST' && request.path.endsWith('/memories'),
    ),
  ).toHaveLength(posted);
  await transaction(account.p.organizationId, (tx) =>
    purgeWorkspaces(tx, new Date(Date.now() + 8 * 24 * 60 * 60 * 1000)),
  );
  const copies = await transaction(account.p.organizationId, async (tx) => ({
    source: (
      await tx.query(
        'SELECT count(*) AS count FROM integration_sources WHERE integration_id=$1 AND text_ciphertext IS NOT NULL',
        [fixture.installed.id],
      )
    ).rows[0].count,
    recall: (
      await tx.query('SELECT count(*) AS count FROM integration_retrievals WHERE integration_id=$1', [
        fixture.installed.id,
      ])
    ).rows[0].count,
    search: (
      await tx.query(
        "SELECT count(*) AS count FROM operations WHERE data->>'memory_integration_id'=$1 AND data ? 'memory_context_ciphertext'",
        [fixture.installed.id],
      )
    ).rows[0].count,
  }));
  expect(copies).toEqual({ source: '0', recall: '0', search: '0' });
  // External memory is intentionally still present until explicitly requested.
  expect(fixture.service.documents.size).toBe(1);
  const retained = await client.request('getAgentIntegration', {
    params: { path: { integration_id: fixture.installed.id } },
  });
  expect(retained.retired).toBe(true);
  await client.request('forgetAgentIntegrationMemory', {
    params: { path: { integration_id: retained.id }, header: { 'If-Match': `"${retained.revision}"` } },
    body: { confirm_delete_all: true },
  });
  await dispatch();
  expect(fixture.service.documents.size).toBe(0);
});

it('bounds successful pending polls and safely resumes acknowledged checks before retrying blocked cleanup', async () => {
  const fixture = await installation('claude-mem');
  const run = await nativeRun(fixture.tree, true);
  await transaction(account.p.organizationId, (tx) => queueIntegrationCapture(tx, run));
  await dispatch();
  const source = (
    await client.request('listAgentIntegrationActivity', {
      params: { path: { integration_id: fixture.installed.id } },
    })
  ).data[0];
  await transaction(account.p.organizationId, (tx) =>
    tx.query('UPDATE integration_sources SET polls=3000 WHERE id=$1', [source.id]),
  );
  await dispatch();
  let activity = await client.request('listAgentIntegrationActivity', {
    params: { path: { integration_id: fixture.installed.id } },
  });
  expect(activity.data[0]).toMatchObject({
    state: 'unknown',
    error_code: 'memory_processing_deadline_exceeded',
  });
  const forgotten = await client.request('forgetAgentIntegrationMemory', {
    params: {
      path: { integration_id: fixture.installed.id },
      header: { 'If-Match': `"${fixture.installed.revision}"` },
    },
    body: { confirm_delete_all: true },
  });
  await dispatch();
  activity = await client.request('listAgentIntegrationActivity', {
    params: { path: { integration_id: fixture.installed.id } },
  });
  expect(activity.data.find((item) => item.id === forgotten.cleanup_id)?.state).toBe('unknown');
  await client.request('retryAgentIntegrationCheck', {
    params: { path: { integration_id: fixture.installed.id, source_id: source.id } },
  });
  await dispatch();
  await client.request('retryAgentIntegrationCheck', {
    params: { path: { integration_id: fixture.installed.id, source_id: forgotten.cleanup_id } },
  });
  await dispatch();
  expect(fixture.service.requests.filter((request) => request.path.startsWith('/v1/events?'))).toHaveLength(
    1,
  );
  expect(fixture.service.documents.size).toBe(0);
  activity = await client.request('listAgentIntegrationActivity', {
    params: { path: { integration_id: fixture.installed.id } },
  });
  expect(activity.data.find((item) => item.id === forgotten.cleanup_id)?.state).toBe('complete');
});

it('captures bounded engineering failure history and accepted checkpoint provenance without tool secrets or reasoning', async () => {
  const fixture = await installation('claude-mem');
  const run = await nativeRun(fixture.tree, true);
  const first = await client.request('createCheckpoint', {
    params: { path: { worktree_id: fixture.tree } },
    body: {},
  });
  const checkpointId = String(first.result!.checkpoint_id);
  const latest = await client.request('createCheckpoint', {
    params: { path: { worktree_id: fixture.tree } },
    body: {},
  });
  expect(latest.result!.checkpoint_id).not.toBe(checkpointId);
  const sourceRun = await transaction(account.p.organizationId, async (tx) => {
    await tx.query(
      "UPDATE runs SET status='failed',result=result||$2::jsonb,config=jsonb_set(config,'{integration_context,repository}',$3::jsonb) WHERE id=$1",
      [
        run.id,
        {
          checkpoint_id: checkpointId,
          execution_outcome: 'failure',
          failure_code: 'fixture_rejected',
          persistence_status: 'verified',
          output_text:
            'Approach rejected; no Apply was confirmed. <private>assistant-private-fixture</private>',
        },
        { repository_id: '123456', target_branch: 'main', worktree_branch: 'investigation' },
      ],
    );
    const current = await getNativeRun(tx, run.id);
    await emitBatch(
      tx,
      account.p.organizationId,
      run.id,
      [
        {
          type: 'tool.started',
          data: {
            tool_call_id: 'fixture-call',
            name: 'validate_recipe',
            arguments: { secret: 'argument-secret-must-not-transfer' },
          },
        },
        {
          type: 'tool.completed',
          data: {
            tool_call_id: 'fixture-call',
            is_error: true,
            outcome: 'unknown',
            result: { secret: 'result-secret-must-not-transfer' },
          },
        },
        { type: 'reasoning.delta', data: { text: 'private-reasoning-must-not-transfer' } },
      ],
      { currentRun: current },
    );
    await queueIntegrationCapture(tx, current);
    return current;
  });
  await dispatch();
  await dispatch();
  const activity = await client.request('listAgentIntegrationActivity', {
    params: { path: { integration_id: fixture.installed.id } },
  });
  expect(activity.data).toHaveLength(1);
  expect(activity.data[0].source_run_id).toBe(sourceRun.id);
  const captured = await client.request('getAgentIntegrationSource', {
    params: { path: { integration_id: fixture.installed.id, source_id: activity.data[0].id } },
  });
  const content = JSON.parse(captured.content!);
  expect(Buffer.byteLength(captured.content!)).toBeLessThanOrEqual(256 * 1024);
  expect(content).toMatchObject({
    kind: 'engineering-history',
    run_outcome: { status: 'failed', partial: true, failure_code: 'fixture_rejected' },
    provenance: {
      source_run_id: run.id,
      verified_checkpoint_id: checkpointId,
      checkpoint_role: 'run_output',
      repository: { repository_id: '123456' },
    },
  });
  expect(content.provenance.git_commit).toMatch(/^[a-f0-9]{40,64}$/);
  expect(content.tool_outcomes).toHaveLength(1);
  expect(content.tool_outcomes[0]).toMatchObject({
    name: 'validate_recipe',
    reported_outcome: 'unknown',
    effect_verified: false,
  });
  expect(captured.content).not.toContain('argument-secret-must-not-transfer');
  expect(captured.content).not.toContain('result-secret-must-not-transfer');
  expect(captured.content).not.toContain('private-reasoning-must-not-transfer');
  expect(captured.content).not.toContain('assistant-private-fixture');
  const hindsight = await installation('hindsight');
  const excluded = await nativeRun(hindsight.tree, true);
  await transaction(account.p.organizationId, async (tx) => {
    await tx.query("UPDATE runs SET status='cancelled' WHERE id=$1", [excluded.id]);
    await queueIntegrationCapture(tx, await getNativeRun(tx, excluded.id));
  });
  expect(
    (
      await client.request('listAgentIntegrationActivity', {
        params: { path: { integration_id: hindsight.installed.id } },
      })
    ).data,
  ).toHaveLength(0);
});
