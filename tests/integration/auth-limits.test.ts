import { afterAll, expect, it } from 'vitest';
import { createAuth } from '../../packages/core/src/auth';
import { config } from '../../packages/core/src/config';
import { authPool, pool } from '../../packages/db';

afterAll(async () => {
  await authPool.end();
  await pool.end();
});
it('shares authentication throttling across independent server instances', async () => {
  const rateLimit = {
    enabled: true,
    storage: 'database' as const,
    customRules: { '/sign-in/email': { window: 60, max: 2 } },
  };
  const a = createAuth(rateLimit),
    b = createAuth(rateLimit);
  const address = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
  const request = () =>
    new Request(config.origin + '/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: config.origin, 'X-Forwarded-For': address },
      body: JSON.stringify({
        email: 'nonexistent-rate-fixture@example.test',
        password: 'only-a-local-fixture-password',
      }),
    });
  expect((await a.handler(request())).status).toBe(401);
  expect((await b.handler(request())).status).toBe(401);
  expect((await a.handler(request())).status).toBe(429);
  expect((await b.handler(request())).status).toBe(429);
  expect(
    Number((await authPool.query('SELECT count(*) FROM auth."rateLimit"')).rows[0].count),
  ).toBeGreaterThan(0);
});
