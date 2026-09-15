import type { ConnectorSetupProvider } from '../../core/src/connector-enablement';
import { assert } from '../../core/src/errors';
import { composio } from './composio';

export function connectorSetupProvider(): ConnectorSetupProvider {
  const sdk = composio();
  // Auth-config creation has no idempotency contract. Never repeat an uncertain POST.
  sdk.getClient().maxRetries = 0;
  return {
    async inspect(toolkit, version) {
      const options = { signal: AbortSignal.timeout(15000) };
      const metadata = await sdk.toolkits.get(toolkit, options);
      const tools = await sdk
        .getClient()
        .tools.list(
          {
            toolkit_slug: toolkit,
            limit: 1,
            ...(version ? { toolkit_versions: { [toolkit]: version } } : {}),
          },
          options,
        );
      const pin = tools.items[0]?.version;
      assert(
        pin && pin !== 'latest' && (!version || version === pin),
        400,
        'invalid_toolkit_version',
        'No tools were found at that exact version. Inspect the toolkit and choose a supported version.',
      );
      const authConfigs: { id: string; name: string }[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await sdk.authConfigs.list({ toolkit, limit: 100, cursor }, options);
        authConfigs.push(
          ...page.items
            .filter((c) => c.toolkit.slug === toolkit && c.status === 'ENABLED')
            .map(({ id, name }) => ({ id, name })),
        );
        cursor = page.nextCursor || undefined;
        assert(
          !cursor || (!seen.has(cursor) && seen.size < 99),
          502,
          'incomplete_auth_configs',
          'Auth configuration discovery did not finish. Retry inspection; nothing has been created.',
        );
        if (cursor) seen.add(cursor);
      } while (cursor);
      return { version: pin, managed: !!metadata.composioManagedAuthSchemes?.length, authConfigs };
    },
    async createManaged(toolkit) {
      const result = await sdk.authConfigs.create(
        toolkit,
        {
          type: 'use_composio_managed_auth',
          name: `platform-managed:${toolkit}`,
        },
        { signal: AbortSignal.timeout(15000) },
      );
      return result.id;
    },
  };
}
