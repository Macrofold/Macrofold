import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/browser';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse navigation', exact: true })).toBeVisible();
}

async function expectWidth(page: Page, width: number) {
  await expect(page.locator('#worktree-sidebar')).toHaveCSS('width', `${width}px`);
  await expect(page.locator('.main-shell')).toHaveCSS('margin-left', `${width}px`);
}

async function expectClosedMobileNavigation(page: Page) {
  const sidebar = page.locator('#worktree-sidebar');
  const opener = page.getByRole('button', { name: 'Open navigation', exact: true });
  await expect(sidebar).toHaveJSProperty('inert', true);
  await expect(opener).toHaveAttribute('aria-expanded', 'false');

  // Playwright 1.63 role locators ignore inert; inspect Chromium's actual accessibility tree.
  const session = await page.context().newCDPSession(page);
  try {
    const { root } = await session.send('DOM.getDocument');
    const { nodeId } = await session.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '#worktree-navigation',
    });
    expect(nodeId).toBeGreaterThan(0);
    await expect
      .poll(async () => {
        const { nodes } = await session.send('Accessibility.getPartialAXTree', {
          nodeId,
          fetchRelatives: false,
        });
        return nodes[0]?.ignored;
      })
      .toBe(true);
  } finally {
    await session.detach();
  }

  await opener.focus();
  await sidebar.getByRole('link', { name: 'Workspaces', exact: true, includeHidden: true }).focus();
  await expect(opener).toBeFocused();
  await opener.press('Shift+Tab');
  await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(opener).toBeFocused();
}

async function dragNavigation(page: Page, delta: number, cancel = false) {
  const separator = page.getByRole('separator', { name: 'Resize navigation', exact: true });
  const box = await separator.boundingBox();
  if (!box) throw new Error('Navigation resize handle is not visible');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(separator).toHaveAttribute('data-resizing', 'true');
  await page.mouse.move(x + delta, y, { steps: 5 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(separator).not.toHaveAttribute('data-resizing', 'true');
  await expect(page.locator('html')).not.toHaveCSS('cursor', 'col-resize');
}

async function audit(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.failureSummary),
    })),
  ).toEqual([]);
}

test('navigation collapse keeps labeled links, keyboard tooltips and account controls, and persists across pages', async ({
  page,
  context,
}) => {
  await signIn(page);
  await expectWidth(page, 234);
  await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
  const expand = page.getByRole('button', { name: 'Expand navigation', exact: true });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expectWidth(page, 64);
  await expect(page.getByRole('separator', { name: 'Resize navigation', exact: true })).toHaveCount(0);

  const workspaces = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Workspaces', exact: true });
  await workspaces.focus();
  await expect(page.getByRole('tooltip', { name: 'Workspaces', exact: true })).toBeVisible();
  await workspaces.press('Enter');
  await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible();
  await expect(workspaces).toHaveAttribute('aria-current', 'page');
  await expectWidth(page, 64);
  await page.reload();
  await expectWidth(page, 64);

  const account = page.getByRole('button', { name: 'Account menu', exact: true });
  await account.click();
  await expect(page.getByRole('group', { name: 'Appearance', exact: true })).toBeVisible();
  const organization = page.getByRole('menuitem', { name: 'Current organization', exact: true });
  await organization.focus();
  await organization.press('ArrowRight');
  const submenu = page.getByRole('menu', { name: 'Current organization', exact: true });
  await expect(submenu).toBeVisible();
  await expect(submenu.getByRole('menuitemradio', { checked: true })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(account).toBeFocused();

  const second = await context.newPage();
  try {
    await second.goto('/');
    await expectWidth(second, 64);
    await expand.click();
    await expectWidth(page, 234);
    await expectWidth(second, 234);
  } finally {
    await second.close();
  }
});

test('navigation drag and keyboard resizing preserve bounds and width, with reset and canceled drag', async ({
  page,
}) => {
  await signIn(page);
  const separator = page.getByRole('separator', { name: 'Resize navigation', exact: true });
  await expect(separator).toHaveAttribute('aria-valuenow', '234');
  await dragNavigation(page, 80);
  await expectWidth(page, 314);
  await dragNavigation(page, -64);
  await expectWidth(page, 250);
  await dragNavigation(page, 70, true);
  await expectWidth(page, 250);
  await page.reload();
  await expectWidth(page, 250);

  await separator.focus();
  await separator.press('ArrowRight');
  await expectWidth(page, 266);
  await separator.press('Shift+ArrowRight');
  await expectWidth(page, 330);
  await separator.press('End');
  await expectWidth(page, 360);
  await separator.press('ArrowRight');
  await expectWidth(page, 360);
  await separator.press('Home');
  await expectWidth(page, 220);
  await separator.press('ArrowLeft');
  await expectWidth(page, 220);
  await expect(separator).toHaveAttribute('aria-valuetext', '220 pixels');
  await separator.dblclick();
  await expectWidth(page, 234);
  await dragNavigation(page, 900);
  await expectWidth(page, 360);
  await dragNavigation(page, -300);
  await expectWidth(page, 220);

  await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
  await expectWidth(page, 64);
  await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
  await expectWidth(page, 220);
  await page.reload();
  await expectWidth(page, 220);
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} collapsed navigation remains accessible and mobile opens a full drawer with reachable account menu`, async ({
    page,
  }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('menuitemradio', { name: `Use ${theme} theme`, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await audit(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await audit(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await expectClosedMobileNavigation(page);
    await expect(page.locator('.main-shell')).toHaveCSS('margin-left', '0px');
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await expect(page.locator('#worktree-sidebar')).toHaveJSProperty('inert', false);
    await expect(page.locator('#worktree-sidebar')).toHaveCSS('width', '234px');
    await expect(page.locator('#worktree-sidebar')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    await expect(page.locator('.sidebar-collapse')).toBeHidden();
    await expect(page.getByRole('separator', { name: 'Resize navigation', exact: true })).toHaveCount(0);
    await expect(
      page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name: 'Workspaces', exact: true }),
    ).toBeVisible();
    const account = page.getByRole('button', { name: 'Account menu', exact: true });
    const box = await account.boundingBox();
    if (!box) throw new Error('Mobile account menu is not visible');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    await account.click();
    await expect(page.getByRole('group', { name: 'Appearance', exact: true })).toBeVisible();
    await audit(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Close navigation', exact: true })
      .click({ position: { x: 380, y: 300 } });
    await expectClosedMobileNavigation(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expectWidth(page, 64);
    await expect(page.locator('#worktree-sidebar')).toHaveJSProperty('inert', false);
    await expect(page.getByRole('button', { name: 'Expand navigation', exact: true })).toBeVisible();
  });
}

test('navigation ignores malformed stored preferences and stays usable when storage is blocked', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const read = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string) {
      if (key === 'macrofold.navigation.width') return 'not a width';
      if (key === 'macrofold.navigation.collapsed') return 'not a boolean';
      return read.call(this, key);
    };
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith('macrofold.navigation.'))
        throw new DOMException('Storage is disabled', 'SecurityError');
      write.call(this, key, value);
    };
  });
  await signIn(page);
  await expectWidth(page, 234);
  await page.getByRole('separator', { name: 'Resize navigation', exact: true }).press('End');
  await expectWidth(page, 360);
  await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
  await expectWidth(page, 64);
  await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
  await expectWidth(page, 360);
});
