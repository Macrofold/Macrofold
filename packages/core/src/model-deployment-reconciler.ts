import { z } from 'zod';
import { pool, transaction, type Tx } from '../../db';
import { runpodModelHosting } from '../../providers/src/runpod-model-hosting';
import { modelEndpointFetch } from '../../providers/src/network';
import { boundedJSON } from './body';
import { config } from './config';
import { id, seal, token, unseal, canonical, sha256 } from './crypto';
import { AppError, assert } from './errors';
import { mapConcurrent } from './concurrent';
import { revisionRow } from './model-deployments';
import { quoteManagedService } from './model-deployment-service';
import { matchesDeploymentResource } from './model-deployment-resource';
import type {
  DeploymentRow,
  DeploymentRevisionRow,
  DeploymentResourceRow,
  ModelHostingProvider,
  ServingObservation,
  GpuOffer,
} from './model-deployment-types';

const LEASE_MS = 120_000;
const STARTUP_MS = 20 * 60_000;
const DRAIN_MS = 270_000;
const MAX_FAILURES = 8;
type Claim = { row: DeploymentRow; lease: string };
type Connection = {
  kind: string;
  owner_subject_id?: string;
  status: string;
  deleted?: boolean;
  secret_ciphertext?: string;
  headers_ciphertext?: string;
  url?: string;
};
type ExternalFetch = typeof modelEndpointFetch;

async function claim(org: string, deploymentId: string): Promise<Claim | undefined> {
  return transaction(org, async (tx) => {
    const row = (
      await tx.query<DeploymentRow>(
        `SELECT * FROM model_deployments WHERE id=$1
      AND next_check_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp()) FOR UPDATE SKIP LOCKED`,
        [deploymentId],
      )
    ).rows[0];
    if (!row) return;
    const lease = id();
    await tx.query(
      "UPDATE model_deployments SET lease_id=$2,lease_until=clock_timestamp()+($3::integer*interval '1 millisecond') WHERE id=$1",
      [row.id, lease, LEASE_MS],
    );
    return { row, lease };
  });
}

async function mutate<T>(
  org: string,
  current: Claim,
  work: (tx: Tx, row: DeploymentRow) => Promise<T>,
): Promise<T | undefined> {
  return transaction(org, async (tx) => {
    const row = (
      await tx.query<DeploymentRow>(
        'SELECT * FROM model_deployments WHERE id=$1 AND lease_id=$2 AND generation=$3 FOR UPDATE',
        [current.row.id, current.lease, current.row.generation],
      )
    ).rows[0];
    if (!row) return;
    return work(tx, row);
  });
}

async function connection(
  tx: Tx,
  row: DeploymentRow,
  revision: DeploymentRevisionRow,
  connectionId: string,
  kind: Connection['kind'],
  cleanup = false,
): Promise<Connection> {
  const selected = (
    await tx.query<{ data: Connection }>(
      `SELECT c.data FROM model_deployment_connections g
    JOIN connections c ON c.id=g.connection_id AND c.organization_id=g.organization_id
    WHERE g.deployment_id=$1 AND g.revision_id=$2 AND g.connection_id=$3 AND g.organization_id=$4 AND g.approved_by=$5 FOR UPDATE OF c`,
      [row.id, revision.id, connectionId, row.organization_id, row.owner_subject_id],
    )
  ).rows[0]?.data;
  assert(
    selected &&
      selected.owner_subject_id === row.owner_subject_id &&
      selected.kind === kind &&
      (cleanup || (!selected.deleted && selected.status === 'healthy')),
    403,
    'permission_denied',
    'The exact delegated deployment connection is unavailable.',
  );
  if (!cleanup) {
    const owner = await tx.query(
      `SELECT 1 FROM memberships m JOIN auth."user" u ON u.id=m.user_id
      WHERE m.organization_id=$1 AND m.user_id=$2 AND m.role IN ('owner','admin') AND u."emailVerified"=true`,
      [row.organization_id, row.owner_subject_id],
    );
    assert(owner.rowCount, 403, 'permission_denied', 'The deployment owner no longer has hosting authority.');
  }
  return selected;
}
function secret(value: Connection): string {
  assert(
    value.secret_ciphertext,
    403,
    'permission_denied',
    'The delegated deployment connection has no credential.',
  );
  return unseal<string>(value.secret_ciphertext);
}
async function activeResource(org: string, deploymentId: string) {
  return transaction(
    org,
    async (tx) =>
      (
        await tx.query<DeploymentResourceRow>(
          'SELECT * FROM model_deployment_resources WHERE deployment_id=$1 AND deleted_at IS NULL',
          [deploymentId],
        )
      ).rows[0],
  );
}

