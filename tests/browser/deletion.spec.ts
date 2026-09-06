import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('project deletion has explicit confirmation, an archived view and a working undo', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const name = 'Deletion browser ' + Date.now();
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Schedule deletion', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Schedule permanent deletion', exact: true })).toBeDisabled();
  await page.getByLabel(`Type ${name} to confirm`).fill(name);
  // Audit the settled interface, rather than a translucent frame of the entry transition.
  await page.getByRole('dialog').evaluate(async (dialog) => {
    await Promise.all(dialog.getAnimations().map((animation) => animation.finished.catch(() => {})));
  });
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10000 });
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.failureSummary) }))).toEqual(
    [],
  );
  await page.getByRole('button', { name: 'Schedule permanent deletion', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Deletion scheduled', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'All projects', exact: true }).click();
  await page.getByRole('combobox', { name: 'Project status' }).click();
  await page.getByRole('option', { name: 'Archived & pending deletion' }).click();
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .click();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Undo deletion', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Schedule deletion', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New run', exact: true })).toBeEnabled();
});
