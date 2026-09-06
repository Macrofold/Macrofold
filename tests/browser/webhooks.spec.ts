import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('manages signed webhook endpoints and secrets on desktop and mobile', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Webhooks', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Webhooks', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add endpoint', exact: true }).first().click();
  const endpoint = `https://example.com/events/${Date.now()}`;
  await page.getByRole('textbox', { name: 'Endpoint URL' }).fill(endpoint);
  await page.getByRole('button', { name: 'Create endpoint', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Save your signing secret' })).toBeVisible();
  await expect(page.locator('.secret-value')).toContainText('whsec_');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const card = page
    .locator('.connection-card')
    .filter({ has: page.getByRole('heading', { name: endpoint, exact: true }) });
  await card.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(card.getByText('paused', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Enable', exact: true }).click();
  await expect(card.getByText('healthy', { exact: true })).toBeVisible();
  // Audit settled content, not the intermediate opacity of exiting toast animations.
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10000 });
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(
    audit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, reason: n.failureSummary })),
    })),
  ).toEqual([]);
  await page.screenshot({ path: 'test-results/webhooks-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: 'test-results/webhooks-mobile.png', fullPage: true });
  await card.getByRole('button', { name: `Delete ${endpoint}` }).click();
  await page.getByRole('button', { name: 'Delete endpoint', exact: true }).click();
  await expect(card).toHaveCount(0);
});