function validateObservedHardware(
  revision: DeploymentRevisionRow,
  resource: DeploymentResourceRow,
  observation: ServingObservation,
  offers: GpuOffer[],
) {
  assert(
    revision.hosting.kind === 'runpod_serverless',
    422,
    'invalid_hosting_policy',
    'Managed hosting is required.',
  );
  const placement = revision.hosting.placement;
  const gpu = z.object({ pools: z.array(z.string()), count: z.number().int() }).parse(observation.config.gpu);
  const workers = z
    .array(z.object({ gpuTypeId: z.string().nullable(), gpuCount: z.number().int() }))
    .parse(observation.config.observed_workers);
  const eligible = offers.filter((offer) => placement.gpu_pool_ids.includes(offer.pool));
  // Pool names describe allowed alternatives; the provider's actual GPU IDs
  // must still resolve into that current catalog. Regions remain preferences.
  assert(
    gpu.count === placement.gpu_count &&
      canonical([...gpu.pools].sort()) === canonical([...placement.gpu_pool_ids].sort()) &&
      workers.every(
        (worker) =>
          worker.gpuCount === 0 ||
          (worker.gpuCount === placement.gpu_count &&
            eligible.some((offer) => offer.id === worker.gpuTypeId)),
      ) &&
      (observation.config.disk === undefined || observation.config.disk === resource.config.disk),
    422,
    'invalid_hosting_policy',
    'Observed hosting hardware or disk differs from the accepted placement.',
  );
}

async function resourceCredential(
  org: string,
  row: DeploymentRow,
  resource: DeploymentResourceRow,
  cleanup: boolean,
  provider?: ModelHostingProvider,
) {
  if (cleanup) {
    assert(
      resource.cleanup_secret_ciphertext,
      503,
      'deployment_unavailable',
      'The resource cleanup credential is unavailable.',
    );
    return unseal<string>(resource.cleanup_secret_ciphertext);
  }
  const selected = await transaction(org, async (tx) => {
    const revision = await revisionRow(tx, row.id, resource.revision_id);
    return connection(tx, row, revision, resource.connection_id, 'runpod');
  });
  const key = secret(selected);
  if (selected.secret_ciphertext !== resource.cleanup_secret_ciphertext) {
    assert(
      provider && resource.provider_id,
      409,
      'deployment_conflict',
      'A credential change cannot reinterpret an ambiguous create.',
    );
    const observation = await provider.inspect(key, resource.provider_id);
    assert(
      observation && matchesDeploymentResource(resource, observation),
      403,
      'permission_denied',
      'The rotated credential did not establish access to the same owned endpoint.',
    );
    await transaction(org, async (tx) => {
      const revision = await revisionRow(tx, row.id, resource.revision_id);
      const latest = await connection(tx, row, revision, resource.connection_id, 'runpod');
      assert(
        latest.secret_ciphertext === selected.secret_ciphertext,
        409,
        'deployment_conflict',
        'The connection changed during resource credential validation.',
      );
      await tx.query(
        'UPDATE model_deployment_resources SET cleanup_secret_ciphertext=$2 WHERE id=$1 AND deleted_at IS NULL',
        [resource.id, selected.secret_ciphertext],
      );
    });
  }
  return key;
}

async function reconcileAttempt(
  org: string,
  current: Claim,
  resource: DeploymentResourceRow,
  key: string,
  provider: ModelHostingProvider,
): Promise<DeploymentResourceRow | undefined> {
  if (resource.provider_id) return resource;
  const matches = await provider.findAttempt(key, resource.attempt_id);
  if (matches.length !== 1) {
    await mutate(org, current, async (tx) => {
      await tx.query(
        "UPDATE model_deployment_resources SET state='ambiguous',last_error=$2,observed_at=now() WHERE id=$1",
        [resource.id, matches.length ? 'multiple_provider_resources' : 'provider_create_unconfirmed'],
      );
      await tx.query(
        "UPDATE model_deployments SET state='cleanup_pending',serving_revision_id=NULL,ready_replicas=0,failure_code=CASE WHEN failure_code='service_recovery_exhausted' THEN failure_code ELSE $2 END WHERE id=$1",
        [current.row.id, matches.length ? 'multiple_provider_resources' : 'provider_create_unconfirmed'],
      );
    });
    return;
  }
  const observed = await provider.inspect(key, matches[0].id);
  assert(
    observed && matchesDeploymentResource(resource, observed),
    409,
    'deployment_conflict',
    'The ambiguous provider resource does not match the saved immutable attempt.',
  );
  // Resource identity survives a superseding stop/generation. A stale readiness
  // callback cannot publish service, but must not strand a discovered paid host.
  await transaction(org, async (tx) => {
    await tx.query(
      "UPDATE model_deployment_resources SET provider_id=$2,endpoint_url=$3,state='starting',observed_at=now(),last_error=NULL WHERE id=$1 AND provider_id IS NULL",
      [resource.id, observed.id, observed.endpoint_url],
    );
  });
  return { ...resource, provider_id: observed.id, endpoint_url: observed.endpoint_url, state: 'starting' };
}

