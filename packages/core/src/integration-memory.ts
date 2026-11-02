import { transaction, pool, afterCommit, type Tx } from '../../db';
import type { NativeRunRow } from './runs';
import { getIntegration, type Integration, type IntegrationContextSnapshot } from './agent-integrations';
import { id, seal, unseal, sha256, canonical } from './crypto';
import { assert, AppError, errorBody } from './errors';
import * as resources from './resources';
import { assertConnectionOwner, connectionHeaders } from './connections';
import type { Principal } from './auth';
import { MemoryService, memoryText, type MemoryReceipt } from '../../providers/src/memory-service';
import { mapConcurrent } from './concurrent';
import { errorDiagnostics } from './error-diagnostics';
import { traceContent } from '../../providers/src/trace-content';
import { recordTrace } from './tracing';
import { runTraceContext } from './run-tracing';
import type { TraceContext } from './trace';
import { integrationResourceAvailable } from './integration-authority';
import { v5 as stableId } from 'uuid';
import { emit } from './events';
import { captureMemorySource } from './integration-memory-source';

const searchIdentity = (p: Principal, integrationId: string, key: string) =>
  stableId(canonical([p.organizationId, p.id, integrationId, key]), 'b3b30de1-5130-5d47-8a66-682cbdbe19c6');

const integrationTraceContext = (integration: Integration, identity: string): TraceContext => ({
  organization_id: integration.organization_id,
  operation_id: identity,
  workspace_id: integration.workspace_id,
  worktree_id: integration.worktree_id,
  session_id: null,
  user_id: integration.owner_user_id || '',
  run_kind: 'integration_memory',
  model: 'memory-service',
  billing_mode: 'external',
});

async function searchOperation(tx: Tx, p: Principal, integrationId: string, key: string, query: string) {
  const operationId = searchIdentity(p, integrationId, key);
  const raw = (await tx.query('SELECT * FROM operations WHERE id=$1', [operationId])).rows[0];
  if (!raw) return undefined;
  const operation = resources.present(raw, 'operations');
  assert(
    operation.kind === 'memory_search' &&
      operation.memory_principal_id === p.id &&
      operation.memory_integration_id === integrationId,
    403,
    'memory_search_unavailable',
    'This search receipt does not belong to the current caller.',
  );
  assert(
    operation.memory_request_hash === sha256(query),
    409,
    'idempotency_conflict',
    'This key was already used for another memory query.',
  );
  return operation;
}

export async function authorizeMemorySearchReplay(
  tx: Tx,
  p: Principal,
  integrationId: string,
  key: string,
  body: unknown,
) {
  const query = typeof body === 'object' && body !== null && 'query' in body ? String(body.query) : '';
  const integration = await getIntegration(tx, p, integrationId, true);
  const operation = await searchOperation(tx, p, integrationId, key, query);
  assert(
    operation &&
      operation.status === 'succeeded' &&
      !integration.removed_at &&
      !integration.retired_at &&
      integration.state !== 'disabled' &&
      String(integration.generation) === operation.memory_generation,
    410,
    'memory_context_revoked',
    'This memory context is no longer available. Inspect current memory settings before starting a new query.',
  );
  await currentMemoryService(tx, integration);
}

/** Authoritative request identity is committed before possibly billed service
 * I/O. Concurrent HTTP preparations may run, but only one can make the call. */
