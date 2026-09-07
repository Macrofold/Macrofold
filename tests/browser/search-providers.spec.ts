import { test, expect } from '../fixtures/browser';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { config } from '../../packages/core/src/config';
import { pool, authPool } from '../../packages/db';

const email = `${randomUUID()}@example.test`;
test.beforeAll(async ({ request }) => {
  const response = await request.post('/auth/sign-up/email', {
    headers: { Origin: config.origin },
    data: { email, password: 'local-fixture-password-2026', name: 'Search dashboard fixture' },
  });
  expect(response.ok()).toBe(true);
  // This fixture owns the account; verify locally without sending any external email.
  const verified = await pool.query('UPDATE auth."user" SET "emailVerified"=true WHERE email=$1', [email]);
  expect(verified.rowCount).toBe(1);
});
test.afterAll(async () => {
  await pool.end();
  await authPool.end();
});
for (const [provider, label] of [
  ['exa', 'Exa'],
  ['tavily', 'Tavily'],
  ['parallel', 'Parallel AI'],
  ['firecrawl', 'Firecrawl'],
]) {
  test(`${label}: selects a provider, clears the old key and persists tool grants`, async ({ page }) => {
    await page.goto('/login?returnTo=/connections');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('local-fixture-password-2026');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Add connection', exact: true }).first().click();
    await page.getByRole('button', { name: 'Web search', exact: true }).click();
    await page.getByRole('combobox', { name: 'Search funding' }).click();
    await page.getByRole('option', { name: 'Bring your Brave Search API key' }).click();
    await page.getByLabel('Brave Search API key', { exact: true }).fill('old-key-must-clear');
    await page.getByRole('combobox', { name: 'Search provider' }).click();
    // Exercise keyboard selection in the Radix control as well as its accessible name.
    await page.getByRole('option', { name: label, exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel(`${label} API key`, { exact: true })).toHaveValue('');
    await expect(page.getByRole('combobox', { name: 'Search funding' })).toContainText(
      `Bring your ${label} API key`,
    );
    await page.getByRole('combobox', { name: 'Search funding' }).click();
    await expect(page.getByRole('option', { name: /Managed/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    const name = `${label} dashboard fixture`;
    await page.getByLabel('Connection name').fill(name);
    await page.getByLabel(`${label} API key`, { exact: true }).fill('synthetic-search-key');
    const saved = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/v1/connections',
    );
    await page.getByRole('dialog').getByRole('button', { name: 'Add connection', exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    expect(await response.json()).toMatchObject({ provider, kind: 'search', auth_method: 'api_key' });
    const card = page
      .locator('.connection-card')
      .filter({ has: page.getByRole('heading', { name, exact: true }) });
    await expect(card).toContainText(`${label} · Your API key`);
    await card.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('checkbox', { name: /web_search/ }).check();
    await page.getByRole('button', { name: 'Save permissions' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await card.getByRole('button', { name: 'Tools', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /web_search/ })).toBeChecked();
    await page.getByRole('button', { name: 'Close dialog' }).click();

    await page.reload();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(audit.violations.map((v) => v.id)).toEqual([]);
  });
}
