import { test, expect } from '@playwright/test';
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
test('finds projects and files beyond the first page and exposes every cursor page', async ({ page }) => {
  const headers = { Origin: 'http://localhost:3210', 'Idempotency-Key': randomUUID() },
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
  const project = await (
    await page.request.post('/v1/projects', {
      headers,
      data: { name: 'Explorer project', persistence: 'persistent' },
    })
  ).json();
  expect(project).toHaveProperty('default_workspace_id');
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    await tx.query("SELECT set_config('app.organization_id',$1,true)", [org]);
    for (let i = 0; i < 105; i++)
      await tx.query('INSERT INTO projects(id,organization_id,data) VALUES($1,$2,$3)', [
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
  await page.goto('/projects');
  await expect(page.locator('.project-card:not(.new-project)')).toHaveCount(25);
  for (const count of [50, 75, 100, 106]) {
    await page.getByRole('button', { name: 'More projects', exact: true }).click();
    await expect(page.locator('.project-card:not(.new-project)')).toHaveCount(count);
  }
  await expect(page.getByRole('button', { name: 'More projects', exact: true })).toHaveCount(0);
  await page.getByLabel('Search projects').fill('research 104');
  await expect(page.locator('.project-card:not(.new-project)')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Archived research 104' })).toBeVisible();
  await page.getByLabel('Search projects').fill('Explorer project');
  await page.getByRole('heading', { name: 'Explorer project' }).click();
  // Fixture contents share a real persisted object; only filenames are expanded directly.
  let ws = await (await page.request.get(`/v1/workspaces/${project.default_workspace_id}`)).json();
  expect(
    (
      await page.request.put(`/v1/workspaces/${ws.id}/file?path=source.txt`, {
        headers: { ...headers, 'Content-Type': 'application/octet-stream', 'If-Match': ws.revision },
        data: 'verified pagination fixture',
      })
    ).ok(),
  ).toBeTruthy();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.organization_id',$1,true)", [org]);
    const files = (await db.query("SELECT data->'files' AS files FROM workspaces WHERE id=$1", [ws.id]))
      .rows[0].files;
    const source = files.find((f: any) => f.path === 'source.txt');
    await db.query(
      `UPDATE workspaces SET data=jsonb_set(data,'{files}',$2),revision=revision+1 WHERE id=$1`,
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
  await expect(page.locator('.file-row')).toHaveCount(100);
  await page.getByRole('button', { name: 'More files', exact: true }).click();
  await expect(page.locator('.file-row')).toHaveCount(130);
  await page.getByLabel('Filter files').fill('RECORD-129');
  await expect(page.locator('.file-row')).toHaveCount(1);
  await page.locator('.file-row').click();
  await expect(page.locator('.cm-content')).toContainText('verified pagination fixture');
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(
    audit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ summary: n.failureSummary, target: n.target })),
    })),
  ).toEqual([]);
});
