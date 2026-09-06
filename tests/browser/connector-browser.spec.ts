import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Full-catalog scrolling already checks every rendered entry. Capturing a full
// DOM trace at every batch makes this stress journey much slower than the UI.
test.use({ trace: 'off' });

test('browses the complete app catalog, filters categories, and reaches the final connector', async ({
  page,
}) => {
  // Scrolling the full catalog verifies UI behavior without requesting thousands
  // of third-party images. Real logo URLs are checked separately during review.
  await page.route('https://logos.composio.dev/api/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="4" y="4" width="24" height="24" rx="6" fill="#5865d9"/></svg>',
    }),
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Connections', exact: true }).click();
  const response = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/v1/connector-catalog',
  );
  await page.getByRole('button', { name: 'Add connection', exact: true }).first().click();
  const catalog = await (await response).json();
  expect(catalog.data.length).toBeGreaterThan(1000);
  expect(catalog.source).toBe('snapshot');
  const dialog = page.getByRole('dialog');
  const search = page.getByRole('searchbox', { name: 'Search apps' });
  await expect(search).toBeFocused();
  const cards = page.locator('.connector-app-card');
  await expect(cards).toHaveCount(48);
  expect(
    await page
      .locator('.connector-cards')
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
  ).toBe(3);
  await search.fill('gmail');
  await page.getByRole('button', { name: 'Set up Gmail', exact: true }).click();
  await expect(page.getByLabel('Connection name')).toHaveValue('Gmail account');
  await expect(dialog).toContainText('An administrator needs to enable this app');
  await page.getByRole('button', { name: 'All apps', exact: true }).click();
  await expect(search).toHaveValue('gmail');
  await search.fill('zzzz-no-such-connector');
  await expect(page.getByRole('heading', { name: 'No apps found' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page
    .getByRole('navigation', { name: 'App categories' })
    .getByRole('button', { name: /^Email\s+\d+$/ })
    .click();
  const emails = catalog.data.filter((entry: { categories: string[] }) => entry.categories.includes('email'));
  await expect(cards).toHaveCount(Math.min(48, emails.length));
  await page
    .getByRole('navigation', { name: 'App categories' })
    .getByRole('button', { name: /^All\s/ })
    .click();
  // Each batch becomes reachable by scrolling, without a pagination click.
  const results = page.getByLabel('App results', { exact: true });
  while ((await cards.count()) < catalog.data.length) {
    const before = await cards.count();
    await results.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => cards.count()).toBeGreaterThan(before);
  }
  await expect(
    page.getByRole('button', { name: `Set up ${catalog.data.at(-1).name}`, exact: true }),
  ).toBeAttached();
  // Audit representative cards and navigation, rather than asking axe to scan
  // thousands of offscreen copies of the exact same component.
  await search.fill('gmail');
  await expect(cards).toHaveCount(
    catalog.data.filter((entry: { name: string; slug: string; description: string; categories: string[] }) =>
      `${entry.name} ${entry.slug} ${entry.description} ${entry.categories.join(' ')}`
        .toLowerCase()
        .includes('gmail'),
    ).length,
  );
  const audit = await new AxeBuilder({ page })
    .include('.connector-dialog')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    audit.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.slice(0, 3).map((node) => node.failureSummary),
    })),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test('keeps model and MCP setup accessible with branded providers and a mobile catalog', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Add connection', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Set up Gmail' })).toBeVisible();
  await page
    .getByRole('dialog')
    .evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  await page
    .locator('.connector-app-card img')
    .first()
    .evaluate((image: HTMLImageElement) => image.decode().catch(() => {}));
  await page.screenshot({ path: 'test-results/connector-browser-desktop.png' });
  await page.getByRole('button', { name: 'Model key', exact: true }).click();
  await page.getByRole('combobox', { name: 'Provider', exact: true }).click();
  const anthropic = page.getByRole('option', { name: 'Anthropic', exact: true });
  await expect(anthropic.locator('img')).toHaveAttribute('src', '/brands/anthropic.svg');
  await anthropic.click();
  await expect(page.getByRole('heading', { name: 'Connect Anthropic' })).toBeVisible();
  await page.getByRole('button', { name: 'MCP server', exact: true }).click();
  await expect(page.getByLabel('MCP endpoint URL')).toBeVisible();
  await page.getByRole('button', { name: 'Sandbox MCP', exact: true }).click();
  await expect(page.getByLabel('Approved package')).toBeVisible();
  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await expect(page.getByRole('searchbox', { name: 'Search apps' })).toBeVisible();
  const dialogBox = await page.getByRole('dialog').boundingBox();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/connector-browser-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('saves a catalog app outside the old shortlist without authorizing upstream or granting tools', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Add connection', exact: true }).first().click();
  await page.getByRole('searchbox', { name: 'Search apps' }).fill('Google Calendar');
  await page.getByRole('button', { name: 'Set up Google Calendar', exact: true }).click();
  const name = `Calendar browser ${Date.now()}`;
  await page.getByLabel('Connection name').fill(name);
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/v1/connections',
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Add connection', exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  const connection = await response.json();
  expect(connection).toMatchObject({ provider: 'googlecalendar', kind: 'composio', status: 'pending' });
  const card = page
    .locator('.connection-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
  await expect(card.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await expect(card.locator('img')).toHaveAttribute('src', 'https://logos.composio.dev/api/googlecalendar');
  // This removes only the pending fixture; there is no upstream account to revoke.
  await card.getByRole('button', { name: `Remove ${name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Remove connection', exact: true }).click();
  await expect(card).toHaveCount(0);
});
