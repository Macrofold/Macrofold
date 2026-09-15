import { test, expect } from '../fixtures/browser';
import AxeBuilder from '@axe-core/playwright';

test('saves a specific named API-key account in a preset and invokes it through the dashboard', async ({
  page,
}) => {
  await page.route('https://logos.composio.dev/**', (route) => route.fulfill({ status: 204 }));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Connections', exact: true }).click();
  const suffix = Date.now();
  const selected = `Coding account ${suffix}`;
  let selectedId = '';
  for (const name of [selected, `Later account ${suffix}`]) {
    await page.getByRole('button', { name: 'Add connection', exact: true }).first().click();
    await page.getByRole('button', { name: 'Model key', exact: true }).click();
    await page.getByLabel('Connection name').fill(name);
    await page.getByLabel('Provider API key').fill('synthetic-unused-api-key');
    const created = page.waitForResponse(
      (r) => r.url().endsWith('/v1/connections') && r.request().method() === 'POST',
    );
    await page.getByRole('dialog').getByRole('button', { name: 'Add connection', exact: true }).click();
    const response = await created;
    expect(response.ok()).toBe(true);
    if (name === selected) selectedId = (await response.json()).id;
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await page.getByRole('link', { name: 'Agent presets', exact: true }).click();
  await page.getByRole('button', { name: 'New preset', exact: true }).click();
  const name = `Named preset ${suffix}`;
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('combobox', { name: 'Model funding', exact: true }).click();
  await page.getByRole('option', { name: 'Your API-key connection', exact: true }).click();
  await page.getByRole('combobox', { name: 'Authentication connection', exact: true }).click();
  await page.getByRole('option', { name: selected, exact: true }).click();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/v1/agents') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create preset', exact: true }).click();
  const presetResponse = await saved;
  expect(presetResponse.ok()).toBe(true);
  const preset = await presetResponse.json();
  expect(preset.provider_connection_id).toBe(selectedId);
  expect(preset.billing_mode).toBe('byok');
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Runs', exact: true }).click();
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  await page.getByRole('combobox', { name: 'Agent preset', exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
  await page
    .getByRole('textbox', { name: 'What would you like to get done?' })
    .fill('Use the selected account.');
  const started = page.waitForResponse(
    (r) => r.url().endsWith('/v1/runs') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Start run', exact: true }).click();
  const run = await started;
  expect(run.ok()).toBe(true);
  expect(run.request().postDataJSON()).toMatchObject({ agent_id: preset.id });
  expect(run.request().postDataJSON()).not.toHaveProperty('provider_connection_id');
  await expect(page.getByRole('heading', { name: 'Work, completed.' })).toBeVisible();
  await expect(page.locator('.markdown-output')).toContainText('Simulation completed');
});

test('names independent accounts, edits backup policy, and clearly keeps subscription authentication unavailable', async ({
  page,
}) => {
  await page.route('https://logos.composio.dev/**', (route) => route.fulfill({ status: 204 }));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Connections', exact: true }).click();
  const suffix = Date.now();
  const backup = `API backup ${suffix}`,
    research = `Claude Research ${suffix}`,
    personal = `Claude Personal ${suffix}`;
  await page.getByRole('button', { name: 'Add connection', exact: true }).first().click();
  await page.getByRole('button', { name: 'Model key', exact: true }).click();
  await page.getByRole('combobox', { name: 'Provider', exact: true }).click();
  await page.getByRole('option', { name: 'Anthropic', exact: true }).click();
  await page.getByLabel('Connection name').fill(backup);
  await page.getByLabel('Provider API key').fill('synthetic-unused-api-key');
  await page.getByRole('dialog').getByRole('button', { name: 'Add connection', exact: true }).click();
  await expect(page.getByRole('heading', { name: backup, exact: true })).toBeVisible();
  for (const name of [research, personal]) {
    await page.getByRole('button', { name: 'Add connection', exact: true }).first().click();
    await page.getByRole('button', { name: 'Claude subscription', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Subscription authentication is not yet available');
    await page.getByLabel('Connection name').fill(name);
    await page.getByRole('dialog').getByRole('button', { name: 'Add connection', exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: `Edit ${research}`, exact: true }).click();
  const id = await page.getByLabel('Connection ID', { exact: true }).inputValue();
  await page.getByLabel('Connection name').fill(`${research} renamed`);
  await page.getByRole('combobox', { name: 'Backup Anthropic API key' }).click();
  await page.getByRole('option', { name: backup, exact: true }).click();
  await page.getByLabel('Per-run API limit (USD)').fill('1.25');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: personal, exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Edit ${research} renamed`, exact: true }).click();
  await expect(page.getByLabel('Connection ID', { exact: true })).toHaveValue(id);
  await expect(page.getByLabel('Per-run API limit (USD)')).toHaveValue('1.25');
  const audit = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.getByRole('combobox', { name: 'Backup Anthropic API key' }).click();
  await page.getByRole('option', { name: 'Disabled · never fall back to paid API usage' }).click();
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const name of [`${research} renamed`, personal, backup]) {
    await page.getByRole('button', { name: `Remove ${name}`, exact: true }).click();
    await page.getByRole('button', { name: 'Remove connection', exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
  }
});
