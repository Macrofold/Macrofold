import { request as playwrightRequest, type Page } from '@playwright/test';
import { test, expect } from '../fixtures/browser';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { config } from '../../packages/core/src/config';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
test.afterAll(() => pool.end());
const headers = () => ({ Origin: config.origin, 'Idempotency-Key': randomUUID() });
async function setup(page: Page) {
  const email = randomUUID() + '@example.test',
    password = 'freshness-browser-password-2026';
  const created = await page.request.post('/auth/sign-up/email', {
    headers: headers(),
    data: { name: 'Stream browser', email, password },
  });
  expect(created.ok()).toBe(true);
  const { user } = await created.json();
  expect(
    (await pool.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1', [user.id])).rowCount,
  ).toBe(1);
  expect(
    (await page.request.post('/auth/sign-in/email', { headers: headers(), data: { email, password } })).ok(),
  ).toBe(true);
  const me = await (await page.request.get('/v1/me')).json();
  const key = await page.request.post('/v1/api-keys', {
    headers: headers(),
    data: {
      name: 'External test client',
      scopes: ['workspaces:read', 'workspaces:write', 'runs:read', 'runs:write', 'files:read', 'files:write'],
    },
  });
  expect(key.ok()).toBe(true);
  const external = await playwrightRequest.newContext({
    baseURL: config.origin,
    extraHTTPHeaders: { Authorization: 'Bearer ' + (await key.json()).secret },
  });
  const workspaceResponse = await external.post('/v1/workspaces', {
    headers: headers(),
    data: { name: 'Live workspace ' + randomUUID(), persistence: 'persistent' },
  });
  expect(workspaceResponse.ok()).toBe(true);
  return { external, workspace: await workspaceResponse.json(), me };
}

test('external API runs refresh history and overview while navigation preserves one shared subscription', async ({
  page,
}) => {
  const { external, workspace } = await setup(page);
  const streams: string[] = [],
    detailed: string[] = [],
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (req) => {
    if (new URL(req.url()).pathname === '/account/events') streams.push(req.url());
    if (/\/v1\/runs\/[^/]+\/stream/.test(req.url())) detailed.push(req.url());
  });
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
    await expect.poll(() => streams.length).toBe(1);
    await page.getByRole('link', { name: 'Runs', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'No runs yet' })).toBeVisible();
    const accepted = await external.post('/v1/runs', {
      headers: headers(),
      data: {
        workspace_id: workspace.id,
        harness: 'codex',
        model: 'fixture-model',
        prompt: 'Create a persistent hello file',
        billing_mode: 'managed',
      },
    });
    expect(accepted.ok(), await accepted.text()).toBe(true);
    const run = await accepted.json();
    const row = page.getByRole('row').filter({ hasText: run.run_id.slice(-8) });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText('succeeded');
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: run.run_id.slice(-8) })).toBeVisible();
    await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
    await page.getByRole('heading', { name: workspace.name }).click();
    await expect(page.getByRole('combobox', { name: 'Active worktree' })).toBeVisible();
    await page.getByRole('link', { name: 'Runs', exact: true }).click();
    await page.getByRole('link', { name: `Open run ${run.run_id.slice(-8)}` }).click();
    await expect.poll(() => detailed.length).toBeGreaterThan(0);
    await expect(page.locator('.run-api-tip code')).toHaveText(`macrofold run attach ${run.run_id}`);
    await expect(page.locator('.markdown-output')).toContainText(/simulation|simulated/i);
    expect(streams).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await external.dispose();
  }
});

test('reconnection reloads authoritative state even when the change signal was missed', async ({ page }) => {
  const { external, workspace } = await setup(page);
  let release = () => {};
  const reconnect = new Promise<void>((resolve) => {
    release = resolve;
  });
  let attempts = 0;
  await page.route('**/account/events?*', async (route) => {
    attempts++;
    if (attempts === 2) await reconnect;
    await route.fulfill({ contentType: 'text/event-stream', body: 'event: ready\ndata: {}\n\n' });
  });
  try {
    await page.goto('/runs');
    await expect(page.getByRole('heading', { name: 'No runs yet' })).toBeVisible();
    await expect.poll(() => attempts).toBe(2);
    const accepted = await external.post('/v1/runs', {
      headers: headers(),
      data: {
        workspace_id: workspace.id,
        harness: 'codex',
        model: 'fixture-model',
        prompt: 'Reconnect fixture',
        billing_mode: 'managed',
      },
    });
    expect(accepted.ok()).toBe(true);
    const run = await accepted.json();
    release();
    await expect(page.getByRole('row').filter({ hasText: run.run_id.slice(-8) })).toBeVisible();
  } finally {
    release();
    await external.dispose();
  }
});

