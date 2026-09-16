import { test, expect } from '../fixtures/browser';
import AxeBuilder from '@axe-core/playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Real public consent reads and branded UI; no upstream OAuth request or paid tool execution.
test('customer consent shows reviewed permissions, themes, mobile layout and safe error recovery', async ({
  page,
}) => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    '--import',
    'tsx',
    'tests/fixtures/customer-connect/setup.ts',
  ]);
  const auth = JSON.parse(stdout) as { authorization_url: string };
  await page.goto(auth.authorization_url);
  await expect(page.getByRole('heading', { name: 'Connect GitHub to Milo' })).toBeVisible();
  await expect(page.getByLabel('No access', { exact: true })).toBeChecked();
  await page.getByLabel('Read my profile', { exact: true }).check();
  await expect(page.getByLabel('No access', { exact: true })).not.toBeChecked();
  await page.getByText('View permissions', { exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('GITHUB_GET_THE_AUTHENTICATED_USER', { exact: true })).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await page.getByRole('button', { name: `Use ${theme} theme`, exact: true }).click();
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations,
    ).toEqual([]);
    await page.screenshot({ path: `test-results/customer-connect-${theme}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: 'test-results/customer-connect-mobile.png', fullPage: true });
  await page.route('**/integrations/customer-connect', async (route) => {
    const body = route.request().postDataJSON();
    if (body.action !== 'start') return route.continue();
    expect(body.capability_ids).toEqual(['profile']);
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { message: 'This connection changed. Return to your app for a new link.' },
      }),
    });
  });
  await page.getByRole('button', { name: 'Continue to GitHub' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('This connection changed');
  await expect(page.getByRole('button', { name: 'Continue to GitHub' })).toBeEnabled();
  await page.goto('/connect');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Open a connection link');
  expect(
    (
      await page.request.post('/integrations/customer-connect', {
        headers: { Origin: 'https://untrusted.example' },
        data: { action: 'describe', ticket: 'x'.repeat(20) },
      })
    ).status(),
  ).toBe(403);
});

test('embedded connection card protects stale drafts and keeps recovery in context', async ({ page }) => {
  const { build } = await import('esbuild');
  const { readFile } = await import('node:fs/promises');
  const bundle = await build({
    entryPoints: ['tests/fixtures/customer-connect/card.tsx'],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  await page.setContent(
    '<!doctype html><html lang="en"><head><title>Customer connection fixture</title></head><body><div id="root"></div></body></html>',
  );
  await page.addStyleTag({ content: await readFile('sdk/typescript/src/react.css', 'utf8') });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByLabel('Read records', { exact: true }).check();
  await page.getByRole('button', { name: 'Simulate permission change' }).click();
  await expect(page.getByRole('button', { name: 'Save permissions' })).toBeDisabled();
  await page.getByRole('button', { name: 'Load current permissions' }).click();
  await expect(page.getByLabel('No access', { exact: true })).toBeChecked();
  await page.getByLabel('Read records', { exact: true }).check();
  await page.getByRole('button', { name: 'Save permissions' }).click();
  await expect(page.locator('output')).toHaveText('Saved read at 2');
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('A new link is needed');
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByRole('button', { name: 'Keep connection' }).click();
  await expect(page.getByRole('group', { name: 'Confirm disconnect' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect account', exact: true }).click();
  await expect(page.locator('output')).toHaveText('Disconnected');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
});
