import { directInferenceStream } from './direct-inference-stream';
import {
  completeDirectInference,
  respondAsync,
  immediateInferencePolicy,
  type InvocationPermit,
} from './direct-inference';
import { getCustomerBinding, customerRun } from './customer-agents';
import {
  pool,
  transaction,
  lock,
  DatabaseBudgetError,
  TransactionCommitUnknownError,
  TransactionRolledBackError,
} from '../../db';
import { config } from './config';
import { identify, requireScopes, type Principal } from './auth';
import { id, sha256, seal, unseal, canonical } from './crypto';
import { AppError, assert, errorBody } from './errors';
import { matchRoute, validateParameters, validateBody, responseFor, operationScopes } from './http-contract';
import { handlers, preparations } from './api-handlers';
import { getRun } from './runs';
import { streamEvents } from './events';
import { adminReport } from './reports';
import { organizationManager } from './organizations';
import { boundedBody } from './body';
import { requestCapacity } from './request-capacity';
import {
  acquireImmediateInferencePermit,
  acquireInferenceAdmission,
  acquireInferenceRequestPermit,
} from './inference-control';

let requestSummariesInFlight = 0;

export async function handleApi(
  request: Request,
  surface: 'rest' | 'mcp' = 'rest',
  background?: (task: () => Promise<void>) => void,
  options: { hostDeadlineAtMs?: number; onMutation?: () => void } = {},
) {
  const requestId = id(),
    start = Date.now();
  const hostDeadlineAtMs = options.hostDeadlineAtMs ?? start + immediateInferencePolicy.hostMs;
  let releaseInference: (() => void) | undefined;
  let releaseRequest: (() => void) | undefined;
  let inferenceIdentity = '';
  let acceptedInference: unknown;
  let operationId = '';
  let exceptionalRecovery = false;
  let inferenceAdmissionAttempted = false;
  let releasePreflight: (() => void) | undefined;
  let preflightDeadlineAtMs: number | undefined;
  let principal: Principal | undefined;
  let route = 'unmatched';
  let status = 500;
  const headers = new Headers({
    'X-Request-Id': requestId,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (!background && !(request.method === 'POST' && new URL(request.url).pathname === '/v1/inferences'))
    await pool
      .query('INSERT INTO api_requests(request_id,method,route) VALUES($1,$2,$3)', [
        requestId,
        request.method,
        'unmatched',
      ])
      .catch(() => {
        console.error(JSON.stringify({ request_id: requestId, code: 'request_observation_start_failed' }));
      });
  try {
    const matched = matchRoute(request);
    route = matched.path;
    operationId = matched.operation.operationId;
    if (operationId === 'createInference') {
      inferenceIdentity = request.headers.get('idempotency-key') || '';
      assert(
        !respondAsync(request),
        400,
        'async_inference_not_supported',
        'Immediate inference does not support Prefer: respond-async. Omit the preference.',
      );
    }
    validateParameters(matched.operation, request, matched.params);
    if (operationId === 'createInference') {
      preflightDeadlineAtMs = Math.min(
        hostDeadlineAtMs - immediateInferencePolicy.deliveryMs,
        Date.now() + immediateInferencePolicy.admissionMs,
      );
      assert(
        preflightDeadlineAtMs > Date.now(),
        503,
        'inference_host_budget_exhausted',
        'This host has insufficient remaining time for inference.',
      );
      releasePreflight = acquireInferenceAdmission(preflightDeadlineAtMs);
    }
    const admin = route.startsWith('/admin/');
    const audience = `${config.origin}${admin ? '/admin/v1' : surface === 'mcp' ? '/mcp' : '/v1'}`;
    principal = await identify(request, audience, { databaseDeadlineAtMs: preflightDeadlineAtMs });
    const p = principal;
    if (!background && operationId !== 'createInference')
      await pool.query(
        'UPDATE api_requests SET organization_id=$2,principal_id=$3,principal_type=$4,user_id=$5,route=$6 WHERE request_id=$1',
        [
          requestId,
          p.organizationId,
          p.id,
          p.kind === 'api_key' ? 'service' : admin ? 'operator' : 'human',
          p.userId || null,
          route,
        ],
      );
    // Scopes apply to every credential kind, including API-key-only operations.
    const scopes = operationScopes(matched.operation);
    requireScopes(p, scopes);
    if (scopes.includes('usage:read') || scopes.includes('billing:write'))
      assert(
        !p.workspaceIds.length,
        403,
        'forbidden',
        'Organization-wide financial and usage reports require an unrestricted organization credential.',
      );
    if (scopes.includes('workspaces:delete'))
      assert(
        ['owner', 'admin'].includes(p.role),
        403,
        'organization_admin_required',
        'An owner or admin must manage permanent deletion.',
      );
    if (scopes.some((s) => s.startsWith('organizations:'))) {
      assert(
        !p.workspaceIds.length,
        403,
        'forbidden',
        'Organization administration requires a credential without workspace restrictions.',
      );
      if (
        matched.operation.operationId !== 'createOrganization' &&
        matched.operation.operationId !== 'listMembers' &&
        matched.operation.operationId !== 'getExecutionPolicy'
      )
        organizationManager(p);
    }
    if (scopes.some((s) => s.startsWith('webhooks:')))
      assert(
        !p.workspaceIds.length && ['owner', 'admin'].includes(p.role),
        403,
        'organization_admin_required',
        'Organization webhook management requires an administrator credential without workspace restrictions.',
      );
    const rate = requestCapacity(request.method, matched.operation.operationId);
    const rateQuery = (tx: Pick<import('../../db').Tx, 'query'>) =>
      tx.query(
        'INSERT INTO rate_limits(key,bucket,count) VALUES($1,$2,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.bucket=excluded.bucket THEN rate_limits.count+1 ELSE 1 END,bucket=excluded.bucket RETURNING count',
        [`${p.organizationId}:${p.id}:${rate.group}`, Math.floor(Date.now() / 60000)],
      );
    const count =
      preflightDeadlineAtMs === undefined
        ? await rateQuery(pool)
        : await transaction(null, rateQuery, { deadlineAtMs: preflightDeadlineAtMs });
    if (count.rows[0].count > rate.limit) {
      headers.set('Retry-After', String(Math.max(1, 60 - (Math.floor(Date.now() / 1000) % 60))));
      throw new AppError(429, 'rate_limited', 'Too many requests. Retry in one minute.');
    }
    // Upload time is not SQL admission time. Release scarce SQL headroom while
    // reading the bounded request, then start a fresh replay-read budget.
    releasePreflight?.();
    releasePreflight = undefined;
    preflightDeadlineAtMs = undefined;
    const query = new URL(request.url).searchParams;
    if (['streamRun', 'streamCustomerAgentRun'].includes(matched.operation.operationId)) {
      await transaction(p.organizationId, async (tx) => {
        if (matched.operation.operationId === 'streamCustomerAgentRun')
          return customerRun(
            tx,
            p,
            await getCustomerBinding(tx, p, matched.params.customer_id, matched.params.customer_agent_id),
            matched.params.run_id,
          );
        return getRun(tx, matched.params.run_id, p);
      });
      const after = request.headers.get('last-event-id') || query.get('after') || '0';
      assert(/^\d+$/.test(after), 400, 'invalid_cursor', 'Use a numeric event sequence.');
      headers.set('Content-Type', 'text/event-stream');
      headers.set('X-Accel-Buffering', 'no');
      status = 200;
      return new Response(
        await streamEvents(p.organizationId, matched.params.run_id, after, request.signal),
        { headers },
      );
    }
    if (admin) {
      const result = await adminReport(matched.operation.operationId, p, query, matched.params);
      await pool.query('INSERT INTO admin_audit(id,operator_id,action,data) VALUES($1,$2,$3,$4)', [
        requestId,
        p.id,
        matched.operation.operationId,
        JSON.stringify({ params: matched.params, include_contact: query.get('include_contact') === 'true' }),
      ]);
      status = 200;
      return Response.json(responseFor(matched.operation, result).body, { headers });
    }
    if (operationId === 'createInference') releaseRequest = acquireInferenceRequestPermit();
    const bytes = await boundedBody(
      request.body,
      4 * 1024 * 1024,
      60_000,
      operationId === 'createInference' ? request.signal : undefined,
    );
    const binary = matched.operation.operationId === 'writeFile';
    let body: unknown = {};
    if (bytes.length && !binary) {
      try {
        body = JSON.parse(bytes.toString());
      } catch {
        throw new AppError(400, 'invalid_json', 'Request body must be valid JSON.');
      }
    }
    validateBody(matched.operation, body, binary);
    const directStream =
      matched.operation.operationId === 'createInference' &&
      !!body &&
      typeof body === 'object' &&
      'stream' in body &&
      body.stream === true;
    if (directStream) {
      requireScopes(p, ['runs:read']);
      assert(
        surface === 'rest' && background,
        400,
        'streaming_not_supported',
        'Direct streaming requires the REST/SDK request lifecycle. Omit stream on this transport.',
      );
      assert(
        !respondAsync(request),
        400,
        'invalid_request',
        'Do not combine stream with Prefer: respond-async.',
      );
    }
    const handler = handlers[matched.operation.operationId];
    const prepare = preparations[matched.operation.operationId];
    assert(handler || prepare, 503, 'operation_unavailable', 'This operation is not configured.');
    const advisory = matched.operation.operationId === 'resolveConnectionAccess';
    const idempotencyKey = advisory ? '' : request.headers.get('idempotency-key') || '';
    const fingerprint = sha256(
      `${request.method}\n${new URL(request.url).pathname}?${query.toString()}\n${request.headers.get('if-match') || ''}\n${binary ? sha256(bytes) : canonical(body)}`,
    );
    const cachedResponse = async (tx: import('../../db').Tx) => {
      if (idempotencyKey) {
        await lock(tx, `idempotency:${p.organizationId}:${p.id}:${route}:${idempotencyKey}`);
        const cached = (
          await tx.query('SELECT * FROM idempotency WHERE principal_id=$1 AND route=$2 AND key=$3', [
            p.id,
            route,
            idempotencyKey,
          ])
        ).rows[0];
        if (cached) {
          assert(
            cached.fingerprint === fingerprint,
            409,
            'idempotency_conflict',
            'This idempotency key was used for a different request.',
          );
          headers.set('Idempotency-Replayed', 'true');
          return { status: cached.status as number, body: unseal(cached.response_ciphertext) };
        }
      }
      return undefined;
    };
    const context = {
      p,
      request,
      query,
      params: matched.params,
      body,
      bytes,
      operationId: matched.operation.operationId,
      idempotencyKey,
      headers,
      requestId,
      hostDeadlineAtMs,
    };
    // Fast replay avoids object I/O. The final transaction checks again under the
    // same idempotency lock, so competing preparations can publish at most once.
    if (operationId === 'createInference') {
      preflightDeadlineAtMs = Math.min(
        hostDeadlineAtMs - immediateInferencePolicy.deliveryMs,
        Date.now() + immediateInferencePolicy.admissionMs,
      );
      assert(
        preflightDeadlineAtMs > Date.now(),
        503,
        'inference_host_budget_exhausted',
        'This host has insufficient remaining time for inference.',
      );
      releasePreflight = acquireInferenceAdmission(preflightDeadlineAtMs);
    }
    const replay =
      prepare && idempotencyKey
        ? await transaction(
            p.organizationId,
            cachedResponse,
            preflightDeadlineAtMs === undefined ? {} : { deadlineAtMs: preflightDeadlineAtMs },
          )
        : undefined;
    releasePreflight?.();
    releasePreflight = undefined;
    if (operationId === 'createInference' && !replay) {
      releaseInference = acquireImmediateInferencePermit();
      releaseRequest?.();
      releaseRequest = undefined;
    }
    const prepared = prepare && !replay ? await prepare(context) : undefined;
    let permit: InvocationPermit | undefined;
    let outcome: Response | { status: number; body: unknown };
    let committed = false;
    try {
      // Immediate A rechecks current key, membership and resource facts while
      // holding its admission/revocation guard; a second pre-lock lookup adds
      // latency without protecting that boundary. Other preparations retain it.
      const current = prepared && operationId !== 'createInference' ? await identify(request, audience) : p;
      assert(
        current.organizationId === p.organizationId && current.id === p.id,
        403,
        'authorization_changed',
        'Authorization changed while preparing this request.',
      );
      requireScopes(current, scopes);
      const admissionStarted = performance.now();
      const admissionDeadline = Date.now() + immediateInferencePolicy.admissionMs;
      const releaseAdmission =
        operationId === 'createInference' && !replay
          ? acquireInferenceAdmission(admissionDeadline)
          : undefined;
      let created = false;
      try {
        if (!replay && operationId === 'createInference') inferenceAdmissionAttempted = true;
        outcome =
          replay ??
          (await transaction(
            p.organizationId,
            async (tx) => {
              const cached = await cachedResponse(tx);
              if (cached) return cached;
              let value: unknown;
              if (prepared) value = await prepared.commit(tx, current);
              else {
                assert(handler, 503, 'not_implemented', 'This operation is not available.');
                value = await handler({ ...context, tx });
              }
              created = true;
              const response =
                value instanceof Response
                  ? value
                  : responseFor(
                      matched.operation,
                      value,
                      matched.operation.operationId === 'createInference' ? 202 : undefined,
                    );
              if (idempotencyKey && !(response instanceof Response))
                await tx.query(
                  'INSERT INTO idempotency(organization_id,principal_id,route,key,fingerprint,response_ciphertext,status) VALUES($1,$2,$3,$4,$5,$6,$7)',
                  [
                    p.organizationId,
                    p.id,
                    route,
                    idempotencyKey,
                    fingerprint,
                    seal(response.body ?? null),
                    response.status,
                  ],
                );
              if (!advisory && p.kind === 'user' && request.method !== 'GET')
                await tx.query(
                  'INSERT INTO actor_activity(id,organization_id,user_id,action) VALUES($1,$2,$3,$4)',
                  [id(), p.organizationId, p.userId, matched.operation.operationId],
                );
              if (!advisory && !['GET', 'HEAD'].includes(request.method))
                await tx.query(
                  'INSERT INTO product_events(id,organization_id,user_id,name,data) VALUES($1,$2,$3,$4,$5)',
                  [
                    id(),
                    p.organizationId,
                    p.userId || null,
                    matched.operation.operationId,
                    JSON.stringify({
                      principal_type: p.kind === 'api_key' ? 'service' : 'human',
                      source: 'public_api',
                      principal_id: p.id,
                    }),
                  ],
                );
              return response;
            },
            operationId === 'createInference' ? { deadlineAtMs: admissionDeadline } : {},
          ));
        committed = created;
        if (committed) {
          permit = prepared?.inferencePermit?.();
          // B persists this observed A duration, including checkout/locks/COMMIT.
          // A cannot truthfully record the duration of its own future commit.
          if (permit) permit.call.timings_ms.admission = performance.now() - admissionStarted;
        }
      } catch (error) {
        if (operationId !== 'createInference' || !(error instanceof TransactionCommitUnknownError))
          throw error;
        const saved = idempotencyKey
          ? await transaction(p.organizationId, cachedResponse, {
              deadlineAtMs: Math.min(
                hostDeadlineAtMs - immediateInferencePolicy.deliveryMs,
                Date.now() + immediateInferencePolicy.admissionMs,
              ),
            }).catch(() => undefined)
          : undefined;
        assert(
          saved,
          503,
          'inference_admission_unknown',
          'Admission may have committed. Recover with the same idempotency key.',
        );
        outcome = saved;
      } finally {
        releaseAdmission?.();
      }
    } finally {
      if (prepared)
        await prepared.dispose().catch(() => {
          // Expiry is the durable fallback; cleanup failure must not turn a committed
          // mutation into an apparent failure or encourage a new side effect.
          console.error(JSON.stringify({ request_id: requestId, code: 'preparation_cleanup_failed' }));
        });
    }
    if (outcome instanceof Response) {
      status = outcome.status;
      const response = outcome;
      headers.forEach((value, key) => response.headers.set(key, value));
      return response;
    }
    if (outcome.status >= 400) {
      status = outcome.status;
      return Response.json(outcome.body, { status, headers });
    }
    acceptedInference = outcome.body;
    if (
      operationId === 'createInference' &&
      outcome.body &&
      typeof outcome.body === 'object' &&
      'run_id' in outcome.body &&
      typeof outcome.body.run_id === 'string'
    )
      headers.set('X-Run-Id', outcome.body.run_id);
    if (directStream && background) {
      const response = await directInferenceStream(
        p,
        outcome.body,
        permit,
        headers,
        background,
        request.signal,
        idempotencyKey,
        releaseInference,
        options.onMutation,
      );
      releaseInference = undefined;
      status = response.status;
      return response;
    }
    if (operationId === 'createInference') {
      const release = releaseInference;
      const producer = Promise.resolve()
        .then(() =>
          completeDirectInference(
            p,
            outcome instanceof Response ? undefined : outcome.body,
            permit,
            background,
          ),
        )
        .finally(() => release?.());
      // Register this same producer before its dispatch microtask starts.
      background?.(() => producer.then(() => {}));
      releaseInference = undefined;
      const completed = await producer;
      exceptionalRecovery =
        completed.status === 202 &&
        'recovery_reason' in completed.body &&
        completed.body.recovery_reason !== 'in_progress';
      if (completed.status === 202) headers.set('Retry-After', '1');
      outcome = responseFor(matched.operation, completed.body, completed.status);
    }
    status = outcome.status;
    if (
      route.includes('/connections/') &&
      route.includes('/access') &&
      outcome.body &&
      typeof outcome.body === 'object' &&
      'version' in outcome.body
    )
      headers.set('ETag', `"${outcome.body.version}"`);
    return status === 204
      ? new Response(null, { status, headers })
      : Response.json(outcome.body, { status, headers });
  } catch (error) {
    if (
      operationId === 'createInference' &&
      (error instanceof DatabaseBudgetError ||
        error instanceof TransactionRolledBackError ||
        (!inferenceAdmissionAttempted && error instanceof TransactionCommitUnknownError))
    ) {
      // Authentication, rate accounting and preparation cannot admit a Run.
      // A missing cleanup acknowledgment there is not an ambiguous A commit.
      const noAdmission =
        !inferenceAdmissionAttempted ||
        error instanceof TransactionRolledBackError ||
        (error instanceof DatabaseBudgetError && error.rollbackConfirmed);
      error = new AppError(
        503,
        noAdmission ? 'inference_admission_timeout' : 'inference_admission_unknown',
        noAdmission
          ? 'Inference admission exceeded its time budget. Retry with the same idempotency key.'
          : 'Admission could not be confirmed. Recover with the same idempotency key.',
      );
    }
    if (error instanceof Error && 'code' in error && error.code === '57014')
      error = new AppError(
        503,
        'query_timeout',
        'This query exceeded its time budget. Narrow the reporting period or filter and retry.',
      );
    if (error instanceof Error && 'code' in error && ['22P02', '22003', '23505'].includes(String(error.code)))
      error = new AppError(
        400,
        'invalid_request',
        'A resource identifier, value, or uniqueness constraint is invalid.',
      );
    status = error instanceof AppError ? error.status : 500;
    if (status === 500)
      console.error(
        JSON.stringify({
          request_id: requestId,
          error: error instanceof Error ? error.name : 'UnknownError',
          code: 'internal_error',
        }),
      );
    if (status === 401)
      headers.set(
        'WWW-Authenticate',
        `Bearer resource_metadata="${config.origin}/.well-known/oauth-protected-resource"`,
      );
    const failure = errorBody(error, requestId).body;
    if (operationId === 'createInference') {
      if (inferenceIdentity)
        failure.error.details = { ...failure.error.details, idempotency_key: inferenceIdentity };
      if (
        error instanceof AppError &&
        [
          'inference_disabled',
          'execution_disabled',
          'inference_admission_unknown',
          'inference_recovery_required',
        ].includes(error.code)
      )
        failure.error.retryable = false;
      if (failure.error.retryable && [429, 503].includes(status) && !headers.has('Retry-After'))
        headers.set('Retry-After', '1');
      if (
        acceptedInference &&
        typeof acceptedInference === 'object' &&
        'run_id' in acceptedInference &&
        ![401, 403].includes(status)
      ) {
        failure.error.details = {
          ...failure.error.details,
          run_id: acceptedInference.run_id,
          ...('urls' in acceptedInference ? { urls: acceptedInference.urls } : {}),
        };
      }
    }
    return Response.json(failure, { status, headers });
  } finally {
    releaseRequest?.();
    releasePreflight?.();
    releaseInference?.();
    if (
      status >= 200 &&
      status < 300 &&
      !['GET', 'HEAD'].includes(request.method) &&
      operationId !== 'resolveConnectionAccess' &&
      (operationId !== 'createInference' || exceptionalRecovery)
    )
      options.onMutation?.();
    const type =
      principal?.kind === 'api_key'
        ? 'service'
        : principal?.operator && route.startsWith('/admin/')
          ? 'operator'
          : principal
            ? 'human'
            : 'anonymous';
    const duration = Date.now() - start;
    const recordRequest = async () => {
      // Request analytics are best effort, unlike financial and actor journals.
      // Refusal storms must not consume the SQL headroom reserved for B/C.
      const maximum = Math.max(1, Math.min(4, Math.floor((pool.options.max ?? 80) / 8)));
      if (requestSummariesInFlight >= maximum || pool.waitingCount > 0) return;
      requestSummariesInFlight++;
      try {
        await transaction(
          null,
          (tx) =>
            tx.query(
              'INSERT INTO api_requests(request_id,organization_id,principal_id,principal_type,user_id,method,route,status,duration_ms,client_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(request_id) DO UPDATE SET organization_id=excluded.organization_id,principal_id=excluded.principal_id,principal_type=excluded.principal_type,user_id=excluded.user_id,route=excluded.route,status=excluded.status,duration_ms=excluded.duration_ms,client_type=excluded.client_type',
              [
                requestId,
                principal?.organizationId || null,
                principal?.id || null,
                type,
                principal?.userId || null,
                request.method,
                route,
                status,
                duration,
                ['dashboard', 'cli', 'sdk', 'api', 'internal'].includes(
                  request.headers.get('x-client-type') || '',
                )
                  ? request.headers.get('x-client-type')
                  : 'api',
              ],
            ),
          { deadlineAtMs: Date.now() + 500 },
        );
      } catch {
        console.error(JSON.stringify({ request_id: requestId, code: 'request_observation_failed' }));
      } finally {
        requestSummariesInFlight--;
      }
    };
    if (background) background(recordRequest);
    else await recordRequest();
  }
}
