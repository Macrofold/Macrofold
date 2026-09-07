import { transaction } from '../../db';
import type { DashboardCategory } from '../../contracts/dashboard';
import { auth, identify, requireScopes } from './auth';
import { config } from './config';
import { assert } from './errors';

export type DashboardAccess = {
  organizationId: string;
  userId: string;
  sessionId: string;
  role: string;
};
export type DashboardSnapshot = {
  authorizedSessions: Set<string>;
  revisions: Record<DashboardCategory, string>;
};

/** Browser sessions currently have organization-wide read access. Reject bearer
 * and project-restricted principals instead of widening their resource authority. */
export async function dashboardAccess(request: Request): Promise<DashboardAccess> {
  assert(!request.headers.has('authorization'), 401, 'unauthenticated', 'Sign in to the dashboard.');
  const origin = request.headers.get('origin');
  assert(
    (!origin || origin === config.origin) && request.headers.get('sec-fetch-site') !== 'cross-site',
    403,
    'forbidden',
    'Use the same-origin dashboard.',
  );
  const principal = await identify(request);
  requireScopes(principal, ['runs:read', 'files:read', 'projects:read']);
  assert(
    principal.kind === 'user' && !principal.projectIds.length,
    403,
    'forbidden',
    'Dashboard session required.',
  );
  assert(
    new URL(request.url).searchParams.get('organization_id') === principal.organizationId,
    409,
    'organization_changed',
    'The active organization changed. Reload the dashboard.',
  );
  const session = await auth.api.getSession({ headers: request.headers });
  assert(session && session.user.id === principal.userId, 401, 'unauthenticated', 'Sign in to continue.');
  return {
    organizationId: principal.organizationId,
    userId: session.user.id,
    sessionId: session.session.id,
    role: principal.role,
  };
}

/** One bounded, RLS-protected snapshot per organization per hub tick. Every tick
 * checks real session/membership rows; no cached identity can extend a revocation.
 * Each scalar revision lookup is an index seek, independent of transcript size. */
export async function readDashboardSnapshot(
  organization: string,
  accesses: DashboardAccess[],
): Promise<DashboardSnapshot> {
  assert(
    accesses.length > 0 && accesses.length <= 256 && accesses.every((a) => a.organizationId === organization),
    400,
    'invalid_subscription',
    'Invalid dashboard subscription.',
  );
  return transaction(
    organization,
    async (tx) => {
      const result = await tx.query(
        `
      SELECT ARRAY(
        SELECT s.id || ':' || a.role FROM jsonb_to_recordset($2::jsonb) AS a("sessionId" text,"userId" text,role text)
        JOIN auth.session s ON s.id=a."sessionId" AND s."userId"=a."userId" AND s."expiresAt">now()
        JOIN auth."user" u ON u.id=s."userId" AND u."emailVerified"=true
        JOIN memberships m ON m.user_id=u.id AND m.organization_id=$1 AND m.role=a.role
      ) AS sessions,
      coalesce((SELECT dashboard_revision FROM runs WHERE organization_id=$1 ORDER BY dashboard_revision DESC LIMIT 1),0)::text AS runs,
      greatest(
        coalesce((SELECT dashboard_revision FROM workspaces WHERE organization_id=$1 ORDER BY dashboard_revision DESC LIMIT 1),0),
        coalesce((SELECT dashboard_revision FROM checkpoints WHERE organization_id=$1 ORDER BY dashboard_revision DESC LIMIT 1),0)
      )::text AS workspace,
      coalesce((SELECT dashboard_git_revision FROM workspaces WHERE organization_id=$1 ORDER BY dashboard_git_revision DESC LIMIT 1),0)::text AS git
    `,
        [organization, JSON.stringify(accesses)],
      );
      const row = result.rows[0];
      return {
        authorizedSessions: new Set<string>(row.sessions),
        revisions: { runs: row.runs, workspace: row.workspace, git: row.git },
      };
    },
    { statementTimeoutMs: 2000 },
  );
}
