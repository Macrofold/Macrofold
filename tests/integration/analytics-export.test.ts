import { it, expect, afterAll } from 'vitest';
import { pool, authPool } from '../../packages/db';
import { fixtureAccount } from '../fixtures/account';
import { id } from '../../packages/core/src/crypto';
import { forwardProductEvents } from '../../packages/core/src/analytics-export';
import type { AnalyticsEvent } from '../../packages/providers/src/posthog';
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
it('exports only metadata, retries stable event identities and honors the daily attempt ceiling', async () => {
  expect(await forwardProductEvents()).toEqual({ analytics_exported: 0 });
  const { p } = await fixtureAccount('Analytics fixture'),
    since = new Date().toISOString();
  const event = id();
  await pool.query(
    'INSERT INTO product_events(id,organization_id,user_id,name,data,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [
      event,
      p.organizationId,
      p.userId,
      'run.completed',
      JSON.stringify({
        prompt: 'PRIVATE PROMPT',
        email: 'private@example.test',
        secret: 'NEVER FORWARD',
        principal_type: 'service',
        principal_id: id(),
      }),
      since,
    ],
  );
  const key = 'analytics:' + new Date().toISOString().slice(0, 10),
    previous =
      (await pool.query('SELECT data FROM platform_meta WHERE key=$1', [key])).rows[0]?.data?.attempts || 0;
  const batches: AnalyticsEvent[][] = [];
  let fail = true;
  const sink = {
    async send(events: AnalyticsEvent[]) {
      batches.push(events);
      if (fail) throw new Error('Fixture delivery failure');
    },
  };
  const options = { since, dailyLimit: previous + 2, organization: p.organizationId };
  expect((await forwardProductEvents(sink, options)).analytics_retry).toBe(1);
  await pool.query('UPDATE product_events SET export_due_at=now() WHERE id=$1', [event]);
  fail = false;
  expect((await forwardProductEvents(sink, options)).analytics_exported).toBe(1);
  expect(batches[0]).toEqual(batches[1]);
  expect(batches[0][0].uuid).toBe(event);
  const text = JSON.stringify(batches);
  for (const value of ['PRIVATE PROMPT', 'private@example.test', 'NEVER FORWARD'])
    expect(text).not.toContain(value);
  await pool.query('INSERT INTO product_events(id,organization_id,name) VALUES($1,$2,$3)', [
    id(),
    p.organizationId,
    'run.completed',
  ]);
  expect((await forwardProductEvents(sink, options)).analytics_exported).toBe(0);
  expect(batches).toHaveLength(2);
});
