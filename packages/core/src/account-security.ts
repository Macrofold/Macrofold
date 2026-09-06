import { auth } from './auth';
import { config } from './config';
import { assert, errorBody } from './errors';
import { transaction } from '../../db';

/** Browser-only account controls. An app token must never revoke another app's grant. */
export async function accountGrants(request: Request) {
  try {
    assert(!request.headers.has('authorization'), 403, 'forbidden', 'Use an authenticated browser session.');
    const session = await auth.api.getSession({ headers: request.headers });
    assert(session?.user.emailVerified, 401, 'unauthenticated', 'Sign in to manage your applications.');
    if (request.method === 'GET') {
      const data = await transaction(
        null,
        async (tx) =>
          (
            await tx.query(
              `
        WITH grants AS (
          SELECT "clientId", jsonb_array_elements_text(scopes) AS scope, "createdAt" AS created_at FROM auth."oauthConsent" WHERE "userId"=$1
          UNION ALL
          SELECT "clientId", jsonb_array_elements_text(scopes), "createdAt" FROM auth."oauthAccessToken" WHERE "userId"=$1 AND revoked IS NULL AND "expiresAt">now()
          UNION ALL
          SELECT "clientId", jsonb_array_elements_text(scopes), "createdAt" FROM auth."oauthRefreshToken" WHERE "userId"=$1 AND revoked IS NULL AND "expiresAt">now()
        ) SELECT g."clientId" AS client_id, coalesce(c.name,g."clientId") AS name,
          array_agg(DISTINCT g.scope ORDER BY g.scope) AS scopes, min(g.created_at) AS authorized_at
          FROM grants g JOIN auth."oauthClient" c ON c."clientId"=g."clientId"
          GROUP BY g."clientId",c.name ORDER BY min(g.created_at) DESC`,
              [session.user.id],
            )
          ).rows,
      );
      return Response.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
    }
    assert(request.method === 'DELETE', 405, 'method_not_allowed', 'Use GET or DELETE.');
    assert(
      request.headers.get('origin') === config.origin,
      403,
      'forbidden',
      'A trusted browser origin is required.',
    );
    const clientId = new URL(request.url).searchParams.get('client_id');
    assert(clientId && clientId.length <= 2048, 400, 'invalid_request', 'Choose an application.');
    await transaction(null, async (tx) => {
      // Keep rows for accepted-run revocation checks and audit, while deleting consent
      // so a future connection requires a new explicit authorization.
      await tx.query(
        'UPDATE auth."oauthRefreshToken" SET revoked=now() WHERE "userId"=$1 AND "clientId"=$2 AND revoked IS NULL',
        [session.user.id, clientId],
      );
      await tx.query(
        'UPDATE auth."oauthAccessToken" SET revoked=now() WHERE "userId"=$1 AND "clientId"=$2 AND revoked IS NULL',
        [session.user.id, clientId],
      );
      await tx.query('DELETE FROM auth."oauthConsent" WHERE "userId"=$1 AND "clientId"=$2', [
        session.user.id,
        clientId,
      ]);
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    const result = errorBody(error, crypto.randomUUID());
    return Response.json(result.body, { status: result.status });
  }
}
