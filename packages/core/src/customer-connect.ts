import { z } from 'zod';
import { transaction, lock, type Tx } from '../../db';
import type { Principal } from './auth';
import type { CustomerConnectorProvider } from './customer-connector-provider';
import { getCustomerBinding, type CustomerBinding } from './customer-agents';
import {
  getCustomerConnection,
  capabilityTools,
  updateCustomerConnectionPermissions,
} from './customer-agent-connections';
import { actorAuthorized } from './actor-authorization';
import { config, isLocal } from './config';
import { assert } from './errors';
import { connectionCookie, connectionCookieName, startConnectionCookies } from './connection-cookies';
import { id, token, sha256, seal, unseal } from './crypto';
import { enabledConnector } from './connector-enablement';
import { validatePublicURL } from '../../providers/src/network';
import * as resources from './resources';

type Authorization = {
  id: string;
  organization_id: string;
  binding_id: string;
  connection_id: string;
  principal: Principal;
  return_url: string;
  ticket_hash: string;
  access_version: string;
  status:
    | 'pending'
    | 'starting'
    | 'authorizing'
    | 'awaiting_confirmation'
    | 'verifying'
    | 'verified'
    | 'completed'
    | 'failed';
  selected_capabilities: string[];
  provider_session_ciphertext: string | null;
  completion_hash: string | null;
  external_account_id: string | null;
  expires_at: Date;
};
const ticketShape = z.object({
  organization: z.string().uuid(),
  authorization: z.string().uuid(),
  secret: z.string(),
});
function decodeTicket(ticket: string) {
  try {
    return ticketShape.parse(unseal(ticket));
  } catch {
    assert(
      false,
      400,
      'invalid_connection_ticket',
      'This connection link is invalid. Request a new link in your app.',
    );
  }
}
export const customerConsentCookieName = () => connectionCookieName('customer');
const cookie = () => connectionCookie('customer');
export const consentHeaders = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
export function hasCustomerConsentCookie(request: Request) {
  return (request.headers.get('cookie') || '')
    .split(';')
    .some((v) => v.trim().startsWith(customerConsentCookieName() + '='));
}
const subjectFor = (b: CustomerBinding) =>
  `customer_${sha256(JSON.stringify([b.organization_id, b.owner_user_id, b.customer_id]))}`;

async function authorizeAttempt(tx: Tx, a: Authorization) {
  assert(
    a.expires_at.getTime() > Date.now(),
    410,
    'connection_link_expired',
    'This link expired. Request a new connection link in your app.',
  );
  const b = (
    await tx.query<CustomerBinding>('SELECT * FROM customer_agent_bindings WHERE id=$1', [a.binding_id])
  ).rows[0];
  assert(b, 404, 'not_found', 'Customer agent not found.');
  const p = a.principal;
  for (const scope of ['connections:read', 'connections:write', 'runs:write']) {
    assert(
      await actorAuthorized(
        tx,
        {
          organization_id: a.organization_id,
          project_id: b.project_id,
          config: {
            user_id: p.userId!,
            principal_id: p.id,
            principal_kind: p.kind,
            oauth_token_id: p.oauthTokenId,
          },
        },
        scope,
      ),
      403,
      'authorization_revoked',
      'The app credential is no longer authorized. Request a new link.',
    );
  }
  const member = (
    await tx.query<{ role: Principal['role'] }>('SELECT role FROM memberships WHERE user_id=$1', [p.userId])
  ).rows[0];
  assert(
    member && ['owner', 'admin'].includes(member.role),
    403,
    'authorization_revoked',
    'An owning administrator must authorize app access.',
  );
  const current = { ...p, role: member.role };
  await getCustomerBinding(tx, current, b.customer_id, b.id);
  const connected = await getCustomerConnection(tx, current, b, a.connection_id);
  assert(
    connected.connection.authorization_attempt_id === a.id,
    409,
    'connection_changed',
    'A newer connection attempt replaced this link.',
  );
  return { b, p: current, ...connected };
}
async function ticketAttempt(tx: Tx, ticket: ReturnType<typeof decodeTicket>) {
  const a = (
    await tx.query<Authorization>('SELECT * FROM customer_connection_authorizations WHERE id=$1', [
      ticket.authorization,
    ])
  ).rows[0];
  assert(a && a.ticket_hash === sha256(ticket.secret), 404, 'not_found', 'Connection link not found.');
  return { a, ...(await authorizeAttempt(tx, a)) };
}

