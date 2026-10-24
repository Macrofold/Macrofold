import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import type { components } from '../../packages/contracts/api';
import { test, expect, fixtureOrigin } from '../fixtures/browser';

type Schema = components['schemas'];

async function connectionsPage(page: Page) {
  const consentRequests: string[] = [];
  for (const pattern of ['**/v1/connections/*/authorize', '**/integrations/composio/**'])
    await page.route(pattern, (route) => {
      consentRequests.push(route.request().url());
      return route.fulfill({ status: 503, json: { error: { message: 'Unexpected app consent' } } });
    });
  await page.route('https://logos.composio.dev/**', (route) => route.fulfill({ status: 204 }));
  await page.route('**/v1/connector-catalog', (route) =>
    route.fulfill({
      json: {
        source: 'snapshot',
        updated_at: '2026-10-23T12:00:00Z',
        data: [
          {
            slug: 'runpod',
            name: 'RunPod',
            description: 'Manage RunPod resources with app tools.',
            logo: 'https://logos.composio.dev/api/runpod',
            categories: ['developer tools'],
            tool_count: 3,
            connectable: false,
          },
        ],
      } satisfies Schema['ConnectorCatalog'],
    }),
  );
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/login/);
  await page.getByRole('link', { name: 'Connections', exact: true }).click();
  return consentRequests;
}

async function removeConnection(page: Page, connectionId: string | undefined) {
  if (!connectionId) return;
  const response = await page.request.delete(`/v1/connections/${connectionId}`, {
    headers: { Origin: fixtureOrigin, 'Idempotency-Key': randomUUID() },
  });
  expect.soft(response.ok(), await response.text()).toBe(true);
}

for (const target of [
  { label: 'RunPod account', kind: 'runpod', provider: 'runpod', auth: 'api_key' },
  { label: 'Hugging Face account', kind: 'hugging_face', provider: 'hf', auth: 'api_key' },
  { label: 'External endpoint', kind: 'external_model', provider: 'external', auth: 'bearer' },
  { label: 'External endpoint', kind: 'external_model', provider: 'external', auth: 'none' },
] as const)
  test(`saves ${target.label} with ${target.auth} through the actual API without app consent or tool controls`, async ({
    page,
  }) => {
    const consentRequests = await connectionsPage(page);
    const name = `${target.label} ${randomUUID()}`;
    const secret = `synthetic-unused-${target.kind}-${target.auth}-token`;
    const external = target.kind === 'external_model';
    const endpoint = `${fixtureOrigin}/v1`;
    let connectionId: string | undefined;
    try {
      await page.getByRole('button', { name: 'Add connection', exact: true }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Add a connection', exact: true });
      await dialog.getByRole('button', { name: 'Model hosting', exact: true }).click();
      await dialog.getByRole('combobox', { name: 'Hosting connection type', exact: true }).click();
      await page.getByRole('option', { name: target.label, exact: true }).click();
      await dialog.getByLabel('Connection name', { exact: true }).fill(name);
      if (external) await dialog.getByLabel('Endpoint base URL', { exact: true }).fill(endpoint);
      const token = dialog.getByLabel(external ? 'Endpoint bearer token' : 'Account API token', {
        exact: true,
      });
      await expect(token).toHaveAttribute('type', 'password');
      await token.fill(secret);
      if (target.auth === 'none') {
        await dialog
          .getByRole('checkbox', { name: 'Endpoint requires no authentication', exact: true })
          .check();
        await expect(token).toHaveCount(0);
      }
      const created = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && new URL(response.url()).pathname === '/v1/connections',
      );
      await dialog.getByRole('button', { name: 'Save connection', exact: true }).click();
      const response = await created;
      expect(response.ok()).toBe(true);
      const connection = (await response.json()) as Schema['Connection'];
      connectionId = connection.id;
      expect(response.request().postDataJSON()).toEqual({
        name,
        kind: target.kind,
        provider: target.provider,
        auth_method: target.auth,
        ...(external ? { url: endpoint } : {}),
        ...(target.auth === 'none' ? {} : { secret }),
      });
      expect(connection).toMatchObject({
        name,
        kind: target.kind,
        provider: target.provider,
        auth_method: target.auth,
        status: 'healthy',
      });
      expect(JSON.stringify(connection)).not.toContain(secret);
      expect(connection).not.toHaveProperty('secret_ciphertext');
      expect(connection).not.toHaveProperty('secret');
      await expect(dialog).toHaveCount(0);
      const card = page
        .locator('.connection-card')
        .filter({ has: page.getByRole('heading', { name, exact: true }) });
      await expect(card).toBeVisible();
      for (const label of ['Connect', 'Connect app tools', 'Tools', 'Access'])
        await expect(card.getByRole('button', { name: label, exact: true })).toHaveCount(0);
      await expect(card.getByRole('button', { name: `Edit ${name}`, exact: true })).toBeVisible();
      await expect(card.getByRole('button', { name: `Remove ${name}`, exact: true })).toBeVisible();

      const checked = page.waitForResponse(
        (result) =>
          result.request().method() === 'POST' &&
          new URL(result.url()).pathname === `/v1/connections/${connectionId}/test`,
      );
      await card.getByRole('button', { name: 'Test', exact: true }).click();
      const check = await checked;
      expect(check.ok()).toBe(true);
      expect(await check.json()).toMatchObject({ status: 'unknown' });
      const stored = await page.request.get(`/v1/connections/${connectionId}`);
      expect(stored.ok()).toBe(true);
      const storedText = await stored.text();
      expect(storedText).not.toContain(secret);
      expect(storedText).not.toContain('secret_ciphertext');
      expect(consentRequests).toEqual([]);
    } finally {
      await removeConnection(page, connectionId);
    }
  });

