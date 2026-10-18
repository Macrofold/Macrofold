import { directInferenceStream } from './direct-inference-stream';
import {
  completeDirectInference,
  respondAsync,
  immediateInferencePolicy,
  type InvocationPermit,
} from './direct-inference';
import { getCustomerBinding, customerRunSummary } from './customer-agents';
import {
  pool,
  transaction,
  queryGroup,
  DatabaseBudgetError,
  TransactionCommitUnknownError,
  TransactionRolledBackError,
} from '../../db';
import { config } from './config';
import { identify, requireScopes, type Principal } from './auth';
import { id, sha256, seal, unseal, canonical } from './crypto';
import { AppError, assert, errorBody } from './errors';
import {
  matchRoute,
  validateParameters,
  validateBody,
  responseFor,
  operationScopes,
  initializeHttpValidation,
} from './http-contract';
import { initializeContextValidation } from './explicit-context';
import { handlers, preparations } from './api-handlers';
import { getRunSummary } from './runs';
import { streamEvents } from './events';
import { adminReport } from './reports';
import { organizationManager } from './organizations';
import { boundedBody } from './body';
import { requestCapacity } from './request-capacity';
import { startInferenceTiming } from './inference-timing';
import { initializePerformance } from './performance-composition';
import {
  performanceEnabled,
  performanceBackground,
  runPerformanceRoot,
  linkPerformanceRun,
} from './performance';
import { beginRequestObservation, enrichRequestObservation, observeRequest } from './request-observations';
import {
  acquireImmediateInferencePermit,
  acquireInferenceAdmission,
  acquireInferenceRequestPermit,
} from './inference-control';

/** Self-hosted readiness initializes reusable validators without dispatching work. */
export function initializeApi() {
  initializeHttpValidation();
  initializeContextValidation();
}

