import { test, expect } from '../fixtures/browser';

for (const [harness, label] of [
  ['hermes', 'Hermes'],
  ['deepseek', 'DeepSeek Harness'],
  ['pi', 'Pi'],
]) {
  test(`${label} can be selected, run, and replayed through the dashboard`, async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('link', { name: 'Projects', exact: true }).click();
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    const name = `${label} browser fixture ${Date.now()}`;
    await page.getByRole('textbox', { name: 'Project name' }).fill(name);
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New run', exact: true }).click();
    await page.getByRole('combobox', { name: 'Harness', exact: true }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await page
      .getByRole('textbox', { name: 'What would you like to get done?' })
      .fill('Record a project note.');
    const submitted = page.waitForResponse(
      (r) => r.url().endsWith('/v1/runs') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Start run', exact: true }).click();
    const response = await submitted;
    expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON()).toMatchObject({ harness, model: 'fixture-model' });
    await expect(page.getByRole('heading', { name: 'Work, completed.' })).toBeVisible({ timeout: 45000 });
    await expect(page.locator('.markdown-output')).toContainText('Simulation completed');
    await page.reload();
    await page.getByRole('tab', { name: /Tool calls/ }).click();
    await expect(page.getByText('tool.started').first()).toBeVisible();
    await page.getByRole('tab', { name: /Events/ }).click();
    await expect(page.getByText('run.succeeded', { exact: true })).toBeVisible();
  });
}

test('public documentation exposes the harness comparison and typed quickstart', async ({ page }) => {
  await page.goto('/docs/harnesses');
  await expect(page.getByRole('heading', { name: 'Agent harnesses', exact: true })).toBeVisible();
  for (const label of ['Hermes', 'DeepSeek Harness', 'Pi'])
    await expect(page.getByRole('cell', { name: label, exact: true })).toBeVisible();
  await expect(page.locator('article')).toContainText('stream_text');
});
