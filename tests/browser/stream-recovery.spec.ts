import { test, expect } from '@playwright/test';

test('malformed sign-in links recover and a revoked event stream stops reconnecting', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/login?returnTo=' + encodeURIComponent('http://['));
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make room for your next idea.' })).toBeVisible();
  const response = await page.request.get('/v1/runs?status=succeeded&limit=1');
  expect(response.ok()).toBeTruthy();
  const run = (await response.json()).data[0];
  expect(run).toBeTruthy();
  let attempts = 0;
  await page.route(`**/v1/runs/${run.id}/stream**`, (route) => {
    attempts++;
    return route.fulfill({ status: 403, json: { error: { code: 'forbidden', message: 'Access revoked' } } });
  });
  await page.goto(`/runs/${run.id}`);
  await expect(page.getByRole('alert').filter({ hasText: 'Access revoked' })).toBeVisible();
  await expect(page.locator('.run-api-tip code')).toHaveText(`agent run attach ${run.id}`);
  // Development Strict Mode may mount twice. Once the error is displayed,
  // neither mount may continue retrying through the old reconnect interval.
  const stoppedAt = attempts;
  expect(stoppedAt).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  expect(attempts).toBe(stoppedAt);
  expect(errors).toEqual([]);
});
