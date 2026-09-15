import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect, fixtureOrigin } from '../fixtures/browser';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible();
}

async function openAppearance(page: Page) {
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Appearance', exact: true })).toBeVisible();
}

async function expectThemeSelection(page: Page, theme: 'light' | 'dark' | 'system') {
  await openAppearance(page);
  await expect(page.getByRole('menuitemradio', { name: `Use ${theme} theme`, exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
}

async function selectTheme(page: Page, theme: 'light' | 'dark' | 'system') {
  await openAppearance(page);
  const option = page.getByRole('menuitemradio', { name: `Use ${theme} theme`, exact: true });
  await option.click();
  await expect(option).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
}

async function audit(page: Page, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']);
  if (include) builder.include(include);
  const result = await builder.analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.failureSummary),
    })),
  ).toEqual([]);
}

test('appearance persists across navigation and refresh while system follows device changes', async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await signIn(page);
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expectThemeSelection(page, 'system');
  await selectTheme(page, 'dark');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expectThemeSelection(page, 'dark');
  await page.getByRole('link', { name: 'Connections', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expectThemeSelection(page, 'dark');
  await expect(root).toHaveAttribute('data-theme', 'dark');

  const second = await context.newPage();
  try {
    await second.goto('/projects');
    await expect(second.locator('html')).toHaveAttribute('data-theme', 'dark');
    await selectTheme(page, 'light');
    await expect(root).toHaveAttribute('data-theme', 'light');
    await expect(second.locator('html')).toHaveAttribute('data-theme', 'light');
    await expectThemeSelection(second, 'light');
  } finally {
    await second.close();
  }

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'light');
  await selectTheme(page, 'system');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expectThemeSelection(page, 'system');
  await expect(root).toHaveAttribute('data-theme', 'light');
});

