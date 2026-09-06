import { pool, transaction, lock } from '../../db';
import { config } from './config';
import { identify, requireScopes, type Principal } from './auth';
import { id, sha256, seal, unseal } from './crypto';
import { AppError, assert, errorBody } from './errors';
import { matchRoute, validateParameters, validateBody, responseFor, canonical } from './http-contract';
import { handlers } from './api-handlers';
import { getRun } from './runs';
import { streamEvents } from './events';
import { adminReport } from './reports';
import { organizationManager } from './organizations';
import { boundedBody } from './body';

export async function handleApi(request: Request) {
  const requestId = id(),
    start = Date.now();
  let principal: Principal | undefined;
  let route = 'unmatched';
  let status = 500;
  const headers = new Headers({
    'X-Request-Id': requestId,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
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
    validateParameters(matched.operation, request, matched.params);
    const admin = route.startsWith('/admin/');
    principal = await identify(request, admin ? `${config.origin}/admin/v1` : undefined);
    const p = principal;
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
    const scopeKey = admin ? 'OperatorOAuth' : 'CustomerOAuth';
    const scopes = matched.operation.security?.find((s) => scopeKey in s)?.[scopeKey] || [];
    requireScopes(p, scopes);
    if (scopes.includes('usage:read') || scopes.includes('billing:write'))
      assert(
        !p.projectIds.length,
        403,
        'forbidden',
        'Organization-wide financial and usage reports require an unrestricted organization credential.',
      );
    if (scopes.includes('projects:delete'))
      assert(
        ['owner', 'admin'].includes(p.role),
        403,
        'organization_admin_required',
        'An owner or admin must manage permanent deletion.',
      );
    if (scopes.some((s) => s.startsWith('organizations:'))) {
      assert(
        !p.projectIds.length,
        403,
        'forbidden',
        'Organization administration requires a credential without project restrictions.',
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
        !p.projectIds.length && ['owner', 'admin'].includes(p.role),
        403,
        'organization_admin_required',
        'Organization webhook management requires an administrator credential without project restrictions.',
      );
    const count = await pool.query(
      'INSERT INTO rate_limits(key,bucket,count) VALUES($1,$2,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.bucket=excluded.bucket THEN rate_limits.count+1 ELSE 1 END,bucket=excluded.bucket RETURNING count',
      [`${p.organizationId}:${p.id}`, Math.floor(Date.now() / 60000)],
    );
    if (count.rows[0].count > Number(process.env.API_RATE_LIMIT_PER_MINUTE || 300)) {
      headers.set('Retry-After', '60');
      throw new AppError(429, 'rate_limited', 'Too many requests. Retry in one minute.');
    }
    const query = new URL(request.url).searchParams;
    if (matched.operation.operationId === 'streamRun') {
      await transaction(p.organizationId, (tx) => getRun(tx, matched.params.run_id, p));
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
    const bytes = await boundedBody(request.body, 4 * 1024 * 1024);
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
    const handler = handlers[matched.operation.operationId];
    assert(handler, 503, 'operation_unavailable', 'This operation is not configured.');
    const idempotencyKey = request.headers.get('idempotency-key') || '';
    const fingerprint = sha256(
      `${request.method}\n${new URL(request.url).pathname}?${query.toString()}\n${request.headers.get('if-match') || ''}\n${binary ? sha256(bytes) : canonical(body)}`,
    );
    const outcome = await transaction(p.organizationId, async (tx) => {
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
          return { status: cached.status, body: unseal(cached.response_ciphertext) };
        }
      }
      const value = await handler({
        tx,
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
      });
      const response = value instanceof Response ? value : responseFor(matched.operation, value);
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
      if (p.kind === 'user' && request.method !== 'GET')
        await tx.query('INSERT INTO actor_activity(id,organization_id,user_id,action) VALUES($1,$2,$3,$4)', [
          id(),
          p.organizationId,
          p.userId,
          matched.operation.operationId,
        ]);
      if (!['GET', 'HEAD'].includes(request.method))
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
    });
    if (outcome instanceof Response) {
      status = outcome.status;
      headers.forEach((value, key) => outcome.headers.set(key, value));
      return outcome;
    }
    status = outcome.status;
    return status === 204
      ? new Response(null, { status, headers })
      : Response.json(outcome.body, { status, headers });
  } catch (error) {
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
    return Response.json(errorBody(error, requestId).body, { status, headers });
  } finally {
    const type =
      principal?.kind === 'api_key'
        ? 'service'
        : principal?.operator && route.startsWith('/admin/')
          ? 'operator'
          : principal
            ? 'human'
            : 'anonymous';
    await pool
      .query(
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
          Date.now() - start,
          ['dashboard', 'cli', 'sdk', 'api', 'internal'].includes(request.headers.get('x-client-type') || '')
            ? request.headers.get('x-client-type')
            : 'api',
        ],
      )
      .catch(() => {
        console.error(JSON.stringify({ request_id: requestId, code: 'request_observation_failed' }));
      });
  }
}
