import { test, expect, fixtureOrigin } from '../fixtures/browser';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgres://platform_app:local-app-only@127.0.0.1:55432/platform',
});
test.afterAll(async () => {
  await pool.end();
});
test('finds workspaces and files beyond the first page and exposes every cursor page', async ({ page }) => {
  const headers = { Origin: fixtureOrigin, 'Idempotency-Key': randomUUID() },
    email = randomUUID() + '@example.test',
    password = 'local-pages-fixture-2026';
  const signup = await page.request.post('/auth/sign-up/email', {
    headers,
    data: { email, password, name: 'Pagination owner' },
  });
  expect(signup.ok()).toBeTruthy();
  const { user } = await signup.json();
  await pool.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1', [user.id]);
  expect(
    (await page.request.post('/auth/sign-in/email', { headers, data: { email, password } })).ok(),
  ).toBeTruthy();
  const identity = await (await page.request.get('/v1/me')).json(),
    org = identity.organization_id;
  const workspace = await (
    await page.request.post('/v1/workspaces', {
      headers,
      data: { name: 'Explorer workspace', persistence: 'persistent' },
    })
  ).json();
  expect(workspace).toHaveProperty('default_worktree_id');
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    await tx.query("SELECT set_config('app.organization_id',$1,true)", [org]);
    for (let i = 0; i < 105; i++)
      await tx.query('INSERT INTO workspaces(id,organization_id,data) VALUES($1,$2,$3)', [
        randomUUID(),
        org,
        JSON.stringify({
          name: `Archived research ${String(i).padStart(3, '0')}`,
          archived: false,
          persistence: 'persistent',
        }),
      ]);
    await tx.query('COMMIT');
  } catch (e) {
    await tx.query('ROLLBACK');
    throw e;
  } finally {
    tx.release();
  }
  await page.goto('/workspaces');
  await expect(page.locator('.workspace-list-row')).toHaveCount(25);
  for (const count of [50, 75, 100, 106]) {
    await page.getByRole('button', { name: 'More workspaces', exact: true }).click();
    await expect(page.locator('.workspace-list-row')).toHaveCount(count);
  }
  await expect(page.getByRole('button', { name: 'More workspaces', exact: true })).toHaveCount(0);
  await page.getByLabel('Search workspaces').fill('research 104');
  await expect(page.locator('.workspace-list-row')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Archived research 104' })).toBeVisible();
  await page.getByLabel('Search workspaces').fill('Explorer workspace');
  await page.getByRole('heading', { name: 'Explorer workspace' }).click();
  // Fixture contents share a real persisted object; only filenames are expanded directly.
  let ws = await (await page.request.get(`/v1/worktrees/${workspace.default_worktree_id}`)).json();
  expect(
    (
      await page.request.put(`/v1/worktrees/${ws.id}/file?path=source.txt`, {
        headers: { ...headers, 'Content-Type': 'application/octet-stream', 'If-Match': ws.revision },
        data: 'verified pagination fixture',
      })
    ).ok(),
  ).toBeTruthy();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.organization_id',$1,true)", [org]);
    const files = (await db.query("SELECT data->'files' AS files FROM worktrees WHERE id=$1", [ws.id]))
      .rows[0].files;
    const source = files.find((f: any) => f.path === 'source.txt');
    await db.query(
      `UPDATE worktrees SET data=jsonb_set(data,'{files}',$2),revision=revision+1 WHERE id=$1`,
      [
        ws.id,
        JSON.stringify(
          Array.from({ length: 130 }, (_, i) => ({
            ...source,
            path: `files/record-${String(i).padStart(3, '0')}.txt`,
          })),
        ),
      ],
    );
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
  await page.reload();
  const folder = page.getByRole('treeitem', { name: 'files', exact: true });
  await expect(folder).toBeVisible();
  await folder.click();
  const tree = page.getByRole('tree', { name: 'Worktree files' });
  await expect(tree.getByRole('treeitem').filter({ hasText: /record-\d{3}\.txt/ })).toHaveCount(100);
  await tree.getByRole('treeitem', { name: 'Load more in files' }).click();
  await expect(tree.getByRole('treeitem').filter({ hasText: /record-\d{3}\.txt/ })).toHaveCount(130);
  await page.getByLabel('Filter files').fill('RECORD-129');
  await expect(tree.getByRole('treeitem').filter({ hasText: /record-\d{3}\.txt/ })).toHaveCount(1);
  await tree.getByRole('treeitem', { name: 'record-129.txt', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('verified pagination fixture');
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(
    audit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ summary: n.failureSummary, target: n.target })),
    })),
  ).toEqual([]);
});
