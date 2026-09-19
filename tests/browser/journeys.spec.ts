import AxeBuilder from '@axe-core/playwright';
import { test, expect, fixtureOrigin } from '../fixtures/browser';
import { headline, journeys, pillars, subtitle, useCases } from '../../apps/web/components/journeys/catalog';
import { examples } from '../../apps/web/components/journeys/examples';
import snapshot from '../../packages/providers/data/connector-catalog.json' with { type: 'json' };

for (const study of journeys) {
  test(`${study.name}: approved copy, evolving diagram, logos, and responsive controls`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/journeys/${study.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(headline);
    await expect(page.locator('.jl-subtitle')).toHaveText(subtitle);
    for (const link of await page.getByRole('link', { name: 'Start building', exact: true }).all())
      await expect(link).toHaveAttribute('href', '/register');
    await expect(
      page.locator('.jl-hero').getByRole('link', { name: 'View docs', exact: true }),
    ).toHaveAttribute('href', '/docs');
    await expect(page.locator('.jl-subtitle img')).toHaveCount(3);
    for (const image of await page.locator('.jl-hero img').all())
      await expect
        .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
    await page.screenshot({ path: test.info().outputPath(`${study.slug}-hero.png`) });
    await page.getByRole('tab', { name: 'Go', exact: true }).click();
    await expect(page.locator('.jl-code-panel').getByRole('tabpanel')).toContainText('client.Runs.Stream');
    await page.getByRole('tab', { name: 'Go', exact: true }).press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Rust', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    for (const stage of [1, 2, 3, 4, 0]) {
      await page
        .locator(`[data-journey-step="${stage}"]`)
        .evaluate((el) => el.scrollIntoView({ block: 'center' }));
      if (study.layout !== 'chapters')
        await expect(page.locator('.jl-sticky .jl-diagram')).toHaveAttribute('data-stage', String(stage));
    }
    const saved =
      study.layout === 'chapters'
        ? page.locator('.jl-diagram[data-stage="2"]')
        : page.locator('.jl-sticky .jl-diagram');
    if (study.layout !== 'chapters')
      await page.locator('[data-journey-step="2"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect(saved.locator('.jl-saved')).toHaveCount(3);
    await page.screenshot({
      path: test.info().outputPath(`${study.slug}-worktree.png`),
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Pause animations', exact: true }).click();
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(
      audit.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, reason: n.failureSummary })),
      })),
    ).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
    await page.getByRole('tab', { name: pillars[4].label, exact: true }).click();
    await expect(page.locator('.jl-compact-story .jl-diagram')).toHaveAttribute('data-stage', '4');
    await page.screenshot({ path: test.info().outputPath(`${study.slug}-mobile-story.png`) });
    await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`${study.slug}-mobile-hero.png`) });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.locator('.jl-page').evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(
      0,
    );
    expect(errors).toEqual([]);
  });
}

test('switching use cases replaces prompts, context, and connector examples; copying combines run and stream', async ({
  page,
  context,
}) => {
  await page.goto('/journeys/fanout');
  for (const example of useCases) {
    await page.getByRole('button', { name: example.label, exact: true }).click();
    await expect(page.locator('.jl-incoming')).toContainText(example.prompt);
    await expect(page.locator('.jl-sticky .jl-diagram')).toHaveAttribute('data-case', example.id);
    await page.locator('[data-journey-step="3"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect(page.locator('.jl-sticky .jl-input-badge')).toHaveCount(4);
    await page.locator('[data-journey-step="4"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect(page.locator('.jl-connector-node')).toHaveCount(6);
    expect(
      await page
        .locator('.jl-connector-node image')
        .evaluateAll((els) => els.map((el) => el.getAttribute('href'))),
    ).toEqual(example.brands.map((brand) => `/brands/${brand}.svg`));
  }
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  try {
    await page.getByRole('button', { name: 'Copy code example' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(examples.TypeScript);
  } finally {
    await context.clearPermissions();
  }
});

test('new gallery preserves older libraries and unknown pages return 404', async ({ page }) => {
  await page.goto('/journeys');
  await expect(page.locator('.jl-gallery-grid>article')).toHaveCount(10);
  await page.getByRole('link', { name: 'Explore Fanout', exact: true }).click();
  await expect(page).toHaveURL(/\/journeys\/fanout$/);
  await page.getByRole('link', { name: 'Next version →' }).click();
  await expect(page).toHaveURL(/\/journeys\/terraces$/);
  await page.goto('/homepages');
  await expect(page.locator('.hp-gallery-card')).toHaveCount(10);
  await page.goto('/concepts');
  await expect(page.locator('.concept-gallery-card')).toHaveCount(10);
  expect((await page.request.get('/journeys/not-a-study')).status()).toBe(404);
});

test('connector directory exposes the complete public snapshot, searches, paginates, and recovers from failure', async ({
  page,
}) => {
  let fail = true;
  await page.route('**/docs/connectors/catalog.json', (route) =>
    fail ? route.fulfill({ status: 503, body: '{}' }) : route.continue(),
  );
  await page.goto('/docs/connectors');
  await expect(page.locator('.docs-connectors').getByRole('alert')).toContainText('couldn’t load');
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.locator('.docs-connectors').getByRole('status', { name: 'Catalog results' }),
  ).toContainText(`${snapshot.data.length.toLocaleString('en-US')} apps`);
  await page.getByRole('button', { name: /Show more apps/ }).click();
  await expect(page.locator('.docs-connector-grid').last().locator('a')).toHaveCount(48);
  await page.getByRole('searchbox', { name: 'Search connectors' }).fill('Linear');
  await expect(page.locator('.docs-connectors').getByRole('link', { name: /^Linear \d/ })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search connectors' }).fill('no-such-app-fixture');
  await expect(page.locator('.docs-connectors')).toContainText('No matching connectors');
  const response = await page.request.get('/docs/connectors/catalog.json');
  const data = await response.json();
  expect(data.apps.map((app: { slug: string }) => app.slug)).toEqual(snapshot.data.map((app) => app.slug));
  expect(data.native).toHaveLength(11);
  await page.getByRole('searchbox', { name: 'Search connectors' }).fill('');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
});

test('static content and use-case explanations remain readable without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(`${fixtureOrigin}/journeys/fanout`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(headline);
    await expect(page.locator('.jl-code-panel')).toContainText('macrofold.runs.create(');
    for (const example of useCases) await expect(page.locator('.jl-no-script')).toContainText(example.prompt);
  } finally {
    await context.close();
  }
});
