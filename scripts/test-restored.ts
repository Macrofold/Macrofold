import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config, isLocal } from '../packages/core/src/config';
import { handleApi } from '../packages/core/src/http';
import { executeRun } from '../packages/core/src/engine';
import { pool, authPool, transaction } from '../packages/db';
import { workspaceFiles } from '../packages/core/src/files';
import { readContent } from '../packages/providers/src/storage';
if (
  !isLocal() ||
  !new URL(config.databaseUrl).pathname.startsWith('/platform_install_') ||
  !new URL(config.databaseUrl).pathname.endsWith('_restored')
)
  throw new Error('Restore validation must target its disposable database.');
const demo = JSON.parse(await readFile(path.join(config.dataDir, 'demo.json'), 'utf8'));
const call = async (method: string, url: string, body?: unknown) => {
  const response = await handleApi(
    new Request(config.origin + url, {
      method,
      headers: {
        Authorization: `Bearer ${demo.api_key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  assert(response.ok, 'Restored public API rejected an operation');
  return response.json();
};
try {
  const projects = await call('GET', '/v1/projects');
  assert(projects.data.length >= 2);
  const runs = await call('GET', '/v1/runs');
  assert(runs.data.length >= 2);
  const run = runs.data.find((r: any) => r.status === 'succeeded');
  assert(run);
  const original = await call('GET', `/v1/runs/${run.id}/result`);
  assert(original.output_text.includes('Simulation completed'));
  const files = await transaction(demo.organization_id, (tx) => workspaceFiles(tx, run.workspace_id));
  for (const file of files.files) await readContent(file.key, file.sha256);
  const accepted = await call('POST', '/v1/runs', {
    session_id: run.session_id,
    prompt: 'Continue after a database and object-store backup restore.',
  });
  await executeRun(demo.organization_id, accepted.run_id);
  const result = await call('GET', `/v1/runs/${accepted.run_id}/result`);
  assert(result.output_text.includes('turn 2'));
  const events = await handleApi(
    new Request(config.origin + `/v1/runs/${accepted.run_id}/stream`, {
      headers: { Authorization: `Bearer ${demo.api_key}` },
    }),
  );
  assert(events.ok);
  assert((await events.text()).includes('run.succeeded'));
  console.log(
    'Restored database, retained vault key, independent encrypted object copy, scoped API access, file hashes, session continuation and SSE replay passed.',
  );
} finally {
  await pool.end();
  await authPool.end();
}
