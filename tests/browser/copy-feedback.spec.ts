import type { Page } from '@playwright/test';
import { test, expect, fixtureOrigin } from '../fixtures/browser';
import { examples } from '../../apps/web/components/landing/examples';

type CopyMotion = { property: string; frames: number[]; state: string }[];

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`${reducedMotion}: copy retains its label and check, copies again, and resets for changed content`, async ({
    page,
    context,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto('/site', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Pause animations', exact: true }).click();
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: fixtureOrigin });
    const copy = page.getByRole('button', { name: 'Copy code example', exact: true });
    const icon = copy.locator('.copy-feedback-icon');
    const check = icon.locator('.copy-feedback-check');
    const before = await copy.boundingBox();
    await copy.evaluate((button) => {
      const observer = new MutationObserver(() => {
        if (button.getAttribute('data-copy-state') !== 'copied') return;
        const motion: CopyMotion = [];
        for (const [selector, property, frameKey] of [
          ['.copy-feedback-check', 'opacity', 'opacity'],
          ['.copy-feedback-check path', 'stroke-dashoffset', 'strokeDashoffset'],
        ] as const) {
          const element = button.querySelector(selector);
          for (const animation of element?.getAnimations() || []) {
            if (!(animation instanceof CSSTransition) || animation.transitionProperty !== property) continue;
            if (!(animation.effect instanceof KeyframeEffect)) continue;
            motion.push({
              property,
              frames: animation.effect
                .getKeyframes()
                .map((frame) => Number.parseFloat(String(frame[frameKey]))),
              state: animation.playState,
            });
          }
        }
        Object.defineProperty(button, 'copyMotion', { value: motion, configurable: true });
        observer.disconnect();
      });
      observer.observe(button, { attributes: true, attributeFilter: ['data-copy-state'] });
    });
    await copy.click();
    await expect(copy).toHaveAttribute('data-copy-state', 'copied');
    await expect(copy).toHaveAccessibleName('Copy code example');
    await expect(copy.getByRole('status')).toHaveText('Copied to clipboard');
    await expect(check).toHaveCSS('opacity', '1');
    await expect(check.locator('path')).toHaveCSS('stroke-dashoffset', '0px');
    // Capture real running transitions at the state change, rather than only declared CSS durations.
    const motion = await copy.evaluate(
      (button) => (button as HTMLElement & { copyMotion?: CopyMotion }).copyMotion,
    );
    expect(motion).toContainEqual({ property: 'opacity', frames: [0, 1], state: 'running' });
    if (reducedMotion === 'no-preference')
      expect(motion).toContainEqual({ property: 'stroke-dashoffset', frames: [1, 0], state: 'running' });
    else expect(motion?.some(({ property }) => property === 'stroke-dashoffset')).toBe(false);
    if (reducedMotion === 'reduce') await expect(check).toHaveCSS('transform', 'none');
    const after = await copy.boundingBox();
    expect(before).not.toBeNull();
    expect(after?.width).toBe(before?.width);
    expect(after?.height).toBe(before?.height);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(examples.TypeScript);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);

    await page.clock.install();
    await page.clock.fastForward(60_000);
    await expect(copy).toHaveAttribute('data-copy-state', 'copied');
    await expect(icon).toHaveAttribute('data-copied', 'true');
    // A checked button must perform a new write, even if another app replaced the clipboard.
    await page.evaluate(() => navigator.clipboard.writeText('Replaced clipboard fixture'));
    await copy.click();
    await expect(copy).toBeEnabled();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(examples.TypeScript);
    await expect(icon).toHaveAttribute('data-copied', 'true');

    await page.getByRole('tab', { name: 'Python', exact: true }).click();
    await expect(copy).toHaveAttribute('data-copy-state', 'idle');
    await expect(icon).toHaveAttribute('data-copied', 'false');
    await copy.click();
    await expect(copy).toHaveAttribute('data-copy-state', 'copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(examples.Python);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  });
}

type ClipboardFixture = { complete: (accepted: boolean) => void; settled: Promise<void> };