export async function createCustomerAuthorization(
  tx: Tx,
  p: Principal,
  b: CustomerBinding,
  connectionId: string,
  returnUrl: string,
) {
  assert(
    process.env.COMPOSIO_CALLBACK_VERIFICATION_ENABLED === 'true',
    503,
    'integration_not_configured',
    'Enable verified app callbacks before offering customer connections.',
  );
  assert(
    ['owner', 'admin'].includes(p.role),
    403,
    'organization_admin_required',
    'An owning administrator must authorize customer connections.',
  );
  const url = new URL(returnUrl);
  const localCallback = isLocal() && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  assert(
    (url.protocol === 'https:' || (localCallback && url.protocol === 'http:')) &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.searchParams.has('connection_code'),
    400,
    'invalid_return_url',
    'Use your HTTPS backend callback URL without a fragment or connection_code parameter. Local development also accepts HTTP loopback URLs.',
  );
  if (!localCallback) await validatePublicURL(url.href);
  await lock(tx, `customer-connect:${connectionId}`);
  const { connection } = await getCustomerConnection(tx, p, b, connectionId);
  await enabledConnector(connection.provider!, tx);
  const unresolved = (
    await tx.query(
      "SELECT id FROM customer_connection_authorizations WHERE connection_id=$1 AND status='starting'",
      [connectionId],
    )
  ).rows[0];
  assert(
    !unresolved,
    409,
    'connection_recovery_required',
    'Account creation is uncertain. Ask the operator to reconcile this connection before trying again.',
  );
  const attempt = id(),
    secret = token('connect'),
    expires = new Date(Date.now() + 600000);
  await tx.query(
    `INSERT INTO customer_connection_authorizations(id,organization_id,binding_id,connection_id,principal,return_url,ticket_hash,expires_at,access_version)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      attempt,
      p.organizationId,
      b.id,
      connectionId,
      JSON.stringify({ ...p, email: undefined }),
      url.href,
      sha256(secret),
      expires,
      connection.access_version,
    ],
  );
  await resources.update(tx, 'connections', connectionId, { authorization_attempt_id: attempt });
  const ticket = seal({ organization: p.organizationId, authorization: attempt, secret });
  return {
    authorization_id: attempt,
    authorization_url: `${config.origin}/connect#ticket=${encodeURIComponent(ticket)}`,
    expires_at: expires.toISOString(),
  };
}

export async function describeCustomerConsent(ticket: string) {
  const decoded = decodeTicket(ticket);
  return transaction(decoded.organization, async (tx) => {
    const { a, b, link, connection } = await ticketAttempt(tx, decoded);
    assert(
      a.status === 'pending',
      409,
      'connection_link_used',
      'This link has already been used. Return to your app for a new link.',
    );
    return {
      name: b.name,
      connection_name: connection.name,
      provider: connection.provider!,
      capabilities: link.capabilities,
      selected_capabilities: link.selected_capabilities,
      return_host: new URL(a.return_url).host,
      expires_at: a.expires_at.toISOString(),
    };
  });
}

