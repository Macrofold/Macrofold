import { test, expect } from '../fixtures/browser';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

test('uploads and previews media, attaches a document, and downloads a persisted run output', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
  await page.getByRole('button', { name: 'New workspace', exact: true }).click();
  const name = 'Media journey ' + Date.now();
  await page.getByLabel('Workspace name').fill(name);
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await page.getByRole('button', { name: 'Upload files', exact: true }).click();
  await page
    .getByLabel('Choose files')
    .setInputFiles([
      'tests/fixtures/media/pixel.png',
      'tests/fixtures/media/document.pdf',
      'tests/fixtures/media/document.docx',
      'tests/fixtures/media/clip.webm',
      'tests/fixtures/media/silence.wav',
    ]);
  await page.getByRole('button', { name: 'Upload 5 files', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // One transport failure must expose recovery without losing file selection.
  await page.route('**/v1/worktrees/*/file?**', (route) => route.fulfill({ status: 503 }), { times: 1 });
  await page.getByRole('treeitem', { name: 'pixel.png', exact: true }).click();
  await expect(page.getByText('This file could not be loaded.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  const image = page.getByRole('img', { name: 'pixel.png', exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(1);
  await page.getByRole('treeitem', { name: 'document.pdf', exact: true }).click();
  const pdf = page.getByRole('region', { name: 'PDF preview', exact: true });
  await expect(pdf.locator('canvas')).toBeVisible();
  await expect(pdf.getByText('Media document fixture', { exact: true })).toBeAttached();
  const footer = page.getByRole('region', { name: 'File viewer', exact: true }).locator('.editor-footer');
  await expect(footer).toContainText('Original file');
  await expect(footer).not.toContainText('Loading');
  await page.screenshot({ path: 'test-results/media-pdf.png' });
  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download selected file' }).click();
  const download = await downloading;
  expect(await readFile((await download.path())!)).toEqual(
    await readFile('tests/fixtures/media/document.pdf'),
  );
  for (const [filename, tag] of [
    ['clip.webm', 'video'],
    ['silence.wav', 'audio'],
  ]) {
    await page.getByRole('treeitem', { name: filename, exact: true }).click();
    const media = page.locator(tag);
    await expect(media).toBeVisible();
    await expect
      .poll(() => media.evaluate((element) => (element as HTMLMediaElement).readyState))
      .toBeGreaterThanOrEqual(1);
  }
  await page.getByRole('treeitem', { name: 'document.docx', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Download to view' })).toBeVisible();
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  await page
    .getByLabel('What would you like to get done?')
    .fill('Summarize the attached document and save a deliverable.');
  await page.getByLabel('Attach files', { exact: true }).setInputFiles('tests/fixtures/media/clip.webm');
  await expect(page.getByRole('alert').filter({ hasText: 'clip.webm: attach PNG' })).toBeVisible();
  const uploads: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/transfers$/.test(new URL(request.url()).pathname))
      uploads.push(request.url());
  });
  await page.getByLabel('Attach files', { exact: true }).setInputFiles('tests/fixtures/media/pixel.png');
  await expect(page.getByRole('alert').filter({ hasText: 'Choose Codex with GPT-5.4 mini' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start run', exact: true })).toBeDisabled();
  expect(uploads).toEqual([]);
  await page.getByRole('button', { name: 'Remove pixel.png', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('Attach files', { exact: true }).setInputFiles('tests/fixtures/media/document.pdf');
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(
    audit.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await page.screenshot({ path: 'test-results/media-attachments.png' });
  const accepted = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/v1/runs' && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Start run', exact: true }).click();
  const response = await accepted;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON().attachments).toEqual([
    expect.stringMatching(/^attachments\/[^/]+\/document.pdf$/),
  ]);
  await expect(page.getByRole('heading', { name: 'Work, completed.' })).toBeVisible({ timeout: 45000 });
  const outputs = page.getByRole('region', { name: 'Downloadable outputs' });
  await expect(outputs.getByRole('heading', { name: 'Files from this run' })).toBeVisible();
  const resultDownload = page.waitForEvent('download');
  await outputs.getByRole('button', { name: /outputs\/run-/ }).click();
  expect((await readFile((await (await resultDownload).path())!)).toString()).toContain(
    'Simulation completed',
  );
  await page.screenshot({ path: 'test-results/media-output.png' });
  await page.getByRole('button', { name: 'Continue conversation', exact: true }).click();
  await page.getByLabel('What would you like to get done?').fill('Describe the image.');
  await page.getByLabel('Attach files', { exact: true }).setInputFiles('tests/fixtures/media/pixel.png');
  await expect(page.getByRole('alert').filter({ hasText: 'For an existing conversation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start run', exact: true })).toBeDisabled();
  await page.goto('/docs/media');
  await expect(page.getByRole('heading', { name: 'Files and media', exact: true })).toBeVisible();
});
