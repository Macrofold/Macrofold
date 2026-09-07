import { test, expect } from '../fixtures/browser';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
test('dashboard stages a large upload and downloads byte-identical checkpoint content', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const name = 'Browser uploads ' + Date.now();
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await page.getByRole('button', { name: 'Upload files', exact: true }).click();
  const bytes = Buffer.alloc(6 * 1024 * 1024, 23);
  await page
    .getByLabel('Choose files')
    .setInputFiles({ name: 'large-fixture.bin', mimeType: 'application/octet-stream', buffer: bytes });
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10000 });
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(
    audit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, reason: n.failureSummary })),
    })),
  ).toEqual([]);
  await page.screenshot({ path: 'test-results/upload-dialog.png' });
  await page.getByRole('button', { name: 'Upload 1 file', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Large file', exact: true })).toBeVisible({
    timeout: 45000,
  });
  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download selected file' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('large-fixture.bin');
  const actual = await readFile((await download.path())!);
  expect(createHash('sha256').update(actual).digest('hex')).toBe(
    createHash('sha256').update(bytes).digest('hex'),
  );
});
