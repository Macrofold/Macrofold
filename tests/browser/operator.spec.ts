import { test, expect } from '../fixtures/browser';
import AxeBuilder from '@axe-core/playwright';
test('operator sees usage, honest cohorts, account drilldown and searchable paginated accounts', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('/');
  await page.goto('/operator');
  await expect(page.getByRole('heading', { name: 'The bigger picture.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Platform usage', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Account cohorts', exact: true })).toBeVisible();
  await expect(page.getByText('Still observing').first()).toBeVisible();
  await page.getByLabel('Search accounts').fill('Alex');
  await expect(
    page
      .locator('.data-table')
      .filter({ has: page.getByRole('columnheader', { name: 'Members', exact: true }) })
      .getByRole('button')
      .first(),
  ).toBeVisible();
  await page
    .locator('.data-table')
    .filter({ has: page.getByRole('columnheader', { name: 'Members', exact: true }) })
    .getByRole('button')
    .first()
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Available credits');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.failureSummary) }))).toEqual(
    [],
  );
  await page.screenshot({ path: 'test-results/operator-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.locator('.sidebar').evaluate((e) => e.getBoundingClientRect().right))
    .toBeLessThanOrEqual(0);
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: 'test-results/operator-mobile.png', fullPage: true });
});