export async function prepareManualMemorySearch(
  p: Principal,
  integrationId: string,
  key: string,
  query: string,
  requestId: string,
) {
  assert(key, 400, 'idempotency_key_required', 'Supply an Idempotency-Key for this service query.');
  const operationId = searchIdentity(p, integrationId, key);
  const source = await transaction(p.organizationId, async (tx) => {
    const integration = await getIntegration(tx, p, integrationId, true);
    assert(
      integration.pack_id !== 'file-memory' &&
        integration.state !== 'disabled' &&
        !integration.removed_at &&
        !integration.retired_at,
      410,
      'memory_context_revoked',
      'Enable a current service memory installation before searching.',
    );
    const service = await currentMemoryService(tx, integration);
    let operation = await searchOperation(tx, p, integrationId, key, query);
    if (operation) {
      assert(
        operation.memory_generation === String(integration.generation),
        410,
        'memory_context_revoked',
        'Memory changed after this query. Use current settings and a new query key.',
      );
      if (operation.status === 'running') {
        const fresh = Date.now() - Date.parse(operation.memory_started_at || '') < 45000;
        if (fresh)
          throw new AppError(
            503,
            'memory_search_pending',
            'The admitted query is running. It will not be sent again.',
            { operation_id: operationId },
          );
        await resources.update(tx, 'operations', operationId, {
          status: 'failed',
          error: errorBody(
            new AppError(
              409,
              'memory_search_outcome_unknown',
              'The admitted query outcome could not be confirmed.',
            ),
            requestId,
          ).body.error,
        });
        return { integration, operation, service, claimed: false, expired: true };
      }
      assert(
        operation.status === 'succeeded' && operation.memory_context_ciphertext && operation.memory_receipt,
        409,
        'memory_search_outcome_unknown',
        'The earlier query did not produce a confirmed durable result. It will not be sent again.',
        { operation_id: operationId },
      );
      return { integration, operation, service, claimed: false };
    }
    operation = await resources.create(
      tx,
      'operations',
      p.organizationId,
      {
        kind: 'memory_search',
        status: 'running',
        workspace_id: integration.workspace_id,
        result: { workspace_id: integration.workspace_id, integration_id: integration.id },
        required_scopes: ['runs:read', 'files:read'],
        memory_request_hash: sha256(query),
        memory_request_key: key,
        memory_principal_id: p.id,
        memory_integration_id: integration.id,
        memory_generation: String(integration.generation),
        memory_started_at: new Date().toISOString(),
      },
      operationId,
    );
    return { integration, operation, service, claimed: true };
  });
  assert(
    !('expired' in source),
    409,
    'memory_search_outcome_unknown',
    'The earlier query outcome could not be confirmed. It will not be sent again.',
    { operation_id: operationId },
  );
  if (source.claimed) {
    try {
      const result = await source.service.recall(query);
      await transaction(p.organizationId, async (tx) => {
        const latest = await getIntegration(tx, p, integrationId, true);
        assert(
          latest.state !== 'disabled' &&
            !latest.removed_at &&
            !latest.retired_at &&
            String(latest.generation) === String(source.integration.generation),
          410,
          'memory_context_revoked',
          'Memory changed while querying.',
        );
        await currentMemoryService(tx, latest);
        await resources.update(tx, 'operations', operationId, {
          status: 'succeeded',
          memory_context_ciphertext: seal(result.text),
          memory_receipt: result.receipt,
          memory_duration_ms: Date.now() - Date.parse(source.operation.memory_started_at!),
        });
        afterCommit(tx, () =>
          traceMemory(
            integrationTraceContext(source.integration, operationId),
            'search',
            operationId,
            new Date(source.operation.memory_started_at!),
            result.receipt,
            { installation_id: integrationId, provider: source.integration.pack_id },
            result.text,
          ),
        );
      });
    } catch (error) {
      await transaction(p.organizationId, async (tx) => {
        await getIntegration(tx, p, integrationId, true);
        await resources.update(tx, 'operations', operationId, {
          status: 'failed',
          error: errorBody(error, requestId).body.error,
        });
        afterCommit(tx, () =>
          traceMemory(
            integrationTraceContext(source.integration, operationId),
            'search',
            operationId,
            new Date(source.operation.memory_started_at!),
            { state: 'failed', external_cost_micro_usd: null, input_tokens: null, output_tokens: null },
            { installation_id: integrationId, provider: source.integration.pack_id, outcome: 'unconfirmed' },
          ),
        );
      });
      throw error;
    }
  }
  return {
    async dispose() {},
    async commit(tx: Tx, currentPrincipal: Principal) {
      await authorizeMemorySearchReplay(tx, currentPrincipal, integrationId, key, { query });
      const operation = (await searchOperation(tx, currentPrincipal, integrationId, key, query))!;
      return {
        context: unseal<string>(operation.memory_context_ciphertext!),
        receipt: operation.memory_receipt!,
      };
    },
  };
}

/** Clear this owner's exact cached reads only. Financial/mutation receipts and
 * unrelated idempotency records retain their original meaning. */
export async function invalidateMemorySearches(tx: Tx, integrationId: string | string[]) {
  const ids = typeof integrationId === 'string' ? [integrationId] : integrationId;
  const expired = seal(
    errorBody(new AppError(410, 'memory_context_revoked', 'This memory context was revoked.'), id()).body,
  );
  await tx.query(
    `UPDATE idempotency d SET response_ciphertext=$2,status=410 FROM operations o
    WHERE o.organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid
      AND o.data->>'kind'='memory_search' AND o.data->>'memory_integration_id'=ANY($1::text[])
      AND d.organization_id=o.organization_id AND d.principal_id=o.data->>'memory_principal_id'
      AND d.key=o.data->>'memory_request_key' AND d.route='/v1/agent-integrations/{integration_id}/search'`,
    [ids, expired],
  );
  await tx.query(
    `UPDATE operations SET data=(data-'memory_context_ciphertext')||jsonb_build_object('status','failed','error',$2::jsonb),revision=revision+1
    WHERE organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid AND data->>'kind'='memory_search' AND data->>'memory_integration_id'=ANY($1::text[])`,
    [
      ids,
      errorBody(new AppError(410, 'memory_context_revoked', 'This memory context was revoked.'), id()).body
        .error,
    ],
  );
}

export async function recordMemoryOmission(tx: Tx, run: NativeRunRow, reason: string) {
  const snapshot = run.config.integration_context;
  if (!snapshot) return;
  await emit(
    tx,
    run.organization_id,
    run.id,
    'memory.omitted',
    { integration_id: snapshot.id, reason, required: false },
    { id: `memory-omission:${snapshot.id}:${snapshot.generation}`, sequence: 1 },
    run,
  );
}