async function observeCosts(
  org: string,
  resource: DeploymentResourceRow,
  key: string,
  provider: ModelHostingProvider,
) {
  if (!resource.provider_id) return;
  const end = new Date();
  const start = new Date(Math.max(resource.created_at.getTime(), end.getTime() - 30 * 86_400_000));
  if (start >= end) return;
  const observations = await provider.costs(
    key,
    resource.provider_id,
    start.toISOString(),
    end.toISOString(),
  );
  await transaction(org, async (tx) => {
    if (!observations.length) return;
    await tx.query(
      `INSERT INTO model_deployment_cost_observations(organization_id,resource_id,period_start,period_end,provider_reported_micro_usd)
      SELECT $1::uuid,$2::uuid,c.period_start,c.period_end,c.micro_usd::bigint FROM jsonb_to_recordset($3::jsonb)
      AS c(period_start timestamptz,period_end timestamptz,micro_usd text)
      ON CONFLICT(resource_id,period_start,period_end) DO UPDATE SET provider_reported_micro_usd=excluded.provider_reported_micro_usd,as_of=now()`,
      [
        org,
        resource.id,
        JSON.stringify(
          observations.map((observation) => ({
            period_start: observation.start,
            period_end: observation.end,
            micro_usd: observation.micro_usd,
          })),
        ),
      ],
    );
  });
}

async function historicalCosts(org: string, row: DeploymentRow, provider: ModelHostingProvider) {
  // Confirmed teardown releases cleanup credentials. Delayed/corrected buckets
  // can still use the current healthy connection; unavailable access remains
  // unknown and never recreates infrastructure or retains a second billing key.
  const resources = await transaction(
    org,
    async (tx) =>
      (
        await tx.query<DeploymentResourceRow & { credential: string }>(
          `SELECT r.*,c.data->>'secret_ciphertext' AS credential
    FROM model_deployment_resources r JOIN connections c ON c.id=r.connection_id AND c.organization_id=r.organization_id
    JOIN model_deployment_connections g ON g.deployment_id=r.deployment_id AND g.revision_id=r.revision_id
      AND g.connection_id=r.connection_id AND g.organization_id=r.organization_id AND g.approved_by=$2
    JOIN memberships m ON m.organization_id=r.organization_id AND m.user_id=$2 AND m.role IN ('owner','admin')
    JOIN auth."user" u ON u.id=m.user_id AND u."emailVerified"=true
    WHERE r.deployment_id=$1 AND r.deleted_at IS NOT NULL AND r.provider_id IS NOT NULL
      AND c.data->>'owner_subject_id'=$2 AND c.data->>'kind'='runpod' AND c.data->>'status'='healthy'
      AND coalesce((c.data->>'deleted')::boolean,false)=false AND c.data->>'secret_ciphertext' IS NOT NULL
      AND (r.observed_at IS NULL OR r.observed_at<now()-interval '5 minutes')
    ORDER BY r.observed_at NULLS FIRST,r.id LIMIT 2`,
          [row.id, row.owner_subject_id],
        )
      ).rows,
  );
  await mapConcurrent(resources, 2, async (resource) => {
    try {
      await observeCosts(org, resource, unseal<string>(resource.credential), provider);
    } finally {
      await transaction(org, async (tx) => {
        await tx.query('UPDATE model_deployment_resources SET observed_at=now() WHERE id=$1', [resource.id]);
      });
    }
  });
}

