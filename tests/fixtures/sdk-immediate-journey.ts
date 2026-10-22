import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ApiError, Client, type Schema } from '../../sdk/typescript/dist/index.js';

const client = new Client({
  baseURL: process.env.MACROFOLD_FIXTURE_ORIGIN!,
  apiKey: process.env.MACROFOLD_FIXTURE_KEY!,
});
const body: Schema['InferenceCreate'] = JSON.parse(
  await readFile(process.env.MACROFOLD_FIXTURE_INFERENCE_INPUT!, 'utf8'),
);
const deploymentId = process.env.MACROFOLD_FIXTURE_DEPLOYMENT!;
const deployment = await client.modelDeployments.get(deploymentId);
assert.equal(deployment.state, 'stopped');
assert.equal(deployment.serving_revision_id, null);
assert.equal(deployment.infrastructure_cost.estimated_micro_usd, null);
assert.equal(deployment.cost_policy.request_charge_micro_usd, '0');
const selected = await client.modelDeployments.getRevision(
  deploymentId,
  process.env.MACROFOLD_FIXTURE_DEPLOYMENT_REVISION!,
);
assert.equal(selected.source.kind, 'external');
assert.equal(selected.hosting.kind, 'external_openai');
assert.equal((await client.modelDeployments.listGrants(deploymentId)).data.length, 1);
const deploymentBody: Schema['InferenceCreate'] = JSON.parse(
  await readFile(process.env.MACROFOLD_FIXTURE_DEPLOYMENT_INFERENCE_INPUT!, 'utf8'),
);
await assert.rejects(
  client.inferences.create(deploymentBody),
  (error: unknown) =>
    error instanceof ApiError && error.status === 409 && error.code === 'deployment_not_ready',
);
const readyId = process.env.MACROFOLD_FIXTURE_READY_DEPLOYMENT_TYPESCRIPT!;
const readyRevision = process.env.MACROFOLD_FIXTURE_READY_DEPLOYMENT_REVISION_TYPESCRIPT!;
const readyBody: Schema['InferenceCreate'] = JSON.parse(
  await readFile(process.env.MACROFOLD_FIXTURE_READY_DEPLOYMENT_INPUT_TYPESCRIPT!, 'utf8'),
);
function deploymentReceipt(value: Schema['RunResult'], nativeExtra: boolean) {
  assert(value.inference);
  assert.equal(value.final, true);
  assert.equal(value.inference.outcome, 'value');
  assert.deepEqual(value.inference.deployment, {
    deployment_id: readyId,
    deployment_revision_id: readyRevision,
  });
  assert.deepEqual(value.inference.cost_attribution, {
    basis: 'deployment',
    deployment_id: readyId,
    infrastructure_cost_included: false,
  });
  assert.equal(value.inference.billing.billing_mode, 'byok');
  for (const field of ['charged_micro_usd', 'budget_cost_micro_usd', 'reported_micro_usd'] as const)
    assert.equal(value.inference.billing[field], '0');
  for (const field of [
    'provider_cost_micro_usd',
    'provider_reported_cost_usd',
    'upstream_inference_cost_usd',
  ] as const)
    assert.equal(value.inference.billing[field], null);
  assert.equal(value.inference.usage.input_tokens, '11');
  assert.equal(value.inference.usage.output_tokens, '4');
  const native = value.inference.value;
  assert(native && typeof native === 'object' && 'choices' in native);
  assert.deepEqual(native.choices, [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: 'Hello from the deployment SDK fixture.',
        ...(nativeExtra ? { annotations: [] } : {}),
      },
      finish_reason: 'stop',
    },
  ]);
  if (nativeExtra)
    assert(
      'provider_native_extra' in native &&
        native.provider_native_extra &&
        typeof native.provider_native_extra === 'object' &&
        'retained' in native.provider_native_extra &&
        native.provider_native_extra.retained === true,
    );
}
const readyKey = crypto.randomUUID();
const readyResult = await client.inferences.create(readyBody, { idempotencyKey: readyKey });
const finalizedDeployment =
  readyResult.status === 'running' ? await client.runs.wait(readyResult.run_id) : readyResult.result;
assert(finalizedDeployment);
deploymentReceipt(finalizedDeployment, true);
let deploymentText = '',
  deploymentTerminal = false;
for await (const event of client.inferences.stream(readyBody)) {
  if (event.type === 'output.delta') deploymentText += event.data.text;
  if (event.type === 'run.succeeded') {
    assert(event.data.result);
    deploymentReceipt(event.data.result, false);
    deploymentTerminal = true;
  }
}
assert.equal(deploymentText, 'Hello from the deployment SDK fixture.');
assert(deploymentTerminal);
await client.modelDeployments.setService(readyId, {
  deployment_revision_id: readyRevision,
  desired_state: 'stopped',
  policy: { max_concurrent_requests: 2, stop_at: null },
});
const recovered = await client.inferences.create(readyBody, { idempotencyKey: readyKey });
assert.equal(recovered.run_id, readyResult.run_id);
assert(recovered.result);
deploymentReceipt(recovered.result, true);
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