export type RemoteMemoryConfiguration = {
  connection_id: string;
  namespace: string;
  external_cost_acknowledged: true;
  required: boolean;
  credential_fingerprint: string;
};
export type MemorySource = {
  id: string;
  organization_id: string;
  integration_id: string;
  source_run_id: string | null;
  generation: string;
  kind: 'capture' | 'purge';
  state: 'queued' | 'sending' | 'waiting' | 'complete' | 'failed' | 'unknown' | 'cancelled';
  text_ciphertext: string | null;
  receipt: MemoryReceipt | null;
  created_at: Date;
  check_started_at: Date;
  failures: number;
  polls: number;
  trace_context: TraceContext | null;
};
export const remoteConfiguration = (row: Integration) => row.configuration as RemoteMemoryConfiguration;

/** Installation is a separate, explicit grant to this Worktree. The service is
 * never advertised as an MCP tool and an agent cannot choose another namespace. */
export async function authorizeMemoryConnection(tx: Tx, p: Principal, connectionId: string, pack: string) {
  const connection = await resources.get(tx, 'connections', connectionId, p);
  assertConnectionOwner(p, connection);
  assert(
    connection.kind === 'memory_service' &&
      connection.provider === pack &&
      connection.status === 'healthy' &&
      connection.url,
    409,
    'memory_connection_unavailable',
    'Choose your healthy memory-service connection for this pack.',
  );
  return connection;
}

export async function currentMemoryService(tx: Tx, integration: Integration, cleanupOnly = false) {
  const config = remoteConfiguration(integration);
  assert(
    config.external_cost_acknowledged && integration.owner_user_id,
    403,
    'memory_funding_not_authorized',
    'Approve external memory-service costs before use.',
  );
  const connection = await resources.get(tx, 'connections', config.connection_id);
  assert(
    config.credential_fingerprint === memoryConnectionFingerprint(connection) &&
      integration.service_identity === memoryServiceIdentity(String(connection.url), config.namespace),
    409,
    'memory_service_authorization_changed',
    'The approved memory-service endpoint or credentials changed. Export current sources and perform fresh explicit setup before using this collection.',
  );
  const available = cleanupOnly
    ? !!(
        await tx.query('SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2 AND role<>$3', [
          integration.organization_id,
          integration.owner_user_id,
          'viewer',
        ])
      ).rowCount
    : await integrationResourceAvailable(
        tx,
        integration.workspace_id,
        integration.worktree_id,
        integration.owner_user_id,
      );
  assert(
    available &&
      connection.owner_subject_id === integration.owner_user_id &&
      !connection.deleted &&
      connection.kind === 'memory_service' &&
      connection.provider === integration.pack_id &&
      connection.status === 'healthy' &&
      connection.url,
    403,
    'memory_connection_unavailable',
    'The memory-service authorization is no longer current.',
  );
  return new MemoryService({
    provider: integration.pack_id as 'hindsight' | 'claude-mem',
    baseURL: connection.url,
    namespace: config.namespace,
    headers: connectionHeaders(connection),
  });
}

const current = async (tx: Tx, integrationId: string) => {
  const row = (
    await tx.query<Integration>('SELECT * FROM agent_integrations WHERE id=$1 FOR UPDATE', [integrationId])
  ).rows[0];
  assert(row, 404, 'not_found', 'Memory integration not found.');
  return row;
};

/** One attempt per admitted Run. A crash while querying cannot cause an
 * automatic second externally billed lookup. Ready evidence is encrypted. */