async function drain(org: string, current: Claim, revisionId: string): Promise<boolean> {
  return (
    (await mutate(org, current, async (tx, row) => {
      const running = (
        await tx.query<{ id: string }>(
          `SELECT id FROM runs WHERE config#>>'{deployment_target,deployment_id}'=$1
      AND config#>>'{deployment_target,deployment_revision_id}'=$2 AND status IN ('queued','provisioning','running','waiting_for_input','persisting') LIMIT 1`,
          [row.id, revisionId],
        )
      ).rows;
      if (!running.length) return true;
      if (!row.drain_started_at) {
        await tx.query('UPDATE model_deployments SET drain_started_at=now() WHERE id=$1', [row.id]);
        return false;
      }
      if (Date.now() - row.drain_started_at.getTime() < DRAIN_MS) return false;
      await tx.query(
        `UPDATE runs SET cancel_requested=true WHERE config#>>'{deployment_target,deployment_id}'=$1
        AND config#>>'{deployment_target,deployment_revision_id}'=$2 AND status IN ('queued','provisioning','running','waiting_for_input','persisting')`,
        [row.id, revisionId],
      );
      await tx.query(
        `UPDATE dispatch_jobs SET available_at=now() WHERE kind='run' AND state<>'done' AND resource_id IN
          (SELECT id FROM runs WHERE config#>>'{deployment_target,deployment_id}'=$1 AND config#>>'{deployment_target,deployment_revision_id}'=$2
          AND status IN ('queued','provisioning','running','waiting_for_input','persisting'))`,
        [row.id, revisionId],
      );
      return true;
    })) ?? false
  );
}

async function stopOwnedResource(
  org: string,
  current: Claim,
  resource: DeploymentResourceRow,
  provider: ModelHostingProvider,
) {
  if (!(await drain(org, current, resource.revision_id))) return;
  const key = await resourceCredential(org, current.row, resource, true);
  const known = await reconcileAttempt(org, current, resource, key, provider);
  if (!known?.provider_id) return;
  // Narrowing and deletion do not depend on a fresh catalog or working inventory.
  // DELETE must still be attempted if scale-down fails.
  const updated = await mutate(org, current, async (tx) => {
    await tx.query("UPDATE model_deployment_resources SET state='stopping' WHERE id=$1", [known.id]);
    return true;
  });
  if (!updated) return;
  await provider.update(key, known.provider_id, { workers: { min: 0, max: 0 } }).catch(() => {});
  await provider.delete(key, known.provider_id).catch(() => {});
  const observation = await provider.inspect(key, known.provider_id);
  await mutate(org, current, async (tx, row) => {
    if (observation === null) {
      await tx.query(
        "UPDATE model_deployment_resources SET state='deleted',stopped_at=coalesce(stopped_at,now()),deleted_at=now(),cleanup_secret_ciphertext=NULL,observed_at=now(),last_error=NULL WHERE id=$1",
        [known.id],
      );
      await tx.query(
        `UPDATE model_deployments SET serving_revision_id=NULL,ready_replicas=0,drain_started_at=NULL,
        state=CASE WHEN failure_code='service_recovery_exhausted' THEN 'failed' WHEN desired_state='running' AND retired=false THEN 'starting' ELSE 'stopped' END,
        observed_at=now() WHERE id=$1`,
        [row.id],
      );
    } else {
      await tx.query(
        "UPDATE model_deployment_resources SET state='cleanup_pending',observed_at=now(),last_error='provider_stop_unconfirmed' WHERE id=$1",
        [known.id],
      );
      await tx.query(
        "UPDATE model_deployments SET state='cleanup_pending',serving_revision_id=NULL,ready_replicas=0,failure_code=CASE WHEN failure_code='service_recovery_exhausted' THEN failure_code ELSE 'provider_stop_unconfirmed' END,observed_at=now() WHERE id=$1",
        [row.id],
      );
    }
  });
  await observeCosts(org, known, key, provider).catch(() => {});
}

