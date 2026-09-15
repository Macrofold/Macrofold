import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, fixtureOrigin } from '../fixtures/browser';
import type { components } from '../../packages/contracts/api';

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/login/);
  await page.goto('/api-keys');
  await page.getByRole('button', { name: 'Create API key', exact: true }).first().click();
});

test('presets create usable scoped keys and keep project and administrative boundaries', async ({ page }) => {
  test.setTimeout(120000);
  const projectResponse = await page.request.post('/v1/projects', {
    headers: { Origin: fixtureOrigin, 'Idempotency-Key': randomUUID() },
    data: { name: `Key project ${randomUUID()}` },
  });
  expect(projectResponse.status()).toBe(201);
  const project = await projectResponse.json();
  await page.reload();
  await page.getByRole('button', { name: 'Create API key', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  const preset = dialog.getByRole('combobox', { name: 'Permissions', exact: true });
  await expect(preset).toHaveText('Read & write');
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await preset.focus();
  await page.keyboard.press('ArrowDown');
  await page.getByRole('option', { name: 'Read-only', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill(`Read-only fixture ${randomUUID()}`);
  await dialog.getByRole('combobox', { name: 'Project access' }).click();
  await page.getByRole('option', { name: project.name, exact: true }).click();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/v1/api-keys') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Create key', exact: true }).click();
  const created = await response;
  expect(created.status()).toBe(201);
  const key: components['schemas']['NewApiKey'] = await created.json();
  expect(key.project_id).toBe(project.id);
  expect(Date.parse(key.expires_at ?? '') - Date.now()).toBeGreaterThan(89 * 86400000);
  expect(key.scopes).toContain('files:read');
  expect(key.scopes.every((scope) => scope.endsWith(':read'))).toBe(true);
  const headers = { Authorization: `Bearer ${key.secret}`, 'Idempotency-Key': randomUUID() };
  expect((await page.request.get(`/v1/projects/${project.id}`, { headers })).status()).toBe(200);
  expect(
    (await page.request.post('/v1/projects', { headers, data: { name: 'Denied creation' } })).status(),
  ).toBe(403);
  await expect(dialog.getByRole('heading', { name: 'Your new API key' })).toBeVisible();
  await dialog.getByRole('button', { name: 'I’ve saved the key' }).click();

  for (const level of ['Read & write', 'Full access']) {
    await page.getByRole('button', { name: 'Create API key', exact: true }).first().click();
    await expect(preset).toHaveText('Read & write');
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    await preset.click();
    await page.getByRole('option', { name: level, exact: true }).click();
    await dialog.getByLabel('Name', { exact: true }).fill(`${level} fixture ${randomUUID()}`);
    const saved = page.waitForResponse(
      (r) => r.url().endsWith('/v1/api-keys') && r.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Create key', exact: true }).click();
    const result = await saved;
    expect(result.status()).toBe(201);
    const next: components['schemas']['NewApiKey'] = await result.json();
    expect(next.project_id).toBeUndefined();
    expect(next.scopes).toContain('runs:write');
    expect(next.scopes).not.toContain('offline_access');
    const auth = { Authorization: `Bearer ${next.secret}`, 'Idempotency-Key': randomUUID() };
    expect(
      (
        await page.request.post('/v1/projects', {
          headers: auth,
          data: { name: `Preset project ${randomUUID()}` },
        })
      ).status(),
    ).toBe(201);
    const child = await page.request.post('/v1/api-keys', {
      headers: auth,
      data: { name: 'Child fixture', scopes: ['identity:read'] },
    });
    expect(child.status()).toBe(level === 'Full access' ? 201 : 403);
    await dialog.getByRole('button', { name: 'I’ve saved the key' }).click();
  }
});

test('customization preserves selections, submits exact scopes, and works on mobile with a keyboard', async ({
  page,
}) => {
  const dialog = page.getByRole('dialog');
  const preset = dialog.getByRole('combobox', { name: 'Permissions', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill(`Custom fixture ${randomUUID()}`);
  await dialog.getByRole('button', { name: /View permissions/ }).focus();
  await page.keyboard.press('Enter');
  const billing = dialog.getByRole('checkbox', { name: 'Manage billing billing:write', exact: true });
  await expect(billing).not.toBeChecked();
  await billing.check();
  await expect(preset).toHaveText('Custom');
  await dialog.getByRole('button', { name: /Hide permissions/ }).click();
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await dialog.getByRole('button', { name: /View permissions/ }).click();
  await expect(billing).toBeChecked();
  await preset.click();
  await page.getByRole('option', { name: 'Read-only', exact: true }).click();
  await dialog.getByRole('button', { name: /Hide permissions/ }).click();
  await preset.click();
  await page.getByRole('option', { name: 'Custom', exact: true }).click();
  await expect(billing).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'View identity identity:read', exact: true })).toBeChecked();
  for (const box of await dialog.getByRole('checkbox').all()) await box.uncheck();
  await expect(dialog.getByRole('button', { name: 'Create key', exact: true })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'View identity identity:read', exact: true }).check();
  await page.setViewportSize({ width: 390, height: 844 });
  const audit = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(audit.violations).toEqual([]);
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: 'test-results/key-permissions-mobile.png' });
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/v1/api-keys') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Create key', exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(201);
  const key: components['schemas']['NewApiKey'] = await result.json();
  expect(key.scopes).toEqual(['identity:read']);
});

test('permission loading failure blocks creation and retry restores presets', async ({ page }) => {
  await page.route('**/v1/me', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'unavailable', message: 'Permissions unavailable' } },
    }),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Create API key', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Retry fixture');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create key', exact: true })).toBeDisabled();
  await page.unroute('**/v1/me');
  await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Permissions', exact: true })).toHaveText('Read & write');
  await expect(dialog.getByRole('button', { name: 'Create key', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'test-results/key-permissions-desktop.png' });
});
