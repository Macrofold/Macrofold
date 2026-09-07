import { test, expect } from '../fixtures/browser';
import AxeBuilder from '@axe-core/playwright';
import { concepts } from '../../apps/web/components/concepts/catalog';

for (const concept of concepts) {
  test(`${concept.name} explains the product and works on desktop and mobile`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/concepts/${concept.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(concept.title.replace('\n', ''));
    await expect(page.locator('.concept-description')).toContainText('Claude Code, Codex, and OpenCode');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await page.getByRole('tab', { name: 'Python', exact: true }).click();
    await expect(page.locator('.concept-code').getByRole('tabpanel')).toContainText(
      'from macrofold import Client',
    );
    await page.getByRole('tab', { name: 'Python', exact: true }).press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'cURL', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('.concept-code').getByRole('tabpanel')).toContainText('Idempotency-Key');
    const art = page.getByRole('img', { name: concept.art, exact: true });
    await expect(art).toBeVisible();
    await expect
      .poll(() => art.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    const motion = page.getByRole('button', { name: `${concept.name} animation concept`, exact: true });
    await motion.focus();
    await expect(page.locator('.concept-study-note')).toBeVisible();
    await expect(page.locator('.concept-study-note')).toContainText(concept.animation);
    await motion.press('Escape');
    await expect(page.locator('.concept-study-note')).toBeHidden();
    await page.getByRole('tab', { name: /Keep$/ }).click();
    await expect(page.locator('.concept-flow').getByRole('tabpanel')).toContainText('checkpoint outcome');
    await page.getByRole('tab', { name: /Keep$/ }).press('ArrowRight');
    await expect(page.locator('.concept-flow').getByRole('tabpanel')).toContainText(
      'Git conflicts stay visible',
    );
    await page.getByRole('button', { name: 'Pause motion' }).click();
    await expect(page.locator('.concept-site')).toHaveAttribute('data-motion', 'paused');
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(audit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.failureSummary) }))).toEqual(
      [],
    );
    await page.screenshot({ path: test.info().outputPath(`${concept.slug}-desktop.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
    await expect(page.getByRole('link', { name: 'Run it locally', exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`${concept.slug}-mobile.png`), fullPage: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(
      await page.locator('.concept-art').evaluate((el) => el.getAnimations({ subtree: true }).length),
    ).toBe(0);
    expect(errors).toEqual([]);
  });
}

test('concept gallery navigation, copying and unknown routes are honest', async ({ page, context }) => {
  await page.goto('/concepts');
  await expect(page.locator('.concept-gallery-card')).toHaveCount(10);
  await page.getByRole('link', { name: 'Explore Aurum', exact: true }).click();
  await expect(page).toHaveURL(/\/concepts\/aurum$/);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy code example' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("agent.request('createRun'");
  await context.clearPermissions();
  await page.getByRole('link', { name: 'Next concept →', exact: true }).click();
  await expect(page).toHaveURL(/\/concepts\/eigen$/);
  await page.getByRole('link', { name: '← All 10 concepts', exact: true }).click();
  await expect(page).toHaveURL(/\/concepts$/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  expect((await page.request.get('/concepts/not-a-concept')).status()).toBe(404);
});

test('concepts remain readable without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto((process.env.APP_ORIGIN || 'http://localhost:3210') + '/concepts/aurum');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Powerful agents.');
    await expect(page.getByRole('link', { name: 'Run it locally', exact: true })).toHaveAttribute(
      'href',
      '/docs/local-development',
    );
    await expect(page.locator('.concept-code').getByRole('tabpanel')).toContainText('createRun');
    await expect(page.locator('.concept-study-fallback')).toContainText('Proposed animation:');
  } finally {
    await context.close();
  }
});

test('animation notes support hover, dismissal, and touch without navigating the gallery', async ({
  page,
  browser,
}) => {
  await page.goto('/concepts');
  const card = page.locator('.concept-gallery-card').first();
  await card.locator('.concept-art').hover();
  await expect(card.locator('.concept-study-note')).toBeVisible();
  await card.locator('.concept-study-note').hover();
  await expect(card.locator('.concept-study-note')).toBeVisible();
  await page.getByRole('heading', { level: 1 }).hover();
  await expect(card.locator('.concept-study-note')).toBeHidden();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    const touch = await context.newPage();
    await touch.goto((process.env.APP_ORIGIN || 'http://localhost:3210') + '/concepts');
    const first = touch.getByRole('button', { name: 'Aurum animation concept' });
    await first.tap();
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    const note = touch.locator('.concept-study-note').first();
    await expect(note).toBeVisible();
    expect(
      await note.evaluate((element) => {
        const number = element.closest('.concept-card-image')!.querySelector('.concept-card-number')!;
        const bounds = number.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
        );
      }),
    ).toBe(true);
    await expect(touch).toHaveURL(/\/concepts$/);
    await first.tap();
    await expect(first).toHaveAttribute('aria-expanded', 'false');
  } finally {
    await context.close();
  }
});
