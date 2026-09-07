import assert from 'node:assert/strict';
import { config, isLocal } from '../../packages/core/src/config';
import { pool, authPool, transaction } from '../../packages/db';
import { fixtureAccount } from '../../tests/fixtures/account';
import * as resources from '../../packages/core/src/resources';
import { createWorkspace } from '../../packages/core/src/files';
import { admitRun } from '../../packages/core/src/runs';
import { credit, reserve } from '../../packages/core/src/ledger';
import { handleModelRequest } from '../../packages/core/src/model-gateway';
import { runtimeToken } from '../../packages/core/src/runtime-auth';
import { saveConnection } from '../../packages/core/src/connections';
import { charge, check } from './guard';

assert(process.env.LIVE_FIXTURE_CHILD === '1' && isLocal());
assert(/^\/platform_test_[a-f0-9]+$/.test(new URL(config.databaseUrl).pathname));
const original = { ...config };
const byok = process.env.LIVE_BILLING_MODE === 'byok';
const credentials = Object.fromEntries(
  ['openai', 'anthropic', 'openrouter'].map((provider) => [
    provider,
    process.env[provider.toUpperCase() + '_API_KEY'],
  ]),
);
const rates = {
  openai: { id: 'gpt-4.1-nano', input: '100000', output: '400000' },
  anthropic: { id: 'claude-haiku-4-5-20251001', input: '1000000', output: '5000000' },
  openrouter: { id: 'openai/gpt-4.1-nano', input: '100000', output: '400000' },
};
const schema = {
  type: 'object',
  properties: { value: { type: 'string', enum: ['ok'] } },
  required: ['value'],
  additionalProperties: false,
};
const functionTool = {
  name: 'probe',
  description: 'Return the test value.',
  parameters: schema,
  strict: true,
};
const nativeFetch = globalThis.fetch;
let selected: keyof typeof rates;
let operation: string;
let upstreamError: string | undefined;
let calls = 0;

// This transport guard applies to actual gateway requests, not a response mock.
// Fixed cheap models, tiny inputs, no hosted tools and a pre-send ceiling bound retries.
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  const hosts = { openai: 'api.openai.com', anthropic: 'api.anthropic.com', openrouter: 'openrouter.ai' };
  assert.equal(url.hostname, hosts[selected]);
  assert.equal(init?.method, 'POST');
  const headers = new Headers(init?.headers);
  if (
    headers.get(selected === 'anthropic' ? 'x-api-key' : 'authorization') !==
    (selected === 'anthropic' ? credentials[selected] : `Bearer ${credentials[selected]}`)
  )
    throw new Error('Gateway did not use the expected credential');
  const body = JSON.parse(String(init?.body));
  assert.equal(body.model, rates[selected].id);
  assert(Buffer.byteLength(String(init?.body)) <= 6000);
  assert((body.max_output_tokens ?? body.max_completion_tokens ?? body.max_tokens ?? 0) <= 128);
  assert(!body.plugins && !body.thinking && !body.reasoning && !body.background);
  assert(
    (body.tools || []).every(
      (tool: { type?: string; name?: string; function?: { name?: string } }) =>
        tool.name === 'probe' || (tool.type === 'function' && tool.function?.name === 'probe'),
    ),
  );
  charge(selected, operation, url.pathname.endsWith('/count_tokens') ? 0 : 20_000);
  calls++;
  const response = await nativeFetch(input, {
    ...init,
    signal: AbortSignal.any([init?.signal || AbortSignal.timeout(45_000), AbortSignal.timeout(45_000)]),
  });
  if (!response.ok) {
    const body = await response
      .clone()
      .json()
      .catch(() => ({}));
    upstreamError = `${response.status}: ${body?.error?.message || 'Provider rejected request'}`;
  }
  return response;
};

