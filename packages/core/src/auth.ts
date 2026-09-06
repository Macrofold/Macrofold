import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { jwt, twoFactor } from 'better-auth/plugins';
import { oauthProvider, oauthDeviceAuthorization } from '@better-auth/oauth-provider';
import { UnsecuredJWT } from 'jose';
import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { authPool, pool, transaction } from '../../db';
import { config, isLocal, assertSecurityConfiguration } from './config';
import { id, sha256, seal, unseal } from './crypto';
import { resourceVerifierClientId, resourceVerifierSecret } from './oauth-settings';
import { assert, AppError } from './errors';
import contract from '../../../docs/api/openapi.json';
import { v5 as stableId } from 'uuid';
export const customerScopes = Object.keys(
  contract.components.securitySchemes.CustomerOAuth.flows.authorizationCode.scopes,
);
export const operatorScopes = ['metrics:read', 'operations:read', 'accounts:read', 'accounts:pii:read'];
export async function sendMail(to: string, subject: string, text: string) {
  if (isLocal()) {
    await nodemailer
      .createTransport({
        host: process.env.LOCAL_SMTP_HOST || '127.0.0.1',
        port: Number(process.env.LOCAL_SMTP_PORT || 51025),
        secure: false,
      })
      .sendMail({ from: 'Platform <hello@platform.test>', to, subject, text });
  } else {
    const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: process.env.EMAIL_FROM!,
      to,
      subject,
      text,
    });
    if (result.error) throw new Error('Email delivery failed');
  }
}
export const auth = betterAuth({
  database: authPool,
  baseURL: config.origin,
  basePath: '/auth',
  secret: config.secret,
  trustedOrigins: [config.origin],
  appName: config.name,
  // Node's production build mode must not change the unpaid local fixture profile.
  // Persist production counters across Functions instead of per-instance memory.
  rateLimit: { enabled: !isLocal(), storage: 'database' },
  advanced: {
    database: { generateId: () => id() },
    cookies: { session_token: { name: isLocal() ? 'platform.session' : '__Secure-session' } },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
    sendResetPassword: async ({ user, url }) =>
      sendMail(user.email, 'Reset your password', `Reset your password: ${url}`),
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) =>
      sendMail(user.email, 'Verify your email', `Verify your email to start using ${config.name}: ${url}`),
  },
  socialProviders: process.env.GITHUB_CLIENT_ID
    ? { github: { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET! } }
    : {},
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (process.env.PUBLIC_SIGNUP_ENABLED === 'false')
            // Better Auth intentionally masks 403 signup denials as synthetic success
            // to prevent account enumeration. Maintenance is a global 503 condition.
            throw new APIError('SERVICE_UNAVAILABLE', {
              message: 'Registration is temporarily paused. Please contact the operator.',
            });
          return { data: user };
        },
        after: async (user) => {
          const org = id();
          await transaction(null, async (tx) => {
            await tx.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
              org,
              `${user.name.split(' ')[0]}'s workspace`,
            ]);
            await tx.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'owner')", [
              org,
              user.id,
            ]);
            await tx.query(
              "INSERT INTO product_events(id,organization_id,user_id,name) VALUES($1,$2,$3,'user.registered')",
              [id(), org, user.id],
            );
          });
        },
      },
    },
  },
  plugins: [
    twoFactor({
      issuer: config.name,
      skipVerificationOnEnable: false,
      accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 900 },
    }),
    jwt(),
    oauthProvider({
      // Opaque tokens use Better Auth's persisted revocation checks on every request.
      // Locally verifying a JWT signature alone would keep revoked grants usable until expiry.
      disableJwtPlugin: true,
      storeClientSecret: {
        encrypt: async (value) => seal(value),
        decrypt: async (value) => unseal<string>(value),
      },
      storeTokens: { hash: async (value) => sha256(value) },
      loginPage: '/login',
      consentPage: '/consent',
      // Only signed, unexpired authorization requests can retrieve pre-login metadata.
      allowPublicClientPrelogin: true,
      scopes: [...customerScopes, ...operatorScopes],
      resources: [
        { identifier: `${config.origin}/v1`, allowedScopes: customerScopes },
        { identifier: `${config.origin}/admin/v1`, allowedScopes: operatorScopes },
        { identifier: `${config.origin}/admin/mcp`, allowedScopes: operatorScopes },
      ],
      accessTokenExpiresIn: 900,
      refreshTokenExpiresIn: 30 * 86400,
      clientPrivileges: async ({ user }) =>
        Boolean(user && config.operatorEmails.includes(user.email.toLowerCase())),
      resourcePrivileges: async ({ user }) =>
        Boolean(user && config.operatorEmails.includes(user.email.toLowerCase())),
    }),
    oauthDeviceAuthorization({
      verificationUri: `${config.origin}/device`,
      expiresIn: '10m',
      interval: '5s',
    }),
  ],
});
export type Principal = {
  id: string;
  userId?: string;
  email?: string;
  organizationId: string;
  role: string;
  kind: 'user' | 'api_key' | 'operator';
  scopes: string[];
  projectIds: string[];
  operator: boolean;
  oauthTokenId?: string;
};
export async function identify(request: Request, adminAudience?: string): Promise<Principal> {
  assertSecurityConfiguration();
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const selector = request.headers.get('x-organization-id');
  let userId: string | undefined,
    principalId = '',
    scopes: string[] = customerScopes,
    projects: string[] = [],
    keyOrg: string | undefined,
    kind: Principal['kind'] = 'user',
    oauthTokenId: string | undefined;
  if (bearer?.startsWith('sk_')) {
    assert(!adminAudience, 401, 'unauthenticated', 'Customer API keys cannot access operator APIs.');
    const found = await pool.query(
      'SELECT * FROM api_keys WHERE key_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())',
      [sha256(bearer)],
    );
    const key = found.rows[0];
    assert(key, 401, 'unauthenticated', 'API key is invalid or expired.');
    userId = key.user_id;
    principalId = key.id;
    scopes = key.scopes;
    projects = key.project_ids;
    keyOrg = key.organization_id;
    kind = 'api_key';
    assert(
      !selector || selector === keyOrg,
      403,
      'forbidden',
      'The key is bound to a different organization.',
    );
    await pool.query('UPDATE api_keys SET last_used_at=now() WHERE id=$1', [key.id]);
  } else if (bearer) {
    try {
      const introspection = await auth.api.oauth2Introspect({
        body: {
          client_id: resourceVerifierClientId,
          client_secret: resourceVerifierSecret(),
          token: bearer,
          token_type_hint: 'access_token',
        },
      });
      assert(introspection.active, 401, 'unauthenticated', 'This OAuth grant is inactive.');
      // This payload comes from the trusted in-process authorization server, never from a caller.
      // jose performs the standard audience/issuer/time validation without a redundant loopback HTTP call.
      const claims = UnsecuredJWT.decode(new UnsecuredJWT(introspection).encode(), {
        audience: adminAudience || `${config.origin}/v1`,
        issuer: `${config.origin}/auth`,
      }).payload;
      const tokenRecord = (
        await pool.query('SELECT id FROM auth."oauthAccessToken" WHERE token=$1 AND revoked IS NULL', [
          sha256(bearer),
        ])
      ).rows[0];
      assert(tokenRecord, 401, 'unauthenticated', 'This access token is no longer active.');
      oauthTokenId = tokenRecord.id;
      const linked = await pool.query(
        `SELECT 1 FROM auth."oauthClientResource" cr JOIN auth."oauthResource" r ON r.identifier=cr."resourceId" WHERE cr."clientId"=$1 AND cr."resourceId"=$2 AND r.disabled=false`,
        [claims.client_id, adminAudience || `${config.origin}/v1`],
      );
      assert(
        linked.rowCount,
        401,
        'unauthenticated',
        'This client is no longer allowed to access the resource.',
      );
      if (adminAudience && claims.client_id && (!claims.sub || claims.sub === claims.client_id)) {
        const service = (
          await pool.query('SELECT * FROM service_clients WHERE client_id=$1 AND enabled=true', [
            claims.client_id,
          ])
        ).rows[0];
        assert(service, 403, 'forbidden', 'This operator service client is not enabled.');
        const requested = typeof claims.scope === 'string' ? claims.scope.split(' ') : [];
        return {
          id: String(claims.client_id),
          organizationId: '',
          role: 'operator',
          kind: 'operator',
          scopes: requested.filter((s) => service.scopes.includes(s)),
          projectIds: [],
          operator: true,
          oauthTokenId,
        };
      }
      userId = claims.sub;
      // A client id is shared by many people; it cannot identify an idempotency owner.
      principalId = stableId(`oauth:${claims.sub}:${claims.client_id}`, stableId.URL);
      scopes = typeof claims.scope === 'string' ? claims.scope.split(' ') : [];
    } catch {
      throw new AppError(
        401,
        'unauthenticated',
        'OAuth token is invalid, expired, or intended for a different resource.',
      );
    }
  } else {
    const session = await auth.api.getSession({ headers: request.headers });
    assert(session, 401, 'unauthenticated', 'Sign in to continue.');
    assert(
      session.user.emailVerified,
      403,
      'email_unverified',
      'Verify your email before using the platform.',
    );
    userId = session.user.id;
    principalId = userId;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method))
      assert(
        request.headers.get('origin') === config.origin,
        403,
        'forbidden',
        'Browser mutations require the trusted application origin.',
      );
  }
  assert(userId, 401, 'unauthenticated', 'An authenticated account is required.');
  const user = await pool.query('SELECT email,"emailVerified" FROM auth."user" WHERE id=$1', [userId]);
  assert(
    user.rowCount && user.rows[0].emailVerified,
    403,
    'forbidden',
    'This account is unavailable or unverified.',
  );
  const membership = await pool.query(
    'SELECT m.*,o.name FROM memberships m JOIN organizations o ON o.id=m.organization_id WHERE user_id=$1 ORDER BY o.created_at',
    [userId],
  );
  const target =
    keyOrg ||
    selector ||
    (!bearer
      ? membership.rows.find(
          (v) =>
            v.organization_id ===
            (request.headers.get('cookie') || '')
              .split(';')
              .map((s) => s.trim())
              .find((s) => s.startsWith((isLocal() ? 'platform.organization' : '__Host-organization') + '='))
              ?.split('=')[1],
        )?.organization_id || membership.rows[0]?.organization_id
      : undefined) ||
    (membership.rows.length === 1 || new URL(request.url).pathname === '/v1/me'
      ? membership.rows[0]?.organization_id
      : undefined);
  assert(target, 400, 'organization_required', 'Select an organization with X-Organization-Id.');
  const m = membership.rows.find((v) => v.organization_id === target);
  assert(m, 403, 'forbidden', 'You cannot access this organization.');
  const operator = config.operatorEmails.includes(user.rows[0].email.toLowerCase());
  if (adminAudience) {
    assert(operator, 403, 'forbidden', 'Platform operator access is required.');
    if (!bearer) scopes = operatorScopes;
    kind = 'operator';
  }
  return {
    id: principalId || userId,
    userId,
    email: user.rows[0].email,
    organizationId: target,
    role: m.role,
    kind,
    scopes,
    projectIds: projects,
    operator,
    oauthTokenId,
  };
}
export function requireScopes(p: Principal, scopes: string[]) {
  assert(
    scopes.every((s) => p.scopes.includes(s)),
    403,
    'forbidden',
    `This action requires: ${scopes.join(', ')}.`,
  );
  if (scopes.some((s) => s.endsWith(':write') || s.endsWith(':delete')))
    assert(p.role !== 'viewer', 403, 'forbidden', 'Viewer access cannot modify resources.');
}
export function requireProject(p: Principal, projectId: string) {
  assert(!p.projectIds.length || p.projectIds.includes(projectId), 404, 'not_found', 'Project not found.');
}