test('periodic reconciliation recovers initial identity failure and refreshes without streaming', async ({
  page,
}) => {
  const { external, workspace } = await setup(page);
  await page.clock.install();
  let identityAvailable = false;
  let subscriptions = 0;
  await page.route('**/v1/me', (route) =>
    identityAvailable
      ? route.continue()
      : route.fulfill({ status: 503, json: { error: { code: 'unavailable' } } }),
  );
  await page.route('**/account/events?*', (route) => {
    subscriptions++;
    return route.fulfill({ status: 503, json: { error: { code: 'unavailable' } } });
  });
  try {
    await page.goto('/runs');
    await expect(page.getByRole('heading', { name: 'No runs yet' })).toBeVisible();
    await page.clock.runFor(1500);
    const accepted = await external.post('/v1/runs', {
      headers: headers(),
      data: {
        workspace_id: workspace.id,
        harness: 'codex',
        model: 'fixture-model',
        prompt: 'Polling fallback fixture',
        billing_mode: 'managed',
      },
    });
    expect(accepted.ok()).toBe(true);
    const run = await accepted.json();
    identityAvailable = true;
    await page.clock.fastForward(71000);
    await page.clock.runFor(1500);
    await expect(page.getByRole('row').filter({ hasText: run.run_id.slice(-8) })).toBeVisible();
    await expect.poll(() => subscriptions).toBeGreaterThan(0);
  } finally {
    await external.dispose();
  }
});

test('saved files, checkpoints and Git status refresh without discarding editor state', async ({ page }) => {
  const { external, workspace, me } = await setup(page);
  const worktree = workspace.default_worktree_id;
  const save = async (content: string) => {
    const current = await (await external.get(`/v1/worktrees/${worktree}`)).json();
    const result = await external.put(`/v1/worktrees/${worktree}/file?path=live.txt`, {
      headers: { ...headers(), 'Content-Type': 'application/octet-stream', 'If-Match': current.revision },
      data: content,
    });
    expect(result.ok(), await result.text()).toBe(true);
  };
  try {
    await page.goto(`/workspaces/${workspace.id}`);
    await expect(page.getByText('No files yet. Add your first file or start an agent run.')).toBeVisible();
    await save('Saved remotely');
    await expect(page.getByRole('treeitem', { name: 'live.txt', exact: true })).toBeVisible();
    const editor = page.getByRole('textbox', { name: 'File editor' });
    await expect(editor).toContainText('Saved remotely');
    await editor.fill('My unsaved draft');
    const scroll = await page.evaluate(() => {
      window.scrollTo(0, 100);
      return window.scrollY;
    });
    const refreshed = page.waitForResponse(
      (r) => r.url().includes(`/v1/worktrees/${worktree}/file?`) && r.request().method() === 'GET',
    );
    await save('Changed by another user');
    await refreshed;
    await expect(editor).toContainText('My unsaved draft');
    expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
    await expect(page.getByRole('treeitem', { name: 'live.txt', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: /revision|changed/i })).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(editor).toContainText('Changed by another user');
    await page.getByRole('tab', { name: 'Checkpoints', exact: true }).click();
    const checkpoints = page.getByRole('button', { name: 'Pin checkpoint', exact: true });
    await expect(checkpoints).toHaveCount(3);
    expect(
      (await external.post(`/v1/worktrees/${worktree}/checkpoints`, { headers: headers(), data: {} })).ok(),
    ).toBe(true);
    await expect(checkpoints).toHaveCount(4);
    // A worker-equivalent committed status fixture; no GitHub network operation.
    const tx = await pool.connect();
    try {
      await tx.query('BEGIN');
      await tx.query("SELECT set_config('app.organization_id',$1,true)", [me.organization_id]);
      await tx.query('UPDATE workspaces SET data=data || $2::jsonb WHERE id=$1', [
        workspace.id,
        JSON.stringify({
          github: { installation_id: 'fixture', repository: 'fixture/repository', target_branch: 'main' },
        }),
      ]);
      await tx.query('UPDATE worktrees SET data=data || $2::jsonb WHERE id=$1', [
        worktree,
        JSON.stringify({ sync: { worktree_id: worktree, status: 'pending' } }),
      ]);
      await tx.query('COMMIT');
    } finally {
      tx.release();
    }
    await page.getByRole('tab', { name: 'Git sync', exact: true }).click();
    await expect(page.getByText('Your repository, kept in sync.')).toBeVisible();
    const statusRefresh = page.waitForResponse((r) => r.url().endsWith(`/v1/worktrees/${worktree}/sync`));
    const tx2 = await pool.connect();
    try {
      await tx2.query('BEGIN');
      await tx2.query("SELECT set_config('app.organization_id',$1,true)", [me.organization_id]);
      await tx2.query('UPDATE worktrees SET data=data || $2::jsonb WHERE id=$1', [
        worktree,
        JSON.stringify({
          sync: {
            worktree_id: worktree,
            status: 'conflict',
            error_code: 'Fixture merge conflict',
            updated_at: new Date().toISOString(),
          },
        }),
      ]);
      await tx2.query('COMMIT');
    } finally {
      tx2.release();
    }
    await statusRefresh;
    await expect(page.getByText('Fixture merge conflict')).toBeVisible();
  } finally {
    await external.dispose();
  }
});

