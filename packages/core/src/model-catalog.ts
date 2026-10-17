import { harnessNames } from '../../contracts/harnesses';
import { pool, transaction, type Tx } from '../../db';
import type { QueryResultRow } from 'pg';
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

export type ModelCatalogSource = (
  provider: ModelProvider,
  options?: { signal?: AbortSignal },
) => Promise<DiscoveredModel[] | undefined>;
export type CatalogRefreshOptions = { deadlineAtMs?: number; signal?: AbortSignal };
export type CatalogCacheRow = {
  provider: ModelProvider;
  models: unknown;
  fetched_at: Date | null;
  refresh_after: Date;
  last_error: string | null;
};

const dynamicPriceMaxAgeMs = 24 * 60 * 60 * 1000;
function pricesExpired(row: Pick<CatalogCacheRow, 'fetched_at'> | undefined, now = Date.now()) {
  return !row?.fetched_at || now - row.fetched_at.getTime() >= dynamicPriceMaxAgeMs;
}

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
    if (provider === 'openrouter' && pricesExpired(row, now))
      values.forEach((model) => {
        model.enabled = false;
      });
    return values;
  });
}

/** Direct inference needs no poller. Repair expired prices before its admission
 * transaction, using the maintenance claim/backoff rather than trusting stale rates.
 * See docs/features/execution/models.md#refresh-and-caching. */
export async function refreshExpiredOpenRouterCatalog(
  source: ModelCatalogSource,
  options: CatalogRefreshOptions = {},
) {
  options.signal?.throwIfAborted();
  if (isSimulated()) return;
  const row = (
    await catalogQuery<Pick<CatalogCacheRow, 'fetched_at'>>(
      options,
      "SELECT fetched_at FROM model_catalog_cache WHERE provider='openrouter'",
    )
  ).rows[0];
  if (pricesExpired(row)) await refreshModelCatalog(source, ['openrouter'], options);
}

/** Each metadata statement gets the same cumulative preparation deadline;
 * no SQL connection survives into upstream discovery. */
function catalogQuery<Row extends QueryResultRow>(
  options: CatalogRefreshOptions,
  text: string,
  values: unknown[] = [],
) {
  options.signal?.throwIfAborted();
  return options.deadlineAtMs === undefined
    ? pool.query<Row>(text, values)
    : transaction(null, (tx) => tx.query<Row>(text, values), { deadlineAtMs: options.deadlineAtMs });
}

/** Short claims coordinate workers/Functions. Never hold a DB connection during provider I/O. */
export async function refreshModelCatalog(
  source: ModelCatalogSource,
  providers: readonly ModelProvider[] = modelProviders,
  options: CatalogRefreshOptions = {},
) {
  let refreshed = 0,
    failed = 0;
  for (const provider of providers) {
    const token = id();
    const claim = await catalogQuery(
      options,
      `UPDATE model_catalog_cache SET refresh_after=least(now()+interval '2 minutes',coalesce($3::timestamptz,'infinity'::timestamptz)),refresh_token=$2
       WHERE provider=$1 AND refresh_after<=now() RETURNING provider`,
      [provider, token, options.deadlineAtMs === undefined ? null : new Date(options.deadlineAtMs)],
    );
    if (!claim.rowCount) continue;
    try {
      const discovered = await source(provider, { signal: options.signal });
      options.signal?.throwIfAborted();
      const entries = discovered === undefined ? undefined : discoveredModelsSchema.parse(discovered);
      const saved = await catalogQuery(
        options,
        "UPDATE model_catalog_cache SET models=CASE WHEN $3::jsonb IS NULL THEN models ELSE $3::jsonb END,fetched_at=CASE WHEN $3::jsonb IS NULL THEN fetched_at ELSE now() END,refresh_after=now()+interval '1 hour',refresh_token=NULL,last_error=NULL WHERE provider=$1 AND refresh_token=$2",
        [provider, token, entries === undefined ? null : JSON.stringify(entries)],
      );
      if (entries && saved.rowCount) refreshed++;
    } catch (error) {
      // An expired request leaves only its short claim lease; do not spend its
      // remaining host time on cleanup or extend another request's backoff.
      if (
        options.signal?.aborted ||
        (options.deadlineAtMs !== undefined && Date.now() >= options.deadlineAtMs)
      )
        throw error;
      const saved = await catalogQuery(
        options,
        "UPDATE model_catalog_cache SET refresh_after=now()+interval '5 minutes',refresh_token=NULL,last_error='discovery_failed' WHERE provider=$1 AND refresh_token=$2",
        [provider, token],
      );
      if (saved.rowCount) failed++;
    }
  }
  return { model_catalog_refreshed: refreshed, model_catalog_failed: failed };
}
