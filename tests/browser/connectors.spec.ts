import { test, expect } from '../fixtures/browser';
import AxeBuilder from '@axe-core/playwright';
test('adds sandbox MCP and BYOK search connections, then grants only selected tools', async ({ page }) => {
  let sandboxName = '';
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Connections', exact: true }).click();
  for (const [kind, label, tool] of [
    ['Sandbox MCP', 'Local files', 'write_file'],
    ['Web search', 'Search key', 'web_search'],
  ]) {
    await page.getByRole('button', { name: 'Add connection', exact: true }).first().click();
    await page.getByRole('button', { name: kind, exact: true }).click();
    const name = label + ' ' + Date.now();
    if (kind === 'Sandbox MCP') sandboxName = name;
    await page.getByLabel('Connection name').fill(name);
    if (kind === 'Web search') {
      await page.getByRole('combobox', { name: 'Search funding' }).click();
      await page.getByRole('option', { name: 'Bring your Brave Search API key' }).click();
      await page.getByLabel('Brave Search API key', { exact: true }).fill('fixture-not-a-live-provider-key');
    } else await expect(page.getByLabel('Approved package')).toContainText('Filesystem');
    await page.getByRole('dialog').getByRole('button', { name: 'Add connection', exact: true }).click();
    const card = page
      .locator('.connection-card')
      .filter({ has: page.getByRole('heading', { name, exact: true }) });
    await expect(card).toBeVisible();

    if (kind === 'Sandbox MCP') {
      await page.route('**/v1/connections/*/access', (route) =>
        route.fulfill({ status: 503, json: { error: { message: 'Grant service unavailable' } } }),
      );
      await card.getByRole('button', { name: 'Tools', exact: true }).click();
      await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Grant service unavailable');
      await expect(page.getByRole('button', { name: 'Save tools' })).toHaveCount(0);
      await page.unroute('**/v1/connections/*/access');
      await page.getByRole('button', { name: 'Try again' }).click();
    } else {
      await card.getByRole('button', { name: 'Tools', exact: true }).click();
    }

    await page.getByRole('checkbox', { name: new RegExp(tool) }).check();
    await page.getByRole('button', { name: 'Save tools' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await card.getByRole('button', { name: 'Tools', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: new RegExp(tool) })).toBeChecked();
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await card.getByRole('button', { name: 'Access', exact: true }).click();
    await page.getByRole('switch', { name: 'Available across the organization' }).check();
    await expect(page.getByRole('switch')).toBeEnabled();
    await page.getByRole('button', { name: 'Close dialog' }).click();
  }
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.failureSummary) }))).toEqual(
    [],
  );
  await page.screenshot({ path: 'test-results/connectors-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
  await page.getByRole('button', { name: 'New workspace', exact: true }).click();
  const workspaceName = `Tool grant journey ${Date.now()}`;
  await page.getByRole('textbox', { name: 'Workspace name' }).fill(workspaceName);
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: workspaceName })).toBeVisible();
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'What would you like to get done?' })
    .fill('Verify the selected tool grant using local simulation.');
  await page.getByRole('button', { name: 'Run settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Selection mode', exact: true }).click();
  await page.getByRole('option', { name: 'Select specific tools', exact: true }).click();
  await page.locator('summary').filter({ hasText: sandboxName }).click();
  await page.getByRole('checkbox', { name: 'write_file', exact: true }).check();
  const request = page.waitForRequest(
    (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/v1/runs',
  );
  await page.getByRole('button', { name: 'Start run', exact: true }).click();
  const body = (await request).postDataJSON();
  expect(body.connection_grants).toHaveLength(1);
  expect(body.connection_grants[0].tools).toEqual(['write_file']);
  await expect(page.getByRole('heading', { name: 'Work, completed.' })).toBeVisible({ timeout: 45000 });
});
