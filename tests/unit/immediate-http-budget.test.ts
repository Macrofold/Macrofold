import { afterEach, expect, it, vi } from 'vitest';
import * as database from '../../packages/db';
import * as auth from '../../packages/core/src/auth';
import { config } from '../../packages/core/src/config';
import { id } from '../../packages/core/src/crypto';
import { handleApi } from '../../packages/core/src/http';
import { preparations } from '../../packages/core/src/api-handlers';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function request(identity: string) {
  return new Request(`${config.origin}/v1/inferences`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': identity },
    body: JSON.stringify({
      model_binding: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', billing_mode: 'managed' },
      input: { messages: [{ role: 'user', content: 'Synthetic HTTP budget fixture' }] },
      limits: { max_cost_micro_usd: '50000', max_output_tokens: 32, timeout_seconds: 20 },
    }),
  });
}
const unavailable = [
  new database.DatabaseBudgetError('statement'),
  new database.TransactionRolledBackError(),
  new database.TransactionCommitUnknownError(new Error('Synthetic metadata commit acknowledgment loss')),
];

it.each(unavailable)(
  'keeps pre-admission %s safe to retry even without a cleanup acknowledgment',
  async (error) => {
    const identify = vi.spyOn(auth, 'identify').mockRejectedValue(error);
    const sql = vi.spyOn(database.pool, 'query').mockRejectedValue(new Error('Unexpected SQL'));
    vi.spyOn(database, 'transaction').mockRejectedValue(new Error('Unexpected transaction'));
    const provider = vi.fn<typeof fetch>().mockRejectedValue(new Error('Unexpected provider request'));
    vi.stubGlobal('fetch', provider);
    const identity = id();
    // The retained callback is intentionally not run: analytics are not admission.
    const response = await handleApi(request(identity), 'rest', () => {});
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('1');
    expect(await response.json()).toMatchObject({
      error: {
        code: 'inference_admission_timeout',
        retryable: true,
        details: { idempotency_key: identity },
      },
    });
    expect(identify).toHaveBeenCalledOnce();
    expect(sql).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  },
);

it.each([
  [new database.DatabaseBudgetError('statement'), 'inference_admission_unknown', false],
  [new database.TransactionRolledBackError(), 'inference_admission_timeout', true],
] as const)('preserves the actual admission boundary for %s', async (error, code, retryable) => {
  vi.spyOn(auth, 'identify').mockResolvedValue({
    id: id(),
    userId: id(),
    organizationId: id(),
    role: 'owner',
    kind: 'api_key',
    scopes: ['runs:write'],
    workspaceIds: [],
    workerIds: [],
    operator: false,
  });
  vi.spyOn(preparations, 'createInference').mockResolvedValue({
    commit: async () => {
      throw new Error('The rejected admission must not execute.');
    },
    dispose: async () => {},
  });
  vi.spyOn(database, 'transaction')
    .mockRejectedValue(new Error('Unexpected transaction'))
    .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // Rate accounting.
    .mockResolvedValueOnce(undefined) // No existing identity at replay preflight.
    .mockRejectedValueOnce(error); // The actual A transaction.
  const sql = vi.spyOn(database.pool, 'query').mockRejectedValue(new Error('Unexpected SQL'));
  const provider = vi.fn<typeof fetch>().mockRejectedValue(new Error('Unexpected provider request'));
  vi.stubGlobal('fetch', provider);
  const response = await handleApi(request(id()), 'rest', () => {});
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: { code, retryable } });
  expect(sql).not.toHaveBeenCalled();
  expect(provider).not.toHaveBeenCalled();
});
