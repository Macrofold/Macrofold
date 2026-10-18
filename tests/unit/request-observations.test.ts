import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RequestObservation } from '../../packages/core/src/request-observations';

const db = vi.hoisted(() => ({
  pool: { options: { max: 80 }, waitingCount: 0 },
  query: vi.fn<(text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>>(),
  groups: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('../../packages/db', () => ({
  pool: db.pool,
  transaction: db.transaction,
  queryGroup: db.groups,
}));
const observation: RequestObservation = {
  requestId: 'request-id',
  organizationId: 'organization-id',
  principalId: 'service-id',
  principalType: 'service',
  method: 'POST',
  route: '/v1/workspaces',
  status: 201,
  durationMs: 12,
  clientType: 'api',
  operation: 'createWorkspace',
};
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv('REQUEST_ANALYTICS_ENABLED', 'true');
  vi.stubEnv('API_PRODUCT_EVENTS_ENABLED', 'true');
  db.pool.options.max = 80;
  db.pool.waitingCount = 0;
  db.query.mockResolvedValue({ rows: [] });
  db.groups.mockResolvedValue([]);
  db.transaction.mockImplementation(
    async (_org: unknown, work: (tx: { query: typeof db.query }) => Promise<unknown>) =>
      work({ query: db.query }),
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each([
  [true, true, 2],
  [true, false, 1],
  [false, true, 1],
  [false, false, 0],
])('collects independent request=%s/product=%s sources', async (requests, products, count) => {
  vi.stubEnv('REQUEST_ANALYTICS_ENABLED', String(requests));
  vi.stubEnv('API_PRODUCT_EVENTS_ENABLED', String(products));
  const owner = await import('../../packages/core/src/request-observations');
  const tasks: (() => Promise<void>)[] = [];
  await owner.beginRequestObservation({ requestId: observation.requestId, method: 'POST' });
  await owner.enrichRequestObservation(observation);
  expect(db.query).toHaveBeenCalledTimes(requests ? 2 : 0);
  db.transaction.mockClear();
  await owner.observeRequest(observation, (task) => tasks.push(task), { fallback: true });
  expect(tasks).toHaveLength(count ? 1 : 0);
  expect(db.transaction).not.toHaveBeenCalled();
  await Promise.all(tasks.map((task) => task()));
  if (count) {
    expect(db.groups.mock.calls[0][1]).toHaveLength(count);
    const sql = JSON.stringify(db.groups.mock.calls[0][1]);
    expect(sql.includes('INSERT INTO api_requests')).toBe(requests);
    expect(sql.includes('INSERT INTO product_events')).toBe(products);
    expect(db.transaction.mock.calls[0][2].deadlineAtMs).toBeGreaterThan(Date.now());
  } else expect(db.groups).not.toHaveBeenCalled();
});

it('uses startup defaults and preserves the no-background fallback policy', async () => {
  vi.stubEnv('REQUEST_ANALYTICS_ENABLED', undefined);
  vi.stubEnv('API_PRODUCT_EVENTS_ENABLED', undefined);
  const owner = await import('../../packages/core/src/request-observations');
  expect(owner.requestObservationPolicy()).toEqual({ requests: true, apiProductEvents: true });
  vi.stubEnv('REQUEST_ANALYTICS_ENABLED', 'false');
  expect(owner.requestObservationPolicy().requests).toBe(true);
  await owner.observeRequest(observation, undefined, { fallback: false });
  expect(db.groups).not.toHaveBeenCalled();
  await owner.observeRequest(observation, undefined, { fallback: true });
  expect(db.groups).toHaveBeenCalledOnce();
});

it('bounds concurrent diagnostics, pool pressure and failures without failing execution', async () => {
  const owner = await import('../../packages/core/src/request-observations');
  let release = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  db.groups.mockImplementation(() => barrier);
  const active = Array.from({ length: 4 }, () =>
    owner.observeRequest(observation, undefined, { fallback: true }),
  );
  await owner.observeRequest(observation, undefined, { fallback: true });
  expect(db.groups).toHaveBeenCalledTimes(4);
  release();
  await Promise.all(active);
  db.pool.waitingCount = 1;
  await owner.observeRequest(observation, undefined, { fallback: true });
  expect(db.groups).toHaveBeenCalledTimes(4);
  db.pool.waitingCount = 0;
  db.groups.mockRejectedValue(new Error('secret diagnostics payload'));
  await expect(owner.observeRequest(observation, undefined, { fallback: true })).resolves.toBeUndefined();
  await expect(
    owner.observeRequest(
      observation,
      () => {
        throw new Error('secret scheduler');
      },
      { fallback: true },
    ),
  ).resolves.toBeUndefined();
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('secret');
});

it('does not publish successful API events for failed attempts', async () => {
  vi.stubEnv('REQUEST_ANALYTICS_ENABLED', 'false');
  const owner = await import('../../packages/core/src/request-observations');
  await owner.observeRequest({ ...observation, status: 403 }, undefined, { fallback: true });
  expect(db.groups).not.toHaveBeenCalled();
});
