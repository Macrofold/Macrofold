import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultScopes } from '../../packages/cli/src/settings';

const deploymentId = '019e1700-0000-7000-8000-000000000001';
const revisionId = '019e1700-0000-7000-8000-000000000002';
const priorRevisionId = '019e1700-0000-7000-8000-000000000003';
const grantId = '019e1700-0000-7000-8000-000000000004';
const apiKeyId = '019e1700-0000-7000-8000-000000000005';
const workspaceId = '019e1700-0000-7000-8000-000000000006';
const policy = { max_concurrent_requests: 2, stop_at: null };
const calls: { method: string; path: string; body: unknown; key: string | undefined }[] = [];
let server: Server, origin: string, directory: string;

async function command(args: string[], stdin?: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve('packages/cli/dist/index.mjs'), ...args, '--json'], {
      cwd: directory,
      env: {
        ...process.env,
        AGENT_HOST: origin,
        AGENT_API_KEY: 'sk_cli_model_deployment_fixture',
        AGENT_CONFIG_DIR: path.join(directory, 'config'),
        NO_COLOR: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (value) => {
      stdout += value;
    });
    child.stderr.on('data', (value) => {
      stderr += value;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(stdin);
  });
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'macrofold-deployment-cli-'));
  server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const url = new URL(request.url ?? '/', 'http://fixture.local');
    const call = {
      method: request.method ?? 'GET',
      path: url.pathname + url.search,
      body: body ? (JSON.parse(body) as unknown) : undefined,
      key:
        typeof request.headers['idempotency-key'] === 'string'
          ? request.headers['idempotency-key']
          : undefined,
    };
    calls.push(call);
    response.setHeader('Content-Type', 'application/json');
    if (url.pathname === `/v1/model-deployments/${deploymentId}` && request.method === 'GET') {
      response.end(JSON.stringify({ deployment_id: deploymentId, desired_revision_id: revisionId, policy }));
    } else if (url.pathname.endsWith('/service')) {
      response.statusCode = 202;
      response.end(
        JSON.stringify({ deployment_id: deploymentId, state: 'starting', desired_state: 'running' }),
      );
    } else if (url.pathname.endsWith('/inspect')) {
      response.end(JSON.stringify({ supported: true, findings: [], hosting_options: [] }));
    } else if (request.method === 'GET') {
      response.end(JSON.stringify({ data: [], next_cursor: null }));
    } else {
      response.statusCode = request.method === 'POST' ? 201 : 200;
      response.end(JSON.stringify({ deployment_id: deploymentId, grant_id: grantId }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not bind.');
  origin = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
  calls.length = 0;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await rm(directory, { recursive: true, force: true });
});

describe('built model deployment CLI public transport', () => {
  it('includes deployment read and use in normal consent while management remains explicit', () => {
    expect(defaultScopes).toContain('model-deployments:read');
    expect(defaultScopes).toContain('model-deployments:use');
    expect(defaultScopes).not.toContain('model-deployments:write');
    expect(defaultScopes).not.toContain('connections:write');
  });

  it('rotates a connection through protected input and preserves the explicit mutation identity', async () => {
    const input = { secret: 'synthetic-replacement-token' };
    const result = await command(
      ['connection', 'update', apiKeyId, '--config-file', '-', '--idempotency-key', 'rotate-same-account'],
      JSON.stringify(input),
    );
    expect(result.code, result.stderr || result.stdout).toBe(0);
    expect(calls).toEqual([
      { method: 'PATCH', path: `/v1/connections/${apiKeyId}`, body: input, key: 'rotate-same-account' },
    ]);
    expect(result.stdout).not.toContain(input.secret);
  });

  it('inspects a repository without creating infrastructure and emits one JSON result', async () => {
    const result = await command(['model-deployment', 'inspect', 'Qwen/Qwen3-0.6B', '--revision', 'main']);
    expect(result.code, result.stderr || result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: 'model-deployment inspect',
      ok: true,
      data: { supported: true },
    });
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/v1/model-deployments/inspect',
        body: {
          source: { kind: 'hugging_face', repository: 'Qwen/Qwen3-0.6B', revision: 'main' },
          task: 'text_generation',
        },
        key: expect.any(String),
      },
    ]);
  });

  it('preserves full create JSON, empty application grants and an explicit recovery key', async () => {
    const input = {
      name: 'CLI fixture',
      source: { kind: 'external', capabilities: { streaming: false } },
      runtime: { kind: 'external' },
      hosting: {
        kind: 'external_openai',
        endpoint_connection_id: apiKeyId,
        model_alias: 'fixture',
        lifecycle: 'external',
      },
      access: { grants: [] },
    };
    const result = await command(
      ['model-deployment', 'create', '--config-file', '-', '--idempotency-key', 'cli-create-recovery'],
      JSON.stringify(input),
    );
    expect(result.code, result.stderr || result.stdout).toBe(0);
    expect(calls).toEqual([
      { method: 'POST', path: '/v1/model-deployments', body: input, key: 'cli-create-recovery' },
    ]);
  });

  it('stops with the stored explicit revision and policy, without source or catalog requests', async () => {
    const result = await command(['model-deployment', 'stop', deploymentId]);
    expect(result.code, result.stderr || result.stdout).toBe(0);
    expect(calls.map((call) => [call.method, call.path])).toEqual([
      ['GET', `/v1/model-deployments/${deploymentId}`],
      ['PUT', `/v1/model-deployments/${deploymentId}/service`],
    ]);
    expect(calls[1].body).toEqual({ deployment_revision_id: revisionId, desired_state: 'stopped', policy });
    expect(JSON.parse(result.stdout).data.state).toBe('starting'); // Accepted transport state is preserved, never optimistic stopped.
  });

  it('rolls back deliberately to a prior immutable revision with a replacement policy', async () => {
    const updated = { max_concurrent_requests: 1, stop_at: '2026-12-01T00:00:00Z' };
    const file = path.join(directory, 'policy.json');
    await writeFile(file, JSON.stringify(updated), { mode: 0o600 });
    const result = await command([
      'model-deployment',
      'rollback',
      deploymentId,
      '--revision',
      priorRevisionId,
      '--policy-file',
      file,
    ]);
    expect(result.code, result.stderr || result.stdout).toBe(0);
    expect(calls[1].body).toEqual({
      deployment_revision_id: priorRevisionId,
      desired_state: 'running',
      policy: updated,
    });
    expect(calls).toHaveLength(2);
  });

  it('grants selected workspace use and revokes by the server grant identity', async () => {
    const grant = {
      subject: { kind: 'api_key', api_key_id: apiKeyId },
      workspace_scope: { kind: 'selected', workspace_ids: [workspaceId] },
    };
    const created = await command(
      ['model-deployment', 'grant', deploymentId, '--config-file', '-'],
      JSON.stringify(grant),
    );
    expect(created.code, created.stderr || created.stdout).toBe(0);
    const revoked = await command(['model-deployment', 'revoke', deploymentId, '--grant', grantId]);
    expect(revoked.code, revoked.stderr || revoked.stdout).toBe(0);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: `/v1/model-deployments/${deploymentId}/grants`,
      body: grant,
    });
    expect(calls[1]).toMatchObject({
      method: 'DELETE',
      path: `/v1/model-deployments/${deploymentId}/grants/${grantId}`,
    });
  });

  it('rejects unprotected files, non-object JSON and invalid rollout IDs before sending a mutation', async () => {
    const file = path.join(directory, 'unsafe.json');
    await writeFile(file, '{}', { mode: 0o644 });
    const unsafe = await command(['model-deployment', 'create', '--config-file', file]);
    expect(unsafe.code).toBe(2);
    expect(unsafe.stdout).toContain('chmod 600');
    const array = await command(['model-deployment', 'create', '--config-file', '-'], '[]');
    expect(array.code).toBe(2);
    const invalid = await command(['model-deployment', 'rollback', deploymentId, '--revision', 'moving-tag']);
    expect(invalid.code).toBe(2);
    expect(calls).toEqual([]);
  });
});