export async function prepareRemoteMemory(
  run: NativeRunRow,
  snapshot: IntegrationContextSnapshot,
): Promise<{ context?: string }> {
  const source = await transaction(run.organization_id, async (tx) => {
    const integration = await current(tx, snapshot.id);
    assert(
      integration.state !== 'disabled' &&
        !integration.removed_at &&
        !integration.retired_at &&
        String(integration.generation) === snapshot.generation,
      409,
      'integration_configuration_changed',
      'Memory settings changed; start a fresh Run.',
    );
    const service = await currentMemoryService(tx, integration);
    const claimed = await tx.query(
      `INSERT INTO integration_retrievals(organization_id,run_id,integration_id,generation,state) VALUES($1,$2,$3,$4,'querying') ON CONFLICT DO NOTHING RETURNING run_id`,
      [run.organization_id, run.id, snapshot.id, snapshot.generation],
    );
    const previous = (
      await tx.query<{ state: string; context_ciphertext: string | null }>(
        'SELECT state,context_ciphertext FROM integration_retrievals WHERE run_id=$1 AND integration_id=$2 AND generation=$3',
        [run.id, snapshot.id, snapshot.generation],
      )
    ).rows[0];
    return {
      integration,
      service,
      claimed: !!claimed.rowCount,
      previous,
      trace: await runTraceContext(tx, run),
    };
  });
  if (!source.claimed) {
    if (source.previous?.state === 'ready' && source.previous.context_ciphertext)
      return { context: unseal<string>(source.previous.context_ciphertext) };
    assert(
      !remoteConfiguration(source.integration).required,
      503,
      'memory_context_unavailable',
      'Required memory retrieval is pending or uncertain. Inspect the integration before starting another Run.',
    );
    await transaction(run.organization_id, (tx) => recordMemoryOmission(tx, run, 'unavailable'));
    return {};
  }
  const startedAt = new Date();
  try {
    const result = await source.service.recall(run.config.prompt);
    await transaction(run.organization_id, async (tx) => {
      const latest = await current(tx, snapshot.id);
      assert(
        latest.state !== 'disabled' &&
          !latest.removed_at &&
          !latest.retired_at &&
          String(latest.generation) === snapshot.generation,
        409,
        'integration_configuration_changed',
        'Memory changed while preparing context.',
      );
      await currentMemoryService(tx, latest);
      await tx.query(
        "UPDATE integration_retrievals SET state='ready',context_ciphertext=$4,receipt=$5,duration_ms=$6 WHERE run_id=$1 AND integration_id=$2 AND generation=$3",
        [
          run.id,
          snapshot.id,
          snapshot.generation,
          seal(result.text),
          result.receipt,
          Date.now() - startedAt.getTime(),
        ],
      );
      if (source.trace)
        afterCommit(tx, () =>
          traceMemory(
            source.trace!,
            'recall',
            run.id,
            startedAt,
            result.receipt,
            { installation_id: snapshot.id },
            result.text,
          ),
        );
    });
    return { context: result.text };
  } catch (error) {
    if (error instanceof AppError && error.code === 'integration_configuration_changed') throw error;
    await transaction(run.organization_id, async (tx) => {
      const latest = await current(tx, snapshot.id);
      assert(
        String(latest.generation) === snapshot.generation && !latest.removed_at && !latest.retired_at,
        409,
        'integration_configuration_changed',
        'Memory changed while preparing context.',
      );
      await tx.query(
        "UPDATE integration_retrievals SET state='unavailable',error_code='memory_retrieval_failed' WHERE run_id=$1 AND integration_id=$2 AND generation=$3",
        [run.id, snapshot.id, snapshot.generation],
      );
      await tx.query(
        "UPDATE agent_integrations SET last_error_code='memory_retrieval_failed' WHERE id=$1 AND generation=$2 AND state<>'disabled'",
        [snapshot.id, snapshot.generation],
      );
      if (!remoteConfiguration(source.integration).required)
        await recordMemoryOmission(tx, run, 'unavailable');
      if (source.trace)
        afterCommit(tx, () =>
          traceMemory(
            source.trace!,
            'recall',
            run.id,
            startedAt,
            { state: 'failed', external_cost_micro_usd: null, input_tokens: null, output_tokens: null },
            { installation_id: snapshot.id, provider: source.integration.pack_id, outcome: 'unconfirmed' },
          ),
        );
    });
    if (remoteConfiguration(source.integration).required) throw error;
    return {};
  }
}

/** Only committed final user/assistant text is eligible, never deltas,
 * reasoning, injected recall or transport logs. Source bytes load off-path. */
export async function queueIntegrationCapture(tx: Tx, run: NativeRunRow, trace?: TraceContext) {
  const snapshot = run.config.integration_context;
  if (!snapshot || !['succeeded', 'failed', 'cancelled', 'timed_out'].includes(run.status)) return;
  if (snapshot.access?.write === false) {
    await emit(
      tx,
      run.organization_id,
      run.id,
      'memory.capture_omitted',
      { integration_id: snapshot.id, reason: snapshot.omitted_reason || 'tool_permissions' },
      { id: `memory-capture-omission:${snapshot.id}:${snapshot.generation}`, sequence: 1 },
      run,
    );
    return;
  }
  await tx.query(
    `WITH source AS (
    INSERT INTO integration_sources(id,organization_id,integration_id,source_run_id,generation,trace_context)
    SELECT $1,$2,i.id,$3,i.generation,$7 FROM agent_integrations i
    WHERE i.id=$4 AND i.state='active' AND i.pack_id<>'file-memory' AND i.generation=$5 AND i.removed_at IS NULL AND i.retired_at IS NULL
    AND (i.pack_id='claude-mem' OR $8='succeeded' AND $9)
    ON CONFLICT(integration_id,source_run_id,generation) DO NOTHING RETURNING id)
    INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id) SELECT $6,$2,'integration',id FROM source`,
    [
      id(),
      run.organization_id,
      run.id,
      snapshot.id,
      snapshot.generation,
      id(),
      trace || null,
      run.status,
      !!run.result.output_text,
    ],
  );
}

