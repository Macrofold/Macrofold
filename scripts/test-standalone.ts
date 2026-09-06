import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const origin = process.argv[2] || 'http://localhost:3321';
assert(
  ['localhost', '127.0.0.1'].includes(new URL(origin).hostname),
  'Standalone acceptance targets localhost only',
);
const demo = JSON.parse(await readFile('.data/demo.json', 'utf8'));
const call = async (method: string, url: string, body?: unknown) => {
  const response = await fetch(origin + url, {
    method,
    headers: {
      Authorization: `Bearer ${demo.api_key}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert(response.ok, `${method} ${url} returned ${response.status}`);
  return response;
};
assert((await (await fetch(origin + '/health')).json()).mode === 'local_simulation');
const html = await (await fetch(origin + '/')).text();
assert(html.includes('Good work deserves'));
const asset = html.match(/src="([^\"]*\/_next\/static\/[^\"]*\.js[^\"]*)"/);
assert(asset);
assert((await fetch(origin + asset[1].replaceAll('&amp;', '&'))).ok);
const contract = await (await fetch(origin + '/openapi.json')).json();
assert(contract.paths['/v1/runs']);
const project = await (
  await call('POST', '/v1/projects', { name: 'Standalone acceptance ' + Date.now() })
).json();
assert(project.default_workspace_id);
const ws = await (await call('GET', `/v1/workspaces/${project.default_workspace_id}`)).json();
const written = await fetch(origin + `/v1/workspaces/${ws.id}/file?path=standalone.txt`, {
  method: 'PUT',
  headers: {
    Authorization: `Bearer ${demo.api_key}`,
    'Content-Type': 'application/octet-stream',
    'Idempotency-Key': crypto.randomUUID(),
    'If-Match': ws.revision,
  },
  body: 'Standalone control-plane persistence verified.',
});
assert(written.ok, `File write returned ${written.status}`);
assert.equal(
  await (await call('GET', `/v1/workspaces/${ws.id}/file?path=standalone.txt`)).text(),
  'Standalone control-plane persistence verified.',
);
const runs = await (await call('GET', '/v1/runs?status=succeeded')).json();
assert(runs.data.length);
const stream = await call('GET', `/v1/runs/${runs.data[0].id}/stream`);
assert((await stream.text()).includes('run.succeeded'));
if (process.argv.includes('--execute')) {
  const accepted = await (
    await call('POST', '/v1/runs', {
      workspace_id: ws.id,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Verify remote worker persistence without a model call.',
    })
  ).json();
  const progress = await call('GET', `/v1/runs/${accepted.run_id}/stream`);
  assert((await progress.text()).includes('run.succeeded'));
  const result = await (await call('GET', `/v1/runs/${accepted.run_id}/result`)).json();
  assert(result.output_text.includes('Simulation completed'));
  console.log('Independent worker completed and persisted an API-submitted simulator run.');
}
console.log(
  'Standalone server health, public page/static asset, OpenAPI, scoped API, checkpointed file write/read and SSE replay passed. No paid provider was called.',
);
