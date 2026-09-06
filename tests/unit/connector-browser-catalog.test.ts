import { expect, it, vi } from 'vitest';
import { listConnectorCatalog, parseConnectorCatalog } from '../../packages/core/src/connector-catalog';
import {
  collectConnectorPages,
  createConnectorCatalogSource,
} from '../../packages/providers/src/connector-catalog';

const entry = {
  slug: 'gmail',
  name: 'Gmail',
  description: 'Email',
  categories: ['email'],
  logo: 'https://untrusted.test/image.svg?secret=not-a-real-secret',
  tool_count: 3,
};
it('restricts logo URLs and preserves metadata without treating it as markup', () => {
  expect(parseConnectorCatalog([{ ...entry, name: '<script>untrusted</script>' }])[0]).toMatchObject({
    name: '<script>untrusted</script>',
    logo: 'https://logos.composio.dev/api/gmail',
  });
  expect(() => parseConnectorCatalog([{ ...entry, slug: '../private' }])).toThrow();
  expect(() => parseConnectorCatalog([entry, entry])).toThrow();
});

it('collects later pages and rejects repeated cursors or an incomplete catalog', async () => {
  const page = vi
    .fn()
    .mockResolvedValueOnce({ items: [entry], nextCursor: 'two' })
    .mockResolvedValueOnce({ items: [{ ...entry, slug: 'slack' }] });
  expect((await collectConnectorPages(page)).map((item) => item.slug)).toEqual(['gmail', 'slack']);
  expect(page.mock.calls[1][0]).toBe('two');
  await expect(collectConnectorPages(async () => ({ items: [entry], nextCursor: 'repeat' }))).rejects.toThrow(
    'pagination',
  );
  await expect(collectConnectorPages(async () => ({ items: [] }))).rejects.toThrow();
});

it('keeps the complete bundled catalog available without credentials', async () => {
  const catalog = await createConnectorCatalogSource().read();
  expect(catalog.source).toBe('snapshot');
  expect(catalog.data.length).toBeGreaterThan(1000);
  expect(catalog.data.some((item) => item.slug === 'gmail')).toBe(true);
  expect(catalog.data.some((item) => item.slug === 'github')).toBe(true);
  expect(catalog.data.at(-1)?.name).toBeTruthy();
});

it('deduplicates concurrent fetches, caches success, and preserves it on a failed refresh', async () => {
  let now = 0;
  const page = vi.fn().mockResolvedValue({ items: [entry] });
  const source = createConnectorCatalogSource(page, () => now);
  const results = await Promise.all([source.read(), source.read(), source.read()]);
  expect(page).toHaveBeenCalledTimes(1);
  expect(results[0].source).toBe('live');
  await source.read();
  expect(page).toHaveBeenCalledTimes(1);
  now += 60 * 60 * 1000 + 1;
  page.mockRejectedValueOnce(new Error('upstream unavailable'));
  expect(await source.read()).toEqual(results[0]);
  await source.read();
  expect(page).toHaveBeenCalledTimes(2);
});

it('falls back after initial API failure without retrying on every browser request', async () => {
  const page = vi.fn().mockRejectedValue(new Error('unauthorized'));
  const source = createConnectorCatalogSource(page);
  expect((await source.read()).source).toBe('snapshot');
  await source.read();
  expect(page).toHaveBeenCalledTimes(1);
});

it('requires all operator setup gates and never returns configuration secrets', async () => {
  const source = {
    read: async () => ({ data: [entry], source: 'snapshot' as const, updated_at: '2026-09-06T00:00:00Z' }),
  };
  const settings = {
    enabled: true,
    authConfigs: '{"gmail":"secret-auth-config-id"}',
    versions: '{"gmail":"20260828_00"}',
  };
  const result = await listConnectorCatalog(source, settings);
  expect(result.data[0].connectable).toBe(true);
  expect(JSON.stringify(result)).not.toContain('secret-auth-config-id');
  for (const overrides of [
    { enabled: false },
    { versions: '{}' },
    { versions: '{"gmail":"latest"}' },
    { authConfigs: 'invalid' },
  ])
    expect((await listConnectorCatalog(source, { ...settings, ...overrides })).data[0].connectable).toBe(
      false,
    );
});
