import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import pg from 'pg';
import { config } from '../../packages/core/src/config';
import { test, expect, fixtureOrigin } from '../fixtures/browser';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
test.afterAll(() => pool.end());

async function project(page: Page) {
  // Each journey owns its principal and request budget, including consecutive theme cases.
  const email = `files-${randomUUID()}@example.test`;
  const password = 'file-explorer-fixture-password-2026';
  const signup = await page.request.post('/auth/sign-up/email', {
    headers: { Origin: fixtureOrigin },
    data: { name: 'File explorer', email, password },
  });
  expect(signup.ok(), await signup.text()).toBe(true);
  const { user } = await signup.json();
  expect(
    (await pool.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1', [user.id])).rowCount,
  ).toBe(1);
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email address' }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  const response = await page.request.post('/v1/projects', {
    headers: { Origin: fixtureOrigin, 'Idempotency-Key': randomUUID() },
    data: { name: `File explorer ${randomUUID().slice(0, 8)}`, persistence: 'persistent' },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const value = await response.json();
  await page.goto(`/projects/${value.id}`);
  await expect(page.getByRole('region', { name: 'File viewer' })).toBeVisible();
  return { ...value, root: `/v1/workspaces/${value.default_workspace_id}` };
}
async function create(page: Page, kind: 'file' | 'folder', path: string) {
  await page
    .getByRole('button', { name: `New ${kind}`, exact: true })
    .first()
    .click();
  await page.getByRole('textbox', { name: kind === 'file' ? 'File path' : 'Folder path' }).fill(path);
  await page.getByRole('button', { name: `Create ${kind}`, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function saveSource(page: Page, value: string) {
  const editor = page.getByRole('textbox', { name: 'File editor' });
  await expect(editor).toBeEditable();
  await editor.fill(value);
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible({ timeout: 15000 });
}

test('project and worktree permission editors persist independent restrictions', async ({ page }) => {
  const value = await project(page);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  const projectForm = page
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: 'Project permissions', exact: true }) });
  const worktreeForm = page
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: 'Worktree permissions', exact: true }) });
  const excluded = projectForm.getByRole('textbox', { name: 'read excluded files', exact: true });
  await excluded.fill('secrets/**');
  await excluded.press('End');
  await excluded.press('Enter');
  await excluded.pressSequentially('**/*.env');
  await expect(excluded).toHaveValue('secrets/**\n**/*.env');
  await projectForm.getByRole('button', { name: 'Save project permissions', exact: true }).click();
  await expect
    .poll(async () => (await (await page.request.get(`/v1/projects/${value.id}`)).json()).permissions)
    .toEqual({ version: 1, files: { read: { exclude: ['secrets/**', '**/*.env'] } } });
  await worktreeForm.getByLabel('Deny all writes', { exact: true }).check();
  await worktreeForm.getByRole('button', { name: 'Save worktree permissions', exact: true }).click();
  await expect
    .poll(async () => (await (await page.request.get(value.root)).json()).permissions)
    .toEqual({ version: 1, files: { write: { include: [] } } });
  await page.reload();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(excluded).toHaveValue('secrets/**\n**/*.env');
  await expect(worktreeForm.getByLabel('Deny all writes', { exact: true })).toBeChecked();
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} folders, Markdown, rename, upload and deletion survive reloads`, async ({
    page,
    context,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: fixtureOrigin });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const value = await project(page);
    await create(page, 'folder', 'notes/research');
    await expect(page.getByRole('heading', { name: 'research', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'This folder is empty' })).toBeVisible();
    await page.reload();
    const notes = page.getByRole('treeitem', { name: 'notes', exact: true });
    await notes.click();
    const research = page.getByRole('treeitem', { name: 'research', exact: true });
    await research.click();
    await expect(research).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('heading', { name: 'This folder is empty' })).toBeVisible();
    await page.getByRole('button', { name: 'New file', exact: true }).first().click();
    await expect(page.getByRole('textbox', { name: 'File path' })).toHaveValue('notes/research/');
    await page.getByRole('textbox', { name: 'File path' }).fill('notes/research/plan.md');
    await page.getByRole('button', { name: 'Create file', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const source =
      '# Personal plan\n\n## This week\n\n- [x] Read a book\n\n| Day | Plan |\n| --- | --- |\n| Friday | Walk |\n\n```js\nconst ready = true;\n```\n\n[Section](#this-week)\n';
    await saveSource(page, source);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const viewer = page.getByRole('region', { name: 'File viewer' });
    await expect(viewer.getByRole('heading', { name: 'Personal plan' })).toBeVisible();
    await expect(viewer.getByRole('table')).toContainText('Friday');
    await expect(viewer.getByRole('checkbox', { name: 'Read a book' })).toBeChecked();
    const richAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(
      richAudit.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })),
    ).toEqual([]);
    await page.screenshot({ path: `test-results/file-markdown-${theme}.png` });
    await viewer.getByRole('button', { name: 'Copy code', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'Copy code', exact: true })).toHaveAttribute(
      'data-copy-state',
      'copied',
    );
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('const ready = true;');
    // Changing a sibling control must not remount Markdown code-block feedback.
    await page.getByRole('button', { name: 'Show hidden files', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'Copy code', exact: true })).toHaveAttribute(
      'data-copy-state',
      'copied',
    );
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'File editor' })).toContainText('const ready = true;');
    expect(await (await page.request.get(`${value.root}/file?path=notes/research/plan.md`)).text()).toBe(
      source,
    );
    await page.getByRole('button', { name: 'Rename selected file' }).click();
    await page.getByRole('textbox', { name: 'Rename plan.md' }).fill('week.md');
    await page.getByRole('textbox', { name: 'Rename plan.md' }).press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('treeitem', { name: 'week.md', exact: true })).toBeVisible();
    expect((await page.request.get(`${value.root}/file?path=notes/research/plan.md`)).status()).toBe(404);
    expect(await (await page.request.get(`${value.root}/file?path=notes/research/week.md`)).text()).toBe(
      source,
    );
    await page.reload();
    await page.getByRole('treeitem', { name: 'notes', exact: true }).click();
    await page.getByRole('treeitem', { name: 'research', exact: true }).click();
    await page.getByRole('treeitem', { name: 'week.md', exact: true }).click();
    await expect(viewer.getByRole('heading', { name: 'Personal plan' })).toBeVisible();
    await page.getByRole('button', { name: 'Upload files', exact: true }).click();
    await page.getByLabel('Choose files').setInputFiles({
      name: 'packing.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Shoes and water'),
    });
    await page.getByRole('button', { name: 'Upload 1 file', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await (await page.request.get(`${value.root}/file?path=notes/research/packing.txt`)).text()).toBe(
      'Shoes and water',
    );
    await page.getByRole('button', { name: 'Rename selected file' }).click();
    await page.getByRole('textbox', { name: 'Rename week.md' }).fill('packing.txt');
    await page.getByRole('textbox', { name: 'Rename week.md' }).press('Enter');
    await expect(page.getByRole('alert').filter({ hasText: /already exists/i })).toBeVisible();
    await page.getByRole('textbox', { name: 'Rename week.md' }).press('Escape');
    expect(await (await page.request.get(`${value.root}/file?path=notes/research/week.md`)).text()).toBe(
      source,
    );
    await page.getByRole('button', { name: 'Delete selected file' }).click();
    await page.getByRole('button', { name: 'Delete file', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('treeitem', { name: 'week.md', exact: true })).toHaveCount(0);
    expect((await page.request.get(`${value.root}/file?path=notes/research/week.md`)).status()).toBe(404);
    await page.reload();
    await page.getByRole('treeitem', { name: 'notes', exact: true }).click();
    await page.getByRole('treeitem', { name: 'research', exact: true }).click();
    await expect(page.getByRole('treeitem', { name: 'packing.txt', exact: true })).toBeVisible();
    await expect(page.getByRole('treeitem', { name: 'week.md', exact: true })).toHaveCount(0);
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(
      audit.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })),
    ).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('file mutations prevent duplicate submits, preserve failures and finish without unrelated refreshes', async ({
  page,
}) => {
  const value = await project(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  await page.route(`**${value.root}/file?path=fast.txt&create_only=true`, async (route) => {
    writes++;
    await gate;
    await route.continue();
  });
  await page.getByRole('button', { name: 'New file', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'File path' }).fill('fast.txt');
  await page.getByRole('button', { name: 'Create file', exact: true }).click();
  try {
    await expect.poll(() => writes).toBe(1);
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Create file' })).toBeDisabled();
    await page.getByRole('textbox', { name: 'File path' }).press('Enter');
    expect(writes).toBe(1);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await saveSource(page, 'Keep my file');
  await page.route(`**${value.root}/file?path=fast.txt`, (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({
          status: 503,
          json: { error: { code: 'unavailable', message: 'Storage is temporarily unavailable.' } },
        })
      : route.continue(),
  );
  await page.getByRole('button', { name: 'Delete selected file' }).click();
  await page.getByRole('button', { name: 'Delete file', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /temporarily unavailable/ })).toBeVisible();
  await expect(
    page.getByRole('treeitem', { name: 'fast.txt', exact: true, includeHidden: true }),
  ).toHaveCount(1);
  expect(await (await page.request.get(`${value.root}/file?path=fast.txt`)).text()).toBe('Keep my file');
  await page.unrouteAll({ behavior: 'wait' });
  let releaseRefresh!: () => void;
  const refresh = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  await page.route(`**${value.root}`, async (route) => {
    await refresh;
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: 'Delete file', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('treeitem', { name: 'fast.txt', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New folder', exact: true })).toBeEnabled();
  } finally {
    releaseRefresh();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('rename waits for authoritative destination content after a concurrent source edit', async ({
  page,
}) => {
  const value = await project(page);
  await create(page, 'file', 'shared.txt');
  await saveSource(page, 'Original text');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let destinationReads = 0;
  await page.route(`**${value.root}/file?*`, async (route) => {
    if (route.request().method() === 'GET') {
      if (new URL(route.request().url()).searchParams.get('path') === 'renamed.txt') destinationReads++;
      await gate;
    }
    await route.continue();
  });
  try {
    const workspace = await (await page.request.get(value.root)).json();
    const changed = await page.request.put(`${value.root}/file?path=shared.txt`, {
      headers: {
        Origin: fixtureOrigin,
        'Idempotency-Key': randomUUID(),
        'If-Match': workspace.revision,
        'Content-Type': 'application/octet-stream',
      },
      data: 'Newer text from another client',
    });
    expect(changed.ok(), await changed.text()).toBe(true);
    const operation = await changed.json();
    await expect(page.getByText(`Revision ${operation.result.revision}`, { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'File editor' })).toContainText('Original text');
    await page.getByRole('button', { name: 'Rename selected file' }).click();
    await page.getByRole('textbox', { name: 'Rename shared.txt' }).fill('renamed.txt');
    await page.getByRole('textbox', { name: 'Rename shared.txt' }).press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => destinationReads).toBeGreaterThan(0);
    // The old buffer must never become editable under the newly committed revision.
    await expect(page.getByRole('textbox', { name: 'File editor' })).toHaveCount(0);
    expect(await (await page.request.get(`${value.root}/file?path=renamed.txt`)).text()).toBe(
      'Newer text from another client',
    );
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
  await expect(page.getByRole('textbox', { name: 'File editor' })).toContainText(
    'Newer text from another client',
  );
  await saveSource(page, 'Newer text from another client\nMy addition');
  expect(await (await page.request.get(`${value.root}/file?path=renamed.txt`)).text()).toBe(
    'Newer text from another client\nMy addition',
  );
});

test('file viewer grows with the viewport and explorer resizing persists without overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await project(page);
  await create(page, 'file', 'readme.md');
  await saveSource(page, '# Read me\n\nA short document.');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const viewer = page.getByRole('region', { name: 'File viewer' });
  const before = (await viewer.boundingBox())!;
  expect(1000 - before.y - before.height).toBeGreaterThanOrEqual(10);
  expect(1000 - before.y - before.height).toBeLessThanOrEqual(30);
  await page.setViewportSize({ width: 1440, height: 1250 });
  await expect.poll(async () => Math.round((await viewer.boundingBox())!.height - before.height)).toBe(250);
  const separator = page.getByRole('separator', { name: 'Resize file explorer' });
  await separator.focus();
  const oldWidth = Number(await separator.getAttribute('aria-valuenow'));
  await separator.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', String(oldWidth + 16));
  const box = (await separator.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 80);
  await page.mouse.up();
  const width = await separator.getAttribute('aria-valuenow');
  expect(Number(width)).toBe(oldWidth + 76);
  await page.reload();
  await expect(separator).toHaveAttribute('aria-valuenow', width!);
  await expect(viewer.getByRole('heading', { name: 'Read me', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/file-workspace-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(separator).toBeHidden();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await expect(viewer).toBeVisible();
  await expect
    .poll(async () => {
      const sidebar = (await page.locator('#workspace-sidebar').boundingBox())!;
      return Math.round(sidebar.x + sidebar.width);
    })
    .toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'test-results/file-workspace-mobile.png' });
});

test('file menus copy, duplicate, rename inline and drag into folders; rich edits round-trip', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: fixtureOrigin });
  const value = await project(page);
  await create(page, 'folder', 'notes');
  await create(page, 'file', 'plan.md');
  await saveSource(page, '---\ntitle: Keep metadata\n---\n\n# Personal plan\n\nRead a book.\n');
  await page.getByRole('button', { name: 'Rich', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Markdown formatting' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'Rich Markdown editor' });
  await expect(editor).toBeEditable();
  await editor.getByText('Read a book.', { exact: true }).click();
  await editor.press('End');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await page.keyboard.type(' Today.');
  await page.getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(page.getByText('Changes since last save')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  const saved = await (await page.request.get(`${value.root}/file?path=plan.md`)).text();
  expect(saved).toContain('---\ntitle: Keep metadata\n---\n');
  expect(saved).toContain('**');
  expect(saved).toContain('Today.');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'File editor' })).toContainText('Today.');
  const row = page.getByRole('treeitem', { name: 'plan.md', exact: true });
  await row.hover();
  await row.getByRole('button', { name: 'Actions for plan.md' }).click();
  const copy = page.getByRole('menuitem', { name: 'Copy name', exact: true });
  await copy.click();
  await expect(copy).toHaveAttribute('data-copy-state', 'copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('plan.md');
  const color = await copy.locator('.copy-feedback-check').evaluate((element) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = getComputedStyle(element).color;
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data);
  });
  expect(color[1]).toBeGreaterThan(color[0]);
  expect(color[1]).toBeGreaterThan(color[2]);
  await page.evaluate(() => navigator.clipboard.writeText('replacement'));
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('plan.md');
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
  const duplicate = page.getByRole('treeitem', { name: 'plan copy.md', exact: true });
  await expect(duplicate).toBeVisible();
  expect(await (await page.request.get(`${value.root}/file?path=plan%20copy.md`)).text()).toBe(saved);
  await duplicate.hover();
  await duplicate.getByRole('button', { name: 'Actions for plan copy.md' }).click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Rename plan copy.md' });
  await expect(name).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await name.fill('weekly.md');
  await name.press('Enter');
  const renamed = page.getByRole('treeitem', { name: 'weekly.md', exact: true });
  await expect(renamed).toBeVisible();
  await renamed.dragTo(page.getByRole('treeitem', { name: 'notes', exact: true }));
  await expect
    .poll(async () => (await page.request.get(`${value.root}/file?path=notes/weekly.md`)).status())
    .toBe(200);
  expect((await page.request.get(`${value.root}/file?path=weekly.md`)).status()).toBe(404);
  await page.reload();
  await page.getByRole('treeitem', { name: 'notes', exact: true }).click();
  await page.getByRole('treeitem', { name: 'weekly.md', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Personal plan' })).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Markdown formatting' })).toBeVisible();
});

test('worktree dialog derives names and branches, rejects duplicates and supports deferred names', async ({
  page,
}) => {
  const value = await project(page);
  await page.getByRole('button', { name: 'Worktree', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create worktree', exact: true });
  const name = dialog.getByRole('textbox', { name: 'Name', exact: true });
  const branch = dialog.getByRole('combobox', { name: 'Branch', exact: true });
  await expect(name).toHaveAttribute('placeholder', /Smart name/);
  await name.fill('main');
  await expect(dialog.getByRole('button', { name: 'Create worktree', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('status')).toContainText('already exists');
  await name.fill('Personal agent');
  await branch.fill('personal-agent');
  await expect(dialog.getByLabel('Branch available')).toBeVisible();
  await dialog.getByRole('button', { name: 'Create worktree', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Active worktree' })).toContainText('Personal agent');
  const created = (await (await page.request.get(`/v1/projects/${value.id}/workspaces`)).json()).data.find(
    (item: { name: string }) => item.name === 'Personal agent',
  );
  expect(created.branch).toBe('personal-agent');
  await page.getByRole('button', { name: 'Worktree', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('first agent task');
  await dialog.getByRole('button', { name: 'Create worktree', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Active worktree' })).toContainText('Untitled worktree');
  const id = new URL(page.url()).pathname.split('/').pop()!;
  expect(await (await page.request.get(`/v1/workspaces/${id}`)).json()).toMatchObject({
    name: null,
    branch: null,
  });
  const run = await page.request.post('/v1/runs', {
    headers: { Origin: fixtureOrigin, 'Idempotency-Key': randomUUID() },
    data: {
      workspace_id: id,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Organize my week',
    },
  });
  expect(run.ok(), await run.text()).toBe(true);
  expect(await (await page.request.get(`/v1/workspaces/${id}`)).json()).toMatchObject({
    id,
    name: 'organize-my-week',
    branch: 'organize-my-week',
  });
});

test('rich Markdown controls preserve lists, tables and details across source and reload', async ({
  page,
}) => {
  const value = await project(page);
  await create(page, 'file', 'journal.md');
  await saveSource(
    page,
    '# Journal\n\n- [ ] Read a book\n\n| Day | Plan |\n| --- | --- |\n| Friday | Walk |\n\nPrivate notes\n',
  );
  await page.getByRole('button', { name: 'Rich', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Rich Markdown editor' });
  await editor.getByRole('checkbox', { name: 'Read a book' }).check();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(await (await page.request.get(`${value.root}/file?path=journal.md`)).text()).toContain(
    '- [x] Read a book',
  );
  await editor.getByRole('cell', { name: 'Walk', exact: true }).click();
  await page.getByRole('button', { name: 'More formatting' }).click();
  await page.getByRole('menuitem', { name: 'Add row', exact: true }).click();
  await expect(editor.getByRole('row')).toHaveCount(3);
  await page.getByRole('button', { name: 'More formatting' }).click();
  await expect(page.getByRole('menuitem', { name: 'Collapsible section', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await editor.getByText('Private notes', { exact: true }).click();
  await page.getByRole('button', { name: 'More formatting' }).click();
  await page.getByRole('menuitem', { name: 'Collapsible section', exact: true }).click();
  await expect(editor.getByRole('button', { name: /details content/ })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  const source = await (await page.request.get(`${value.root}/file?path=journal.md`)).text();
  expect(source).toContain('Private notes');
  expect(source).toContain(':::details');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'File editor' })).toContainText(':::details');
  await page.getByRole('button', { name: 'Rich', exact: true }).click();
  await expect(editor.getByRole('checkbox', { name: 'Read a book' })).toBeChecked();
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(
    audit.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })),
  ).toEqual([]);
  await page.reload();
  await page.getByRole('treeitem', { name: 'journal.md', exact: true }).click();
  await expect(editor.getByRole('button', { name: /details content/ })).toBeVisible();
  await expect(editor.getByRole('checkbox', { name: 'Read a book' })).toBeChecked();
});
