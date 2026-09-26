import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../fixtures/browser';

test('creates, pauses, resumes, selects and destroys a Worker without touching files or Sessions', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Workers', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Workers', exact: true })).toBeVisible();

  const name = `Browser Worker ${randomUUID().slice(0, 8)}`;
  await page.getByRole('button', { name: 'Create Worker', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create Worker', exact: true });
  await create.getByLabel('Name (optional)').fill(name);
  // Isolated metered sandbox compute is the default contract; trusted sharing is never implied.
  await expect(create.getByRole('combobox', { name: 'Compute offering', exact: true })).toContainText(
    'On-demand sandbox · metered capacity · isolated Runs',
  );
  await create.getByRole('button', { name: 'Create Worker', exact: true }).click();
  await expect(create).toHaveCount(0);

  const worker = page.getByRole('region', { name, exact: true });
  await expect(worker).toContainText('On-demand sandbox · metered capacity · isolated Runs');
  await expect(worker).toContainText('0 active · 0 queued');

  await worker.getByRole('button', { name: 'Pause', exact: true }).click();
  const pause = page.getByRole('dialog', { name: 'Pause Worker', exact: true });
  await expect(pause).toContainText('Files and Sessions are not deleted.');
  await pause.getByRole('button', { name: 'Confirm pause', exact: true }).click();
  await expect(pause).toHaveCount(0);
  await worker.getByRole('button', { name: 'Resume', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Resume Worker', exact: true })
    .getByRole('button', { name: 'Confirm resume' })
    .click();
  await expect(worker.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

  // Compute selection is optional and explicit in the run composer.
  await page.getByRole('link', { name: 'Runs', exact: true }).click();
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  const composer = page.getByRole('dialog', { name: 'Start a new run', exact: true });
  await composer.getByRole('button', { name: 'Run settings', exact: true }).click();
  const compute = composer.getByRole('combobox', { name: 'Compute', exact: true });
  await expect(compute).toContainText('Automatic isolated compute');
  await compute.click();
  await page.getByRole('option', { name: new RegExp(`^${name} · sandbox`) }).click();
  await expect(composer).toContainText('Each Run receives an isolated allocation.');
  await expect(composer.getByLabel('Memory per Run (MiB, optional)')).toBeVisible();
  await composer.getByRole('button', { name: 'Close dialog' }).click();

  await page.getByRole('link', { name: 'Workers', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.failureSummary) }))).toEqual(
    [],
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await worker.getByRole('button', { name: 'Destroy', exact: true }).click();
  const destroy = page.getByRole('dialog', { name: 'Destroy Worker', exact: true });
  await expect(destroy).toContainText('The destroyed Worker cannot be resumed.');
  await destroy.getByRole('button', { name: 'Confirm destroy', exact: true }).click();
  await expect(destroy).toHaveCount(0);
  await expect(worker.getByRole('button', { name: 'Destroy', exact: true })).toBeDisabled();
  await expect(worker.getByRole('button', { name: 'Settings', exact: true })).toBeDisabled();
});