test('defaults the RunPod app catalog entry to hosting while preserving explicit app-tool setup', async ({
  page,
}) => {
  const consentRequests = await connectionsPage(page);
  let connectionId: string | undefined;
  try {
    await page.getByRole('button', { name: 'Add connection', exact: true }).first().click();
    await page.getByRole('button', { name: 'Set up RunPod', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a connection', exact: true });
    await expect(
      dialog.getByRole('combobox', { name: 'Hosting connection type', exact: true }),
    ).toContainText('RunPod account');
    await expect(dialog.getByLabel('Account API token', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save connection', exact: true })).toBeVisible();
    await expect(dialog).not.toContainText('An administrator needs to enable this app');

    await dialog.getByRole('button', { name: 'Connect RunPod app tools instead', exact: true }).click();
    await expect(dialog.getByLabel('Account API token', { exact: true })).toHaveCount(0);
    await expect(dialog).toContainText('An administrator needs to enable this app');
    const name = `RunPod app tools ${randomUUID()}`;
    await dialog.getByLabel('Connection name', { exact: true }).fill(name);
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/v1/connections',
    );
    await dialog.getByRole('button', { name: 'Add connection', exact: true }).click();
    const response = await created;
    expect(response.ok()).toBe(true);
    const connection = (await response.json()) as Schema['Connection'];
    connectionId = connection.id;
    expect(response.request().postDataJSON()).toEqual({
      name,
      kind: 'composio',
      provider: 'runpod',
      auth_method: 'oauth',
    });
    expect(connection).toMatchObject({ kind: 'composio', provider: 'runpod', status: 'pending' });
    const card = page
      .locator('.connection-card')
      .filter({ has: page.getByRole('heading', { name, exact: true }) });
    await expect(card.getByRole('button', { name: 'Connect app tools', exact: true })).toBeVisible();
    // The pending fixture has no upstream account. Leave consent unstarted.
    expect(connection.account_identity).toBeFalsy();
    const mutations: string[] = [];
    page.on('request', (request) => {
      if (['POST', 'PATCH', 'DELETE'].includes(request.method())) mutations.push(request.url());
    });
    await card.getByRole('button', { name: 'Use for model hosting', exact: true }).click();
    await expect(
      dialog.getByRole('combobox', { name: 'Hosting connection type', exact: true }),
    ).toContainText('RunPod account');
    await expect(dialog.getByLabel('Account API token', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save connection', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const unchanged = await page.request.get(`/v1/connections/${connectionId}`);
    expect(unchanged.ok()).toBe(true);
    expect(await unchanged.json()).toMatchObject({
      id: connectionId,
      kind: 'composio',
      provider: 'runpod',
      status: 'pending',
    });
    expect(mutations).toEqual([]);
    expect(consentRequests).toEqual([]);
  } finally {
    await removeConnection(page, connectionId);
  }
});