async function external(
  org: string,
  current: Claim,
  revision: DeploymentRevisionRow,
  fetchEndpoint: ExternalFetch,
) {
  assert(
    revision.hosting.kind === 'external_openai',
    500,
    'invalid_model_deployment',
    'External hosting selection is required.',
  );
  const selected = await mutate(org, current, async (tx, row) => {
    const value = await connection(
      tx,
      row,
      revision,
      revision.hosting.kind === 'external_openai' ? revision.hosting.endpoint_connection_id : '',
      'external_model',
    );
    assert(
      value.url && value.url === revision.source_evidence.endpoint_url,
      409,
      'deployment_binding_stale',
      'The external origin changed; select an immutable revision for the new endpoint.',
    );
    const headers = value.headers_ciphertext ? unseal<Record<string, string>>(value.headers_ciphertext) : {};
    if (value.secret_ciphertext) headers.Authorization = `Bearer ${unseal<string>(value.secret_ciphertext)}`;
    return { url: value.url, headers };
  });
  if (!selected) return;
  const response = await fetchEndpoint(
    selected.url + '/models',
    { headers: selected.headers, method: 'GET' },
    { timeoutMs: 10_000, maximumResponseBytes: 1024 * 1024 },
  );
  if (!response.ok) {
    await response.body?.cancel();
    assert(false, 503, 'deployment_unavailable', 'The external model endpoint is not ready.');
  }
  const models = z
    .object({ data: z.array(z.object({ id: z.string() })).max(1000) })
    .parse(await boundedJSON(response, 1024 * 1024));
  assert(
    models.data.some(
      (model) => revision.hosting.kind === 'external_openai' && model.id === revision.hosting.model_alias,
    ),
    503,
    'deployment_unavailable',
    'The external endpoint is not serving the configured model alias.',
  );
  await mutate(org, current, async (tx, row) => {
    await tx.query(
      "UPDATE model_deployments SET state='ready',serving_revision_id=$2,ready_replicas=NULL,observed_at=now(),failure_code=NULL,failure_attempts=0 WHERE id=$1",
      [row.id, revision.id],
    );
  });
}

function providerConfig(
  row: DeploymentRow,
  revision: DeploymentRevisionRow,
  attemptId: string,
): Record<string, unknown> {
  assert(
    revision.hosting.kind === 'runpod_serverless' &&
      revision.source.kind === 'hugging_face' &&
      'profile_id' in revision.runtime &&
      row.policy &&
      'min_replicas' in row.policy,
    422,
    'invalid_hosting_policy',
    'A managed revision requires a compatible source, runtime and standing policy.',
  );
  const image = revision.source_evidence.runtime_image;
  assert(
    typeof image === 'string' && /@sha256:[a-f0-9]{64}$/.test(image),
    503,
    'model_runtime_unconfigured',
    'The immutable wrapper image is unavailable.',
  );
  const source = revision.source;
  const memory = revision.source_evidence.memory_estimate_bytes;
  assert(
    typeof memory === 'string' && /^[0-9]+$/.test(memory),
    422,
    'invalid_hosting_policy',
    'The accepted memory estimate is unavailable.',
  );
  return {
    name: `macrofold-${row.id}`,
    type: 'LOAD_BALANCER',
    image,
    cmd: ['python3', '/opt/macrofold-model/server.py'],
    disk: Math.max(20, Math.ceil((Number(memory) / 1e9) * 2)),
    ports: ['8000/http'],
    env: {
      PORT: '8000',
      PORT_HEALTH: '8000',
      HEALTH_CHECK_PATH: '/ping',
      MF_ATTEMPT_ID: attemptId,
      MF_REVISION_ID: revision.id,
      MF_MODEL_CONFIG: JSON.stringify({
        source: {
          repository: source.repository,
          revision: source.revision,
          weight_files: source.weight_files,
          ...(source.tokenizer ? { tokenizer: source.tokenizer } : {}),
        },
        parameters: revision.runtime.parameters,
        served_alias: `macrofold-${revision.id}`,
      }),
    },
    gpu: {
      pools: revision.hosting.placement.gpu_pool_ids,
      count: revision.hosting.placement.gpu_count,
      minCudaVersion: '13.0',
    },
    dataCenterIds: revision.hosting.placement.region_ids,
    workers: { min: row.policy.min_replicas, max: row.policy.max_replicas, idleTimeout: 10 },
    scaling: {
      type: 'REQUEST_COUNT',
      requestCount: Math.min(
        row.policy.max_concurrent_requests,
        revision.capabilities.max_concurrent_requests,
      ),
    },
    timeout: 240_000,
  };
}