export function handleApi(
  request: Request,
  surface: 'rest' | 'mcp' = 'rest',
  background?: (task: () => Promise<void>) => void,
  options: { hostDeadlineAtMs?: number; onMutation?: () => void } = {},
) {
  initializePerformance();
  const requestId = id();
  if (!performanceEnabled()) return handleApiRequest(request, surface, background, options, requestId);
  return runPerformanceRoot(surface, { requestId }, () =>
    handleApiRequest(
      request,
      surface,
      background ? (task) => background(performanceBackground(task)) : undefined,
      options,
      requestId,
    ),
  );
}
async function handleApiRequest(
  request: Request,
  surface: 'rest' | 'mcp',
  background?: (task: () => Promise<void>) => void,
  options: { hostDeadlineAtMs?: number; onMutation?: () => void } = {},
  requestId = id(),
) {
  const start = Date.now();
  const hostDeadlineAtMs = options.hostDeadlineAtMs ?? start + immediateInferencePolicy.hostMs;
  let releaseInference: (() => void) | undefined;
  let releaseRequest: (() => void) | undefined;
  let inferenceIdentity = '';
  let acceptedInference: unknown;
  let operationId = '';
  let exceptionalRecovery = false;
  let productEvent:
    { organizationId: string; userId?: string; principalId: string; principalType: string } | undefined;
  let inferenceAdmissionAttempted = false;
  let releasePreflight: (() => void) | undefined;
  let preflightDeadlineAtMs: number | undefined;
  let principal: Principal | undefined;
  let route = 'unmatched';
  let status = 500;
  let stopRequestTiming = () => {};
  const headers = new Headers({
    'X-Request-Id': requestId,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (!background && !(request.method === 'POST' && new URL(request.url).pathname === '/v1/inferences'))
    await beginRequestObservation({ requestId, method: request.method });
  try {
    const matched = matchRoute(request);
    route = matched.path;
    operationId = matched.operation.operationId;
    if (operationId === 'createInference') {
      stopRequestTiming = startInferenceTiming('http.total');
      inferenceIdentity = request.headers.get('idempotency-key') || '';
      assert(
        !respondAsync(request),
        400,
        'async_inference_not_supported',
        'Immediate inference does not support Prefer: respond-async. Omit the preference.',
      );
    }
    // First-use schema compilation is request work too, including header/path
    // validation that happens before authentication and body validation.
    const stopParameters = startInferenceTiming(
      'http.parameter_validation',
      operationId === 'createInference',
    );
    try {
      validateParameters(matched.operation, request, matched.params);
    } finally {
      stopParameters();
    }
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
    const stopAuthentication = startInferenceTiming('http.authentication', operationId === 'createInference');
    const rate = requestCapacity(request.method, matched.operation.operationId);
    let identifiedRateCount: number | undefined;
    principal = await identify(request, audience, {
      databaseDeadlineAtMs: preflightDeadlineAtMs,
      requestRate:
        operationId === 'createInference'
          ? {
              group: rate.group,
              observed: (count) => {
                identifiedRateCount = count;
              },
            }
          : undefined,
    });
    stopAuthentication();
    const p = principal;
    if (!background && operationId !== 'createInference')
      await enrichRequestObservation({
        requestId,
        organizationId: p.organizationId,
        principalId: p.id,
        principalType: p.kind === 'api_key' ? 'service' : admin ? 'operator' : 'human',
        userId: p.userId,
        route,
      });
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
    const rateQuery = (tx: Pick<import('../../db').Tx, 'query'>) =>
      tx.query(
        'INSERT INTO rate_limits(key,bucket,count) VALUES($1,$2,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.bucket=excluded.bucket THEN rate_limits.count+1 ELSE 1 END,bucket=excluded.bucket RETURNING count',
        [`${p.organizationId}:${p.id}:${rate.group}`, Math.floor(Date.now() / 60000)],
      );
    const stopRateLimit = startInferenceTiming('http.rate_limit', operationId === 'createInference');
    const count =
      identifiedRateCount ??
      (preflightDeadlineAtMs === undefined
        ? await rateQuery(pool)
        : await transaction(null, rateQuery, { deadlineAtMs: preflightDeadlineAtMs })
      ).rows[0].count;
    stopRateLimit();
    if (count > rate.limit) {
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
          return customerRunSummary(
            tx,
            p,
            await getCustomerBinding(tx, p, matched.params.customer_id, matched.params.customer_agent_id),
            matched.params.run_id,
          );
        return getRunSummary(tx, matched.params.run_id, p);
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
    const stopBodyRead = startInferenceTiming('http.body_read', operationId === 'createInference');
    const bytes = await boundedBody(
      request.body,
      4 * 1024 * 1024,
      60_000,
      operationId === 'createInference' ? request.signal : undefined,
    );
    stopBodyRead();
    const stopBodyValidation = startInferenceTiming(
      'http.body_validation',
      operationId === 'createInference',
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
    stopBodyValidation();
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
    const stopFingerprint = startInferenceTiming('http.fingerprint', operationId === 'createInference');
    const fingerprint = idempotencyKey
      ? sha256(
          `${request.method}\n${new URL(request.url).pathname}?${query.toString()}\n${request.headers.get('if-match') || ''}\n${binary ? sha256(bytes) : canonical(body)}`,
        )
      : '';
    stopFingerprint();
    const cachedResponse = async (tx: import('../../db').Tx, writing = true) => {
      if (idempotencyKey) {
        type CachedMutation = { fingerprint: string; response_ciphertext: string; status: number };
        const lookup = {
          text: 'SELECT fingerprint,response_ciphertext,status FROM idempotency WHERE principal_id=$1 AND route=$2 AND key=$3',
          values: [p.id, route, idempotencyKey],
        };
        const result = writing
          ? (
              await queryGroup<CachedMutation | { locked: unknown }>(tx, [
                {
                  text: 'SELECT pg_advisory_xact_lock(hashtextextended($1,0)) AS locked',
                  values: [`idempotency:${p.organizationId}:${p.id}:${route}:${idempotencyKey}`],
                },
                lookup,
              ])
            )[1]
          : await tx.query<CachedMutation>(lookup);
        const cached = result.rows[0];
        if (cached) {
          assert(
            'fingerprint' in cached,
            500,
            'idempotency_unavailable',
            'The saved request identity is unavailable.',
          );
          assert(
            cached.fingerprint === fingerprint,
            409,
            'idempotency_conflict',
            'This idempotency key was used for a different request.',
          );
          headers.set('Idempotency-Replayed', 'true');
          return { status: cached.status, body: unseal(cached.response_ciphertext) };
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
    // A read-only replay needs no writer lock. Simultaneous misses may prepare
    // twice; final admission locks/rechecks so only one can publish or dispatch.
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
    const stopReplay = startInferenceTiming('http.replay_lookup', operationId === 'createInference');
    const replay =
      prepare && idempotencyKey
        ? await transaction(
            p.organizationId,
            (tx) => cachedResponse(tx, false),
            preflightDeadlineAtMs === undefined ? {} : { deadlineAtMs: preflightDeadlineAtMs },
          )
        : undefined;
    stopReplay();
    releasePreflight?.();
    releasePreflight = undefined;
    if (operationId === 'createInference' && !replay) {
      releaseInference = acquireImmediateInferencePermit();
      releaseRequest?.();
      releaseRequest = undefined;
    }
    const stopPreparation = startInferenceTiming('http.preparation', operationId === 'createInference');
    const prepared = prepare && !replay ? await prepare(context) : undefined;
    stopPreparation();
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
      const stopAdmission = startInferenceTiming('http.admission', operationId === 'createInference');
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
                productEvent = {
                  organizationId: p.organizationId,
                  userId: p.userId,
                  principalId: p.id,
                  principalType: p.kind === 'api_key' ? 'service' : 'human',
                };
              return response;
            },
            operationId === 'createInference' ? { deadlineAtMs: admissionDeadline } : {},
          ));
        committed = created;
        if (committed) {
          permit = prepared?.inferencePermit?.();
          // F persists this observed A duration, including checkout/locks/COMMIT.
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
        stopAdmission();
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
    ) {
      headers.set('X-Run-Id', outcome.body.run_id);
      linkPerformanceRun(outcome.body.run_id);
    }
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
      const stopProjection = startInferenceTiming('http.response');
      try {
        outcome = responseFor(matched.operation, completed.body, completed.status);
      } finally {
        stopProjection();
      }
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
    const stopResponse = startInferenceTiming('http.response', operationId === 'createInference');
    try {
      return status === 204
        ? new Response(null, { status, headers })
        : Response.json(outcome.body, { status, headers });
    } finally {
      stopResponse();
    }
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
    const clientType = request.headers.get('x-client-type') || 'api';
    await observeRequest(
      {
        requestId,
        organizationId: principal?.organizationId,
        principalId: principal?.id,
        principalType: type,
        userId: principal?.userId,
        method: request.method,
        route,
        status,
        durationMs: duration,
        clientType: ['dashboard', 'cli', 'sdk', 'api', 'internal'].includes(clientType) ? clientType : 'api',
        ...(productEvent && status >= 200 && status < 300 ? { operation: operationId } : {}),
      },
      background,
      { fallback: operationId !== 'createInference' },
    );
    stopRequestTiming();
  }
}
