import { test, expect, fixtureOrigin } from '../fixtures/browser';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgres://platform_app:local-app-only@127.0.0.1:55432/platform',
});
test.afterAll(async () => {
  await pool.end();
});
test('storage policy is an explicit budget, shows unmeasured state and remains usable on mobile', async ({
  page,
}) => {
  const email = randomUUID() + '@example.test',
    password = 'local-storage-fixture-2026',
    headers = { Origin: fixtureOrigin };
  const signed = await page.request.post('/auth/sign-up/email', {
    headers,
    data: { email, password, name: 'Storage owner' },
  });
  expect(signed.ok()).toBeTruthy();
  const { user } = await signed.json();
  await pool.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1', [user.id]);
  expect(
    (await page.request.post('/auth/sign-in/email', { headers, data: { email, password } })).ok(),
  ).toBeTruthy();
  await page.goto('/billing');
  await expect(page.getByRole('heading', { name: 'Persistent storage' })).toBeVisible();
  await expect(page.getByText('Waiting for first measurement')).toBeVisible();
  await page.getByLabel('Enable storage beyond the included allowance').check();
  await page.getByLabel('Monthly storage budget (USD)').fill('12.34');
  await page.getByRole('button', { name: 'Save storage budget' }).click();
  await expect(page.locator('[data-sonner-toast]')).toBeVisible();
  const stored = await (await page.request.get('/v1/storage')).json();
  expect(stored.overage_enabled).toBe(true);
  expect(stored.monthly_budget_micro_usd).toBe('12340000');
  await page.reload();
  await expect(page.getByLabel('Monthly storage budget (USD)')).toHaveValue('12.34');
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.failureSummary) }))).toEqual(
    [],
  );
  await page.screenshot({ path: 'test-results/billing-storage-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.locator('.sidebar').evaluate((e) => e.getBoundingClientRect().right))
    .toBeLessThanOrEqual(0);
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: 'test-results/billing-storage-mobile.png', fullPage: true });
  await page.getByLabel('Enable storage beyond the included allowance').uncheck();
  await page.getByRole('button', { name: 'Save storage budget' }).click();
  await expect(page.locator('[data-sonner-toast]')).toBeVisible();
  expect((await (await page.request.get('/v1/storage')).json()).overage_enabled).toBe(false);
});
