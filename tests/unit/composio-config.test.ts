import { afterEach, expect, it, vi } from 'vitest';
import { composio } from '../../packages/core/src/connections';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each([undefined, '', '   ', 'ak_******', 'ak_...1234', 'ak_…1234'])(
  'rejects an absent or masked Composio credential before requesting an upstream operation (%s)',
  (key) => {
    vi.stubEnv('COMPOSIO_API_KEY', key);
    expect(composio).toThrow(expect.objectContaining({ code: 'integration_not_configured', status: 503 }));
  },
);

it('accepts an unmasked configured value without assuming that construction verifies authentication', () => {
  vi.stubEnv('COMPOSIO_API_KEY', 'fixture-not-a-real-workspace-key');
  expect(composio).not.toThrow();
});

it('maps pinned execution, caller identity and the observed log_id response through the real SDK', async () => {
  vi.stubEnv('COMPOSIO_API_KEY', 'fixture-not-a-real-workspace-key');
  const http = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (init?.method === 'GET') {
      expect(String(url)).toBe(
        'https://backend.composio.dev/api/v3.1/tools/HACKERNEWS_GET_ITEM?version=20260708_00',
      );
      return Response.json({
        name: 'Get Item',
        slug: 'HACKERNEWS_GET_ITEM',
        description: 'Public fixture',
        toolkit: { slug: 'hackernews', name: 'Hacker News', logo: '' },
        version: '20260708_00',
        available_versions: ['20260708_00'],
        input_parameters: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
        output_parameters: { type: 'object' },
        tags: [],
        no_auth: true,
      });
    }
    expect(String(url)).toBe('https://backend.composio.dev/api/v3.1/tools/execute/HACKERNEWS_GET_ITEM');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('x-api-key')).toBe('fixture-not-a-real-workspace-key');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      user_id: 'fixture-org:fixture-user',
      version: '20260708_00',
      connected_account_id: 'chosen-account',
      arguments: { id: 8863 },
    });
    return Response.json({
      data: { id: 8863, type: 'story' },
      successful: true,
      error: null,
      log_id: 'fixture-log',
    });
  });
  const sdk = composio();
  sdk.getClient().maxRetries = 0;
  const result = await sdk.tools.execute('HACKERNEWS_GET_ITEM', {
    userId: 'fixture-org:fixture-user',
    connectedAccountId: 'chosen-account',
    version: '20260708_00',
    arguments: { id: 8863 },
  });
  expect(result).toMatchObject({ successful: true, data: { id: 8863, type: 'story' }, logId: 'fixture-log' });
  expect(http).toHaveBeenCalledTimes(2);
});

it('uses the installed SDK to create distinct aliases despite an existing active account', async () => {
  vi.stubEnv('COMPOSIO_API_KEY', 'fixture-workspace-key');
  const account = {
    id: 'existing-account',
    alias: 'existing-alias',
    status: 'ACTIVE',
    status_reason: null,
    toolkit: { slug: 'gmail' },
    auth_config: { id: 'fixture-auth', is_composio_managed: true, is_disabled: false },
    is_disabled: false,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
  const aliases: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (init?.method === 'GET') {
      expect(String(url)).toContain('/connected_accounts?');
      expect(new URL(String(url)).searchParams.get('user_ids')).toBe('org:user');
      return Response.json({ items: [account], next_cursor: null, total_pages: 1 });
    }
    expect(String(url)).toBe('https://backend.composio.dev/api/v3.1/connected_accounts/link');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ user_id: 'org:user', auth_config_id: 'fixture-auth' });
    aliases.push(body.alias);
    return Response.json({
      connected_account_id: 'account-' + body.alias,
      link_token: 'fixture-link',
      redirect_url: 'https://connect.composio.dev/fixture',
    });
  });
  const sdk = composio();
  sdk.getClient().maxRetries = 0;
  const first = await sdk.connectedAccounts.link('org:user', 'fixture-auth', {
    alias: 'research',
    allowMultiple: true,
  });
  const second = await sdk.connectedAccounts.link('org:user', 'fixture-auth', {
    alias: 'personal',
    allowMultiple: true,
  });
  expect(aliases).toEqual(['research', 'personal']);
  expect(first.id).toBe('account-research');
  expect(second.id).toBe('account-personal');
});