export async function forgetRemoteMemory(tx: Tx, integration: Integration) {
  const latest = await current(tx, integration.id);
  assert(
    String(latest.revision) === String(integration.revision),
    412,
    'stale_revision',
    'Memory settings changed. Reload before forgetting.',
  );
  assert(
    integration.pack_id !== 'file-memory',
    409,
    'service_memory_required',
    'Delete editable notes through the file browser; historical files have separate retention.',
  );
  const existing = (
    await tx.query<{ id: string }>(
      "SELECT id FROM integration_sources WHERE integration_id=$1 AND kind='purge' ORDER BY id DESC LIMIT 1",
      [integration.id],
    )
  ).rows[0];
  if (latest.retired_at && existing)
    return { accepted: true as const, recall_disabled: true as const, cleanup_id: existing.id };
  // Revoke recall before contacting the service. Unknown/in-flight effects can
  // only touch this quarantined collection, never a new authorized collection.
  const sourceId = id();
  await invalidateMemorySearches(tx, integration.id);
  await tx.query(
    "UPDATE integration_retrievals SET context_ciphertext=NULL,state='unavailable',error_code='memory_forgotten' WHERE integration_id=$1",
    [integration.id],
  );
  const row = (
    await tx.query<Integration>(
      "UPDATE agent_integrations SET state='disabled',retired_at=now(),generation=generation+1,revision=revision+1,last_error_code='memory_cleanup_pending' WHERE id=$1 RETURNING *",
      [integration.id],
    )
  ).rows[0];
  await tx.query(
    "UPDATE integration_sources SET state='cancelled' WHERE integration_id=$1 AND state='queued'",
    [integration.id],
  );
  await tx.query(
    "INSERT INTO integration_sources(id,organization_id,integration_id,generation,kind) VALUES($1,$2,$3,$4,'purge')",
    [sourceId, integration.organization_id, integration.id, row.generation],
  );
  await tx.query(
    "INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id) VALUES($1,$2,'integration',$3)",
    [id(), integration.organization_id, sourceId],
  );
  return { accepted: true as const, recall_disabled: true as const, cleanup_id: sourceId };
}

