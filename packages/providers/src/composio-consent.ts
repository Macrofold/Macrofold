import { z } from 'zod';
import { composio } from './composio';
import { collectToolPages } from './tool-catalog';
import { assert } from '../../core/src/errors';
import { boundedJSON } from '../../core/src/body';
import type { CustomerConnectorProvider } from '../../core/src/customer-connector-provider';

export async function composioTools(toolkit: string, version: string) {
  const sdk = composio();
  return collectToolPages(async (cursor, signal) => {
    const page = await sdk
      .getClient()
      .tools.list(
        {
          toolkit_slug: toolkit,
          toolkit_versions: { [toolkit]: version },
          limit: 100,
          ...(cursor ? { cursor } : {}),
        },
        { signal },
      );
    return {
      items: page.items.map((t) => ({
        name: t.slug,
        description: t.description,
        input_schema: t.input_parameters || {},
        granted: false,
      })),
      nextCursor: page.next_cursor,
    };
  });
}

/** Fixed provider endpoint; the opaque URI is never fetched as a user-controlled URL. */
export async function completeComposioConsent(uri: string, subject: string, transport: typeof fetch = fetch) {
  assert(process.env.COMPOSIO_API_KEY, 503, 'integration_not_configured', 'Configure app connections first.');
  const response = await transport('https://backend.composio.dev/api/v3.1/connected_accounts/complete_auth', {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.COMPOSIO_API_KEY },
    body: JSON.stringify({ session_uri: uri, user_id: subject }),
    signal: AbortSignal.timeout(15000),
  });
  assert(
    response.ok,
    409,
    'connection_verification_failed',
    'Account verification failed. Start a new connection attempt.',
  );
  const result = z
    .object({ connected_account_id: z.string(), toolkit_slug: z.string() })
    .parse(await boundedJSON(response, 65536));
  const account = await composio().connectedAccounts.get(result.connected_account_id, {
    signal: AbortSignal.timeout(15000),
  });
  assert(
    account.id === result.connected_account_id &&
      account.toolkit.slug === result.toolkit_slug &&
      account.status === 'ACTIVE' &&
      !account.isDisabled,
    409,
    'connection_verification_failed',
    'The connected account is not active. Reconnect it before granting access.',
  );
  return { accountId: result.connected_account_id, toolkit: result.toolkit_slug };
}

export const composioCustomerConsent: CustomerConnectorProvider = {
  tools: composioTools,
  complete: completeComposioConsent,
  async start(input) {
    const sdk = composio(),
      options = { signal: AbortSignal.timeout(15000), maxRetries: 0 };
    if (input.externalAccountId) {
      const result = await sdk.connectedAccounts.refresh(
        input.externalAccountId,
        { redirectUrl: input.callbackUrl },
        options,
      );
      assert(
        result.id === input.externalAccountId && result.redirect_url,
        409,
        'reconnect_unavailable',
        'The provider did not return an account-preserving reconnect link. Disconnect and create a new connection.',
      );
      return { accountId: result.id, url: result.redirect_url };
    }
    const result = await sdk.connectedAccounts.link(
      input.subject,
      input.authConfigId,
      { callbackUrl: input.callbackUrl, alias: input.connectionId, allowMultiple: true },
      options,
    );
    assert(
      result.redirectUrl,
      502,
      'authorization_failed',
      'The provider did not return an authorization link.',
    );
    return { accountId: result.id, url: result.redirectUrl };
  },
};
