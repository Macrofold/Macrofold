import { test, expect, fixtureOrigin } from '../fixtures/browser';

test('device approval issues a scoped API token and refresh/revocation remain enforceable', async ({
  page,
  request,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make room for your next idea.' })).toBeVisible();
  const deviceResponse = await request.post('/auth/device/code', {
    form: {
      client_id: 'hosted-agent-cli',
      scope: 'identity:read projects:read offline_access',
      resource: fixtureOrigin + '/v1',
    },
  });
  expect(deviceResponse.ok()).toBeTruthy();
  const device = await deviceResponse.json();
  await page.goto(`/device?user_code=${encodeURIComponent(device.user_code)}`);
  await expect(page.getByText(device.user_code, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Authorize terminal' }).click();
  await expect(page.getByText('Your terminal is connected.')).toBeVisible();
  const response = await request.post('/auth/oauth2/token', {
    form: {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: device.device_code,
      client_id: 'hosted-agent-cli',
      resource: fixtureOrigin + '/v1',
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const tokens = await response.json();
  expect(tokens.access_token).toBeTruthy();
  expect(tokens.refresh_token).toBeTruthy();
  const identity = await request.get('/v1/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  expect(identity.ok(), await identity.text()).toBeTruthy();
  const denied = await request.post('/v1/projects', {
    headers: { Authorization: `Bearer ${tokens.access_token}`, 'Idempotency-Key': crypto.randomUUID() },
    data: { name: 'Forbidden scope' },
  });
  expect(denied.status()).toBe(403);
  const refresh = await request.post('/auth/oauth2/token', {
    form: {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: 'hosted-agent-cli',
      resource: fixtureOrigin + '/v1',
    },
  });
  expect(refresh.ok(), await refresh.text()).toBeTruthy();
  const rotated = await refresh.json();
  const revoked = await request.post('/auth/oauth2/revoke', {
    form: { token: rotated.refresh_token, token_type_hint: 'refresh_token', client_id: 'hosted-agent-cli' },
  });
  expect(revoked.ok()).toBeTruthy();
  const cannotUseRevokedAccess = await request.get('/v1/me', {
    headers: { Authorization: `Bearer ${rotated.access_token}` },
  });
  expect(cannotUseRevokedAccess.status()).toBe(401);
  const cannotRefresh = await request.post('/auth/oauth2/token', {
    form: {
      grant_type: 'refresh_token',
      refresh_token: rotated.refresh_token,
      client_id: 'hosted-agent-cli',
      resource: fixtureOrigin + '/v1',
    },
  });
  expect(cannotRefresh.ok()).toBeFalsy();
});
