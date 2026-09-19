import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures/browser';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
}

function navigationLink(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name, exact: true });
}

async function activeIconAnimations(link: Locator) {
  return link.locator(':scope > svg').evaluate((icon) =>
    icon
      .getAnimations({ subtree: true })
      .filter(
        (animation) =>
          animation instanceof CSSAnimation && animation.animationName.startsWith('sidebar-icon-'),
      )
      .map((animation) => ({
        name: (animation as CSSAnimation).animationName,
        iterations: animation.effect?.getTiming().iterations,
      })),
  );
}

test('every navigation icon animates once on hover, replays on reentry, and keeps its link geometry', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await signIn(page);
  const links = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link');
  for (const link of await links.all()) {
    await link.hover();
    const animations = await activeIconAnimations(link);
    expect(animations.length, (await link.getAttribute('aria-label')) || 'Navigation icon').toBeGreaterThan(
      0,
    );
    expect(animations.every((animation) => animation.iterations === 1)).toBe(true);
    await expect(link.locator(':scope > svg')).toHaveAttribute('aria-hidden', 'true');
  }

  await page.getByRole('heading', { name: 'Home', exact: true }).hover();
  const workspaces = navigationLink(page, 'Workspaces');
  await workspaces.scrollIntoViewIfNeeded();
  const before = await workspaces.boundingBox();
  await workspaces.hover();
  expect(await activeIconAnimations(workspaces)).toContainEqual({ name: 'sidebar-icon-folder', iterations: 1 });
  await workspaces.locator(':scope > svg').evaluate(async (icon) => {
    await Promise.all(icon.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
  expect(await activeIconAnimations(workspaces)).toEqual([]);
  expect(await workspaces.boundingBox()).toEqual(before);

  await page.getByRole('heading', { name: 'Home', exact: true }).hover();
  await workspaces.hover();
  expect(await activeIconAnimations(workspaces)).toContainEqual({ name: 'sidebar-icon-folder', iterations: 1 });
});

test('collapsed icons animate on keyboard focus while their tooltip and navigation remain usable', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await signIn(page);
  await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
  await page.keyboard.press('Tab');
  const workspaces = navigationLink(page, 'Workspaces');
  await workspaces.focus();
  expect(await activeIconAnimations(workspaces)).toContainEqual({ name: 'sidebar-icon-folder', iterations: 1 });
  await expect(page.getByRole('tooltip', { name: 'Workspaces', exact: true })).toBeVisible();
  await navigationLink(page, 'Home').focus();
  await workspaces.focus();
  expect(await activeIconAnimations(workspaces)).toContainEqual({ name: 'sidebar-icon-folder', iterations: 1 });
  await workspaces.press('Enter');
  await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible();
  await expect(workspaces).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#worktree-sidebar')).toHaveCSS('width', '64px');
});

test('dashboard playback overrides Reduce Motion and a paused choice persists', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page);
  await expect(page.locator('html')).toHaveAttribute('data-dashboard-motion', 'playing');
  const workspaces = navigationLink(page, 'Workspaces');
  await workspaces.hover();
  expect((await activeIconAnimations(workspaces)).length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Pause animations', exact: true }).click();
  await page.keyboard.press('Escape');
  await workspaces.hover();
  expect(await activeIconAnimations(workspaces)).toEqual([]);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dashboard-motion', 'paused');
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Play animations', exact: true }).click();
  await page.keyboard.press('Escape');
  await workspaces.hover();
  expect((await activeIconAnimations(workspaces)).length).toBeGreaterThan(0);
});
