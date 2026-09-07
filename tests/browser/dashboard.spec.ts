import { test, expect, fixtureOrigin } from '../fixtures/browser';
import AxeBuilder from '@axe-core/playwright';
test('dashboard → persistent files → streamed run → history', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make room for your next idea.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your projects', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/overview-desktop.png', fullPage: true });
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const name = `Browser workspace ${Date.now()}`;
  await page.getByRole('textbox', { name: 'Project name' }).fill(name);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await page.getByRole('button', { name: 'Open in CLI', exact: true }).click();
  const handoff = page.getByRole('dialog');
  await expect(handoff).toContainText(`agent login --host '${fixtureOrigin}'`);
  await expect(handoff).toContainText('agent link ');
  await expect(handoff).toContainText('--workspace');
  await expect(handoff).not.toContainText('Bearer');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'New file', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'File path' }).fill('hello.md');
  await page.getByRole('button', { name: 'Create file', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toBeEditable();
  await page
    .locator('.cm-content')
    .fill('# Persisted from the browser\n\nThis file should survive agent execution.');
  // Hold the post-save file refresh: the write is done, but this editor still owns the pending action.
  let releaseRefresh!: () => void;
  let refreshStarted!: () => void;
  const refresh = new Promise<void>((resolve) => {
    refreshStarted = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const fileURL = '**/v1/workspaces/*/file?path=hello.md';
  await page.route(fileURL, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    refreshStarted();
    await gate;
    await route.continue();
  });
  try {
    await refresh;
    await expect(page.getByRole('button', { name: 'New file', exact: true }).first()).toBeDisabled();
    await expect(page.getByRole('button', { name: 'hello.md', exact: true })).toBeDisabled();
    await expect(page.locator('.cm-content')).toContainText('Persisted from the browser');
  } finally {
    releaseRefresh();
    await page.unrouteAll({ behavior: 'wait' });
  }
  await expect(page.getByRole('button', { name: 'New file', exact: true }).first()).toBeEnabled();
  await expect(page.locator('.cm-content')).toContainText('Persisted from the browser');
  await page.getByRole('button', { name: 'New file', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'File path' }).fill('hello.md');
  await page.getByRole('button', { name: 'Create file', exact: true }).click();
  await expect(
    page.getByText('A file already exists at this path. Choose another name or edit the existing file.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('Persisted from the browser');

  await page.getByRole('button', { name: 'New run', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'What would you like to get done?' })
    .fill('Review the project and record progress.');
  await page.getByRole('button', { name: 'Start run', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Work, completed.' })).toBeVisible({ timeout: 45000 });
  await expect(page.locator('.markdown-output')).toContainText('Simulation completed');
  await page.screenshot({ path: 'test-results/run-desktop.png', fullPage: true });
  await page.getByRole('tab', { name: /Tool calls/ }).click();
  await expect(page.getByText('tool.started').first()).toBeVisible();
  await page.getByRole('tab', { name: /Events/ }).click();
  await expect(page.getByText('run.succeeded', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'main', exact: true }).click();
  await page.getByRole('button', { name: 'hello.md', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('Persisted from the browser');
  await page.getByRole('tab', { name: 'Checkpoints', exact: true }).click();
  await expect(page.getByText('Latest checkpoint', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Git sync', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your files already have a history.' })).toBeVisible();
  await expect(page.getByText('Versioned on main')).toBeVisible();
  await page.getByRole('button', { name: 'Connect GitHub', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Authorize GitHub' })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.screenshot({ path: 'test-results/git-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/project-mobile.png', fullPage: true });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  expect(errors).toEqual([]);
  expect(audit.violations.map((v) => ({ id: v.id, impact: v.impact, count: v.nodes.length }))).toEqual([]);
});