async function executeMemoryJob(org: string, sourceId: string) {
  const claimed = await transaction(org, async (tx) => {
    // Resource -> dispatch/source lock order is shared with deletion. Never
    // hold a source lease while waiting for the collection's control fence.
    const hint = (
      await tx.query<{ integration_id: string }>(
        'SELECT integration_id FROM integration_sources WHERE id=$1',
        [sourceId],
      )
    ).rows[0];
    if (!hint) return undefined;
    const integration = await current(tx, hint.integration_id);
    const lease = await tx.query(
      "UPDATE dispatch_jobs SET lease_until=now()+interval '30 seconds',state='running' WHERE kind='integration' AND resource_id=$1 AND state IN ('pending','running') AND (lease_until IS NULL OR lease_until<now()) RETURNING id",
      [sourceId],
    );
    if (!lease.rowCount) return undefined;
    const source = (
      await tx.query<MemorySource>('SELECT * FROM integration_sources WHERE id=$1 FOR UPDATE', [sourceId])
    ).rows[0];
    if (!source || ['complete', 'failed', 'unknown', 'cancelled'].includes(source.state)) {
      await tx.query(
        "UPDATE dispatch_jobs SET state='done',lease_until=NULL WHERE resource_id=$1 AND kind='integration'",
        [sourceId],
      );
      return undefined;
    }
    if (Date.now() - source.check_started_at.getTime() > 24 * 60 * 60 * 1000 || source.polls >= 3000) {
      await tx.query(
        "UPDATE integration_sources SET state='unknown',error_code='memory_processing_deadline_exceeded' WHERE id=$1",
        [sourceId],
      );
      await tx.query(
        "UPDATE dispatch_jobs SET state='done',lease_until=NULL WHERE resource_id=$1 AND kind='integration'",
        [sourceId],
      );
      return undefined;
    }
    if (source.state === 'sending') {
      if (integration.pack_id === 'hindsight' && source.kind === 'capture') {
        source.state = 'waiting';
        source.receipt = {
          state: 'pending',
          operation_id: source.id,
          external_cost_micro_usd: null,
          input_tokens: null,
          output_tokens: null,
        };
        await tx.query("UPDATE integration_sources SET state='waiting',receipt=$2 WHERE id=$1", [
          sourceId,
          source.receipt,
        ]);
      } else {
        // No acknowledgement survived. Claude-mem has no source-idempotent POST.
        // Do not replay it or conceal unknown external generation spend.
        await tx.query(
          "UPDATE integration_sources SET state='unknown',error_code='memory_capture_outcome_unknown' WHERE id=$1",
          [sourceId],
        );
        await tx.query(
          "UPDATE dispatch_jobs SET state='done',lease_until=NULL WHERE resource_id=$1 AND kind='integration'",
          [sourceId],
        );
        return undefined;
      }
    }
    if (
      source.kind === 'capture' &&
      source.state === 'queued' &&
      (integration.state !== 'active' ||
        integration.removed_at ||
        String(integration.generation) !== String(source.generation))
    ) {
      await tx.query("UPDATE integration_sources SET state='cancelled' WHERE id=$1", [sourceId]);
      await tx.query(
        "UPDATE dispatch_jobs SET state='done',lease_until=NULL WHERE resource_id=$1 AND kind='integration'",
        [sourceId],
      );
      return undefined;
    }
    if (source.kind === 'purge') {
      const active = (
        await tx.query<{ uncertain: boolean; active: number }>(
          "SELECT coalesce(bool_or(state='unknown'),false) AS uncertain,count(*)::int AS active FROM integration_sources WHERE integration_id=$1 AND id<>$2 AND state IN ('sending','waiting','unknown')",
          [integration.id, source.id],
        )
      ).rows[0];
      if (active.uncertain) {
        // This is a known control blocker, not a transient discovery failure.
        // Publish it once; an owner can check the old job, then retry cleanup.
        await tx.query(
          "UPDATE integration_sources SET state='unknown',error_code='memory_cleanup_unconfirmed' WHERE id=$1",
          [sourceId],
        );
        await tx.query(
          "UPDATE dispatch_jobs SET state='done',lease_until=NULL WHERE resource_id=$1 AND kind='integration'",
          [sourceId],
        );
        await tx.query(
          "UPDATE agent_integrations SET last_error_code='memory_cleanup_unconfirmed' WHERE id=$1",
          [integration.id],
        );
        return undefined;
      }
      if (active.active) {
        await tx.query(
          "UPDATE dispatch_jobs SET state='pending',lease_until=NULL,available_at=now()+interval '2 seconds' WHERE resource_id=$1 AND kind='integration'",
          [sourceId],
        );
        return undefined;
      }
    }
    const service = await currentMemoryService(
      tx,
      integration,
      source.kind === 'purge' || source.state === 'waiting',
    );
    let text = source.text_ciphertext ? unseal<string>(source.text_ciphertext) : '';
    if (source.kind === 'capture' && source.state === 'queued' && !text) {
      text = await captureMemorySource(tx, source.source_run_id!, integration.pack_id === 'claude-mem');
      await tx.query('UPDATE integration_sources SET text_ciphertext=$2,text_bytes=$3 WHERE id=$1', [
        sourceId,
        seal(text),
        Buffer.byteLength(text),
      ]);
    }
    const leaseToken = id();
    await tx.query(
      "UPDATE integration_sources SET lease_token=$2,polls=polls+CASE WHEN state='waiting' THEN 1 ELSE 0 END,state=CASE WHEN state='queued' THEN 'sending' ELSE state END WHERE id=$1",
      [sourceId, leaseToken],
    );
    return { source, integration, service, text, leaseToken };
  });
  if (!claimed) return;
  let receipt: MemoryReceipt;
  const startedAt = new Date();
  try {
    if (claimed.source.kind === 'purge') {
      await claimed.service.purge();
      receipt = { state: 'complete', external_cost_micro_usd: null, input_tokens: null, output_tokens: null };
    } else
      receipt =
        claimed.source.state === 'waiting' && claimed.source.receipt?.operation_id
          ? await claimed.service.poll(claimed.source.receipt.operation_id)
          : await claimed.service.capture(
              claimed.source.id,
              claimed.text,
              claimed.source.id,
              claimed.source.created_at,
            );
  } catch (error) {
    await transaction(org, async (tx) => {
      await current(tx, claimed.integration.id);
      const mayPoll =
        (claimed.source.state === 'waiting' ||
          (claimed.integration.pack_id === 'hindsight' && claimed.source.kind === 'capture')) &&
        claimed.source.failures < 9;
      const recovering =
        claimed.source.receipt ||
        (claimed.integration.pack_id === 'hindsight'
          ? {
              state: 'pending',
              operation_id: sourceId,
              external_cost_micro_usd: null,
              input_tokens: null,
              output_tokens: null,
            }
          : null);
      const code = error instanceof AppError ? error.code : 'memory_service_call_failed';
      const updated = await tx.query(
        'UPDATE integration_sources SET state=$2,error_code=$4,receipt=coalesce(receipt,$5),failures=failures+1 WHERE id=$1 AND lease_token=$3 RETURNING id',
        [sourceId, mayPoll ? 'waiting' : 'unknown', claimed.leaseToken, code, recovering],
      );
      if (!updated.rowCount) return;
      await tx.query(
        "UPDATE dispatch_jobs SET state=$2,lease_until=NULL,available_at=now()+interval '10 seconds' WHERE resource_id=$1 AND kind='integration'",
        [sourceId, mayPoll ? 'pending' : 'done'],
      );
      await tx.query(
        "UPDATE agent_integrations SET last_error_code='memory_service_call_failed' WHERE id=$1",
        [claimed.integration.id],
      );
      afterCommit(tx, () =>
        traceMemory(
          claimed.source.trace_context || integrationTraceContext(claimed.integration, sourceId),
          claimed.source.kind === 'purge' ? 'purge' : 'capture',
          sourceId,
          claimed.source.created_at,
          {
            state: 'failed',
            operation_id: recovering?.operation_id,
            external_cost_micro_usd: null,
            input_tokens: null,
            output_tokens: null,
          },
          {
            installation_id: claimed.integration.id,
            provider: claimed.integration.pack_id,
            outcome: mayPoll ? 'awaiting_confirmation' : 'unconfirmed',
            error_code: code,
          },
        ),
      );
    });
    console.error(JSON.stringify({ code: 'memory_service_call_failed', ...errorDiagnostics(error) }));
    return;
  }
  await transaction(org, async (tx) => {
    await current(tx, claimed.integration.id);
    const state = receipt.state === 'pending' ? 'waiting' : receipt.state;
    const updated = await tx.query(
      'UPDATE integration_sources SET state=$2,receipt=$3,failures=0 WHERE id=$1 AND lease_token=$4 RETURNING id',
      [sourceId, state, receipt, claimed.leaseToken],
    );
    if (!updated.rowCount) return;
    const context = claimed.source.trace_context || integrationTraceContext(claimed.integration, sourceId);
    // One upserted processing observation, not thousands of pending poll spans
    // or repeatedly summed vendor totals. The final receipt remains explicit.
    if (receipt.state !== 'pending' || claimed.source.state !== 'waiting')
      afterCommit(tx, () =>
        traceMemory(
          context,
          claimed.source.kind === 'purge' ? 'purge' : 'capture',
          sourceId,
          claimed.source.created_at,
          receipt,
          {
            installation_id: claimed.integration.id,
            provider: claimed.integration.pack_id,
            duration_ms: Date.now() - startedAt.getTime(),
            poll_attempts: claimed.source.polls,
          },
        ),
      );
    const delay = Date.now() - claimed.source.created_at.getTime() > 60000 ? 30 : 2;
    await tx.query(
      "UPDATE dispatch_jobs SET state=$2,lease_until=NULL,available_at=now()+$3*interval '1 second' WHERE resource_id=$1 AND kind='integration'",
      [sourceId, state === 'waiting' ? 'pending' : 'done', delay],
    );
    if (claimed.source.kind === 'purge' && state === 'complete') {
      await tx.query(
        "UPDATE integration_sources SET text_ciphertext=NULL,text_bytes=NULL,forgotten_at=now() WHERE integration_id=$1 AND kind='capture'",
        [claimed.integration.id],
      );
      await tx.query('DELETE FROM integration_retrievals WHERE integration_id=$1', [claimed.integration.id]);
      await tx.query("UPDATE agent_integrations SET last_error_code='memory_forgotten' WHERE id=$1", [
        claimed.integration.id,
      ]);
    }
  });
}

