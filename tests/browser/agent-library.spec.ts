import { test, expect } from '../fixtures/browser';

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
  await page.getByRole('button', { name: 'New workspace', exact: true }).click();
  const name = `Memory journey ${Date.now()}`;
  await page.getByLabel('Workspace name').fill(name);
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  return name;
}

async function chooseWorktree(page: import('@playwright/test').Page, name: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Workspace', exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Worktree', exact: true }).click();
  await page.getByRole('option', { name: 'main', exact: true }).click();
  return dialog;
}

test('editable memory uses real installation, file editing, state controls and safe removal', async ({
  page,
}) => {
  const name = await signIn(page);
  await page.getByRole('link', { name: 'Agent library', exact: true }).click();
  await page.getByRole('button', { name: 'Add memory', exact: true }).click();
  const dialog = await chooseWorktree(page, name);
  await dialog.getByRole('button', { name: 'Add memory', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const installed = page.getByRole('region', { name: 'Installed editable memory', exact: true });
  await expect(installed).toBeVisible();
  await installed.getByRole('button', { name: 'View memory', exact: true }).click();
  await expect(installed.getByText('profile.md', { exact: true })).toBeVisible();
  await installed.getByRole('link', { name: 'Open worktree and edit memory files' }).click();
  await page.getByRole('treeitem', { name: 'profile.md', exact: true }).click();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  // Wait for this edit's actual save, not the initial document's Saved label.
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname.endsWith('/file') &&
      new URL(response.url()).searchParams.get('path') === 'profile.md',
  );
  await page
    .getByRole('textbox', { name: 'File editor', exact: true })
    .fill('# Profile\n\nConfirmed preference: concise summaries.');
  expect((await saved).ok()).toBe(true);
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await page.reload();
  await page.getByRole('treeitem', { name: 'profile.md', exact: true }).click();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'File editor', exact: true })).toContainText(
    'Confirmed preference: concise summaries.',
  );
  await page.getByRole('link', { name: 'Agent library', exact: true }).click();
  await installed.getByRole('button', { name: 'Pause learning', exact: true }).click();
  await expect(installed).toContainText('Read existing memory');
  await installed.getByRole('button', { name: 'Disable', exact: true }).click();
  await expect(installed).toContainText('Memory guidance is disabled');
  await installed.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('files, checkpoints and past conversations remain');
  await page.getByRole('button', { name: 'Remove installation', exact: true }).click();
  await expect(installed).toHaveCount(0);
  await page.screenshot({ path: 'test-results/agent-library-simple.png', fullPage: true });
});

test('remote setup requires explicit dedication and external funding before activation', async ({ page }) => {
  const name = await signIn(page);
  await page.getByRole('link', { name: 'Agent library', exact: true }).click();
  const card = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Claude-mem', exact: true }) });
  await card.getByRole('button', { name: 'Set up service memory', exact: true }).click();
  const dialog = await chooseWorktree(page, name);
  await expect(dialog).toContainText('existing dedicated PostgreSQL project');
  await expect(dialog.getByRole('button', { name: 'Add memory', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Add service connection', exact: true }).click();
  await expect(dialog.getByLabel('Service bearer key')).toHaveAttribute('type', 'password');
  await expect(dialog.getByRole('button', { name: 'Save connection', exact: true })).toBeDisabled();
  await dialog.getByLabel('Service API base URL').fill(new URL(page.url()).origin);
  await dialog.getByLabel('Service bearer key').fill('synthetic-browser-key');
  let saveStarted!: () => void;
  let releaseSave!: () => void;
  const started = new Promise<void>((resolve) => {
    saveStarted = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let pendingSave: Promise<void> | undefined;
  const holdSave = async (route: import('@playwright/test').Route) => {
    if (route.request().method() !== 'POST') return route.continue();
    saveStarted();
    pendingSave = gate.then(() => route.continue());
    await pendingSave;
  };
  await page.route('**/v1/connections', holdSave);
  try {
    await dialog.getByRole('button', { name: 'Save connection', exact: true }).click();
    await started;
    // Edits made after Save starts must survive its eventual response/refetch.
    const namespace = dialog.getByLabel('Dedicated Claude-mem project ID', { exact: true });
    const dedicated = dialog.getByLabel(/This collection is dedicated/);
    const costs = dialog.getByLabel(/I understand this service can charge separately/);
    await namespace.fill('dedicated-browser-project');
    await dedicated.check();
    await costs.check();
    await expect(dialog.getByRole('button', { name: 'Add memory', exact: true })).toBeDisabled();
    releaseSave();
    await expect(dialog.getByRole('button', { name: 'Add service connection', exact: true })).toBeVisible();
    await expect(
      dialog.getByRole('combobox', { name: 'Memory service connection', exact: true }),
    ).toContainText('Claude-mem memory service');
    await expect(namespace).toHaveValue('dedicated-browser-project');
    await expect(dedicated).toBeChecked();
    await expect(costs).toBeChecked();
    await expect(dialog.getByRole('button', { name: 'Add memory', exact: true })).toBeEnabled();
  } finally {
    releaseSave();
    await pendingSave;
    await page.unroute('**/v1/connections', holdSave);
  }
  await dialog.getByText('Advanced availability', { exact: true }).click();
  await expect(dialog.getByLabel('Require memory before starting the agent.')).not.toBeChecked();
  await expect(dialog).toContainText('Macrofold Run budgets do not cap');
  // Saving credentials does not install or contact a service. The isolated app
  // origin is explicitly allowlisted; domain HTTP owns actual vendor readiness.
  await page.screenshot({ path: 'test-results/agent-library-remote-disclosure.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('link', { name: 'Connections', exact: true }).click();
  const saved = page
    .locator('.connection-card')
    .filter({ has: page.getByRole('heading', { name: 'Claude-mem memory service', exact: true }) });
  await expect(saved).toContainText('Memory service · Claude-mem');
  await expect(saved.getByRole('button', { name: 'Tools', exact: true })).toHaveCount(0);
  await expect(saved.getByRole('button', { name: 'Access', exact: true })).toHaveCount(0);
  await expect(saved).not.toContainText('No tools enabled');
  await expect(saved.getByRole('link', { name: 'Manage memory in Agent library' })).toBeVisible();
  await saved.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(page.getByText('Service credentials are configured.', { exact: false })).toBeVisible();
  await saved.getByRole('button', { name: 'Edit Claude-mem memory service', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'A replacement blocks installed memory until fresh explicit setup.',
  );
});
