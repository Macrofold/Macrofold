import { pool } from '../packages/db';
import { refreshModelCatalog, cachedModels, type CatalogCacheRow } from '../packages/core/src/model-catalog';
import { providerModelCatalog } from '../packages/providers/src/model-catalog';

try {
  if (process.argv.includes('--refresh')) {
    // Do not steal another worker's live claim. Expired claims are recovered normally.
    await pool.query('UPDATE model_catalog_cache SET refresh_after=now() WHERE refresh_token IS NULL');
    const result = await refreshModelCatalog(providerModelCatalog());
    if (result.model_catalog_failed) process.exitCode = 1;
    console.log(JSON.stringify(result));
  }
  const rows = (await pool.query<CatalogCacheRow>('SELECT * FROM model_catalog_cache ORDER BY provider'))
    .rows;
  console.log(
    JSON.stringify(
      rows.map((row) => ({
        provider: row.provider,
        source: row.fetched_at ? 'provider' : 'built-in',
        fetched_at: row.fetched_at,
        refresh_after: row.refresh_after,
        last_error: row.last_error,
        discovered: Array.isArray(row.models) ? row.models.length : 0,
        models: cachedModels(rows).filter((model) => model.provider === row.provider),
      })),
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