export async function dispatchIntegrationJobs() {
  const jobs = (
    await pool.query<{ organization_id: string; resource_id: string }>(
      "SELECT organization_id,resource_id FROM dispatch_jobs WHERE kind='integration' AND state IN ('pending','running') AND available_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY available_at,id LIMIT 16",
    )
  ).rows;
  await mapConcurrent(jobs, 4, async (job) => {
    try {
      await executeMemoryJob(job.organization_id, job.resource_id);
    } catch (error) {
      await transaction(job.organization_id, async (tx) => {
        // A lost publication may leave a live sending lease. Never erase that
        // identity, or overwrite a newer owner's claim, in the discovery catch.
        const changed = await tx.query(
          `UPDATE dispatch_jobs SET failure_attempts=failure_attempts+1,
          state=CASE WHEN failure_attempts>=7 THEN 'blocked' ELSE 'pending' END,
          available_at=now()+interval '30 seconds',lease_until=NULL,error=$2
          WHERE resource_id=$1 AND kind='integration' AND state IN ('pending','running')
          AND (lease_until IS NULL OR lease_until<now()) RETURNING state`,
          [job.resource_id, error instanceof AppError ? error.code : 'memory_job_failed'],
        );
        if (changed.rows[0]?.state === 'blocked')
          await tx.query(
            "UPDATE integration_sources SET state=CASE WHEN state IN ('sending','waiting') THEN 'unknown' ELSE 'failed' END,error_code=$2 WHERE id=$1",
            [job.resource_id, error instanceof AppError ? error.code : 'memory_job_failed'],
          );
      });
      console.error(JSON.stringify({ code: 'memory_job_failed', ...errorDiagnostics(error) }));
    }
  });
  return { memory_jobs: jobs.length };
}

export const memoryServiceIdentity = (baseURL: string, namespace: string) =>
  sha256(`${new URL(baseURL).href.replace(/\/+$/, '')}\n${namespace}`);

export const memoryConnectionFingerprint = (connection: resources.Document<'connections'>) =>
  sha256(
    canonical({
      provider: connection.provider,
      kind: connection.kind,
      owner: connection.owner_subject_id,
      url: connection.url ? new URL(connection.url).href : null,
      authentication: connection.auth_method,
      credential: connection.secret_ciphertext || null,
      headers: connection.headers_ciphertext || null,
    }),
  );

export async function listMemoryActivity(tx: Tx, integration: Integration, query: URLSearchParams) {
  const limit = Math.min(100, Math.max(1, Number(query.get('limit')) || 25));
  const rows = (
    await tx.query<MemorySource & { error_code: string | null }>(
      `SELECT id,organization_id,integration_id,source_run_id,generation,kind,state,receipt,error_code,created_at FROM integration_sources WHERE integration_id=$1 AND ($2::uuid IS NULL OR id<$2) ORDER BY id DESC LIMIT $3`,
      [integration.id, query.get('cursor'), limit + 1],
    )
  ).rows;
  return {
    data: rows.slice(0, limit).map((row) => ({
      id: row.id,
      source_run_id: row.source_run_id,
      kind: row.kind,
      state: row.state,
      generation: String(row.generation),
      error_code: row.error_code,
      created_at: row.created_at.toISOString(),
      receipt: row.receipt,
    })),
    next_cursor: rows.length > limit ? rows[limit - 1].id : null,
  };
}