async function startResource(
  org: string,
  current: Claim,
  revision: DeploymentRevisionRow,
  provider: ModelHostingProvider,
) {
  assert(
    config.allowPaid,
    503,
    'execution_disabled',
    'Paid hosting execution is disabled; owned cleanup remains available.',
  );
  const selected = await mutate(org, current, async (tx, row) => {
    assert(
      revision.hosting.kind === 'runpod_serverless' && row.policy,
      422,
      'invalid_hosting_policy',
      'Managed hosting policy is missing.',
    );
    return {
      key: secret(await connection(tx, row, revision, revision.hosting.compute_connection_id, 'runpod')),
      policy: row.policy,
    };
  });
  if (!selected) return;
  const rates = await quoteManagedService(revision, selected.policy, selected.key, provider);
  const reservation = await mutate(org, current, async (tx, row) => {
    assert(
      config.allowPaid &&
        row.desired_state === 'running' &&
        !row.retired &&
        row.desired_revision_id === revision.id,
      409,
      'deployment_conflict',
      'The desired service changed before provisioning.',
    );
    const compute = await connection(
      tx,
      row,
      revision,
      revision.hosting.kind === 'runpod_serverless' ? revision.hosting.compute_connection_id : '',
      'runpod',
    );
    const sourceConnection =
      revision.source.kind === 'hugging_face' && revision.source.source_connection_id
        ? await connection(tx, row, revision, revision.source.source_connection_id, 'hugging_face')
        : undefined;
    const sourceToken = sourceConnection ? secret(sourceConnection) : undefined;
    const attemptId = id();
    const payload = providerConfig(row, revision, attemptId);
    if (sourceConnection?.secret_ciphertext)
      payload.env = {
        ...z.record(z.string(), z.string()).parse(payload.env),
        MF_SOURCE_CREDENTIAL_REVISION: sha256(sourceConnection.secret_ciphertext),
      };
    const endpointSecret = token('model');
    const resource = (
      await tx.query<DeploymentResourceRow>(
        `INSERT INTO model_deployment_resources(id,organization_id,deployment_id,revision_id,connection_id,attempt_id,secret_ciphertext,config,accepted_rates,cleanup_secret_ciphertext,state)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'creating') RETURNING *`,
        [
          id(),
          org,
          row.id,
          revision.id,
          revision.hosting.kind === 'runpod_serverless' ? revision.hosting.compute_connection_id : '',
          attemptId,
          seal(endpointSecret),
          JSON.stringify(payload),
          JSON.stringify(rates),
          compute.secret_ciphertext,
        ],
      )
    ).rows[0];
    await tx.query(
      "UPDATE model_deployments SET state='starting',serving_revision_id=NULL,ready_replicas=0,accepted_rates=$2,startup_at=coalesce(startup_at,now()),failure_code=NULL WHERE id=$1",
      [row.id, JSON.stringify(rates)],
    );
    return { resource, key: secret(compute), sourceToken, endpointSecret };
  });
  if (!reservation) return;
  let result: { id: string; endpoint_url: string };
  try {
    const environment = z.record(z.string(), z.string()).parse(reservation.resource.config.env);
    result = await provider.create(reservation.key, {
      ...reservation.resource.config,
      env: {
        ...environment,
        MF_ENDPOINT_SECRET: reservation.endpointSecret,
        ...(reservation.sourceToken ? { HF_TOKEN: reservation.sourceToken } : {}),
      },
    });
  } catch (cause) {
    await transaction(org, async (tx) => {
      await tx.query(
        "UPDATE model_deployment_resources SET state='ambiguous',last_error='provider_create_unconfirmed',observed_at=now() WHERE id=$1 AND provider_id IS NULL",
        [reservation.resource.id],
      );
    });
    throw cause;
  }
  await transaction(org, async (tx) => {
    await tx.query(
      "UPDATE model_deployment_resources SET provider_id=$2,endpoint_url=$3,state='starting',observed_at=now() WHERE id=$1 AND provider_id IS NULL",
      [reservation.resource.id, result.id, result.endpoint_url],
    );
  });
}

