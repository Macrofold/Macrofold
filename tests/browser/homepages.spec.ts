import AxeBuilder from '@axe-core/playwright';
import { test, expect, fixtureOrigin } from '../fixtures/browser';
import { headline, subtitle, homepages, stages } from '../../apps/web/components/homepages/catalog';
import { examples } from '../../apps/web/components/homepages/examples';

for (const study of homepages) {
  test(`${study.name} has working code, feature diagrams, and mobile layout`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/homepages/${study.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(headline);
    await expect(page.locator('.hp-subtitle')).toHaveText(subtitle);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    expect(
      await page
        .locator('#code')
        .evaluate((element) =>
          Boolean(
            element.compareDocumentPosition(document.querySelector('#how-it-works')!) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        ),
    ).toBe(true);
    const image = page.locator('.hp-hero-visual img');
    await expect.poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({ path: test.info().outputPath(`${study.slug}-hero.png`) });
    await page.getByRole('tab', { name: 'Python', exact: true }).click();
    await expect(page.locator('.hp-snippet').getByRole('tabpanel')).toContainText(
      'from macrofold import Macrofold',
    );
    await page.getByRole('tab', { name: 'Python', exact: true }).press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'cURL', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('.hp-snippet').getByRole('tabpanel')).toContainText('Idempotency-Key');

    if (study.story === 'scroll') {
      // Actual scrolling, without using the stage buttons, must update the shared diagram.
      for (const index of [1, 2, 4, 0, 4]) {
        await page
          .locator(`[data-feature-step="${index}"]`)
          .evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await expect(page.locator('.hp-story-sticky .hp-diagram')).toHaveAttribute(
          'data-stage',
          String(index),
        );
      }
    } else if (study.story !== 'chapters') {
      await page.getByRole('tab', { name: /In your product/ }).click();
      await expect(page.locator('.hp-story-tabs .hp-diagram')).toHaveAttribute('data-stage', '4');
    } else {
      await expect(page.locator('.hp-chapter')).toHaveCount(5);
      await page.locator('.hp-chapter').last().scrollIntoViewIfNeeded();
    }
    const routing = page.locator('.hp-diagram[data-stage="4"]');
    await routing.getByRole('button', { name: 'CLI', exact: true }).click();
    await expect(routing).toContainText('CLI → OpenCode workspaces');
    await expect(routing.locator('.hp-tree-selected')).toHaveCount(1);
    for (const icon of await routing.locator('.hp-input-picker svg').all()) {
      await expect(icon).toHaveCSS('width', '14px');
      await expect(icon).toHaveCSS('height', '14px');
    }
    await page.getByRole('button', { name: 'Pause animations', exact: true }).click();
    await expect(page.locator('.hp-page')).toHaveAttribute('data-motion', 'paused');
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(
      audit.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, reason: n.failureSummary })),
      })),
    ).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`${study.slug}-desktop.png`), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
    if (study.story !== 'chapters') {
      await page.getByRole('tab', { name: /Persistence & Git/ }).click();
      await expect(page.locator('.hp-story-tabs .hp-diagram')).toHaveAttribute('data-stage', '2');
      await expect(page.locator('.hp-story-tabs').getByRole('tablist')).toHaveAttribute(
        'aria-orientation',
        'horizontal',
      );
      await expect(page.locator('.hp-story-sticky')).toHaveCount(0);
      await page.locator('.hp-story-tabs').getByRole('heading', { level: 3 }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath(`${study.slug}-mobile-feature.png`) });
    }
    await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('link', { name: 'Get started', exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`${study.slug}-mobile.png`), fullPage: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.locator('.hp-page').evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(
      0,
    );
    expect(errors).toEqual([]);
  });
}

test('homepage navigation preserves the original gallery and examples copy without line numbers', async ({
  page,
  context,
}) => {
  await page.goto('/homepages');
  await expect(page.locator('.hp-gallery-card')).toHaveCount(10);
  await page.getByRole('link', { name: /Explore Foundation/ }).click();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  try {
    for (const operation of ['Run', 'Stream', 'Continue'] as const) {
      await page.getByRole('button', { name: new RegExp(`^0[123] ${operation}$`) }).click();
      await page.getByRole('button', { name: 'Copy code example' }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(examples.TypeScript[operation]);
    }
  } finally {
    await context.clearPermissions();
  }
  await page.getByRole('link', { name: 'Next version →', exact: true }).click();
  await expect(page).toHaveURL(/\/homepages\/immersion$/);
  await page.getByRole('link', { name: '← All homepage studies', exact: true }).click();
  await page.getByRole('link', { name: /Original.*designs/i }).click();
  await expect(page.locator('.concept-gallery-card')).toHaveCount(10);
  expect((await page.request.get('/homepages/not-a-homepage')).status()).toBe(404);
});

test('feature steps work by keyboard and without JavaScript', async ({ page, browser }) => {
  await page.goto('/homepages/sequence');
  await expect(page.getByRole('button', { name: 'Previous feature' })).toBeDisabled();
  for (let i = 1; i < 5; i++) await page.getByRole('button', { name: 'Next feature' }).click();
  await expect(page.getByRole('button', { name: 'Next feature' })).toBeDisabled();
  await page.getByRole('tab', { name: /In your product/ }).press('Home');
  await expect(page.getByRole('tab', { name: '01 Project', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const plain = await context.newPage();
    await plain.goto(`${fixtureOrigin}/homepages/precision`);
    await expect(plain.getByRole('heading', { level: 1 })).toHaveText(headline);
    await expect(plain.locator('.hp-snippet')).toContainText('macrofold.runs.create(');
    for (const stage of stages.slice(1))
      await expect(plain.locator('.hp-no-script')).toContainText(stage.title);
  } finally {
    await context.close();
  }
});
