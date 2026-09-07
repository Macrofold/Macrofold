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
  await page.getByRole('button', { name: 'Save', exact: true }).click();
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
