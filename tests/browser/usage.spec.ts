import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('usage charts aggregate real daily totals, support keyboard controls and fit mobile', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Usage', exact: true }).click();
  const chart = page.getByRole('region', { name: 'Daily usage' });
  await expect(chart.locator('.recharts-surface')).toBeVisible();
  await page.getByRole('button', { name: 'View daily values' }).click();
  await expect(chart.locator('tbody tr')).toHaveCount(30);
  const period = page.getByRole('combobox', { name: 'Reporting period' });
  await period.focus();
  await period.press('Space');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.getByRole('option', { name: 'Last 7 days', exact: true }).click();
  await expect(period).toBeFocused();
  await expect(chart.locator('tbody tr')).toHaveCount(7);
  const daily = await chart.locator('tbody td').allTextContents();
  const total = daily.reduce((sum, value) => sum + Number(value.replaceAll(',', '')), 0);
  await expect(chart.locator('.usage-chart-total')).toHaveText(`${total.toLocaleString()}in this period`);
  await page.getByRole('button', { name: 'Input tokens', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Input tokens', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Charges', exact: true }).click();
  await expect(chart.locator('tbody td').first()).toContainText('$');
  await page.getByRole('button', { name: 'Runs', exact: true }).click();
  await page.getByRole('button', { name: 'Hide daily values' }).click();
  await expect(chart.locator('tbody')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/usage-desktop.png', fullPage: true });
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.failureSummary) }))).toEqual(
    [],
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: 'test-results/usage-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('run composer uses styled, accessible listboxes and keyboard selection', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  const harness = page.getByRole('combobox', { name: 'Harness', exact: true });
  await harness.focus();
  await harness.press('Space');
  await expect(page.getByRole('listbox')).toBeVisible();
  await expect(page.getByRole('option', { name: 'Codex', exact: true })).toBeFocused();
  await page.screenshot({ path: 'test-results/run-select-desktop.png', animations: 'disabled' });
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'Claude Code', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(harness).toContainText('Claude Code');
  await expect(harness).toBeFocused();
  await expect(page.getByRole('dialog')).toBeVisible();
  await harness.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toBeVisible();
  const audit = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(audit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.failureSummary) }))).toEqual(
    [],
  );
});

test('an interrupted create recovers with the same idempotency key and creates one project', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const name = `Uncertain response ${Date.now()}`;
  const keys: string[] = [];
  await page.route('**/v1/projects', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length === 1) {
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      await route.abort('connectionreset');
    } else await route.continue();
  });
  await page.getByRole('textbox', { name: 'Project name' }).fill(name);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Retry the unchanged action');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  const result = await (await page.request.get(`/v1/projects?query=${encodeURIComponent(name)}`)).json();
  expect(result.data.filter((p: { name: string }) => p.name === name)).toHaveLength(1);
});
