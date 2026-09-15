import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { test, expect, fixtureOrigin } from '../fixtures/browser';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
}

function trackRunCreation(page: Page) {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/v1/runs')
      requests.push(request.postData() || '');
  });
  return requests;
}

test('home reflects account setup and hands a task to review without starting a run', async ({
  page,
  context,
}) => {
  await signIn(page);
  const logo = page.locator('.brand .sidebar-wordmark');
  await expect(logo).toBeVisible();
  await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  const runRequests = trackRunCreation(page);
  const [projectsResponse, billingResponse, runsResponse] = await Promise.all([
    page.request.get('/v1/projects?archived=false&limit=4'),
    page.request.get('/v1/billing'),
    page.request.get('/v1/runs?status=succeeded&limit=1'),
  ]);
  for (const response of [projectsResponse, billingResponse, runsResponse]) expect(response.ok()).toBe(true);
  const projects = await projectsResponse.json();
  const billing = await billingResponse.json();
  const runs = await runsResponse.json();
  const completed = [
    projects.data.length > 0,
    BigInt(billing.available_micro_usd) > 0n && !billing.billing_hold,
    runs.data.length > 0,
  ].filter(Boolean).length;
  const setup = page.getByRole('region', { name: 'Getting started', exact: true });
  await expect(setup.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute(
    'value',
    String(completed),
  );
  await expect(setup).toContainText(`${completed} of 3 complete`);
  await expect(setup.getByRole('link', { name: /Create a project/ })).toHaveAttribute('href', '/projects');
  await expect(setup.getByRole('link', { name: /Set up funding/ })).toHaveAttribute('href', '/billing');
  await expect(setup.getByRole('link', { name: /Complete your first run/ })).toHaveAttribute('href', '/runs');

  await page.getByRole('button', { name: 'Setup guide', exact: true }).click();
  const guide = page.getByRole('dialog', { name: 'From an idea to your first run' });
  await expect(guide.getByRole('heading', { level: 3 })).toHaveCount(3);
  await expect(guide).toContainText('Adding a connection never grants it to an agent automatically.');
  await page.keyboard.press('Escape');
  await expect(guide).toHaveCount(0);

  const task = page.getByRole('textbox', { name: 'Describe your task' });
  const review = page.getByRole('button', { name: 'Review run', exact: true });
  await expect(review).toBeDisabled();
  await page.getByRole('button', { name: 'Review my code', exact: true }).click();
  await expect(task).toHaveValue(/Write a prioritized report to review.md/);
  const prompt = 'Review the supplied parser and save a report. Do not change implementation files.';
  await task.fill(prompt);
  await review.click();
  const composer = page.getByRole('dialog', { name: 'Start a new run', exact: true });
  await expect(composer.getByRole('textbox', { name: 'What would you like to get done?' })).toHaveValue(
    prompt,
  );
  await expect(composer.getByRole('combobox', { name: 'Project', exact: true })).toBeVisible();
  await expect(composer.getByRole('button', { name: 'Start run', exact: true })).toBeVisible();
  expect(runRequests).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(composer).toHaveCount(0);
  await expect(task).toHaveValue(prompt);

  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: fixtureOrigin });
  await setup.getByRole('button', { name: 'Copy setup prompt', exact: true }).click();
  await expect(
    setup.getByRole('button', { name: 'Copy setup prompt', exact: true, includeHidden: true }),
  ).toHaveAttribute('data-copy-state', 'copied');
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(fixtureOrigin + '/docs/raw/api/quickstart.md');
  expect(copied).toContain('never ask me to paste it into chat');
  const promptDialog = page.getByRole('dialog', { name: 'Ready for your coding agent' });
  await expect(promptDialog).toContainText(copied);
  expect(runRequests).toEqual([]);
});

