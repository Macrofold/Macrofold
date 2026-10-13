import { test, expect } from '../fixtures/browser';

test('exhausted recovery stops the waiting UI and stream without offering an agent replay', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  const response = await page.request.get('/v1/runs?status=succeeded&limit=1');
  expect(response.ok()).toBeTruthy();
  const run = (await response.json()).data[0];
  expect(run).toBeTruthy();
  await page.route(`**/v1/runs/${run.id}`, (route) =>
    route.fulfill({
      json: {
        ...run,
        status: 'persisting',
        completed_at: null,
        persistence_status: 'pending',
        failure_code: 'run_recovery_required',
      },
    }),
  );
  await page.route(`**/v1/runs/${run.id}/result`, (route) =>
    route.fulfill({
      json: {
        final: false,
        persistence_status: 'pending',
        output_text: '',
      },
    }),
  );
  let attempts = 0;
  await page.route(`**/v1/runs/${run.id}/stream**`, (route) => {
    attempts++;
    return route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({
        id: 'recovery',
        run_id: run.id,
        sequence: '1',
        type: 'run.recovery_required',
        data: {
          code: 'run_recovery_required',
          step: 'checkpoint',
          cause: 'file_permission_denied',
          attempts: 8,
        },
      })}\n\n`,
    });
  });
  await page.goto(`/runs/${run.id}`);
  await expect(page.getByRole('heading', { name: 'Couldn’t save run files.', exact: true })).toBeVisible();
  const notice = page.getByRole('status').filter({ hasText: 'This run will not be replayed automatically' });
  await expect(notice).toBeVisible();
  await expect(page.getByText('Automatic retries stopped', { exact: true })).toBeVisible();
  await expect(notice).toContainText('rejected by this run’s accepted permissions');
  await expect(notice).toContainText('after 8 consecutive failures');
  await expect(notice).toContainText('file changes are not confirmed saved');
  await expect(page.locator('.run-summary-bar .badge')).toHaveText('blocked');
  await expect(page.locator('.run-summary-bar .waiting-text')).toHaveCount(0);
  await expect(
    page.getByText('Inspect the failure details above. Recorded output and events remain available.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByText('Technical details', { exact: true }).click();
  await expect(notice).toContainText('Saving the worktree checkpoint');
  await expect(notice).toContainText('file_permission_denied');
  await expect(page.getByRole('button', { name: 'Continue conversation' })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('recovery-paused.png') });
  await page.getByRole('button', { name: 'View events', exact: true }).click();
  await expect(page.getByRole('tab', { name: /^Events/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.event-row strong', { hasText: 'run.recovery_required' })).toBeVisible();
  const stoppedAt = attempts;
  await page.waitForTimeout(1500);
  expect(attempts).toBe(stoppedAt);
});

test('malformed sign-in links recover and a revoked event stream stops reconnecting', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/login?returnTo=' + encodeURIComponent('http://['));
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  const response = await page.request.get('/v1/runs?status=succeeded&limit=1');
  expect(response.ok()).toBeTruthy();
  const run = (await response.json()).data[0];
  expect(run).toBeTruthy();
  // This independent request context has no dashboard login cookie.
  const anonymous = await request.get(`/v1/runs/${run.id}/stream`);
  expect(anonymous.status()).toBe(401);
  let attempts = 0;
  await page.route(`**/v1/runs/${run.id}/stream**`, (route) => {
    attempts++;
    return route.fulfill({ status: 403, json: { error: { code: 'forbidden', message: 'Access revoked' } } });
  });
  await page.goto(`/runs/${run.id}`);
  await expect(page.getByRole('alert').filter({ hasText: 'Access revoked' })).toBeVisible();
  await expect(page.locator('.run-api-tip code')).toHaveText(`macrofold run attach ${run.id}`);
  // Development Strict Mode may mount twice. Once the error is displayed,
  // neither mount may continue retrying through the old reconnect interval.
  const stoppedAt = attempts;
  expect(stoppedAt).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  expect(attempts).toBe(stoppedAt);
  expect(errors).toEqual([]);
});