/** Persist dispatch before a non-idempotent provider request; never blindly retry an uncertain creation. */
export async function startCustomerConsent(
  ticket: string,
  selected: string[],
  provider: CustomerConnectorProvider,
) {
  const decoded = decodeTicket(ticket);
  const context = await transaction(decoded.organization, async (tx) => {
    await lock(tx, `customer-connect:${decoded.authorization}`);
    const result = await ticketAttempt(tx, decoded);
    assert(
      result.a.status === 'pending',
      409,
      'connection_link_used',
      'This link has already been used. Return to your app for a new link.',
    );
    capabilityTools(result.link.capabilities, selected);
    const setup = await enabledConnector(result.connection.provider!, tx);
    await tx.query(
      "UPDATE customer_connection_authorizations SET status='starting',selected_capabilities=$2 WHERE id=$1",
      [result.a.id, selected],
    );
    return { ...result, setup };
  });
  const { a, b, connection } = context;
  try {
    const result = await provider.start({
      subject: subjectFor(b),
      connectionId: connection.id,
      authConfigId: context.setup.auth_config_id,
      callbackUrl: config.origin + '/integrations/composio/callback',
      externalAccountId: connection.external_account_id || undefined,
    });
    await transaction(a.organization_id, (tx) =>
      tx.query('UPDATE customer_connection_authorizations SET external_account_id=$2 WHERE id=$1', [
        a.id,
        result.accountId,
      ]),
    );
    assert(
      new URL(result.url).protocol === 'https:' &&
        (!connection.external_account_id || result.accountId === connection.external_account_id),
      502,
      'connection_changed',
      'The provider returned an invalid account or authorization link.',
    );
    await transaction(a.organization_id, async (tx) => {
      await lock(tx, `customer-connect:${connection.id}`);
      await authorizeAttempt(tx, a);
      await tx.query(
        "UPDATE customer_connection_authorizations SET status='authorizing',external_account_id=$2 WHERE id=$1",
        [a.id, result.accountId],
      );
      await resources.update(tx, 'connections', connection.id, {
        external_account_id: result.accountId,
        provider_subject_id: subjectFor(b),
        identity_verified: false,
        status: 'pending',
      });
    });
    return Response.json(
      { authorization_url: result.url },
      { headers: startConnectionCookies('customer', ticket, consentHeaders) },
    );
  } catch (error) {
    // A refresh targets a known account. A new-account dispatch must be reconciled if its local commit failed.
    if (connection.external_account_id)
      await transaction(a.organization_id, (tx) =>
        tx.query(
          "UPDATE customer_connection_authorizations SET status='failed' WHERE id=$1 AND status='starting'",
          [a.id],
        ),
      );
    throw error;
  }
}

/** No account activation here. The application's authenticated callback must confirm the customer. */
export async function finishCustomerConsent(request: Request) {
  const value = (request.headers.get('cookie') || '')
    .split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(customerConsentCookieName() + '='))
    ?.slice(customerConsentCookieName().length + 1);
  const uri = new URL(request.url).searchParams.get('session_uri');
  assert(
    value && uri && uri.length < 8192,
    400,
    'invalid_oauth_state',
    'Return to your app and start the connection again.',
  );
  let ticket: string;
  try {
    ticket = decodeURIComponent(value);
  } catch {
    assert(false, 400, 'invalid_oauth_state', 'Connection state is invalid.');
  }
  const decoded = decodeTicket(ticket);
  return transaction(decoded.organization, async (tx) => {
    await lock(tx, `customer-connect:${decoded.authorization}`);
    const { a } = await ticketAttempt(tx, decoded);
    assert(
      a.status === 'authorizing',
      409,
      'connection_link_used',
      'This callback has already been used. Return to your app.',
    );
    const secret = token('complete');
    await tx.query(
      "UPDATE customer_connection_authorizations SET status='awaiting_confirmation',provider_session_ciphertext=$2,completion_hash=$3 WHERE id=$1",
      [a.id, seal(uri), sha256(secret)],
    );
    const target = new URL(a.return_url);
    target.searchParams.set(
      'connection_code',
      seal({ organization: a.organization_id, authorization: a.id, secret }),
    );
    return new Response(null, {
      status: 303,
      headers: { ...consentHeaders, 'set-cookie': cookie(), location: target.href },
    });
  });
}