async function observeManaged(
  org: string,
  current: Claim,
  revision: DeploymentRevisionRow,
  resource: DeploymentResourceRow,
  provider: ModelHostingProvider,
) {
  const key = await resourceCredential(org, current.row, resource, false, provider);
  const known = await reconcileAttempt(org, current, resource, key, provider);
  if (!known?.provider_id) return;
  const observation = await provider.inspect(key, known.provider_id);
  if (!observation) {
    await mutate(org, current, async (tx, row) => {
      const failures = row.failure_attempts + 1;
      await tx.query(
        "UPDATE model_deployment_resources SET state='deleted',deleted_at=now(),stopped_at=now(),cleanup_secret_ciphertext=NULL,observed_at=now() WHERE id=$1",
        [known.id],
      );
      await tx.query(
        'UPDATE model_deployments SET serving_revision_id=NULL,ready_replicas=0,state=$2,failure_attempts=$3,failure_code=$4 WHERE id=$1',
        [
          row.id,
          failures >= MAX_FAILURES ? 'failed' : 'starting',
          failures,
          failures >= MAX_FAILURES ? 'service_recovery_exhausted' : 'provider_resource_disappeared',
        ],
      );
    });
    return;
  }
  assert(
    matchesDeploymentResource(known, observation),
    409,
    'deployment_conflict',
    'The endpoint no longer matches its selected immutable revision.',
  );
  const policy = current.row.policy;
  assert(
    policy && 'min_replicas' in policy,
    422,
    'invalid_hosting_policy',
    'Managed standing policy is missing.',
  );
  const offers = await provider.catalog(key);
  validateObservedHardware(revision, known, observation, offers);
  const rates = await quoteManagedService(revision, policy, key, provider, offers);
  if (revision.source.kind === 'hugging_face' && revision.source.source_connection_id) {
    const rotation = await mutate(org, current, async (tx, row) => {
      const sourceConnection = await connection(
        tx,
        row,
        revision,
        revision.source.kind === 'hugging_face' ? revision.source.source_connection_id || '' : '',
        'hugging_face',
      );
      assert(
        sourceConnection.secret_ciphertext,
        403,
        'permission_denied',
        'The delegated source credential is unavailable.',
      );
      const environment = z.record(z.string(), z.string()).parse(known.config.env);
      const fingerprint = sha256(sourceConnection.secret_ciphertext);
      return environment.MF_SOURCE_CREDENTIAL_REVISION === fingerprint
        ? null
        : {
            environment: { ...environment, MF_SOURCE_CREDENTIAL_REVISION: fingerprint },
            sourceToken: secret(sourceConnection),
          };
    });
    if (rotation) {
      await provider.update(key, known.provider_id, {
        env: {
          ...rotation.environment,
          HF_TOKEN: rotation.sourceToken,
          MF_ENDPOINT_SECRET: unseal<string>(known.secret_ciphertext),
        },
      });
      await mutate(org, current, async (tx) => {
        await tx.query(
          "UPDATE model_deployment_resources SET config=jsonb_set(config,'{env}',$2::jsonb),observed_at=now() WHERE id=$1",
          [known.id, JSON.stringify(rotation.environment)],
        );
      });
    }
  }
  const expected = { min: policy.min_replicas, max: policy.max_replicas, idleTimeout: 10 };
  const scaling = {
    type: 'REQUEST_COUNT',
    requestCount: Math.min(policy.max_concurrent_requests, revision.capabilities.max_concurrent_requests),
  };
  if (
    canonical(observation.config.workers) !== canonical(expected) ||
    canonical(observation.config.scaling) !== canonical(scaling) ||
    observation.config.timeout !== 240_000
  ) {
    const allowed = await mutate(org, current, async (tx, row) => {
      assert(
        row.desired_state === 'running' && !row.retired && row.desired_revision_id === known.revision_id,
        409,
        'deployment_conflict',
        'The desired service changed before scaling.',
      );
      await connection(tx, row, revision, known.connection_id, 'runpod');
      return true;
    });
    if (!allowed) return;
    await provider.update(key, known.provider_id, {
      workers: expected,
      scaling,
      timeout: 240_000,
    });
  }
  await mutate(org, current, async (tx, row) => {
    const ready = observation.ready_replicas > 0;
    const expired = !ready && row.startup_at && Date.now() - row.startup_at.getTime() >= STARTUP_MS;
    const failures = ready ? 0 : row.serving_revision_id ? row.failure_attempts + 1 : row.failure_attempts;
    const exhausted = expired || failures >= MAX_FAILURES;
    await tx.query(
      `UPDATE model_deployments SET state=$2,serving_revision_id=$3,ready_replicas=$4,observed_at=now(),failure_attempts=$5,
      failure_code=$6,startup_at=CASE WHEN $7 THEN NULL ELSE coalesce(startup_at,now()) END WHERE id=$1`,
      [
        row.id,
        exhausted ? 'failed' : ready ? 'ready' : row.serving_revision_id ? 'degraded' : 'starting',
        ready || (row.serving_revision_id && !exhausted) ? revision.id : null,
        observation.ready_replicas,
        failures,
        exhausted ? 'service_recovery_exhausted' : ready ? null : 'model_loading',
        ready,
      ],
    );
    await tx.query(
      'UPDATE model_deployment_resources SET state=$2,observed_at=now(),accepted_rates=coalesce($3::jsonb,accepted_rates) WHERE id=$1',
      [known.id, ready ? 'ready' : 'starting', rates ? JSON.stringify(rates) : null],
    );
  });
  await observeCosts(org, known, key, provider).catch(() => {});
}

