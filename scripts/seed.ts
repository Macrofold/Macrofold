import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auth, customerScopes } from '../packages/core/src/auth';
import { pool, authPool, transaction } from '../packages/db';
import { config, isLocal } from '../packages/core/src/config';
import { handleApi } from '../packages/core/src/http';
import { createKey } from '../packages/core/src/keys';
import { credit } from '../packages/core/src/ledger';
import { executeRun } from '../packages/core/src/engine';
import { id } from '../packages/core/src/crypto';
if (!isLocal()) throw new Error('Demo seeding is only permitted in local mode.');
const email = 'demo@example.test',
  password = 'local-only-demo-2026';
let user = (await pool.query('SELECT * FROM auth."user" WHERE email=$1', [email])).rows[0];
if (!user) {
  await auth.api.signUpEmail({ body: { email, password, name: 'Alex Morgan' } });
  user = (await pool.query('SELECT * FROM auth."user" WHERE email=$1', [email])).rows[0];
}
await pool.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1', [user.id]);
const org = (await pool.query('SELECT organization_id FROM memberships WHERE user_id=$1', [user.id])).rows[0]
  .organization_id;
const p = {
  id: user.id,
  userId: user.id,
  email,
  organizationId: org,
  role: 'owner',
  kind: 'user' as const,
  scopes: customerScopes,
  projectIds: [],
  operator: false,
};
const key = await transaction(org, async (tx) => {
  await credit(tx, org, 25000000n, 'local-demo-credit');
  return createKey(tx, p, { name: 'Local development', scopes: customerScopes });
});
async function call(method: string, route: string, body?: unknown, extra: Record<string, string> = {}) {
  const response = await handleApi(
    new Request(`${config.origin}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${key.secret}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': id(),
        ...extra,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
  const value = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(value));
  return value;
}
const existing = await call('GET', '/v1/projects');
if (!existing.data.length) {
  for (const [name, description] of [
    ['Product workspace', 'A persistent home for product research, planning, and implementation.'],
    ['Research lab', 'A workspace for reading, gathering evidence, and turning questions into answers.'],
  ]) {
    const project = await call('POST', '/v1/projects', { name, persistence: 'persistent' });
    const workspaces = await call('GET', `/v1/projects/${project.id}/workspaces`);
    let ws = workspaces.data[0];
    await call(
      'PUT',
      `/v1/workspaces/${ws.id}/file?path=README.md`,
      `# ${name}\n\n${description}\n\n## Getting started\n\nFiles in this workspace persist between runs. Create a new workspace to explore an independent branch.\n`,
      { 'Content-Type': 'application/octet-stream', 'If-Match': ws.revision },
    );
    ws = await call('GET', `/v1/workspaces/${ws.id}`);
    await call(
      'PUT',
      `/v1/workspaces/${ws.id}/file?path=notes%2Fbrief.md`,
      '# Project brief\n\n- Keep changes small and reviewable.\n- Save useful findings in this workspace.\n- Explain assumptions and link to evidence.\n',
      { 'Content-Type': 'application/octet-stream', 'If-Match': ws.revision },
    );
    const accepted = await call('POST', '/v1/runs', {
      workspace_id: ws.id,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: `Review the files in ${name} and save a concise progress note.`,
    });
    await executeRun(org, accepted.run_id);
  }
  await call('POST', '/v1/agents', {
    name: 'Engineering partner',
    harness: 'codex',
    model: 'fixture-model',
    billing_mode: 'managed',
    instructions: 'Make clear, maintainable changes. Read existing files first and explain the result.',
    limits: { timeout_seconds: 900, max_cost_micro_usd: '2000000' },
  });
}
await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
await writeFile(
  path.join(config.dataDir, 'demo.json'),
  JSON.stringify({ email, password, organization_id: org, api_key: key.secret }, null, 2),
  { mode: 0o600 },
);
console.log(
  `Local demo ready: ${email} / ${password}. Credentials are local fixtures; no paid APIs were called.`,
);
await pool.end();
await authPool.end();