try {
  const { p } = await fixtureAccount('Live gateway acceptance');
  await transaction(p.organizationId, (tx) =>
    credit(tx, p.organizationId, 100_000_000n, 'live-fixture-credit'),
  );
  for (const provider of Object.keys(rates) as (keyof typeof rates)[]) {
    if (process.env.LIVE_PLATFORMS && !process.env.LIVE_PLATFORMS.split(',').includes(provider)) continue;
    selected = provider;
    await check(provider, byok ? 'gateway-byok' : 'gateway', async () => {
      Object.assign(config, original);
      config.vaultKey = 'live-fixture-vault-secret-at-least-32-characters';
      const rate = rates[provider];
      let connectionId: string | undefined;
      const runId = await transaction(p.organizationId, async (tx) => {
        const project = await resources.create(tx, 'projects', p.organizationId, { name: 'Live fixture' });
        const workspace = (await createWorkspace(tx, p, project.id, { name: 'main', branch: 'main' }))
          .result as { workspace_id: string };
        const run = await admitRun(tx, p, {
          workspace_id: workspace.workspace_id,
          harness: 'codex',
          model: 'fixture-model',
          billing_mode: 'managed',
          prompt: 'Synthetic acceptance',
          limits: { max_cost_micro_usd: '2000000', timeout_seconds: 900 },
        });
        await reserve(tx, p.organizationId, 2_000_000n);
        if (byok) {
          const connection = await saveConnection(tx, p, {
            name: 'Live BYOK fixture',
            kind: 'model',
            provider,
            auth_method: 'api_key',
            secret: credentials[provider]!,
          });
          connectionId = connection.id;
          // No platform fallback is usable during the BYOK request.
          process.env[provider.toUpperCase() + '_API_KEY'] = '';
        }
        await tx.query(
          "UPDATE runs SET config=config||$2::jsonb,status='running',deadline=now()+interval '15 minutes',lease_generation=1,reservation_micro_usd=2000000 WHERE id=$1",
          [
            run.run_id,
            JSON.stringify({
              model: rate.id,
              ...(byok ? { billing_mode: 'byok', provider_connection_id: connectionId } : {}),
              rate_card: {
                id: rate.id,
                name: 'Live fixture',
                provider,
                harnesses: ['codex'],
                input_micro_usd_per_million: rate.input,
                output_micro_usd_per_million: rate.output,
                enabled: true,
              },
            }),
          ],
        );
        return run.run_id;
      });
      config.mode = 'production';
      config.origin = 'https://fixture.invalid';
      config.allowPaid = true;
      config.secret = 'live-fixture-auth-secret-at-least-32-characters';
      config.vaultKey = 'live-fixture-vault-secret-at-least-32-characters';
      process.env.AUTH_SECRET = config.secret;
      process.env.VAULT_KEY = config.vaultKey;
      const token = runtimeToken({
        organization: p.organizationId,
        run: runId,
        lease: '1',
        expires: Date.now() + 300_000,
      });
      const shapes: Record<string, unknown>[] = [];
      const beforeCalls = calls;
      const call = async (name: string, endpoint: string, body: Record<string, unknown>) => {
        operation = name;
        upstreamError = undefined;
        const response = await handleModelRequest(
          new Request(`https://fixture.invalid/runtime/runs/${runId}/model/${endpoint}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: rate.id, ...body }),
          }),
          runId,
          endpoint,
        );
        assert.equal(response.status, 200, upstreamError || 'Gateway rejected request');
        const text = await response.text();
        const stream = response.headers.get('content-type')?.includes('text/event-stream');
        const data = stream
          ? text
              .split('\n')
              .filter((line) => line.startsWith('data:') && line.slice(5).trim() !== '[DONE]')
              .map((line) => JSON.parse(line.slice(5)))
          : JSON.parse(text);
        shapes.push({
          operation: name,
          stream: Boolean(stream),
          eventTypes: stream
            ? [
                ...new Set(
                  data.map((event: { type?: string; object?: string }) => event.type || event.object),
                ),
              ]
            : undefined,
          keys: stream ? undefined : Object.keys(data),
        });
        return data;
      };
      if (byok) {
        const endpoint =
          provider === 'openai'
            ? 'v1/responses'
            : provider === 'anthropic'
              ? 'v1/messages'
              : 'v1/chat/completions';
        const body =
          provider === 'openai'
            ? { input: 'Reply exactly OK.', max_output_tokens: 16 }
            : { messages: [{ role: 'user', content: 'Reply exactly OK.' }], max_tokens: 16 };
        const result = await call('byok-text', endpoint, body);
        assert(
          provider === 'openai'
            ? result.output.some((item: { type: string }) => item.type === 'message')
            : provider === 'anthropic'
              ? result.content.some((item: { type: string }) => item.type === 'text')
              : result.choices[0].message.content,
        );
        await transaction(p.organizationId, (tx) =>
          resources.update(tx, 'connections', connectionId!, { status: 'error' }),
        );
        const callsBeforeRevocation = calls;
        const rejected = await handleModelRequest(
          new Request(`https://fixture.invalid/runtime/runs/${runId}/model/${endpoint}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: rate.id, ...body }),
          }),
          runId,
          endpoint,
        );
        assert.equal(rejected.status, 403);
        assert.equal(calls, callsBeforeRevocation);
      } else if (provider === 'openai') {
        const events = await call('responses-stream-tool', 'v1/responses', {
          input: 'Call probe with value ok.',
          tools: [{ type: 'function', ...functionTool }],
          tool_choice: { type: 'function', name: 'probe' },
          max_output_tokens: 128,
          stream: true,
        });
        const response = events.find((e: { type: string }) => e.type === 'response.completed')?.response;
        const tool = response?.output.find((item: { type: string }) => item.type === 'function_call');
        assert.equal(tool?.name, 'probe');
        assert.equal(JSON.parse(tool.arguments).value, 'ok');
        const followup = await call('responses-tool-result', 'v1/responses', {
          input: [
            { role: 'user', content: 'Call probe with value ok, then reply with the result.' },
            tool,
            { type: 'function_call_output', call_id: tool.call_id, output: '{"value":"ok"}' },
          ],
          max_output_tokens: 64,
        });
        assert(followup.output.some((item: { type: string }) => item.type === 'message'));
        const chat = await call('chat-json', 'v1/chat/completions', {
          messages: [{ role: 'user', content: 'Return JSON with value ok.' }],
          max_tokens: 64,
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'probe_result', strict: true, schema },
          },
        });
        assert.equal(JSON.parse(chat.choices[0].message.content).value, 'ok');
      } else if (provider === 'anthropic') {
        const tools = [{ name: 'probe', description: functionTool.description, input_schema: schema }];
        const messages = [{ role: 'user', content: 'Call probe with value ok, then reply with the result.' }];
        const counted = await call('count-tokens', 'v1/messages/count_tokens', { messages, tools });
        assert(counted.input_tokens > 0);
        const events = await call('messages-stream-tool', 'v1/messages', {
          messages,
          tools,
          tool_choice: { type: 'tool', name: 'probe' },
          max_tokens: 128,
          stream: true,
        });
        assert(events.some((e: { type: string }) => e.type === 'message_stop'));
        const tool = events.find(
          (e: { content_block?: { type?: string } }) => e.content_block?.type === 'tool_use',
        )?.content_block;
        const args = events
          .filter((e: { delta?: { type?: string } }) => e.delta?.type === 'input_json_delta')
          .map((e: { delta: { partial_json: string } }) => e.delta.partial_json)
          .join('');
        assert.equal(tool?.name, 'probe');
        assert.equal(JSON.parse(args).value, 'ok');
        const result = await call('messages-tool-result', 'v1/messages', {
          messages: [
            ...messages,
            { role: 'assistant', content: [{ ...tool, input: JSON.parse(args) }] },
            {
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: tool.id, content: '{"value":"ok"}' }],
            },
          ],
          tools,
          max_tokens: 64,
        });
        assert(result.content.some((item: { type: string }) => item.type === 'text'));
      } else {
        const events = await call('chat-stream-tool', 'v1/chat/completions', {
          messages: [{ role: 'user', content: 'Call probe with value ok, then reply with the result.' }],
          tools: [{ type: 'function', function: functionTool }],
          tool_choice: { type: 'function', function: { name: 'probe' } },
          max_tokens: 128,
          stream: true,
        });
        const deltas = events.flatMap(
          (e: { choices?: { delta?: { tool_calls?: unknown[] } }[] }) =>
            e.choices?.flatMap((c) => c.delta?.tool_calls || []) || [],
        ) as { id?: string; function?: { name?: string; arguments?: string } }[];
        const tool = {
          id: deltas.find((d) => d.id)?.id,
          type: 'function',
          function: {
            name: deltas.find((d) => d.function?.name)?.function?.name,
            arguments: deltas.map((d) => d.function?.arguments || '').join(''),
          },
        };
        assert.equal(tool.function.name, 'probe');
        assert.equal(JSON.parse(tool.function.arguments).value, 'ok');
        const result = await call('chat-tool-result-json', 'v1/chat/completions', {
          messages: [
            { role: 'user', content: 'Call probe with value ok, then return JSON with value ok.' },
            { role: 'assistant', content: null, tool_calls: [tool] },
            { role: 'tool', tool_call_id: tool.id, content: '{"value":"ok"}' },
          ],
          max_tokens: 64,
          response_format: { type: 'json_object' },
        });
        assert.equal(JSON.parse(result.choices[0].message.content).value, 'ok');
      }
      const saved = await transaction(p.organizationId, async (tx) => ({
        usage: (
          await tx.query(
            'SELECT provider,input_tokens,output_tokens,cost_micro_usd,completeness FROM model_usage WHERE run_id=$1 ORDER BY created_at',
            [runId],
          )
        ).rows,
        budget: (
          await tx.query(
            'SELECT model_reserved_micro_usd,budget_used_micro_usd,reservation_micro_usd,cost_micro_usd FROM runs WHERE id=$1',
            [runId],
          )
        ).rows[0],
        requests: (await tx.query('SELECT status FROM gateway_requests WHERE run_id=$1', [runId])).rows,
      }));
      assert.equal(saved.budget.model_reserved_micro_usd, '0');
      assert.equal(saved.budget.reservation_micro_usd, '2000000');
      if (byok) assert.equal(saved.budget.cost_micro_usd, '0');
      assert(saved.requests.every((r) => r.status === 'complete'));
      assert(saved.usage.every((u) => u.completeness === 'complete'));
      assert.equal(
        saved.usage.reduce((n, u) => n + BigInt(u.cost_micro_usd), 0n).toString(),
        saved.budget.budget_used_micro_usd,
      );
      // Anthropic's count_tokens is unmetered and deliberately creates no usage row.
      assert.equal(saved.usage.length, calls - beforeCalls - (!byok && provider === 'anthropic' ? 1 : 0));
      return {
        model: rate.id,
        billingMode: byok ? 'byok' : 'managed',
        calls: calls - beforeCalls,
        shapes,
        ...(byok ? { localRevocationRejectedWithoutFallback: true } : {}),
        ...saved,
      };
    });
  }
} finally {
  globalThis.fetch = nativeFetch;
  Object.assign(config, original);
  await pool.end();
  await authPool.end();
}
