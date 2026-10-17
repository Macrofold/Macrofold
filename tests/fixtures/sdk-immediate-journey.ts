import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Client, type Schema } from '../../sdk/typescript/dist/index.js';

const client = new Client({
  baseURL: process.env.MACROFOLD_FIXTURE_ORIGIN!,
  apiKey: process.env.MACROFOLD_FIXTURE_KEY!,
});
const body: Schema['InferenceCreate'] = JSON.parse(
  await readFile(process.env.MACROFOLD_FIXTURE_INFERENCE_INPUT!, 'utf8'),
);
function receipt(value: Schema['RunResult']) {
  assert.equal(value.final, true);
  assert.equal(value.persistence_status, 'not_required');
  assert.equal(value.inference?.outcome, 'value');
  assert.equal(value.inference?.usage.input_tokens, '100');
  assert.equal(value.inference?.usage.output_tokens, '10');
  assert.equal(value.inference?.usage.completeness, 'complete');
  assert.equal(value.inference?.billing.billing_mode, 'managed');
  assert.equal(value.inference?.billing.provisional, false);
  assert.match(value.inference!.billing.charged_micro_usd!, /^[0-9]+$/);
  assert(BigInt(value.inference!.billing.charged_micro_usd!) > 0n);
}
const key = crypto.randomUUID();
const response = await client.inferences.create(body, { idempotencyKey: key });
assert.equal(response.status, 'succeeded');
assert(response.result);
receipt(response.result);
assert.equal((await client.inferences.create(body, { idempotencyKey: key })).run_id, response.run_id);
let text = '',
  terminal = false;
for await (const event of client.inferences.stream(body)) {
  if (event.type === 'output.delta') text += event.data.text;
  if (event.type === 'run.succeeded') {
    assert(event.data.result);
    receipt(event.data.result);
    terminal = true;
  }
}
assert.equal(text, 'Hello from the SDK fixture.');
assert(terminal);
console.log('TypeScript immediate JSON/SSE application acceptance passed.');
