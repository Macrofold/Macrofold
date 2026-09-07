import { test, expect, fixtureOrigin } from '../fixtures/browser';
import { createHmac, createHash, randomBytes, randomUUID as id } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import pg from 'pg';
const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgres://platform_app:local-app-only@127.0.0.1:55432/platform',
});
const origin = fixtureOrigin,
  password = 'local-fixture-password-2026';
async function fixtureAccount(request: import('@playwright/test').APIRequestContext, label: string) {
  const email = id() + '@example.test';
  const response = await request.post('/auth/sign-up/email', {
    headers: { Origin: origin },
    data: { email, password, name: label },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const { user } = await response.json();
  await pool.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1', [user.id]);
  const signed = await request.post('/auth/sign-in/email', {
    headers: { Origin: origin },
    data: { email, password },
  });
  expect(signed.ok(), await signed.text()).toBeTruthy();
  return { p: { email }, key: 'sk_no-bearer-allowed' };
}
function totp(secret: string) {
  const bits = [...secret.toUpperCase().replace(/=+$/, '')]
    .map((c) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0'))
    .join('');
  const key = Buffer.from((bits.match(/.{8}/g) || []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', key).update(counter).digest(),
    offset = digest[19]! & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
test('authenticator enrollment, challenge, single-use recovery codes and account controls', async ({
  page,
}) => {
  test.setTimeout(120000);
  const a = await fixtureAccount(page.request, 'Security browser');
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Account & security' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Display name' }).fill('Updated identity');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.getByRole('button', { name: 'Set up authenticator' }).click();
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.recovery-codes')).toBeVisible();
  const backups = (await page.locator('.recovery-codes').innerText()).split('\n');
  await page.getByText('Enter a setup key manually').click();
  const secret = (await page.locator('details code').textContent())!.trim();
  await page.getByLabel('Authenticator code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and enable' }).click();
  await expect(page.getByRole('button', { name: 'Disable two-factor', exact: true })).toBeVisible();
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10000 });
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.failureSummary) }))).toEqual(
    [],
  );
  await page.screenshot({ path: 'test-results/security-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: 'test-results/security-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Sign out this device' }).click();
  await expect(page).toHaveURL(/\/login/);
  async function signIn() {
    await page.goto('/login?returnTo=%2Faccount');
    await page.getByLabel('Email address').fill(a.p.email!);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'One more step.' })).toBeVisible();
  }
  await signIn();
  expect((await page.request.get('/v1/me')).status()).toBe(401);
  await page.getByRole('button', { name: 'Use a recovery code' }).click();
  await page.getByLabel('Recovery code', { exact: true }).fill(backups[0]!);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.getByRole('button', { name: 'Sign out this device' }).click();
  await expect(page).toHaveURL(/\/login/);
  await signIn();
  await page.getByRole('button', { name: 'Use a recovery code' }).click();
  await page.getByLabel('Recovery code', { exact: true }).fill(backups[0]!);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Recovery code', { exact: true }).fill(backups[1]!);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.getByRole('button', { name: 'Disable two-factor', exact: true }).click();
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('dialog').getByRole('button', { name: 'Disable two-factor', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Set up authenticator' })).toBeVisible();
});

test('signed OAuth consent, PKCE and account-wide application revocation', async ({
  page,
  context,
  request,
}) => {
  const a = await fixtureAccount(page.request, 'Consent browser'),
    client = 'browser-' + id();
  await pool.query(
    `INSERT INTO auth."oauthClient"(id,"clientId",name,scopes,"redirectUris","tokenEndpointAuthMethod","applicationType","grantTypes","responseTypes","requirePKCE",disabled,"skipConsent","createdAt","updatedAt") VALUES($1,$2,'Fixture application',$3,$4,'none','web','["authorization_code","refresh_token"]','["code"]',true,false,false,now(),now())`,
    [
      id(),
      client,
      JSON.stringify(['identity:read', 'offline_access']),
      JSON.stringify([origin + '/oauth-test-callback']),
    ],
  );
  await pool.query(
    'INSERT INTO auth."oauthClientResource"(id,"clientId","resourceId","createdAt") VALUES($1,$2,$3,now())',
    [id(), client, origin + '/v1'],
  );
  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({
    client_id: client,
    response_type: 'code',
    redirect_uri: origin + '/oauth-test-callback',
    scope: 'identity:read offline_access',
    resource: origin + '/v1',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'fixture-state',
  });
  await context.clearCookies();
  await page.goto('/auth/oauth2/authorize?' + params);
  await expect(page).toHaveURL(/\/login\?/);
  await page.getByLabel('Email address').fill(a.p.email!);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect Fixture application?' })).toBeVisible();
  const signedUrl = page.url();
  await page.goto(signedUrl.replace('identity%3Aread', 'projects%3Awrite'));
  await expect(page.getByRole('heading', { name: 'Connection unavailable.' })).toBeVisible();
  await page.goto(signedUrl);
  await page.route('**/oauth-test-callback?**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<main>OAuth callback received</main>' }),
  );
  await page.getByRole('button', { name: 'Allow access' }).click();
  await expect(page).toHaveURL(/\/oauth-test-callback\?/);
  const callback = new URL(page.url());
  expect(callback.searchParams.get('state')).toBe('fixture-state');
  const tokenResponse = await request.post('/auth/oauth2/token', {
    form: {
      grant_type: 'authorization_code',
      client_id: client,
      code: callback.searchParams.get('code')!,
      redirect_uri: origin + '/oauth-test-callback',
      code_verifier: verifier,
      resource: origin + '/v1',
    },
  });
  expect(tokenResponse.ok(), await tokenResponse.text()).toBeTruthy();
  const tokens = await tokenResponse.json();
  expect(
    (await request.get('/v1/me', { headers: { Authorization: 'Bearer ' + tokens.access_token } })).ok(),
  ).toBeTruthy();
  await page.goto('/account');
  await page.getByRole('button', { name: 'Revoke Fixture application' }).click();
  await expect(page.getByRole('button', { name: 'Revoke Fixture application' })).toHaveCount(0);
  expect(
    (await request.get('/v1/me', { headers: { Authorization: 'Bearer ' + tokens.access_token } })).status(),
  ).toBe(401);
  expect(
    (
      await request.post('/auth/oauth2/token', {
        form: {
          grant_type: 'refresh_token',
          client_id: client,
          refresh_token: tokens.refresh_token,
          resource: origin + '/v1',
        },
      })
    ).ok(),
  ).toBeFalsy();
  expect(
    (
      await request.delete('/account/grants?client_id=' + client, {
        headers: { Authorization: 'Bearer ' + a.key },
      })
    ).status(),
  ).toBe(403);
});
