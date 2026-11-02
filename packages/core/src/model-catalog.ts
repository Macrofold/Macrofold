import { harnessNames } from '../../contracts/harnesses';
import { pool, transaction, type Tx } from '../../db';
import type { QueryResultRow, QueryResult } from 'pg';
import { isSimulated } from './config';
import { id } from './crypto';
import { assert } from './errors';
import {
  applyModelPolicy,
  modelPolicy,
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

type CatalogVersion = Pick<CatalogCacheRow, 'provider' | 'fetched_at'> & { revision: string };
export type ModelSelection = { model: Model; revision: string | null };
type ParsedCatalog = { revision: string; models: readonly Model[] };
// One immutable version per provider, bounded by the three supported catalogs.
// SQL still supplies current identity and expiry on every selection; this cache
// saves transferring/parsing unchanged public metadata, never current authority.
const parsedCatalogs = new Map<ModelProvider, ParsedCatalog>();

function available(model: Model, row?: Pick<CatalogVersion, 'provider' | 'fetched_at'>): Model {
  return {
    ...model,
    harnesses: [...model.harnesses],
    enabled: model.enabled && !(row?.provider === 'openrouter' && pricesExpired(row)),
  };
}
function simulationModel(): Model {
  return {
    id: 'fixture-model',
    context_tokens: 128000,
    output_tokens: 65536,
    name: 'Simulation · no model charges',
    provider: 'fixture',
    harnesses: [...harnessNames],
    input_micro_usd_per_million: '0',
    output_micro_usd_per_million: '0',
    enabled: true,
    simulated: true,
  };
}

async function catalogs(tx: Pick<Tx, 'query'>, providers: readonly ModelProvider[]) {
  // Keep the exact snapshots referenced by this SQL query even if another
  // request refreshes the process cache before this response arrives.
  const snapshots = new Map(parsedCatalogs);
  const revisions = [...snapshots.values()].map((entry) => entry.revision);
  const rows = (
    await tx.query<CatalogVersion & { models: unknown }>(
      `SELECT provider,revision,fetched_at,
         CASE WHEN revision=ANY($2::uuid[]) THEN NULL ELSE models END AS models
       FROM model_catalog_cache WHERE provider=ANY($1::text[])`,
      [providers, revisions],
    )
  ).rows;
  return rows.map((row) => {
    let parsed = snapshots.get(row.provider);
    if (parsed?.revision !== row.revision) {
      parsed = {
        revision: row.revision,
        models: applyModelPolicy(
          row.provider,
          row.models === null ? undefined : discoveredModelsSchema.parse(row.models),
        ),
      };
      parsedCatalogs.set(row.provider, parsed);
    }
    return { ...row, models: parsed.models };
  });
}

export async function models(tx: Pick<Tx, 'query'> = pool): Promise<Model[]> {
  if (isSimulated()) return [simulationModel()];
  const rows = await catalogs(tx, modelProviders);
  return modelProviders.flatMap((provider) => {
    const row = rows.find((entry) => entry.provider === provider);
    return (row?.models ?? applyModelPolicy(provider)).map((model) => available(model, row));
  });
}

function selectFromCatalog(
  modelId: string,
  provider: ModelProvider,
  row?: CatalogVersion & { models: readonly Model[] },
): ModelSelection | undefined {
  const model = (row?.models ?? applyModelPolicy(provider)).find((entry) => entry.id === modelId);
  if (model) return { model: available(model, row), revision: row?.revision ?? null };
}

/** Prepare dynamic selection and freshness together. Discovery, when needed,
 * runs only after releasing the metadata transaction; warm requests read once. */
export async function prepareOpenRouterModel(
  modelId: string,
  source: ModelCatalogSource,
  options: CatalogRefreshOptions = {},
): Promise<ModelSelection | undefined> {
  options.signal?.throwIfAborted();
  if (isSimulated()) return;
  const read = async () => {
    options.signal?.throwIfAborted();
    const rows =
      options.deadlineAtMs === undefined
        ? await catalogs(pool, ['openrouter'])
        : await transaction(null, (tx) => catalogs(tx, ['openrouter']), {
            deadlineAtMs: options.deadlineAtMs,
          });
    options.signal?.throwIfAborted();
    return rows[0];
  };
  let row = await read();
  if (pricesExpired(row)) {
    await refreshModelCatalog(source, ['openrouter'], options);
    // Also observe a concurrent refresher's committed snapshot. Claims/backoff
    // still prevent duplicate provider discovery; no stale prices are trusted.
    row = await read();
  }
  return selectFromCatalog(modelId, 'openrouter', row);
}

/** Resolve only one provider's immutable catalog. Unknown dynamic identifiers
 * can only belong to OpenRouter; direct-provider models use reviewed policy. */
export async function selectedModel(
  tx: Pick<Tx, 'query'>,
  modelId: string,
  provider?: ModelProvider,
): Promise<ModelSelection | undefined> {
  if (isSimulated())
    return modelId === 'fixture-model' ? { model: simulationModel(), revision: null } : undefined;
  const owner =
    provider ??
    modelProviders.find((provider) =>
      modelPolicy.some((model) => model.id === modelId && model.provider === provider),
    ) ??
    'openrouter';
  return selectFromCatalog(modelId, owner, (await catalogs(tx, [owner]))[0]);
}

/** Admission rechecks current terms without loading a replacement catalog under
 * locks. Preparation must be repeated when the immutable source changed. */
export function currentSelectedModelQuery(selection: ModelSelection) {
  return {
    text: 'SELECT provider,revision,fetched_at FROM model_catalog_cache WHERE provider=$1',
    values: [selection.model.provider],
  };
}
export function currentSelectedModelFromResult(
  selection: ModelSelection,
  result: QueryResult<Record<string, unknown>>,
): Model {
  const row = result.rows[0];
  assert(
    (row?.revision ?? null) === selection.revision,
    409,
    'model_terms_changed',
    'Model terms changed during preparation. Submit the same intended request again.',
  );
  if (!row) return available(selection.model);
  assert(
    (row.provider === 'openrouter' || row.provider === 'openai' || row.provider === 'anthropic') &&
      (row.fetched_at === null || row.fetched_at instanceof Date),
    503,
    'model_catalog_unavailable',
    'The current model catalog is unavailable.',
  );
  return available(selection.model, { provider: row.provider, fetched_at: row.fetched_at });
}
export async function currentSelectedModel(tx: Pick<Tx, 'query'>, selection: ModelSelection): Promise<Model> {
  return currentSelectedModelFromResult(
    selection,
    await tx.query<CatalogVersion>(currentSelectedModelQuery(selection)),
  );
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
