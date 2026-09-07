import { test, expect, fixtureOrigin } from '../fixtures/browser';
import { randomUUID } from 'node:crypto';

test('preserves an unsaved draft across focus, rejects stale save, and explicitly discards', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make room for your next idea.' })).toBeVisible();
  const headers = () => ({ Origin: fixtureOrigin, 'Idempotency-Key': randomUUID() });
  const created = await page.request.post('/v1/projects', {
    headers: headers(),
    data: { name: 'Draft preservation ' + Date.now() },
  });
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  const fileURL = `/v1/workspaces/${project.default_workspace_id}/file?path=draft.txt`;
  const workspace = await (await page.request.get(`/v1/workspaces/${project.default_workspace_id}`)).json();
  expect(
    (
      await page.request.put(fileURL, {
        headers: { ...headers(), 'Content-Type': 'application/octet-stream', 'If-Match': workspace.revision },
        data: 'Original saved text',
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/projects/${project.id}`);
  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('Original saved text');
  await editor.fill('My unsaved local draft');
  await expect(page.getByRole('button', { name: 'New run', exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Active workspace' })).toBeDisabled();
  const current = await (await page.request.get(`/v1/workspaces/${project.default_workspace_id}`)).json();
  expect(
    (
      await page.request.put(fileURL, {
        headers: { ...headers(), 'Content-Type': 'application/octet-stream', 'If-Match': current.revision },
        data: 'A newer remote revision',
      })
    ).ok(),
  ).toBeTruthy();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: /revision|changed/i })).toBeVisible();
  await expect(editor).toContainText('My unsaved local draft');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(editor).toContainText('My unsaved local draft');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(editor).toContainText('A newer remote revision');
  await expect(page.getByRole('button', { name: 'New run', exact: true })).toBeEnabled();
});

test('debounces autosave, keeps newer typing during a pending save, and shows Saved after persistence', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make room for your next idea.' })).toBeVisible();
  const created = await page.request.post('/v1/projects', {
    headers: { Origin: fixtureOrigin, 'Idempotency-Key': randomUUID() },
    data: { name: 'Autosave ' + randomUUID() },
  });
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('button', { name: 'New file', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'File path' }).fill('autosave.txt');
  await page.getByRole('button', { name: 'Create file', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const editor = page.getByRole('textbox', { name: 'File editor' });
  await expect(editor).toBeEditable();
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes: string[] = [];
  const recoveryKeys: string[] = [];
  await page.route('**/file?path=autosave.txt', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    writes.push(route.request().postData() || '');
    recoveryKeys.push(route.request().headers()['idempotency-key']);
    if (writes.length === 1) await gate;
    if (writes.length === 3) return route.abort();
    await route.continue();
  });
  try {
    await editor.fill('First draft');
    await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await page.clock.runFor(1999);
    expect(writes).toEqual([]);
    await editor.fill('Second draft');
    await page.clock.runFor(1999);
    expect(writes).toEqual([]);
    await page.clock.runFor(1);
    await expect.poll(() => writes).toEqual(['Second draft']);
    await expect(page.getByRole('status').filter({ hasText: 'Saving' })).toBeVisible();
    await editor.fill('Typed while saving');
    await page.clock.runFor(2500);
    expect(writes).toEqual(['Second draft']);
    release();
    await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible();
    await expect(editor).toContainText('Typed while saving');
    await page.clock.runFor(2000);
    await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
    expect(writes).toEqual(['Second draft', 'Typed while saving']);
    const saved = await page.request.get(
      `/v1/workspaces/${project.default_workspace_id}/file?path=autosave.txt`,
    );
    expect(await saved.text()).toBe('Typed while saving');
    await editor.fill('Recovered after interruption');
    await page.clock.runFor(2000);
    await expect(page.getByRole('status').filter({ hasText: 'Not saved' })).toBeVisible();
    await expect(editor).toContainText('Recovered after interruption');
    await page.clock.runFor(6000);
    expect(writes).toHaveLength(3);
    await page.getByRole('button', { name: 'Retry save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
    expect(writes).toHaveLength(4);
    expect(recoveryKeys[3]).toBe(recoveryKeys[2]);
    const recovered = await page.request.get(
      `/v1/workspaces/${project.default_workspace_id}/file?path=autosave.txt`,
    );
    expect(await recovered.text()).toBe('Recovered after interruption');
    await page.screenshot({ path: 'test-results/file-autosave-saved.png', fullPage: true });
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
  await page.clock.resume();
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goBack();
  await expect(page).toHaveURL(`/projects/${project.id}`);
  await expect(editor).toContainText('Recovered after interruption');
});
