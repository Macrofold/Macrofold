import { test, expect } from '../fixtures/browser';
import AxeBuilder from '@axe-core/playwright';
test('public discovery, pricing and quickstart work on desktop and mobile', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Good work deserves/ })).toBeVisible();
  for (const route of ['/', '/pricing', '/docs']) {
    await page.goto(route);
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(audit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.failureSummary) }))).toEqual(
      [],
    );
    await page.screenshot({
      path: `test-results/public-${route === '/' ? 'home' : route.slice(1)}-desktop.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
    await page.screenshot({
      path: `test-results/public-${route === '/' ? 'home' : route.slice(1)}-mobile.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await page.getByRole('link', { name: 'Open the complete interactive API reference' }).click();
  await expect(page).toHaveURL(/\/reference/);
  expect((await page.request.get('/openapi.json')).ok()).toBeTruthy();
});