it('discovers enabled auth configs through the installed SDK without exposing credentials', async () => {
  vi.stubEnv('COMPOSIO_API_KEY', 'fixture-workspace-key');
  const { connectorSetupProvider } = await import('../../packages/providers/src/connector-setup');
  const cursors: (string | null)[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    expect(init?.method).toBe('GET');
    const address = new URL(String(url));
    if (address.pathname.endsWith('/toolkits/gmail'))
      return Response.json({
        name: 'Gmail',
        slug: 'gmail',
        meta: {},
        is_local_toolkit: false,
        composio_managed_auth_schemes: ['OAUTH2'],
      });
    if (address.pathname.endsWith('/tools')) {
      expect(address.searchParams.get('toolkit_slug')).toBe('gmail');
      expect(address.search).toContain('20260910_00');
      return Response.json({ items: [{ version: '20260910_00' }] });
    }
    expect(address.pathname).toContain('/auth_configs');
    cursors.push(address.searchParams.get('cursor'));
    const item = (id: string, slug: string, status: string) => ({
      id,
      name: id,
      toolkit: { slug, logo: '' },
      status,
      no_of_connections: 0,
      credentials: { secret: 'must-not-leave-adapter' },
    });
    return Response.json(
      cursors.length === 1
        ? {
            items: [item('enabled', 'gmail', 'ENABLED'), item('disabled', 'gmail', 'DISABLED')],
            next_cursor: 'second',
            total_pages: 2,
          }
        : {
            items: [item('other-toolkit', 'github', 'ENABLED'), item('second', 'gmail', 'ENABLED')],
            next_cursor: null,
            total_pages: 2,
          },
    );
  });
  expect(await connectorSetupProvider().inspect('gmail', '20260910_00')).toEqual({
    version: '20260910_00',
    managed: true,
    authConfigs: [
      { id: 'enabled', name: 'enabled' },
      { id: 'second', name: 'second' },
    ],
  });
  expect(cursors).toEqual([null, 'second']);
});

it('creates managed auth with the installed SDK and never retries an ambiguous POST', async () => {
  vi.stubEnv('COMPOSIO_API_KEY', 'fixture-workspace-key');
  const { connectorSetupProvider } = await import('../../packages/providers/src/connector-setup');
  const http = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    expect(String(url)).toContain('/auth_configs');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      toolkit: { slug: 'gmail' },
      auth_config: { type: 'use_composio_managed_auth', name: 'platform-managed:gmail' },
    });
    return Response.json({
      auth_config: { id: 'created', auth_scheme: 'OAUTH2', is_composio_managed: true },
      toolkit: { slug: 'gmail' },
    });
  });
  expect(await connectorSetupProvider().createManaged('gmail')).toBe('created');
  http.mockResolvedValue(Response.json({ message: 'Uncertain response' }, { status: 503 }));
  await expect(connectorSetupProvider().createManaged('gmail')).rejects.toThrow();
  expect(http).toHaveBeenCalledTimes(2);
});

it('customer consent uses the exact subject, alias and pinned account without retrying account creation', async () => {
  vi.stubEnv('COMPOSIO_API_KEY', 'fixture-workspace-key');
  const { composioCustomerConsent } = await import('../../packages/providers/src/composio-consent');
  let posts = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const address = new URL(String(url));
    if (init?.method === 'GET') {
      expect(address.searchParams.get('user_ids')).toBe('customer_opaque-subject');
      return Response.json({ items: [], next_cursor: null, total_pages: 0 });
    }
    posts++;
    expect(address.pathname).toBe('/api/v3.1/connected_accounts/link');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      user_id: 'customer_opaque-subject',
      alias: 'immutable-connection',
      auth_config_id: 'fixture-auth',
      callback_url: 'https://macrofold.example/integrations/composio/callback',
    });
    return Response.json({ message: 'Uncertain response' }, { status: 503 });
  });
  await expect(
    composioCustomerConsent.start({
      subject: 'customer_opaque-subject',
      connectionId: 'immutable-connection',
      authConfigId: 'fixture-auth',
      callbackUrl: 'https://macrofold.example/integrations/composio/callback',
    }),
  ).rejects.toThrow();
  expect(posts).toBe(1);
});

it('verifies opaque customer consent through a fixed endpoint and checks the active account with the installed SDK', async () => {
  vi.stubEnv('COMPOSIO_API_KEY', 'fixture-workspace-key');
  const { completeComposioConsent } = await import('../../packages/providers/src/composio-consent');
  const http = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (init?.method === 'POST') {
      expect(String(url)).toBe('https://backend.composio.dev/api/v3.1/connected_accounts/complete_auth');
      expect(init.redirect).toBe('error');
      expect(JSON.parse(String(init.body))).toEqual({
        session_uri: 'http://169.254.169.254/not-a-fetch-target',
        user_id: 'customer_opaque-subject',
      });
      return Response.json({ connected_account_id: 'verified-account', toolkit_slug: 'gmail' });
    }
    expect(String(url)).toBe('https://backend.composio.dev/api/v3.1/connected_accounts/verified-account');
    return Response.json({
      id: 'verified-account',
      status: 'ACTIVE',
      is_disabled: false,
      toolkit: { slug: 'gmail' },
      auth_config: { id: 'fixture-auth', is_composio_managed: true, is_disabled: false },
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      status_reason: null,
    });
  });
  expect(
    await completeComposioConsent('http://169.254.169.254/not-a-fetch-target', 'customer_opaque-subject'),
  ).toEqual({ accountId: 'verified-account', toolkit: 'gmail' });
  expect(http).toHaveBeenCalledTimes(2);
});
