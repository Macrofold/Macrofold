import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { handleApi } from '../../packages/core/src/http';
import { auth, customerScopes, type Principal } from '../../packages/core/src/auth';
import { createKey } from '../../packages/core/src/keys';
import { pool, authPool, transaction } from '../../packages/db';
import { id, sha256 } from '../../packages/core/src/crypto';
import { config } from '../../packages/core/src/config';
import { credit, reserve, settle } from '../../packages/core/src/ledger';
import { executeRun } from '../../packages/core/src/engine';
import { emit, eventsAfter, streamEvents } from '../../packages/core/src/events';
import { serveObject } from '../../packages/core/src/transfers';
import { checkpoint, checkpointState, type FileRecord } from '../../packages/core/src/files';
import * as resources from '../../packages/core/src/resources';
import { saveContent, readContent } from '../../packages/providers/src/storage';
import { withRepository } from '../../packages/providers/src/git-repository';
import spec from '../../docs/api/openapi.json';

let a: Principal, b: Principal, keyA: string, keyB: string;
const ajv = new Ajv({ strict: false });
addFormats(ajv);
const check = (schema: string, value: unknown) => {
  const validate = ajv.compile({ $ref: `#/components/schemas/${schema}`, components: spec.components });
  expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
};
async function account(label: string) {
  const email = `${label.toLowerCase().replaceAll(' ', '-')}-${id()}@example.test`;
  const signup = await auth.api.signUpEmail({
    body: { email, password: 'test-password-at-least-12', name: label },
  });
  const user = signup.user;
  await pool.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1', [user.id]);
  const org = (await pool.query('SELECT organization_id FROM memberships WHERE user_id=$1', [user.id]))
    .rows[0].organization_id;
  const p: Principal = {
    id: user.id,
    userId: user.id,
    email,
    organizationId: org,
    role: 'owner',
    kind: 'user',
    scopes: customerScopes,
    projectIds: [],
    operator: false,
  };
  const key = await transaction(org, (tx) =>
    createKey(tx, p, { name: 'Integration', scopes: customerScopes }),
  );
  return { p, key: key.secret };
}
async function request(
  method: string,
  path: string,
  body?: unknown,
  key = keyA,
  extra: Record<string, string> = {},
) {
  const response = await handleApi(
    new Request(config.origin + path, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        'Idempotency-Key': id(),
        'Content-Type': 'application/json',
        ...extra,
      },
      body:
        body === undefined
          ? undefined
          : extra['Content-Type'] === 'application/octet-stream'
            ? (body as string)
            : JSON.stringify(body),
    }),
  );
  const value = response.status === 204 ? null : await response.json();
  return { response, value };
}
beforeAll(async () => {
  ({ p: a, key: keyA } = await account('Tenant A'));
  ({ p: b, key: keyB } = await account('Tenant B'));
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
describe('tenant API and execution invariants', () => {
  it.each(['editor', 'transfer'])(
    'preserves executable permissions when %s replaces file content',
    async (source) => {
      const project = (await request('POST', '/v1/projects', { name: 'Executable file' })).value;
      const workspace = await transaction(a.organizationId, async (tx) => {
        const cp = await checkpoint(tx, a, project.default_workspace_id, 'Executable fixture', [
          {
            ...(await saveContent(a.organizationId, Buffer.from('original'))),
            path: 'script.sh',
            type: 'file',
            mode: 0o755,
            modified_at: new Date().toISOString(),
            git_ignored: false,
          },
        ]);
        return resources.update(tx, 'workspaces', project.default_workspace_id, checkpointState(cp));
      });
      if (source === 'editor') {
        expect(
          (
            await request('PUT', `/v1/workspaces/${workspace.id}/file?path=script.sh`, 'changed', keyA, {
              'Content-Type': 'application/octet-stream',
              'If-Match': workspace.revision,
            })
          ).response.status,
        ).toBe(202);
      } else {
        const plan = (
          await request('POST', `/v1/workspaces/${workspace.id}/transfers`, {
            direction: 'push',
            base_revision: workspace.revision,
            paths: ['script.sh'],
            manifest: [
              {
                path: 'script.sh',
                local_sha256: sha256('changed'),
                local_size_bytes: 7,
                baseline_known: true,
                baseline_sha256: sha256('original'),
              },
            ],
          })
        ).value;
        const upload = new Request(plan.actions[0].url, { method: 'PUT', body: 'changed' });
        expect(
          (await serveObject(upload, decodeURIComponent(new URL(upload.url).pathname.split('/').pop()!)))
            .status,
        ).toBe(204);
        expect(
          (await request('POST', `/v1/transfers/${plan.id}/apply`, { expected_revision: workspace.revision }))
            .response.status,
        ).toBe(202);
      }
      const saved = await transaction(a.organizationId, (tx) =>
        resources.get(tx, 'workspaces', workspace.id),
      );
      const file = (saved.files as FileRecord[])[0];
      expect(file.mode).toBe(0o755);
      expect((await readContent(file.key, file.sha256)).toString()).toBe('changed');
      expect(
        await withRepository(
          saved.git_files as FileRecord[],
          async (repo) => (await repo.tree()).get('script.sh')?.mode,
        ),
      ).toBe('100755');
    },
  );
  it('replays admitted mutations, rejects changed payloads, and enforces tenant isolation at API and SQL layers', async () => {
    const token = id();
    const first = await request('POST', '/v1/projects', { name: 'Private project' }, keyA, {
      'Idempotency-Key': token,
    });
    expect(first.response.status).toBe(201);
    check('Project', first.value);
    const replay = await request('POST', '/v1/projects', { name: 'Private project' }, keyA, {
      'Idempotency-Key': token,
    });
    expect(replay.value.id).toBe(first.value.id);
    expect(replay.response.headers.get('idempotency-replayed')).toBe('true');
    expect(
      (await request('POST', '/v1/projects', { name: 'Other' }, keyA, { 'Idempotency-Key': token })).response
        .status,
    ).toBe(409);
    expect((await request('GET', `/v1/projects/${first.value.id}`, undefined, keyB)).response.status).toBe(
      404,
    );
    const hidden = await transaction(b.organizationId, (tx) =>
      tx.query('SELECT id FROM projects WHERE id=$1', [first.value.id]),
    );
    expect(hidden.rowCount).toBe(0);
    const inserted = await transaction(b.organizationId, (tx) =>
      tx.query('INSERT INTO projects(id,organization_id,data) VALUES($1,$2,$3)', [
        id(),
        a.organizationId,
        '{}',
      ]),
    ).catch((e) => e);
    expect(inserted.code).toBe('42501');
  });
  it('prevents key scope escalation and rejects revoked keys', async () => {
    const scoped = await transaction(a.organizationId, (tx) =>
      createKey(tx, a, { name: 'Read only', scopes: ['identity:read', 'projects:read'] }),
    );
    expect((await request('POST', '/v1/projects', { name: 'Denied' }, scoped.secret)).response.status).toBe(
      403,
    );
    await request('DELETE', `/v1/api-keys/${scoped.id}`);
    expect((await request('GET', '/v1/me', undefined, scoped.secret)).response.status).toBe(401);
  });
  it('preserves files across runs and sessions, publishes contiguous events, and supports cursor reconnect', async () => {
    const project = (await request('POST', '/v1/projects', { name: 'Persistent execution' })).value;
    let workspace = (await request('GET', `/v1/workspaces/${project.default_workspace_id}`)).value;
    check('Workspace', workspace);
    const write = await request(
      'PUT',
      `/v1/workspaces/${workspace.id}/file?path=brief.md`,
      'Remember this content.',
      keyA,
      { 'Content-Type': 'application/octet-stream', 'If-Match': workspace.revision },
    );
    expect(write.response.status).toBe(202);
    expect(
      (
        await request('PUT', `/v1/workspaces/${workspace.id}/file?path=brief.md`, 'Stale overwrite', keyA, {
          'Content-Type': 'application/octet-stream',
          'If-Match': workspace.revision,
        })
      ).response.status,
    ).toBe(412);
    const accepted = (
      await request('POST', '/v1/runs', {
        workspace_id: workspace.id,
        harness: 'codex',
        model: 'fixture-model',
        billing_mode: 'managed',
        prompt: 'Inspect the files.',
      })
    ).value;
    check('RunAccepted', accepted);
    expect(
      (
        await request('POST', '/v1/runs', {
          workspace_id: workspace.id,
          harness: 'codex',
          model: 'fixture-model',
          billing_mode: 'managed',
          prompt: 'Conflicting writer',
        })
      ).response.status,
    ).toBe(409);
    await executeRun(a.organizationId, accepted.run_id);
    const run = (await request('GET', `/v1/runs/${accepted.run_id}`)).value;
    check('Run', run);
    expect(run.status).toBe('succeeded');
    const result = (await request('GET', `/v1/runs/${accepted.run_id}/result`)).value;
    check('RunResult', result);
    expect(result.persistence_status).toBe('verified');
    const listing = (await request('GET', `/v1/workspaces/${workspace.id}/files`)).value;
    check('FileListing', listing);
    expect(listing.entries.map((f: { path: string }) => f.path)).toContain('brief.md');
    const history = await eventsAfter(a.organizationId, accepted.run_id, '0');
    history.forEach((event, i) => {
      check('Event', event);
      expect(event.sequence).toBe(String(i + 1));
    });
    const response = new Response(
      await streamEvents(a.organizationId, accepted.run_id, '3', new AbortController().signal),
    );
    const stream = await response.text();
    expect(stream).not.toContain('id: 3\n');
    expect(stream).toContain('event: run.succeeded');
    const follow = (
      await request('POST', `/v1/sessions/${accepted.session_id}/messages`, { prompt: 'Continue.' })
    ).value;
    await executeRun(a.organizationId, follow.run_id);
    const continued = (await request('GET', `/v1/runs/${follow.run_id}/result`)).value;
    expect(continued.output_text).toContain('turn 2');
  });
  it('deduplicates producer events under concurrent delivery', async () => {
    const project = (await request('POST', '/v1/projects', { name: 'Event deduplication' })).value;
    const run = (
      await request('POST', '/v1/runs', {
        project_id: project.id,
        harness: 'codex',
        model: 'fixture-model',
        billing_mode: 'managed',
        prompt: 'Test events',
      })
    ).value;
    await Promise.all(
      [1, 2].map(() =>
        transaction(a.organizationId, (tx) =>
          emit(
            tx,
            a.organizationId,
            run.run_id,
            'tool.completed',
            { result: 'once' },
            { id: 'producer', sequence: 1 },
          ),
        ),
      ),
    );
    const events = await eventsAfter(a.organizationId, run.run_id, '0');
    expect(events.filter((e) => e.type === 'tool.completed')).toHaveLength(1);
    await request('POST', `/v1/runs/${run.run_id}/cancel`, {});
  });
  it('rejects file and directory collisions without changing the last restorable checkpoint', async () => {
    const project = (await request('POST', '/v1/projects', { name: 'Valid filesystem tree' })).value;
    const workspaceId = project.default_workspace_id;
    let workspace = (await request('GET', `/v1/workspaces/${workspaceId}`)).value;
    const write = (path: string, revision: string) =>
      request('PUT', `/v1/workspaces/${workspaceId}/file?path=${path}`, 'retained content', keyA, {
        'Content-Type': 'application/octet-stream',
        'If-Match': revision,
      });
    expect((await write('parent', workspace.revision)).response.status).toBe(202);
    workspace = (await request('GET', `/v1/workspaces/${workspaceId}`)).value;
    const collision = await write('parent/child.txt', workspace.revision);
    expect(collision.response.status).toBe(409);
    expect(collision.value.error.code).toBe('file_path_conflict');
    expect((await request('GET', `/v1/workspaces/${workspaceId}`)).value).toMatchObject({
      revision: workspace.revision,
      latest_checkpoint_id: workspace.latest_checkpoint_id,
    });
    expect((await write('folder/child.txt', workspace.revision)).response.status).toBe(202);
    workspace = (await request('GET', `/v1/workspaces/${workspaceId}`)).value;
    expect((await write('folder', workspace.revision)).response.status).toBe(409);
    const restored = await request('POST', `/v1/workspaces/${workspaceId}/restore`, {
      checkpoint_id: workspace.latest_checkpoint_id,
    });
    expect(restored.response.status).toBe(202);
    const files = (await request('GET', `/v1/workspaces/${workspaceId}/files`)).value.entries;
    expect(files.map((file: { path: string }) => file.path)).toEqual(['folder/child.txt', 'parent']);
    for (const file of files) {
      const response = await handleApi(
        new Request(`${config.origin}/v1/workspaces/${workspaceId}/file?path=${file.path}`, {
          headers: { Authorization: `Bearer ${keyA}` },
        }),
      );
      expect(await response.text()).toBe('retained content');
    }
  });
  it('rejects a conflicting upload tree during planning before returning upload capabilities', async () => {
    const project = (await request('POST', '/v1/projects', { name: 'Transfer tree collisions' })).value;
    const workspace = (await request('GET', `/v1/workspaces/${project.default_workspace_id}`)).value;
    const planned = await request('POST', `/v1/workspaces/${workspace.id}/transfers`, {
      direction: 'push',
      base_revision: workspace.revision,
      paths: [],
      manifest: ['file', 'file/child'].map((path) => ({
        path,
        local_sha256: sha256('content'),
        local_size_bytes: 7,
        baseline_known: true,
        baseline_sha256: null,
      })),
    });
    expect(planned.response.status).toBe(409);
    expect(planned.value.error.code).toBe('file_path_conflict');
    expect((await request('GET', `/v1/workspaces/${workspace.id}/transfers`)).value.data).toHaveLength(0);
    expect((await request('GET', `/v1/workspaces/${workspace.id}`)).value.revision).toBe(workspace.revision);
  });
  it('serializes workspace branch creation across concurrent requests', async () => {
    const project = (await request('POST', '/v1/projects', { name: 'Concurrent branch creation' })).value;
    const responses = await Promise.all(
      [1, 2].map(() =>
        request('POST', `/v1/projects/${project.id}/workspaces`, { name: 'Review', branch: 'review' }),
      ),
    );
    expect(responses.map((result) => result.response.status).sort()).toEqual([202, 409]);
    expect(responses.find((result) => result.response.status === 409)?.value.error.code).toBe(
      'branch_exists',
    );
    const workspaces = (await request('GET', `/v1/projects/${project.id}/workspaces`)).value.data;
    expect(workspaces.filter((workspace: { branch: string }) => workspace.branch === 'review')).toHaveLength(
      1,
    );
  });
  it('stops queued runs before execution when deletion cancels them or their project becomes unavailable', async () => {
    let invocations = 0;
    const provider = {
      execute: async () => {
        invocations++;
        throw new Error('A stopped run must never execute');
      },
    };
    for (const action of ['deletion', 'archive']) {
      const project = (await request('POST', '/v1/projects', { name: `Stopped ${action}` })).value;
      const workspace = (await request('GET', `/v1/workspaces/${project.default_workspace_id}`)).value;
      const run = (
        await request('POST', '/v1/runs', {
          project_id: project.id,
          harness: 'codex',
          model: 'fixture-model',
          billing_mode: 'managed',
          prompt: 'This prompt must not execute.',
        })
      ).value;
      const changed =
        action === 'deletion'
          ? await request('POST', `/v1/projects/${project.id}/deletion`, { confirmation: project.name })
          : await request('PATCH', `/v1/projects/${project.id}`, { archived: true });
      expect(changed.response.ok).toBe(true);
      expect(await executeRun(a.organizationId, run.run_id, provider)).toBe(false);
      const state = (await request('GET', `/v1/runs/${run.run_id}`)).value;
      expect(state.status).toBe(action === 'deletion' ? 'cancelled' : 'failed');
      expect(state.failure_code).toBe(action === 'deletion' ? 'cancelled' : 'workspace_unavailable');
      expect(state.started_at).toBeUndefined();
      expect(state.cost_micro_usd).toBe('0');
      expect((await request('GET', `/v1/workspaces/${workspace.id}`)).value.latest_checkpoint_id).toBe(
        workspace.latest_checkpoint_id,
      );
    }
    expect(invocations).toBe(0);
  });
  it('stages verified transfers and preserves changed remote content', async () => {
    const project = (await request('POST', '/v1/projects', { name: 'Transfer safety' })).value;
    const workspace = (await request('GET', `/v1/workspaces/${project.default_workspace_id}`)).value;
    const content = 'A safely staged file';
    const hash = sha256(content);
    const created = await request('POST', `/v1/workspaces/${workspace.id}/transfers`, {
      direction: 'push',
      base_revision: workspace.revision,
      manifest: [
        {
          path: 'safe.md',
          local_sha256: hash,
          local_size_bytes: Buffer.byteLength(content),
          baseline_known: true,
          baseline_sha256: null,
        },
      ],
      paths: [],
    });
    expect(created.response.status).toBe(201);
    check('Transfer', created.value);
    const action = created.value.actions[0];
    const capability = decodeURIComponent(new URL(action.url).pathname.split('/').pop()!);
    expect(
      (await serveObject(new Request(action.url, { method: 'PUT', body: content }), capability)).status,
    ).toBe(204);
    const apply = await request('POST', `/v1/transfers/${created.value.id}/apply`, {
      expected_revision: workspace.revision,
    });
    expect(apply.response.status).toBe(202);
    const ws = (await request('GET', `/v1/workspaces/${workspace.id}`)).value;
    const conflict = await request('POST', `/v1/workspaces/${workspace.id}/transfers`, {
      direction: 'push',
      base_revision: ws.revision,
      manifest: [
        {
          path: 'safe.md',
          local_sha256: sha256('overwrite'),
          local_size_bytes: 9,
          baseline_known: false,
          baseline_sha256: null,
        },
      ],
      paths: [],
    });
    expect(conflict.value.status).toBe('conflicted');
    expect(conflict.value.actions[0].url).toBeUndefined();
    const exportResult = (
      await request('POST', `/v1/checkpoints/${ws.latest_checkpoint_id}/exports`, {
        format: 'portable_archive',
      })
    ).value;
    check('ExportOperation', exportResult);
    const url = exportResult.result.download_url;
    const download = await serveObject(
      new Request(url),
      decodeURIComponent(new URL(url).pathname.split('/').pop()!),
    );
    expect(sha256(Buffer.from(await download.arrayBuffer()))).toBe(exportResult.result.sha256);
  });
  it('serializes budget reservations and maintains balanced immutable journals', async () => {
    await transaction(b.organizationId, (tx) => credit(tx, b.organizationId, 1000000n, 'test-credit'));
    const admitted = await Promise.allSettled(
      [1, 2].map(() => transaction(b.organizationId, (tx) => reserve(tx, b.organizationId, 800000n))),
    );
    expect(admitted.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
    await transaction(b.organizationId, (tx) => settle(tx, b.organizationId, id(), 800000n, 125000n));
    const balance = (
      await pool.query('SELECT balance_micro_usd,reserved_micro_usd FROM organizations WHERE id=$1', [
        b.organizationId,
      ])
    ).rows[0];
    expect(balance).toEqual({ balance_micro_usd: '875000', reserved_micro_usd: '0' });
    const journals = await transaction(b.organizationId, (tx) =>
      tx.query('SELECT journal_id,sum(amount_micro_usd)::text AS balance FROM ledger GROUP BY journal_id'),
    );
    expect(journals.rows.every((r) => r.balance === '0')).toBe(true);
    const failure = await transaction(b.organizationId, (tx) =>
      tx.query('UPDATE ledger SET amount_micro_usd=0'),
    ).catch((e) => e);
    expect(failure.code).toBe('42501'); // SQL privileges reject mutation before the immutable-ledger trigger.
  });
});

it('limits diff content reads to returned paths while retaining truncation and path filtering', async () => {
  const project = (await request('POST', '/v1/projects', { name: 'Bounded diff' })).value;
  const workspaceId = project.default_workspace_id;
  await transaction(a.organizationId, async (tx) => {
    const files: FileRecord[] = [];
    for (const name of ['a.txt', 'b.txt', 'c.txt'])
      files.push({
        ...(await saveContent(a.organizationId, Buffer.from(name))),
        path: name,
        type: 'file',
        mode: 0o644,
        modified_at: new Date().toISOString(),
        git_ignored: false,
      });
    const cp = await checkpoint(tx, a, workspaceId, 'Diff fixture', files);
    await resources.update(tx, 'workspaces', workspaceId, checkpointState(cp));
  });
  const storage = await import('../../packages/providers/src/storage');
  const reads = vi.spyOn(storage, 'readContent');
  try {
    const result = await request('GET', `/v1/workspaces/${workspaceId}/diff?limit=1`);
    expect(result.response.status).toBe(200);
    expect(result.value).toMatchObject({
      truncated: true,
      data: [{ path: 'a.txt', change: 'added', binary: false, patch: expect.stringContaining('+a.txt') }],
    });
    expect(reads).toHaveBeenCalledTimes(1);
    reads.mockClear();
    const filtered = await request('GET', `/v1/workspaces/${workspaceId}/diff?limit=1&path=c.txt`);
    expect(filtered.value).toMatchObject({ truncated: false, data: [{ path: 'c.txt' }] });
    expect(reads).toHaveBeenCalledTimes(1);
  } finally {
    reads.mockRestore();
  }
});
