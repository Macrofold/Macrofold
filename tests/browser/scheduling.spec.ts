import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { config } from '../../packages/core/src/config';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
test.afterAll(() => pool.end());

test('plan controls and queued run status work through the dashboard and public API', async ({ page }) => {
  const email = randomUUID() + '@example.test',
    password = 'queue-fixture-password-2026';
  const created = await page.request.post('/auth/sign-up/email', {
    headers: { Origin: config.origin },
    data: { name: 'Queue workspace', email, password },
  });
  expect(created.ok()).toBeTruthy();
  const { user } = await created.json();
  await pool.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1', [user.id]);
  expect(
    (
      await page.request.post('/auth/sign-in/email', {
        headers: { Origin: config.origin },
        data: { email, password },
      })
    ).ok(),
  ).toBeTruthy();
  const identity = await (await page.request.get('/v1/me')).json();
  await page.goto('/billing');
  await expect(page.getByRole('region', { name: 'Available plans' }).getByRole('heading')).toHaveText([
    'Starter',
    'Pro',
    'Scale',
  ]);
  const cap = page.getByRole('spinbutton', { name: 'Concurrent jobs', exact: true });
  await expect(cap).toHaveAttribute('max', '2');
  await cap.fill('1');
  await page.getByRole('spinbutton', { name: 'Execution timeout cap (seconds)' }).fill('600');
  await page.getByRole('button', { name: 'Save execution limits' }).click();
  await expect(page.getByText('Execution limits saved')).toBeVisible();
  expect(await (await page.request.get('/v1/organization/execution-policy')).json()).toMatchObject({
    concurrency_limit: 1,
    max_timeout_seconds: 600,
  });
  // A fixture billing entitlement exercises the real dashboard/catalog without Stripe calls.
  await pool.query("UPDATE organizations SET plan='scale' WHERE id=$1", [identity.organization_id]);
  await page.reload();
  await expect(cap).toHaveAttribute('max', '50');
  await cap.fill('');
  await page.getByRole('spinbutton', { name: 'Execution timeout cap (seconds)' }).fill('');
  await page.getByRole('button', { name: 'Save execution limits' }).click();
  await expect(page.getByText('Execution limits saved')).toBeVisible();
  expect(await (await page.request.get('/v1/organization/execution-policy')).json()).toMatchObject({
    concurrency_limit: 50,
    max_timeout_seconds: 7200,
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/plans-desktop.png', fullPage: true });
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.failureSummary) }))).toEqual(
    [],
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).not.toBeInViewport();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: 'test-results/plans-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(path, {
      headers: { Origin: config.origin, 'Idempotency-Key': randomUUID() },
      data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const project = await post('/v1/projects', { name: 'Scheduling UI fixture', persistence: 'persistent' });
  let first: { run_id: string; session_id: string };
  // Pin a queue blocker before a preview worker can claim and finish it.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.organization_id',$1,true)", [identity.organization_id]);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('capacity:global',0))");
    first = await post('/v1/runs', {
      project_id: project.id,
      prompt: 'Workspace writer fixture',
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
    });
    await client.query(
      "UPDATE runs SET status='running',started_at=now(),heartbeat_at=now(),deadline=now()+interval '10 minutes' WHERE id=$1",
      [first.run_id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  try {
    const next = await post(`/v1/sessions/${first.session_id}/messages`, {
      prompt: 'Queued follow-up',
      queue_if_busy: true,
      queue_timeout_seconds: 900,
      scheduling_class: 'interactive',
    });
    expect(next).not.toHaveProperty('queue_position');
    expect(next.waiting_reason).toBe('earlier_workspace_work');
    await page.goto('/runs/' + next.run_id);
    const waiting = page.getByRole('status').filter({ hasText: 'Earlier work is using this workspace' });
    await expect(waiting).toBeVisible();
    await expect(waiting).toContainText('Budget held');
    await expect(waiting).toContainText('Start deadline');
    await page.screenshot({ path: 'test-results/queue-desktop.png', fullPage: true });
    const queueAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(
      queueAudit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.failureSummary) })),
    ).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).not.toBeInViewport();
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
    await page.screenshot({ path: 'test-results/queue-mobile.png', fullPage: true });
    await page.getByRole('button', { name: 'Cancel run', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Run stopped.' })).toBeVisible();
    expect(await (await page.request.get('/v1/runs/' + next.run_id)).json()).toMatchObject({
      status: 'cancelled',
      reserved_micro_usd: '0',
      waiting_reason: null,
    });
  } finally {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id',$1,true)", [identity.organization_id]);
      await client.query("UPDATE runs SET status='queued',cancel_requested=true WHERE id=$1", [first.run_id]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await post('/v1/runs/' + first.run_id + '/cancel', {});
  }
});