async function deferClipboard(page: Page) {
  await page.evaluate(() => {
    const fixture: ClipboardFixture = { complete: () => {}, settled: Promise.resolve() };
    Object.defineProperty(window, 'copyFixture', { configurable: true, value: fixture });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => {
          fixture.settled = new Promise<void>((resolve, reject) => {
            fixture.complete = (accepted) => (accepted ? resolve() : reject(new Error('Clipboard denied')));
          });
          return fixture.settled;
        },
      },
    });
  });
}

async function completeClipboard(page: Page, accepted: boolean) {
  await page.evaluate(async (accepted) => {
    const fixture = (window as Window & { copyFixture?: ClipboardFixture }).copyFixture;
    if (!fixture) throw new Error('Clipboard fixture was not installed');
    fixture.complete(accepted);
    await fixture.settled.catch(() => {});
    // Let the settled clipboard promise and React's resulting render finish.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, accepted);
}

test('a pending clipboard write cannot confirm different content or a changed-back value', async ({
  page,
}) => {
  await page.goto('/site', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Pause animations', exact: true }).click();
  await deferClipboard(page);
  const copy = page.getByRole('button', { name: 'Copy code example', exact: true });
  await copy.click();
  await expect(copy).toBeDisabled();
  await expect(copy).toHaveAttribute('aria-busy', 'true');
  await expect(copy.locator('.copy-feedback-icon')).toHaveAttribute('data-copied', 'false');
  await page.getByRole('tab', { name: 'Python', exact: true }).click();
  await expect(copy).toBeEnabled();
  await page.getByRole('tab', { name: 'TypeScript', exact: true }).click();
  await completeClipboard(page, true);
  await expect(copy).toHaveAttribute('data-copy-state', 'idle');
  await expect(copy.locator('.copy-feedback-icon')).toHaveAttribute('data-copied', 'false');
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
});

test('a checked button stays checked while copying again, then reports denial and recovers truthfully', async ({
  page,
}) => {
  await page.goto('/docs/agents');
  const region = page.getByRole('region', { name: 'Setup prompt', exact: true });
  const copy = page.locator('.docs-prompt-block').getByRole('button', { name: 'Copy prompt', exact: true });
  const source = await region.innerText();
  await deferClipboard(page);
  await copy.click();
  await completeClipboard(page, true);
  await expect(copy).toHaveAttribute('data-copy-state', 'copied');
  await copy.click();
  await expect(copy).toHaveAttribute('data-copy-state', 'copying');
  await expect(copy.locator('.copy-feedback-icon')).toHaveAttribute('data-copied', 'true');
  await completeClipboard(page, false);
  await expect(copy).toHaveAttribute('data-copy-state', 'error');
  await expect(copy).toHaveAccessibleName('Copy prompt');
  await expect(copy).toBeEnabled();
  await expect(copy).toHaveAccessibleDescription('Clipboard unavailable. Select and copy the text manually.');
  await expect(copy.locator('.copy-feedback-icon')).toHaveAttribute('data-copied', 'false');
  await expect(copy.getByRole('status')).toHaveText(
    'Clipboard unavailable. Select and copy the text manually.',
  );
  await expect(region).toHaveText(source);
  await copy.click();
  await completeClipboard(page, true);
  await expect(copy).toHaveAttribute('data-copy-state', 'copied');
  await expect(copy).toHaveAccessibleName('Copy prompt');
  await expect(copy).toHaveAccessibleDescription('');
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
});

for (const accepted of [true, false]) {
  test(`an unmounted copy control ignores late ${accepted ? 'success' : 'failure'}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/docs/agents');
    await deferClipboard(page);
    await page
      .locator('.docs-prompt-block')
      .getByRole('button', { name: 'Copy prompt', exact: true })
      .click();
    await page
      .getByRole('navigation', { name: 'Documentation navigation', exact: true })
      .getByRole('link', { name: 'Quickstart', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Quickstart', exact: true })).toBeVisible();
    await completeClipboard(page, accepted);
    await expect(page.locator('[data-copy-state="copied"], [data-copy-state="error"]')).toHaveCount(0);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