test('changing editor appearance preserves the unsaved draft and its later persisted content', async ({
  page,
}) => {
  await signIn(page);
  const created = await page.request.post('/v1/projects', {
    headers: { Origin: fixtureOrigin, 'Idempotency-Key': randomUUID() },
    data: { name: 'Editor appearance ' + randomUUID() },
  });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('button', { name: 'New file', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'File path' }).fill('appearance.md');
  await page.getByRole('button', { name: 'Create file', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const editor = page.getByRole('textbox', { name: 'File editor' });
  await expect(editor).toBeEditable();
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await editor.fill('# Keep this draft\n\nA theme change must preserve these edits.');
  const dirty = page.getByRole('status').filter({ hasText: 'Unsaved changes' });
  await expect(dirty).toBeVisible();
  await selectTheme(page, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(editor).toContainText('A theme change must preserve these edits.');
  await expect(dirty).toBeVisible();
  await selectTheme(page, 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(editor).toContainText('# Keep this draft');
  await expect(dirty).toBeVisible();
  const fileUrl = `/v1/workspaces/${project.default_workspace_id}/file?path=appearance.md`;
  expect(await (await page.request.get(fileUrl)).text()).toBe('');
  await page.clock.runFor(2000);
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(await (await page.request.get(fileUrl)).text()).toBe(
    '# Keep this draft\n\nA theme change must preserve these edits.',
  );
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} theme keeps all core dashboard routes accessible on desktop and mobile`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await signIn(page);
    await selectTheme(page, theme);
    for (const [route, title] of [
      ['/runs', 'Runs'],
      ['/agents', 'Agent presets'],
      ['/connections', 'Connections'],
      ['/triggers', 'Triggers'],
      ['/scheduled-tasks', 'Scheduled tasks'],
      ['/api-keys', 'API keys'],
      ['/usage', 'Usage'],
      ['/billing', 'Billing'],
      ['/account', 'Account & security'],
      ['/team', 'Team & organization'],
    ]) {
      await test.step(`${route} preserves ${theme} appearance and accessible layout`, async () => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(route);
        const heading = page.getByRole('main').getByRole('heading', { name: title, exact: true, level: 1 });
        await expect(heading).toBeVisible();
        await expect(page.getByText('Loading workspace…', { exact: true })).toHaveCount(0);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await audit(page);
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(heading).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
        await audit(page);
      });
    }
  });

  test(`${theme} theme covers page surfaces, portaled forms and mobile assistant without overflow`, async ({
    page,
  }) => {
    await signIn(page);
    await selectTheme(page, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await audit(page);
    await page.screenshot({ path: `test-results/dashboard-home-${theme}.png`, fullPage: true });

    await page.getByRole('link', { name: 'Projects', exact: true }).click();
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    const projectDialog = page.getByRole('dialog');
    await expect(projectDialog).toBeVisible();
    await expect(projectDialog).toHaveCSS('color-scheme', theme);
    await expect(projectDialog).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(projectDialog.getByRole('textbox', { name: 'Project name' })).toBeVisible();
    await projectDialog.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    await expect(projectDialog).toHaveCSS('opacity', '1');
    await audit(page, '[role="dialog"]');
    await page.keyboard.press('Escape');
    await expect(projectDialog).toHaveCount(0);

    await page.goto('/');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
    await audit(page);
    await page.getByRole('button', { name: 'Ask Macrofold', exact: true }).click();
    const assistant = page.getByRole('dialog', { name: 'Macrofold assistant Preview' });
    await expect(assistant).toBeVisible();
    await expect(assistant).toHaveCSS('color-scheme', theme);
    await expect(assistant).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const box = await assistant.boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error('Assistant has no visible bounds');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    await audit(page, '[role="dialog"]');
    await page.screenshot({ path: `test-results/dashboard-assistant-mobile-${theme}.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Ask Macrofold', exact: true })).toBeFocused();
  });
}

test('appearance remains usable when browser preference storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const read = Storage.prototype.getItem;
    const write = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key: string) {
      if (key === 'macrofold.theme') throw new DOMException('Storage is disabled', 'SecurityError');
      return read.call(this, key);
    };
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'macrofold.theme') throw new DOMException('Storage is disabled', 'SecurityError');
      write.call(this, key, value);
    };
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await signIn(page);
  await selectTheme(page, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectThemeSelection(page, 'dark');
  await selectTheme(page, 'system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('mobile account menu supports keyboard appearance controls and organization submenu', async ({
  page,
}) => {
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  const account = page.getByRole('button', { name: 'Account menu', exact: true });
  await expect(account).toBeVisible();
  const accountBounds = await account.boundingBox();
  if (!accountBounds) throw new Error('Account menu is not visible');
  expect(accountBounds.y + accountBounds.height).toBeLessThanOrEqual(844);
  await openAppearance(page);
  const light = page.getByRole('menuitemradio', { name: 'Use light theme', exact: true });
  const dark = page.getByRole('menuitemradio', { name: 'Use dark theme', exact: true });
  await light.focus();
  await light.press('ArrowRight');
  await expect(dark).toBeFocused();
  await dark.press('Space');
  await expect(dark).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('group', { name: 'Appearance', exact: true })).toBeVisible();
  await audit(page);

  const organizations = page.getByRole('menuitem', { name: 'Current organization', exact: true });
  await organizations.focus();
  await organizations.press('ArrowRight');
  const submenu = page.getByRole('menu', { name: 'Current organization', exact: true });
  await expect(submenu).toBeVisible();
  await expect(submenu.getByRole('menuitemradio', { checked: true })).toHaveCount(1);
  const submenuBounds = await submenu.boundingBox();
  if (!submenuBounds) throw new Error('Organization submenu is not visible');
  expect(submenuBounds.x).toBeGreaterThanOrEqual(0);
  expect(submenuBounds.x + submenuBounds.width).toBeLessThanOrEqual(390);
  expect(submenuBounds.y + submenuBounds.height).toBeLessThanOrEqual(844);
  await audit(page);
  await page.screenshot({
    path: test.info().outputPath('mobile-account-workspaces.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(account).toBeFocused();
  await account.click();
  await organizations.click();
  await submenu.getByRole('menuitemradio', { checked: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
});