test('five featured examples lead through a template preview to a persisted, editable preset', async ({
  page,
  context,
}) => {
  await signIn(page);
  const runRequests = trackRunCreation(page);
  const featured = page.getByRole('region', { name: 'Start with an example', exact: true });
  await expect(featured.getByRole('button')).toHaveCount(5);
  for (const name of [
    'Research brief',
    'Code review',
    'Data analyst',
    'Support triage',
    'Personal assistant',
  ])
    await expect(featured.getByRole('button', { name: new RegExp(name) })).toBeVisible();
  await featured.getByRole('button', { name: /Research brief/ }).click();
  const preview = page.getByRole('dialog', { name: 'Research brief', exact: true });
  await expect(preview).toContainText('A research-brief.md file with findings');
  await expect(preview).toContainText('A question and source documents or links');
  const instructions = await preview
    .getByRole('tabpanel', { name: 'Agent instructions' })
    .locator('pre')
    .innerText();
  expect(instructions).toContain('Do not invent sources or quotes.');
  await preview.getByRole('tab', { name: 'Agent instructions', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(preview.getByRole('tab', { name: 'Example result' })).toHaveAttribute('aria-selected', 'true');
  await expect(preview.getByRole('tabpanel', { name: 'Example result' })).toContainText(
    'Illustrative structure · no agent has run',
  );
  await preview.getByRole('tab', { name: 'Agent instructions', exact: true }).click();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: fixtureOrigin });
  await preview.getByRole('button', { name: 'Copy instructions', exact: true }).click();
  await expect(
    preview
      .getByRole('tabpanel', { name: 'Agent instructions' })
      .getByRole('button', { name: 'Copy instructions', exact: true }),
  ).toHaveAttribute('data-copy-state', 'copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(instructions);
  await preview.getByRole('button', { name: 'Copy prompt for my agent', exact: true }).click();
  await expect(
    preview
      .locator('.template-assist')
      .getByRole('button', { name: 'Copy prompt for my agent', exact: true }),
  ).toHaveAttribute('data-copy-state', 'copied');
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(instructions);
  for (const path of ['agents.md', 'api/quickstart.md', 'sdk.md'])
    expect(copied).toContain(`${fixtureOrigin}/docs/raw/${path}`);
  expect(copied).toContain('explicit budget');
  await preview.getByRole('link', { name: 'Use template', exact: true }).click();
  await expect(page).toHaveURL(/\/agents\?template=research-brief$/);
  const preset = page.getByRole('dialog', { name: 'Create an agent preset', exact: true });
  await expect(preset.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Research brief');
  await expect(preset.getByRole('textbox', { name: 'Instructions', exact: true })).toHaveValue(instructions);
  await expect(preset.getByRole('combobox', { name: 'Model', exact: true })).toHaveText('fixture-model');
  await expect(preset.getByRole('combobox', { name: 'Model funding' })).toHaveText('Managed API usage');
  await expect(preset.getByRole('combobox', { name: 'Authentication connection' })).toHaveCount(0);
  expect(runRequests).toEqual([]);

  const name = 'Research template ' + randomUUID();
  const edited = instructions + '\n\nKeep the final report under 800 words.';
  await preset.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await preset.getByRole('textbox', { name: 'Instructions', exact: true }).fill(edited);
  const savedResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/v1/agents' && response.request().method() === 'POST',
  );
  await preset.getByRole('button', { name: 'Create preset', exact: true }).click();
  const saved = await savedResponse;
  expect(saved.ok(), await saved.text()).toBe(true);
  expect(saved.request().postDataJSON()).toEqual({
    name,
    instructions: edited,
    limits: { max_cost_micro_usd: '2000000' },
    harness: 'codex',
    model: 'fixture-model',
    billing_mode: 'managed',
  });
  const agent = await saved.json();
  const persisted = await page.request.get(`/v1/agents/${agent.id}`);
  expect(persisted.ok()).toBe(true);
  expect(await persisted.json()).toMatchObject({ id: agent.id, name, instructions: edited });
  await expect(page).toHaveURL(/\/agents$/);
  await expect(preset).toHaveCount(0);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(runRequests).toEqual([]);
});

test('the searchable library distinguishes planned examples and supports manual copy on mobile', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Browse library', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Examples library', exact: true })).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'Search examples' });
  await expect(page.getByRole('region', { name: 'Ready to make your own' }).getByRole('button')).toHaveCount(
    6,
  );
  const planned = page.getByRole('region', { name: 'On the drawing board' });
  await expect(planned.getByRole('article')).toHaveCount(3);
  await expect(planned.getByRole('button')).toHaveCount(0);
  await expect(planned.getByRole('link')).toHaveCount(0);
  await search.fill('  ENGINEERING  ');
  await expect(page.getByRole('region', { name: 'Matching starters' }).getByRole('button')).toHaveCount(1);
  await expect(planned.getByRole('heading', { name: 'Release notes' })).toBeVisible();
  await search.fill('account research');
  await expect(page.getByRole('region', { name: 'Matching starters' })).toHaveCount(0);
  await expect(planned.getByRole('article')).toHaveCount(1);
  await expect(planned.getByRole('heading', { name: 'Account research' })).toBeVisible();
  await search.fill('no-matching-example-4291');
  await expect(page.getByRole('heading', { name: 'No matching examples' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(search).toHaveValue('');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page
    .getByRole('region', { name: 'Ready to make your own' })
    .getByRole('button', { name: /Code review/ })
    .click();
  const preview = page.getByRole('dialog', { name: 'Code review', exact: true });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('Denied by browser')) },
    });
  });
  await preview.getByRole('button', { name: 'Copy prompt for my agent', exact: true }).click();
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toContainText(
    'Clipboard unavailable. Select and copy the text manually.',
  );
  await preview.getByText('View prompt for manual copy', { exact: true }).click();
  await expect(preview).toContainText(fixtureOrigin + '/docs/raw/agents.md');
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  const audit = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    audit.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.failureSummary),
    })),
  ).toEqual([]);
  await page.screenshot({ path: 'test-results/template-mobile.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await page.goto('/agents?template=release-notes');
  await expect(page.getByRole('heading', { name: 'Agent presets', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'New preset', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Instructions', exact: true })).toHaveValue('');
});

test('home explains read-only access and keeps the run review action disabled', async ({ page }) => {
  await page.route('**/v1/me', async (route) => {
    const response = await route.fetch();
    const identity = await response.json();
    await route.fulfill({
      response,
      json: {
        ...identity,
        effective_scopes: identity.effective_scopes.filter((scope: string) => scope !== 'runs:write'),
      },
    });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Analyze a dataset', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Describe your task' })).not.toHaveValue('');
  await expect(page.getByRole('button', { name: 'Review run', exact: true })).toBeDisabled();
  await expect(
    page.getByText('Your role can explore this workspace. Ask an administrator for access to start runs.'),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Start with an example' })).toBeVisible();
});

test('mobile account-menu links close navigation and reveal the selected settings page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const navigation = page.getByRole('button', { name: 'Open navigation', exact: true });
  for (const destination of [
    { menu: 'Account & security', heading: 'Account & security', path: '/account' },
    { menu: 'Team settings', heading: 'Team & organization', path: '/team' },
  ]) {
    await navigation.click();
    await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('menuitem', { name: destination.menu, exact: true }).click();
    await expect(page).toHaveURL(fixtureOrigin + destination.path);
    await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toHaveCount(0);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: destination.heading, exact: true })).toBeVisible();
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  }
});