test('organization switching and logout close old subscriptions across tabs', async ({ page, context }) => {
  const { external, workspace, me } = await setup(page);
  const second = await context.newPage();
  try {
    const created = await page.request.post('/v1/organizations', {
      headers: headers(),
      data: { name: 'Other organization' },
    });
    expect(created.ok()).toBe(true);
    const other = await created.json();
    const requests: string[] = [];
    second.on('request', (req) => {
      if (new URL(req.url()).pathname === '/account/events') requests.push(req.url());
    });
    await page.goto('/workspaces');
    await second.goto('/workspaces');
    await expect(second.getByRole('heading', { name: workspace.name })).toBeVisible();
    await expect.poll(() => requests.length).toBe(1);
    await second.getByRole('button', { name: 'Ask Macrofold', exact: true }).click();
    const assistantQuestion = second.getByRole('textbox', { name: 'Ask Macrofold a question' });
    await assistantQuestion.fill('A private setup question for the first organization');
    await assistantQuestion.press('Enter');
    await expect(second.getByRole('log', { name: 'Assistant conversation' })).toContainText(
      'A private setup question for the first organization',
    );
    await second.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Current organization', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Other organization', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toContainText(
      'Other organization',
    );
    await expect(second.getByRole('button', { name: 'Account menu', exact: true })).toContainText(
      'Other organization',
    );
    await expect(second.getByRole('heading', { name: workspace.name })).toHaveCount(0);
    await second.getByRole('button', { name: 'Ask Macrofold', exact: true }).click();
    await expect(second.getByRole('log', { name: 'Assistant conversation' })).toBeEmpty();
    await expect(assistantQuestion).toHaveValue('');
    await expect(second.getByRole('button', { name: 'Help me get started', exact: true })).toBeVisible();
    await second.keyboard.press('Escape');
    await expect.poll(() => requests.at(-1)).toContain(other.id);
    const starts = requests.length;
    await external.post('/v1/runs', {
      headers: headers(),
      data: {
        workspace_id: workspace.id,
        harness: 'codex',
        model: 'fixture-model',
        prompt: 'Old organization run',
        billing_mode: 'managed',
      },
    });
    await page.getByRole('link', { name: 'Runs', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'No runs yet' })).toBeVisible();
    expect(requests.slice(1).every((url) => !url.includes(me.organization_id))).toBe(true);
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    await expect(second.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    expect(requests).toHaveLength(starts);
  } finally {
    await second.close();
    await external.dispose();
  }
});