/** External verification happens outside the API commit transaction. A verified receipt survives retries. */
export async function prepareCustomerCompletion(
  p: Principal,
  customerId: string,
  bindingId: string,
  connectionId: string,
  code: string,
  provider: CustomerConnectorProvider,
) {
  const decoded = decodeTicket(code);
  assert(decoded.organization === p.organizationId, 404, 'not_found', 'Connection confirmation not found.');
  const context = await transaction(p.organizationId, async (tx) => {
    const b = await getCustomerBinding(tx, p, customerId, bindingId);
    await getCustomerConnection(tx, p, b, connectionId);
    await lock(tx, `customer-connect:${decoded.authorization}`);
    const a = (
      await tx.query<Authorization>(
        'SELECT * FROM customer_connection_authorizations WHERE id=$1 AND binding_id=$2 AND connection_id=$3',
        [decoded.authorization, b.id, connectionId],
      )
    ).rows[0];
    assert(
      a && a.completion_hash === sha256(decoded.secret),
      404,
      'not_found',
      'Connection confirmation not found.',
    );
    await authorizeAttempt(tx, a);
    assert(
      ['awaiting_confirmation', 'verified'].includes(a.status),
      409,
      'connection_confirmation_used',
      'This confirmation is used or could not be completed. Return to your app to reconnect.',
    );
    if (a.status === 'awaiting_confirmation')
      await tx.query("UPDATE customer_connection_authorizations SET status='verifying' WHERE id=$1", [a.id]);
    return { a, b };
  });
  const { a, b } = context;
  if (a.status !== 'verified') {
    try {
      const result = await provider.complete(unseal<string>(a.provider_session_ciphertext!), subjectFor(b));
      await transaction(p.organizationId, async (tx) => {
        const { connection } = await authorizeAttempt(tx, a);
        assert(
          result.accountId === a.external_account_id &&
            result.accountId === connection.external_account_id &&
            result.toolkit === connection.provider,
          409,
          'connection_changed',
          'The verified account does not match this connection.',
        );
        await tx.query(
          "UPDATE customer_connection_authorizations SET status='verified',provider_session_ciphertext=NULL WHERE id=$1",
          [a.id],
        );
      });
    } catch (error) {
      await transaction(p.organizationId, (tx) =>
        tx.query(
          "UPDATE customer_connection_authorizations SET status='failed',provider_session_ciphertext=NULL WHERE id=$1 AND status='verifying'",
          [a.id],
        ),
      );
      throw error;
    }
  }
  const { connection } = await transaction(p.organizationId, (tx) =>
    getCustomerConnection(tx, p, b, connectionId),
  );
  const setup = await enabledConnector(connection.provider!);
  const catalog = await provider.tools(setup.toolkit, setup.toolkit_version);
  return {
    async commit(tx: Tx, current: Principal) {
      await lock(tx, `customer-connect:${a.id}`);
      await lock(tx, `customer-connect:${connectionId}`);
      await getCustomerBinding(tx, current, customerId, bindingId);
      const latest = (
        await tx.query<Authorization>(
          "SELECT * FROM customer_connection_authorizations WHERE id=$1 AND status='verified'",
          [a.id],
        )
      ).rows[0];
      assert(latest, 409, 'connection_confirmation_used', 'This confirmation has already been used.');
      const { connection: c } = await authorizeAttempt(tx, latest);
      // Permission edits lock the binding before the connection row; keep that order here too.
      await lock(tx, `customer-connections:${b.id}`);
      await resources.update(tx, 'connections', c.id, {
        identity_verified: true,
        status: 'healthy',
        account_identity: c.external_account_id,
      });
      const result = await updateCustomerConnectionPermissions(
        tx,
        current,
        b,
        c.id,
        latest.selected_capabilities,
        `"${latest.access_version}"`,
        catalog,
      );
      await tx.query("UPDATE customer_connection_authorizations SET status='completed' WHERE id=$1", [a.id]);
      await resources.update(tx, 'connections', c.id, { authorization_attempt_id: null });
      return result;
    },
    async dispose() {},
  };
}
