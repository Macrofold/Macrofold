import { randomUUID } from 'node:crypto';
import { test, expect, fixtureOrigin } from '../fixtures/browser';

test('composite fields have one focus indicator, subtle border motion, and hidden scrollbars', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const task = page.getByRole('textbox', { name: 'Describe your task' });
  await task.fill('Keep this task while opening other controls.');
  await expect(task).toHaveCSS('outline-style', 'none');
  await expect(task).toHaveCSS('box-shadow', 'none');
  const composer = page.locator('.welcome-composer');
  await expect(composer).not.toHaveCSS('box-shadow', 'none');
  await expect(composer).toHaveCSS('animation-name', 'welcome-border-drift');
  const initialAngle = await composer.evaluate((element) =>
    getComputedStyle(element).getPropertyValue('--welcome-border-angle'),
  );
  await expect
    .poll(() =>
      composer.evaluate((element) => getComputedStyle(element).getPropertyValue('--welcome-border-angle')),
    )
    .not.toBe(initialAngle);
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await expect(page.getByRole('menu').first()).toHaveCSS('animation-duration', '0.16s');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(task).toHaveValue('Keep this task while opening other controls.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Pause animations', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(composer).toHaveCSS('animation-name', 'none');
  await task.focus();
  await expect(composer).not.toHaveCSS('box-shadow', 'none');
  await expect(page.locator('.sidebar')).toHaveCSS('scrollbar-width', 'none');
  await page.setViewportSize({ width: 1280, height: 500 });
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.move(950, 430);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
  await expect(page.locator('html')).toHaveCSS('scrollbar-width', 'none');

  await page.goto('/workspaces');
  const search = page.getByRole('textbox', { name: 'Search workspaces' });
  await search.fill('');
  await expect(search).toHaveCSS('box-shadow', 'none');
  await expect(page.locator('.search-input')).not.toHaveCSS('box-shadow', 'none');
  await page.getByRole('button', { name: 'New workspace', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Workspace name', exact: true });
  await name.fill('Focus inspection only');
  await expect(name).toHaveCSS('outline-style', 'none');
  await expect(name).not.toHaveCSS('box-shadow', 'none');
  await page.keyboard.press('Escape');
});

test('waiting labels shimmer accessibly and actual save toasts transition quickly', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Pause animations', exact: true }).click();
  await page.keyboard.press('Escape');
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/v1/workspaces?*', async (route) => {
    await pending;
    await route.continue();
  });
  await page.goto('/workspaces');
  const waiting = page
    .getByRole('status')
    .filter({ hasText: /^Loading…$/ })
    .locator('.waiting-text');
  try {
    await expect(waiting).toBeVisible();
    await expect(waiting).toHaveCSS('animation-name', 'waiting-sheen');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(waiting).toHaveCSS('animation-name', 'none');
    await expect(waiting).not.toHaveCSS('-webkit-text-fill-color', 'rgba(0, 0, 0, 0)');
  } finally {
    release();
  }
  await expect(waiting).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const created = await page.request.post('/v1/workspaces', {
    headers: { Origin: fixtureOrigin, 'Idempotency-Key': randomUUID() },
    data: { name: 'Interaction fixture ' + randomUUID() },
  });
  expect(created.ok()).toBe(true);
  const workspace = await created.json();
  await page.goto(`/workspaces/${workspace.id}`);
  await page.getByRole('button', { name: 'New file', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'File path' }).fill('motion.md');
  await page.getByRole('button', { name: 'Create file', exact: true }).click();
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'File created and checkpointed' });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveCSS('transition-duration', '0.18s, 0.16s, 0.18s, 0.16s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(toast).toHaveCSS('transition-duration', '0.16s');
  await expect(toast).toHaveCSS(
    'transition-property',
    'color, background-color, border-color, box-shadow, opacity',
  );
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} busy primary action keeps every sheen color readable until its request settles`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'no-preference' });
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Pause animations', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.goto('/workspaces');
    // The fetched grid confirms the lazily loaded view is interactive after a full navigation.
    await expect(page.getByRole('region', { name: 'Workspace list', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New workspace', exact: true }).click();
    const workspaceName = `Busy contrast ${theme} ${randomUUID()}`;
    await page.getByRole('textbox', { name: 'Workspace name', exact: true }).fill(workspaceName);

    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/v1/workspaces', async (route) => {
      if (route.request().method() === 'POST') await pending;
      await route.continue();
    });
    const create = page.getByRole('button', { name: 'Create workspace', exact: true });
    const waiting = create.locator('.waiting-text');
    try {
      await create.click();
      await page.mouse.move(0, 0);
      await expect(create).toHaveAttribute('aria-busy', 'true');
      await expect(create).toBeDisabled();
      await expect(create).toHaveCSS('opacity', '1');
      await expect(waiting).toHaveCSS('animation-name', 'waiting-sheen');
      const contrast = await waiting.evaluate((element) => {
        const style = getComputedStyle(element);
        const button = element.closest('button');
        if (!button) throw new Error('Waiting label is outside its action');
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas color conversion is unavailable');
        const luminance = (color: string) => {
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        };
        // Split gradient stops outside color functions, including resolved color-mix values.
        const stops: string[] = [];
        let depth = 0;
        let start = style.backgroundImage.indexOf('(') + 1;
        for (let index = start; index < style.backgroundImage.length - 1; index++) {
          const character = style.backgroundImage[index];
          if (character === '(') depth++;
          if (character === ')') depth--;
          if (character === ',' && depth === 0) {
            stops.push(style.backgroundImage.slice(start, index));
            start = index + 1;
          }
        }
        stops.push(style.backgroundImage.slice(start, -1));
        const background = luminance(getComputedStyle(button).backgroundColor);
        return stops.slice(1).map((stop) => {
          const foreground = luminance(stop.trim().replace(/\s+[\d.]+%$/, ''));
          return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        });
      });
      expect(contrast).toHaveLength(3);
      expect(Math.min(...contrast)).toBeGreaterThanOrEqual(4.5);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(waiting).toHaveCSS('animation-name', 'none');
      await expect(waiting).toHaveCSS('background-image', 'none');
      const solidColor = await waiting.evaluate((element) => getComputedStyle(element).color);
      await expect(waiting).toHaveCSS('-webkit-text-fill-color', solidColor);
      await expect(create).toHaveAttribute('aria-busy', 'true');
    } finally {
      release();
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: workspaceName, exact: true })).toBeVisible();
  });
}
