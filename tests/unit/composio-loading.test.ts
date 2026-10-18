import { afterEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@composio/core', () => {
  fixture.load();
  return {
    Composio: class {
      private client = { maxRetries: 2 };
      constructor(private options: { apiKey: string }) {}
      getConfig() {
        return this.options;
      }
      getClient() {
        return this.client;
      }
    },
  };
});

import { composio } from '../../packages/providers/src/composio';
import { connectorCatalogSource } from '../../packages/providers/src/connector-catalog';
import { connectorSetupProvider } from '../../packages/providers/src/connector-setup';

afterEach(() => vi.unstubAllEnvs());

it('defers SDK loading until use, shares that load, and keeps credentials and clients separate', async () => {
  vi.stubEnv('COMPOSIO_API_KEY', '');
  const catalog = await connectorCatalogSource().read();
  expect(catalog.source).toBe('snapshot');
  expect(catalog.data.length).toBeGreaterThan(1000);
  expect(connectorSetupProvider()).toBeDefined();
  await expect(composio()).rejects.toMatchObject({ code: 'integration_not_configured' });
  expect(fixture.load).not.toHaveBeenCalled();

  vi.stubEnv('COMPOSIO_API_KEY', 'fixture-first-key');
  const first = composio();
  vi.stubEnv('COMPOSIO_API_KEY', 'fixture-second-key');
  const second = composio();
  const [a, b] = await Promise.all([first, second]);
  expect(fixture.load).toHaveBeenCalledOnce();
  expect(a).not.toBe(b);
  expect(a.getConfig()).toMatchObject({
    apiKey: 'fixture-first-key',
    allowTracking: false,
    disableVersionCheck: true,
  });
  expect(b.getConfig()).toMatchObject({ apiKey: 'fixture-second-key' });
  a.getClient().maxRetries = 0;
  expect(b.getClient().maxRetries).toBe(2);
});