export async function readMemorySource(tx: Tx, integration: Integration, sourceId: string) {
  const latest = await current(tx, integration.id);
  assert(
    String(latest.generation) === String(integration.generation),
    410,
    'memory_context_revoked',
    'Memory changed while inspecting this source.',
  );
  const source = (
    await tx.query<MemorySource>('SELECT * FROM integration_sources WHERE integration_id=$1 AND id=$2', [
      integration.id,
      sourceId,
    ])
  ).rows[0];
  assert(source, 404, 'not_found', 'Memory source not found.');
  return {
    id: source.id,
    state: source.state,
    content: source.text_ciphertext ? unseal<string>(source.text_ciphertext) : null,
    receipt: source.receipt,
  };
}

export async function addMemoryNote(tx: Tx, integration: Integration, content: string) {
  const latest = await current(tx, integration.id);
  assert(
    String(latest.generation) === String(integration.generation),
    412,
    'stale_revision',
    'Memory changed. Reload before adding a note.',
  );
  assert(
    integration.pack_id !== 'file-memory' &&
      integration.state === 'active' &&
      !integration.removed_at &&
      !integration.retired_at,
    409,
    'memory_not_active',
    'Enable the service integration before adding a note.',
  );
  assert(
    Buffer.byteLength(content) > 0 && Buffer.byteLength(content) <= 65536,
    413,
    'memory_note_too_large',
    'Use a non-empty memory note up to 64 KiB.',
  );
  await currentMemoryService(tx, integration);
  const sourceId = id();
  const text = JSON.stringify(
    traceContent(
      { kind: 'human-confirmed-note', content: memoryText(content), recorded_at: new Date().toISOString() },
      512 * 1024,
    ),
  );
  await tx.query(
    'INSERT INTO integration_sources(id,organization_id,integration_id,generation,text_ciphertext,text_bytes) VALUES($1,$2,$3,$4,$5,$6)',
    [
      sourceId,
      integration.organization_id,
      integration.id,
      integration.generation,
      seal(text),
      Buffer.byteLength(text),
    ],
  );
  await tx.query(
    "INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id) VALUES($1,$2,'integration',$3)",
    [id(), integration.organization_id, sourceId],
  );
  return { id: sourceId, state: 'queued' as const };
}

export async function retryMemoryCheck(tx: Tx, integration: Integration, sourceId: string) {
  const latest = await current(tx, integration.id);
  await currentMemoryService(tx, latest, true);
  const job = (
    await tx.query<{ lease_until: Date | null }>(
      "SELECT lease_until FROM dispatch_jobs WHERE resource_id=$1 AND kind='integration' FOR UPDATE",
      [sourceId],
    )
  ).rows[0];
  assert(
    !job?.lease_until || job.lease_until.getTime() <= Date.now(),
    409,
    'memory_job_busy',
    'This memory job is already being checked.',
  );
  const source = (
    await tx.query<MemorySource>(
      'SELECT * FROM integration_sources WHERE integration_id=$1 AND id=$2 FOR UPDATE',
      [integration.id, sourceId],
    )
  ).rows[0];
  assert(
    source && (source.kind === 'purge' || source.receipt?.operation_id),
    409,
    'memory_recovery_unavailable',
    'No acknowledged provider job can be checked safely. Ask the service operator to verify the uncertain write; it will not be submitted again.',
  );
  const state = source.kind === 'purge' ? ('queued' as const) : ('waiting' as const);
  await tx.query(
    'UPDATE integration_sources SET state=$2,failures=0,polls=0,check_started_at=now(),error_code=NULL WHERE id=$1',
    [sourceId, state],
  );
  await tx.query(
    "UPDATE dispatch_jobs SET state='pending',lease_until=NULL,available_at=now() WHERE kind='integration' AND resource_id=$1",
    [sourceId],
  );
  return { id: sourceId, state };
}

function traceMemory(
  context: TraceContext,
  action: string,
  identity: string,
  startedAt: Date,
  receipt: MemoryReceipt,
  metadata: Record<string, unknown>,
  output?: string,
) {
  recordTrace({
    context,
    id: `memory:${action}:${identity}`,
    name: `memory.${action}`,
    type: action === 'recall' || action === 'search' ? 'retriever' : 'tool',
    startedAt,
    endedAt: new Date(),
    output,
    chargedMicroUsd: '0',
    level: receipt.state === 'failed' ? 'ERROR' : 'DEFAULT',
    metadata: {
      ...metadata,
      funding: 'external',
      external_cost_micro_usd: receipt.external_cost_micro_usd,
      external_cost_known: receipt.external_cost_micro_usd !== null,
      input_tokens: receipt.input_tokens,
      output_tokens: receipt.output_tokens,
      provider_operation_id: receipt.operation_id,
      operation_state: receipt.state,
    },
    ...(receipt.input_tokens !== null && receipt.output_tokens !== null
      ? {
          usage: {
            input: Number(receipt.input_tokens),
            output: Number(receipt.output_tokens),
            cached: 0,
            cacheWrite: 0,
            complete: true,
          },
        }
      : {}),
  });
}
