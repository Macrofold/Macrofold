import { test, expect, fixtureOrigin } from '../fixtures/browser';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

test('developer onboarding links to the guides and reports clipboard failure honestly', async ({
  page,
  context,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make room for your next idea.' })).toBeVisible();
  await page.goto('/developers');
  await expect(page.getByRole('link', { name: 'CLI installation guide' })).toHaveAttribute(
    'href',
    '/docs/cli',
  );
  await expect(page.getByRole('link', { name: 'API quickstart', exact: true })).toHaveAttribute(
    'href',
    '/docs/api/quickstart',
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('Denied by browser')) },
    });
  });
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByText('Clipboard unavailable. Select and copy the text manually.')).toBeVisible();
  await page.reload();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByText('Example copied')).toBeVisible();
  const code = await page.evaluate(() => navigator.clipboard.readText());
  expect(code).toContain(fixtureOrigin + '/v1/runs');
  expect(code).toContain('"max_cost_micro_usd":"1000000"');
});

test('documentation navigation, search recovery, copy, and mobile access', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/docs');
  await page.locator('.docs-header').evaluate((header) => header.setAttribute('data-persistent', 'yes'));
  await page
    .getByRole('navigation', { name: 'Documentation navigation', exact: true })
    .getByRole('link', { name: 'Quickstart', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Quickstart', exact: true })).toBeVisible();
  await expect(page.locator('.docs-header')).toHaveAttribute('data-persistent', 'yes');
  await expect(page.locator('.docs-prose ul').first()).toHaveCSS('list-style-type', 'disc');
  await page.route(
    '**/docs/search-index.json',
    (route) => route.fulfill({ status: 503, body: 'Temporarily unavailable' }),
    { times: 1 },
  );
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('alert')).toContainText('Search could not load');
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('textbox', { name: 'Search documentation' }).fill('idempotency');
  await expect(page.getByRole('dialog').getByRole('link', { name: /API conventions/ })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search documentation' }).fill('zzzzunfindable');
  await expect(page.getByText('No matching pages.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search documentation' }).fill('workspaces');
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations,
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await page.goto('/docs/api/quickstart');
  await page
    .getByRole('navigation', { name: 'On this page' })
    .getByRole('link', { name: '1. Create a project' })
    .click();
  await expect(page).toHaveURL(/#1-create-a-project$/);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy page' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('# API quickstart');
  await page.screenshot({ path: 'test-results/docs-api-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations,
  ).toEqual([]);
  await page.getByRole('button', { name: 'Open documentation menu' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Billing and limits' }).click();
  await expect(page.getByRole('heading', { name: 'Billing and limits', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations,
  ).toEqual([]);
  await page.screenshot({ path: 'test-results/docs-billing-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('every published guide, Markdown source, sitemap, and unknown route returns the intended public content', async ({
  request,
  browser,
}) => {
  const index = await request.get('/llms.txt'),
    complete = await request.get('/llms-full.txt');
  expect(await index.text()).toContain(fixtureOrigin + '/docs/raw/index.md');
  expect(await complete.text()).not.toContain('## Remaining launch work');
  const sitemap = await (await request.get('/sitemap.xml')).text();
  const manifest: { slug: string }[] = JSON.parse(await readFile('docs/navigation.json', 'utf8'));
  for (const page of manifest) {
    const url = '/docs' + (page.slug ? '/' + page.slug : '');
    const html = await request.get(url);
    expect(html.status(), url).toBe(200);
    const content = await html.text();
    expect(content).toContain('rel="canonical"');
    expect(content).toContain(`href="${fixtureOrigin}${url}"`);
    expect(sitemap).toContain(fixtureOrigin + url);
    const raw = await request.get(`/docs/raw/${page.slug || 'index'}.md`);
    expect(raw.headers()['content-type']).toContain('text/markdown');
    expect(await raw.text()).toMatch(/^# /);
  }
  expect((await request.get('/docs/not-a-real-guide')).status()).toBe(404);
  expect((await request.get('/docs/raw/maintainers/TODO.md')).status()).toBe(404);
  expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /admin/');
  const noJS = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await noJS.newPage();
    await page.goto(fixtureOrigin + '/docs/concepts');
    await expect(page.getByRole('heading', { name: 'Resource model' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Runs and agents', exact: true }).first()).toBeVisible();
  } finally {
    await noJS.close();
  }
});

test('the published cURL quickstart executes unchanged against the local simulator', async () => {
  test.setTimeout(90000);
  expect(new URL(fixtureOrigin).hostname).toBe('localhost');
  const account: { api_key: string } = JSON.parse(
    await readFile(path.join(process.env.DATA_DIR || '.data', 'demo.json'), 'utf8'),
  );
  const markdown = await readFile('docs/features/api/quickstart.md', 'utf8');
  const commands = [...markdown.matchAll(/```sh\n([\s\S]*?)```/g)]
    .map((match) => match[1])
    .join('\n')
    .replace('export AGENT_HOST=http://localhost:3210', 'export AGENT_HOST="$DOCS_FIXTURE_ORIGIN"');
  const { stdout } = await promisify(execFile)('bash', ['-euo', 'pipefail', '-c', commands], {
    env: { ...process.env, AGENT_API_KEY: account.api_key, DOCS_FIXTURE_ORIGIN: fixtureOrigin },
    timeout: 80000,
    maxBuffer: 1024 * 1024,
  });
  expect(stdout).toMatch(/"final"\s*:\s*true/);
  expect(stdout).toContain('run.succeeded');
});