/** Provider I/O lives outside tenant transactions. A new create is possible only
 * in the owner that committed its resource attempt; recovered attempts inspect
 * inventory even when it is empty. See the model-deployment lifecycle design. */
export async function advanceModelDeployment(
  org: string,
  deploymentId: string,
  provider: ModelHostingProvider = runpodModelHosting(),
  externalFetch: ExternalFetch = modelEndpointFetch,
): Promise<boolean> {
  const current = await claim(org, deploymentId);
  if (!current) return false;
  try {
    const resource = await activeResource(org, deploymentId);
    const revision = await transaction(org, (tx) =>
      revisionRow(tx, deploymentId, current.row.desired_revision_id),
    );
    const scheduledStop =
      !!current.row.policy?.stop_at && Date.parse(current.row.policy.stop_at) <= Date.now();
    const failed = current.row.failure_code === 'service_recovery_exhausted';
    const stopped = current.row.desired_state === 'stopped' || current.row.retired || scheduledStop || failed;
    if (scheduledStop)
      await mutate(org, current, async (tx) => {
        await tx.query(
          "UPDATE model_deployments SET desired_state='stopped',state='stopping',serving_revision_id=NULL,ready_replicas=0 WHERE id=$1",
          [deploymentId],
        );
      });
    if (resource && (stopped || resource.revision_id !== revision.id)) {
      await mutate(org, current, async (tx) => {
        await tx.query(
          "UPDATE model_deployments SET serving_revision_id=NULL,ready_replicas=0,state='stopping' WHERE id=$1",
          [deploymentId],
        );
      });
      await stopOwnedResource(org, current, resource, provider);
    } else if (stopped) {
      if (current.row.serving_revision_id && !(await drain(org, current, current.row.serving_revision_id)))
        return true;
      await mutate(org, current, async (tx) => {
        await tx.query(
          "UPDATE model_deployments SET state=CASE WHEN failure_code='service_recovery_exhausted' THEN 'failed' ELSE 'stopped' END,serving_revision_id=NULL,ready_replicas=0,observed_at=now() WHERE id=$1",
          [deploymentId],
        );
      });
    } else if (revision.hosting.kind === 'external_openai') {
      if (
        current.row.serving_revision_id &&
        current.row.serving_revision_id !== revision.id &&
        !(await drain(org, current, current.row.serving_revision_id))
      )
        return true;
      await external(org, current, revision, externalFetch);
    } else if (!resource) {
      await startResource(org, current, revision, provider);
    } else {
      await observeManaged(org, current, revision, resource, provider);
    }
  } catch (cause) {
    await mutate(org, current, async (tx, row) => {
      const failures = row.failure_attempts + 1;
      const terminal =
        failures >= MAX_FAILURES ||
        (cause instanceof AppError &&
          [
            'permission_denied',
            'deployment_budget_exhausted',
            'invalid_hosting_policy',
            'execution_disabled',
            'deployment_conflict',
          ].includes(cause.code));
      await tx.query(
        `UPDATE model_deployments SET state=$2,serving_revision_id=NULL,ready_replicas=0,failure_attempts=$3,failure_code=$4 WHERE id=$1`,
        [
          row.id,
          terminal
            ? 'failed'
            : row.desired_state === 'stopped' || row.retired
              ? 'cleanup_pending'
              : 'degraded',
          failures,
          terminal ? 'service_recovery_exhausted' : 'deployment_provider_unavailable',
        ],
      );
    });
  } finally {
    await historicalCosts(org, current.row, provider).catch(() => {});
    await mutate(org, current, async (tx, row) => {
      const seconds = Math.min(300, 5 * 2 ** Math.min(6, row.failure_attempts));
      await tx.query(
        "UPDATE model_deployments SET lease_id=NULL,lease_until=NULL,next_check_at=clock_timestamp()+($2::integer*interval '1 second'),updated_at=now() WHERE id=$1",
        [row.id, seconds],
      );
    });
  }
  return true;
}

export async function dispatchModelDeployments(
  provider: ModelHostingProvider = runpodModelHosting(),
): Promise<Record<string, number>> {
  const due = (
    await pool.query<{ id: string; organization_id: string }>(
      'SELECT id,organization_id FROM reporting.model_deployment_dispatch WHERE next_check_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_check_at,id LIMIT 20',
    )
  ).rows;
  const results = await mapConcurrent(due, 4, async (row) =>
    advanceModelDeployment(row.organization_id, row.id, provider),
  );
  return { model_deployments_advanced: results.filter(Boolean).length };
}
