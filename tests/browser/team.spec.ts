import { test, expect, fixtureOrigin } from '../fixtures/browser';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import pg from 'pg';
const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgres://platform_app:local-app-only@127.0.0.1:55432/platform',
});
const origin = fixtureOrigin,
  password = 'local-team-fixture-2026';
test.afterAll(async () => {
  await pool.end();
});
async function account(request: import('@playwright/test').APIRequestContext, name: string) {
  const email = randomUUID() + '@example.test';
  const response = await request.post('/auth/sign-up/email', {
    headers: { Origin: origin },
    data: { name, email, password },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const { user } = await response.json();
  await pool.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1', [user.id]);
  expect(
    (
      await request.post('/auth/sign-in/email', { headers: { Origin: origin }, data: { email, password } })
    ).ok(),
  ).toBeTruthy();
  return { email, user };
}
test('team invitations, organization switching, owner protection and immediate member revocation', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const owner = await account(page.request, 'Team owner');
  const other = await browser.newContext({ baseURL: origin });
  try {
    const member = await account(other.request, 'Teammate');
    await page.goto('/team');
    await page.getByRole('button', { name: 'New organization', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Organization name').fill('Research collective');
    await page.getByRole('button', { name: 'Create organization', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel('Organization name')).toHaveValue('Research collective');
    const identity = await (await page.request.get('/v1/me')).json();
    expect(identity.organizations).toHaveLength(2);
    const org = identity.organization_id;
    const request = (path: string, data: unknown) =>
      page.request.post(path, { headers: { Origin: origin, 'Idempotency-Key': randomUUID() }, data });
    expect((await request('/account/organization', { organization_id: randomUUID() })).status()).toBe(403);
    // A last-owner demotion is rejected at the same API boundary as the dashboard.
    const last = await page.request.patch('/v1/organization/members/' + owner.user.id, {
      headers: { Origin: origin, 'Idempotency-Key': randomUUID() },
      data: { role: 'viewer' },
    });
    expect(last.status()).toBe(409);
    await page.getByRole('button', { name: 'Invite member', exact: true }).click();
    await page.getByLabel('Email address').fill(member.email);
    await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
    const link = page.getByLabel('Invitation link');
    await expect(link).toBeVisible();
    const invite = await link.inputValue();
    const token = new URL(invite).searchParams.get('token');
    expect((await request('/account/invitation', { token })).status()).toBe(403);
    const joined = await other.newPage();
    await joined.goto(invite);
    await joined.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(joined.getByRole('heading', { name: 'Team & organization' })).toBeVisible();
    expect((await (await other.request.get('/v1/me')).json()).organization_id).toBe(org);
    expect(
      (
        await other.request.post('/account/invitation', { headers: { Origin: origin }, data: { token } })
      ).status(),
    ).toBe(410);
    expect(
      (
        await other.request.post('/v1/organization/invitations', {
          headers: { Origin: origin, 'Idempotency-Key': randomUUID() },
          data: { email: 'no-access@example.test', role: 'admin' },
        })
      ).status(),
    ).toBe(403);
    const keyResult = await other.request.post('/v1/api-keys', {
      headers: { Origin: origin, 'Idempotency-Key': randomUUID() },
      data: { name: 'Revocation fixture', scopes: ['identity:read', 'projects:read'] },
    });
    expect(keyResult.status()).toBe(201);
    const key = (await keyResult.json()).secret;
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByText('Teammate', { exact: true })).toBeVisible();
    await page.locator('[data-sonner-toast]').waitFor({ state: 'hidden' });
    await page.evaluate(() => window.scrollTo(0, 0));
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(audit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.failureSummary) }))).toEqual(
      [],
    );
    await page.screenshot({ path: 'test-results/team-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Remove Teammate', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm access change' }).click();
    await expect(page.getByText('Teammate', { exact: true })).toHaveCount(0);
    expect(
      (await other.request.get('/v1/me', { headers: { Authorization: 'Bearer ' + key } })).status(),
    ).toBe(401);
    expect((await other.request.get('/v1/me', { headers: { 'X-Organization-Id': org } })).status()).toBe(403);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
    await expect
      .poll(() => page.locator('.sidebar').evaluate((e) => e.getBoundingClientRect().right))
      .toBeLessThanOrEqual(0);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10000 });
    await page.screenshot({ path: 'test-results/team-mobile.png', fullPage: true });
  } finally {
    await other.close();
  }
});
