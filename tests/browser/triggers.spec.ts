import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, fixtureOrigin } from '../fixtures/browser';
import type { Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make room for your next idea.' })).toBeVisible();
}
async function post(page: Page, path: string, body: unknown) {
  const response = await page.request.post(path, {
    data: body,
    headers: { Origin: fixtureOrigin, 'Idempotency-Key': randomUUID() },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function targets(page: Page) {
  const suffix = randomUUID().slice(0, 8);
  const project = await post(page, '/v1/projects', { name: `Trigger project ${suffix}` });
  const agent = await post(page, '/v1/agents', {
    name: `Trigger preset ${suffix}`,
    harness: 'codex',
    model: 'fixture-model',
    billing_mode: 'managed',
  });
  return { project, agent };
}
test('dashboard webhook setup → external delivery → persistent simulated run → historical replay', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  await signIn(page);
  const { project, agent } = await targets(page);
  await page.getByRole('link', { name: 'Triggers', exact: true }).click();
  await page.getByRole('button', { name: 'Create trigger', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Webhook research inbox');
  await choose(page, 'Project', project.name);
  await choose(page, 'Agent preset', agent.name);
  await dialog
    .getByRole('textbox', { name: 'Prompt', exact: true })
    .fill('Write a research brief and save it.');
  await dialog.getByRole('button', { name: 'Create trigger', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your webhook is ready' })).toBeVisible();
  const url = await dialog.getByRole('textbox', { name: 'Webhook URL', exact: true }).inputValue();
  const authorization = await dialog
    .getByRole('textbox', { name: 'Authorization header', exact: true })
    .inputValue();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const key = randomUUID();
  const incoming = () =>
    request.post(url, {
      headers: { Authorization: authorization, 'Idempotency-Key': key },
      data: { prompt: 'Research fractals.' },
    });
  const response = await incoming();
  expect(response.status()).toBe(202);
  const delivery = await response.json();
  expect((await (await incoming()).json()).id).toBe(delivery.id);
  const card = page.locator('.trigger-card').filter({ hasText: 'Webhook research inbox' });
  await card.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('link', { name: 'View run →' })).toBeVisible({
    timeout: 60000,
  });
  await page.getByRole('dialog').getByRole('link', { name: 'View run →' }).click();
  await expect(page.locator('.badge.succeeded')).toBeVisible({ timeout: 60000 });
  await page.getByRole('tab', { name: /Tool calls/ }).click();
  await expect(page.getByText('tool.started', { exact: true }).first()).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: /Events/ }).click();
  await expect(page.getByText('run.succeeded', { exact: true })).toBeVisible();
  const checkpoints = await page.request.get(`/v1/workspaces/${project.default_workspace_id}/checkpoints`);
  expect(checkpoints.ok()).toBeTruthy();
  expect((await checkpoints.json()).data.length).toBeGreaterThan(0);
});

test('scheduled task creation, editing, pause/resume, run now and accessible history', async ({ page }) => {
  test.setTimeout(120000);
  await signIn(page);
  const { project, agent } = await targets(page);
  await page.getByRole('link', { name: 'Scheduled tasks', exact: true }).click();
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Morning briefing');
  await choose(page, 'Project', project.name);
  await choose(page, 'Agent preset', agent.name);
  await dialog.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Prepare the morning report.');
  await choose(page, 'Cadence', 'Weekdays at 9:00');
  await dialog.getByRole('textbox', { name: 'Timezone', exact: true }).fill('Invalid/Zone');
  await dialog.getByRole('button', { name: 'Create scheduled task', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('valid cron expression');
  await dialog.getByRole('textbox', { name: 'Timezone', exact: true }).fill('UTC');
  await dialog.getByRole('button', { name: 'Create scheduled task', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const card = page.locator('.trigger-card').filter({ hasText: 'Morning briefing' });
  await expect(card).toContainText('0 9 * * 1-5');
  await expect(card).toContainText(/Next: .*9:00/);
  await card.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Run now', exact: true })).toBeDisabled();
  await card.getByRole('button', { name: 'Resume', exact: true }).click();
  await card.getByRole('button', { name: 'Edit Morning briefing' }).click();
  await dialog
    .getByRole('textbox', { name: 'Prompt', exact: true })
    .fill('Prepare a concise morning report.');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(card).toContainText('concise morning report');
  const audit = await new AxeBuilder({ page }).include('#main').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({ path: 'test-results/scheduled-tasks.png', fullPage: true });
  await card.getByRole('button', { name: 'Run now', exact: true }).click();
  await card.getByRole('button', { name: 'History', exact: true }).click();
  await expect(dialog.getByRole('link', { name: 'View run →' })).toBeVisible({ timeout: 60000 });
  await dialog.getByRole('link', { name: 'View run →' }).click();
  await expect(page.locator('.badge.succeeded')).toBeVisible({ timeout: 60000 });
  await page.getByRole('link', { name: 'Runs', exact: true }).click();
  await expect(page.locator('.run-name').filter({ hasText: 'scheduled' }).first()).toBeVisible();
});

test('Slack trigger form selects a connected channel and handles channel discovery failure', async ({
  page,
}) => {
  await signIn(page);
  const { project, agent } = await targets(page);
  const connection = randomUUID();
  await page.route('**/v1/slack-connections', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: connection,
            name: 'Product team',
            team_id: 'T123',
            bot_user_id: 'UBOT',
            events_url: `${fixtureOrigin}/events/slack/${connection}`,
            created_at: new Date().toISOString(),
          },
        ],
        next_cursor: null,
      },
    }),
  );
  let broken = true;
  await page.route(`**/v1/slack-connections/${connection}/channels`, (route) =>
    broken
      ? route.fulfill({
          status: 502,
          json: { error: { code: 'slack_error', message: 'Check bot channel scopes.' } },
        })
      : route.fulfill({ json: { data: [{ id: 'C123', name: 'agent-inbox' }], next_cursor: null } }),
  );
  await page.goto('/triggers');
  await page.getByRole('button', { name: 'Create trigger', exact: true }).first().click();
  await choose(page, 'Integration', 'Slack');
  await choose(page, 'Slack connection', 'Product team');
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Check bot channel scopes.');
  broken = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await choose(page, 'Slack channel', '#agent-inbox');
  await choose(page, 'Project', project.name);
  await choose(page, 'Agent preset', agent.name);
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Slack agent inbox');
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Help with the request.');
  // Provider discovery is a UI fixture; the signed backend + reply journey is tested against real SQL separately.
  let submitted: unknown;
  await page.route('**/v1/triggers', (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({
      status: 400,
      json: { error: { code: 'fixture_stop', message: 'Fixture captured; no external Slack call.' } },
    });
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Create trigger', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Fixture captured');
  expect(submitted).toMatchObject({
    kind: 'slack',
    project_id: project.id,
    agent_id: agent.id,
    slack_connection_id: connection,
    channel_id: 'C123',
  });
});
