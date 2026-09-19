import { test, expect } from '../fixtures/browser';
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';

test('shows a typed proposal, its receipt and task lineage without native worktree controls', async ({
  page,
}) => {
  // Seed in a tsx process, avoiding Playwright's ESM loader for server modules.
  const output = execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `
    import { decisionBrowserFixture } from './tests/fixtures/decision-browser.ts';
    import { pool, authPool } from './packages/db/index.ts';
    try { console.log(JSON.stringify(await decisionBrowserFixture())); }
    finally { await pool.end(); await authPool.end(); }
  `,
    ],
    { encoding: 'utf8' },
  );
  const fixture = JSON.parse(output.trim().split('\n').at(-1)!) as {
    email: string;
    password: string;
    runId: string;
  };
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(fixture.email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Workspaces', exact: true })).toBeVisible();
  await page.goto(`/runs/${fixture.runId}`);
  const result = page.getByRole('region', { name: 'Decision result' });
  await expect(result.getByRole('heading', { name: 'Validated proposal' })).toBeVisible();
  await expect(result).toContainText('investigate');
  await expect(page.getByRole('region', { name: 'Task lineage' })).toContainText('Application review');
  await expect(page.getByRole('region', { name: 'Task lineage' })).toContainText('$0.00015');
  await expect(page.getByText('20 seconds', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open worktree', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue conversation', exact: true })).toHaveCount(0);
  await result.getByText('Evidence and validation receipt').click();
  await expect(result).toContainText('context_digest');
  const issues = await new AxeBuilder({ page }).include('main').analyze();
  expect(issues.violations).toEqual([]);
  await page.screenshot({ path: 'test-results/decision-task.png', fullPage: true });
});
