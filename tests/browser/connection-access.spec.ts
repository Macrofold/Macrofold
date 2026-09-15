import { test, expect } from '../fixtures/browser';
import AxeBuilder from '@axe-core/playwright';

test('manages exact access rules, preserves a stale tools draft, filters by URL, and works on mobile', async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/login/);
  const origin = new URL(page.url()).origin;
  async function create(path: string, body: unknown, headers: Record<string, string> = {}) {
    const response = await page.request.post(origin + path, {
      data: body,
      headers: { Origin: origin, 'Idempotency-Key': crypto.randomUUID(), ...headers },
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  const stamp = Date.now();
  const project = await create('/v1/projects', { name: `Access project ${stamp}` });
  const preset = await create('/v1/agents', {
    name: `Access preset ${stamp}`,
    harness: 'codex',
    model: 'fixture-model',
    billing_mode: 'managed',
  });
  const connection = await create('/v1/connections', {
    name: `Access connection ${stamp}`,
    kind: 'search',
    provider: 'brave',
    auth_method: 'none',
  });
  await page.goto('/connections');
  const card = page
    .locator('.connection-card')
    .filter({ has: page.getByRole('heading', { name: connection.name, exact: true }) });
  await card.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('checkbox', { name: 'web_search' }).check();
  const second = await context.newPage();
  await second.goto('/connections');
  const secondCard = second
    .locator('.connection-card')
    .filter({ has: second.getByRole('heading', { name: connection.name, exact: true }) });
  await secondCard.getByRole('button', { name: 'Access', exact: true }).click();
  await second.getByRole('switch').check();
  await expect(second.getByRole('switch')).toBeEnabled();
  await page.getByRole('button', { name: 'Save tools', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your draft is preserved');
  await expect(page.getByRole('checkbox', { name: 'web_search' })).toBeChecked();
  await page.getByRole('button', { name: 'Save tools', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await second.close();
  await card.getByRole('button', { name: 'Access', exact: true }).click();
  await expect(page.getByRole('switch')).toBeChecked();
  for (const scope of ['Project', 'Agent preset', 'Project + agent preset']) {
    await page.getByRole('button', { name: 'Add permission', exact: true }).click();
    await page.getByRole('combobox', { name: 'Permission scope', exact: true }).click();
    await page.getByRole('option', { name: scope, exact: true }).click();
    if (scope !== 'Agent preset') {
      await page
        .getByRole('searchbox', { name: 'Search permission project', exact: true })
        .fill(project.name);
      await page.getByRole('combobox', { name: 'Permission project', exact: true }).click();
      await page.getByRole('option', { name: project.name, exact: true }).click();
    }
    if (scope !== 'Project') {
      await page.getByRole('searchbox', { name: 'Search permission preset', exact: true }).fill(preset.name);
      await page.getByRole('combobox', { name: 'Permission preset', exact: true }).click();
      await page.getByRole('option', { name: preset.name, exact: true }).click();
    }
    await page.getByRole('button', { name: 'Save permission', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'New permission', exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(3);
  await page.getByRole('button', { name: 'Add permission', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search permission project', exact: true }).fill(project.name);
  await page.getByRole('combobox', { name: 'Permission project', exact: true }).click();
  await page.getByRole('option', { name: project.name, exact: true }).click();
  await page.getByRole('button', { name: 'Save permission', exact: true }).click();
  // The parent reports the conflict; no second permission row is created.
  await expect(
    page.getByRole('dialog', { name: 'New permission', exact: true }).getByRole('alert'),
  ).toContainText('already exists');
  await page.getByRole('button', { name: 'Cancel edit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(3);
  await page.getByRole('switch').uncheck();
  await expect(page.getByRole('switch')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(3);
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByRole('button', { name: 'Cancel edit' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(2);
  let version = (await (await page.request.get(`${origin}/v1/connections/${connection.id}/access`)).json())
    .version;
  for (let index = 0; index < 24; index++) {
    const target = await create('/v1/agents', {
      name: `Paged preset ${stamp} ${index}`,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
    });
    const saved = await create(
      `/v1/connections/${connection.id}/access/rules`,
      { scope: 'project_agent', project_id: project.id, agent_id: target.id },
      { 'If-Match': `"${version}"` },
    );
    version = saved.version;
  }
  await page.reload();
  await card.getByRole('button', { name: 'Access', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(25);
  await page.getByRole('button', { name: 'Next permissions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Previous permissions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(25);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations,
  ).toEqual([]);
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: 'test-results/connection-access-mobile.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto(`/connections?project_id=${project.id}&agent_id=${preset.id}`);
  await expect(card).toBeVisible();
  await page.getByRole('combobox', { name: 'Project filter', exact: true }).click();
  await page.getByRole('option', { name: 'All projects', exact: true }).click();
  await expect(page).not.toHaveURL(/project_id=/);
  await expect(page).toHaveURL(new RegExp(`agent_id=${preset.id}`));

  const exception = await create('/v1/connections', {
    name: `One-run search ${stamp}`,
    kind: 'search',
    provider: 'brave',
    auth_method: 'none',
  });
  const writeHeaders = { Origin: origin, 'Idempotency-Key': crypto.randomUUID(), 'If-Match': '"1"' };
  expect(
    (
      await page.request.patch(`${origin}/v1/connections/${exception.id}/access`, {
        data: { tools: ['web_search'] },
        headers: writeHeaders,
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.patch(`${origin}/v1/agents/${preset.id}`, {
        data: { connection_grants: [] },
        headers: { Origin: origin, 'Idempotency-Key': crypto.randomUUID() },
      })
    ).ok(),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search agent preset', exact: true }).fill(preset.name);
  await page.getByRole('combobox', { name: 'Agent preset', exact: true }).click();
  await page.getByRole('option', { name: preset.name, exact: true }).click();
  await page
    .getByRole('textbox', { name: 'What would you like to get done?' })
    .fill('Verify isolated exception selection.');
  await page.getByRole('button', { name: 'Run settings', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Allow for this run only' }).click();
  const exceptions = page
    .locator('details')
    .filter({ has: page.locator('summary').filter({ hasText: 'Allow for this run only' }) });
  await exceptions.locator('summary').filter({ hasText: exception.name }).click();
  const exceptionTools = exceptions
    .locator('.run-tool-connection')
    .filter({ has: page.locator('summary').filter({ hasText: exception.name }) });
  let releaseSelection!: () => void;
  const selectionGate = new Promise<void>((resolve) => {
    releaseSelection = resolve;
  });
  await page.route('**/v1/connection-access/resolve?limit=100', async (route) => {
    await selectionGate;
    await route.continue();
  });
  await exceptionTools.getByRole('checkbox', { name: 'web_search', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start run', exact: true })).toBeDisabled();
  releaseSelection();

  await expect(exceptionTools.getByRole('checkbox', { name: 'web_search', exact: true })).toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Selection mode', exact: true })).toContainText(
    'Select specific tools',
  );
  await expect(page.getByRole('region', { name: 'Connection access preview' })).toContainText('run override');
  await page.getByRole('combobox', { name: 'Agent preset', exact: true }).click();
  await page.getByRole('option', { name: 'Custom configuration', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Selection mode', exact: true })).toContainText(
    'Inherit available tools',
  );
  await page.getByRole('combobox', { name: 'Agent preset', exact: true }).click();
  await page.getByRole('option', { name: preset.name, exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Allow for this run only' }).click();
  await exceptions.locator('summary').filter({ hasText: exception.name }).click();
  await expect(exceptionTools.getByRole('checkbox', { name: 'web_search', exact: true })).not.toBeChecked();
  await exceptionTools.getByRole('checkbox', { name: 'web_search', exact: true }).click();
  await expect(exceptionTools.getByRole('checkbox', { name: 'web_search', exact: true })).toBeChecked();
  const submission = page.waitForRequest(
    (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/v1/runs',
  );
  await page.getByRole('button', { name: 'Start run', exact: true }).click();
  const input = (await submission).postDataJSON();
  expect(input.connection_grants).toEqual([{ connection_id: exception.id, tools: ['web_search'] }]);
  expect(input.connection_access_overrides).toEqual(input.connection_grants);
  await expect(page.getByRole('heading', { name: 'Work, completed.' })).toBeVisible({ timeout: 45000 });
});
