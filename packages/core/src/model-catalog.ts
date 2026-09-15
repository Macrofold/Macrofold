import { harnessNames } from '../../contracts/harnesses';
import { pool, type Tx } from '../../db';
import { isSimulated } from './config';
import { id } from './crypto';
import {
  applyModelPolicy,
  discoveredModelsSchema,
  modelProviders,
  type DiscoveredModel,
  type ModelProvider,
  type Model,
} from './model-policy';

export type ModelCatalogSource = (provider: ModelProvider) => Promise<DiscoveredModel[] | undefined>;
export type CatalogCacheRow = {
  provider: ModelProvider;
  models: unknown;
  fetched_at: Date | null;
  refresh_after: Date;
  last_error: string | null;
};

export async function models(tx: Pick<Tx, 'query'> = pool): Promise<Model[]> {
  if (isSimulated())
    return [
      {
        id: 'fixture-model',
        name: 'Simulation · no model charges',
        provider: 'fixture',
        harnesses: [...harnessNames],
        input_micro_usd_per_million: '0',
        output_micro_usd_per_million: '0',
        enabled: true,
        simulated: true,
      },
    ];
  const rows = (await tx.query<CatalogCacheRow>('SELECT * FROM model_catalog_cache')).rows;
  return cachedModels(rows);
}

export function cachedModels(rows: CatalogCacheRow[], now = Date.now()): Model[] {
  return modelProviders.flatMap((provider) => {
    const row = rows.find((row) => row.provider === provider);
    const entries = row?.models === null || !row ? undefined : discoveredModelsSchema.parse(row.models);
    const values = applyModelPolicy(provider, entries);
    // Dynamic upstream pricing is not trusted indefinitely after an outage. Direct-provider
    // prices are our fixed retail policy; availability failures do not erase its last good data.
    if (provider === 'openrouter' && (!row?.fetched_at || now - row.fetched_at.getTime() >= 86400000))
      values.forEach((model) => {
        model.enabled = false;
      });
    return values;
  });
}

/** Short claims coordinate workers/Functions. Never hold a DB connection during provider I/O. */
export async function refreshModelCatalog(source: ModelCatalogSource) {
  let refreshed = 0,
    failed = 0;
  for (const provider of modelProviders) {
    const token = id();
    const claim = await pool.query(
      "UPDATE model_catalog_cache SET refresh_after=now()+interval '2 minutes',refresh_token=$2 WHERE provider=$1 AND refresh_after<=now() RETURNING provider",
      [provider, token],
    );
    if (!claim.rowCount) continue;
    try {
      const discovered = await source(provider);
      const entries = discovered === undefined ? undefined : discoveredModelsSchema.parse(discovered);
      const saved = await pool.query(
        "UPDATE model_catalog_cache SET models=CASE WHEN $3::jsonb IS NULL THEN models ELSE $3::jsonb END,fetched_at=CASE WHEN $3::jsonb IS NULL THEN fetched_at ELSE now() END,refresh_after=now()+interval '1 hour',refresh_token=NULL,last_error=NULL WHERE provider=$1 AND refresh_token=$2",
        [provider, token, entries === undefined ? null : JSON.stringify(entries)],
      );
      if (entries && saved.rowCount) refreshed++;
    } catch {
      const saved = await pool.query(
        "UPDATE model_catalog_cache SET refresh_after=now()+interval '5 minutes',refresh_token=NULL,last_error='discovery_failed' WHERE provider=$1 AND refresh_token=$2",
        [provider, token],
      );
      if (saved.rowCount) failed++;
    }
  }
  return { model_catalog_refreshed: refreshed, model_catalog_failed: failed };
}
