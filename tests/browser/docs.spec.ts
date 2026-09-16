import { test, expect, fixtureOrigin } from '../fixtures/browser';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

test('branded docs preserve appearance across guides and mobile search', async ({ page }) => {
  // Contrast belongs to the settled theme, not an intermediate cross-theme fade.
  const settleAppearance = () =>
    expect
      .poll(() =>
        page.evaluate(
          () => document.getAnimations().filter((animation) => animation instanceof CSSTransition).length,
        ),
      )
      .toBe(0);
  await page.goto('/docs/customer-agents');
  await expect(page).toHaveTitle('Customer agents · Macrofold Docs');
  await expect(page.getByRole('banner').getByRole('img', { name: 'Macrofold' })).toBeVisible();
  for (const theme of ['dark', 'light'] as const) {
    await page.getByRole('button', { name: `Use ${theme} theme`, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await settleAppearance();
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations,
    ).toEqual([]);
    await page.screenshot({ path: `test-results/docs-brand-${theme}.png` });
  }
  await page.getByRole('link', { name: 'Docs', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Use light theme', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({ path: 'test-results/docs-brand-home.png' });
  for (const width of [900, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
  }
  await page.getByRole('button', { name: 'Open documentation menu' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Use dark theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await settleAppearance();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations,
  ).toEqual([]);
  await page.getByRole('dialog').getByRole('link', { name: 'Customer agents', exact: true }).click();
  await page.getByRole('button', { name: 'Search documentation', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search documentation' }).fill('customer agents');
  await expect(page.getByRole('dialog').getByRole('link').first()).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations,
  ).toEqual([]);
  await page.screenshot({ path: 'test-results/docs-brand-search-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Search documentation', exact: true })).toBeFocused();
  await page.screenshot({ path: 'test-results/docs-brand-mobile.png' });
});

test('developer onboarding links to the guides and reports clipboard failure honestly', async ({
  page,
  context,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
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
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toContainText(
    'Clipboard unavailable. Select and copy the text manually.',
  );
  await page.reload();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toHaveAttribute(
    'data-copy-state',
    'copied',
  );
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
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
  const markdown = await readFile('docs/features/api/http-quickstart.md', 'utf8');
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

test('AI setup copies deployment-specific links and remains accessible on mobile', async ({
  page,
  context,
}) => {
  await page.goto('/docs');
  await expect(page.getByRole('link', { name: /Use Macrofold Cloud/ })).toHaveAttribute(
    'href',
    '/docs/cloud',
  );
  await expect(page.getByRole('link', { name: /Run it on your infrastructure/ })).toHaveAttribute(
    'href',
    '/docs/self-hosting',
  );
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy setup prompt', exact: true }).click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain(fixtureOrigin + '/docs/raw/api/quickstart.md');
  expect(prompt).toContain(fixtureOrigin + '/docs/raw/workspaces/shared-agents.md');
  expect(prompt).not.toContain('https://app.macrofold.ai');
  await page.getByRole('link', { name: /Build with your AI/ }).click();
  await expect(page.getByRole('region', { name: 'Setup prompt', exact: true })).toContainText(prompt);
  await page.getByRole('button', { name: 'Copy prompt', exact: true }).click();
  expect((await page.evaluate(() => navigator.clipboard.readText())).trim()).toBe(prompt);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('Denied by browser')) },
    });
  });
  await page.locator('.docs-prompt-block').getByRole('button').click();
  await expect(page.getByRole('button', { name: 'Copy prompt', exact: true })).toHaveAttribute(
    'data-copy-state',
    'error',
  );
  await expect(page.getByRole('region', { name: 'Setup prompt', exact: true })).toContainText(prompt);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations,
  ).toEqual([]);
  await page.screenshot({ path: 'test-results/docs-ai-mobile.png', fullPage: true });
});

test('published Python quickstart and shared-workspace example execute through the local API', async () => {
  test.setTimeout(120000);
  expect(new URL(fixtureOrigin).hostname).toBe('localhost');
  const account: { api_key: string } = JSON.parse(
    await readFile(path.join(process.env.DATA_DIR || '.data', 'demo.json'), 'utf8'),
  );
  const blocks = async (source: string) =>
    [...(await readFile(source, 'utf8')).matchAll(/```python\n([\s\S]*?)```/g)]
      .map((match) => match[1])
      .join('\n');
  const quickstart = await blocks('docs/features/api/quickstart.md');
  const shared = await blocks('docs/features/workspaces/shared-agents.md');
  const verification = `
import os
from macrofold import Macrofold

setup = Macrofold(base_url=os.environ['MACROFOLD_BASE_URL'])
try:
    project = setup.projects.create(name='Shared workspace documentation')
    workspace = setup.workspaces.get(project.default_workspace_id)
    setup.workspaces.write_file(workspace.id, path='handoff.txt', if_match=workspace.revision, content=b'Persistent handoff')
    research_agent = setup.agents.create(name='Research docs', harness='codex', model='fixture-model', billing_mode='managed')
    review_agent = setup.agents.create(name='Review docs', harness='pi', model='fixture-model', billing_mode='managed')
    example = ${JSON.stringify(shared)}
    example = example.replace('Macrofold()', 'Macrofold(base_url=os.environ["MACROFOLD_BASE_URL"])')
    example = example.replace('YOUR_WORKSPACE_ID', str(workspace.id)).replace('YOUR_RESEARCH_AGENT_ID', str(research_agent.id)).replace('YOUR_REVIEW_AGENT_ID', str(review_agent.id))
    scope = {'os': os}
    exec(example, scope)
    first, second = scope['research'], scope['review']
    assert first.workspace_id == second.workspace_id == workspace.id
    assert first.session_id != second.session_id
    assert setup.runs.get(first.run_id).harness == 'codex'
    assert setup.runs.get(second.run_id).harness == 'pi'
    assert setup.runs.get_result(first.run_id).checkpoint_id is not None
    assert scope['result'].checkpoint_id is not None
    assert setup.workspaces.read_file(workspace.id, path='handoff.txt') == b'Persistent handoff'
finally:
    setup.close()
print('Documentation: Python quickstart and two-agent persisted handoff passed.')
`;
  const { stdout } = await promisify(execFile)('python3', ['-c', quickstart + '\n' + verification], {
    env: {
      ...process.env,
      PYTHONPATH: path.resolve('sdk/python'),
      MACROFOLD_API_KEY: account.api_key,
      MACROFOLD_BASE_URL: fixtureOrigin,
      MACROFOLD_MODEL: 'fixture-model',
    },
    timeout: 110000,
    maxBuffer: 1024 * 1024,
  });
  expect(stdout).toContain('Simulation completed');
  expect(stdout).toContain('two-agent persisted handoff passed');
});
