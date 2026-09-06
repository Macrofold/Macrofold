import { executionPolicy, planFor } from './plans';
import type { components } from '../../contracts/api';
import { z } from 'zod';
import { transaction, lock, type Tx } from '../../db';
import { auth, identify, requireScopes, type Principal } from './auth';
import { config, isLocal } from './config';
import { assert, errorBody } from './errors';
import { id, token, sha256, seal, unseal } from './crypto';
import { boundedBody } from './body';

export function organizationManager(p: Principal) {
  requireScopes(p, ['organizations:write']);
  assert(
    !p.projectIds.length && ['owner', 'admin'].includes(p.role),
    403,
    'organization_admin_required',
    'An unrestricted organization owner or admin credential is required.',
  );
}
async function audit(
  tx: Tx,
  p: Principal,
  action: string,
  subject?: string,
  data: Record<string, unknown> = {},
) {
  await tx.query(
    'INSERT INTO organization_audit(id,organization_id,actor_id,action,subject_id,data) VALUES($1,$2,$3,$4,$5,$6)',
    [id(), p.organizationId, p.id, action, subject, JSON.stringify(data)],
  );
}
export async function createOrganization(tx: Tx, p: Principal, name: string) {
  assert(
    p.kind === 'user' && !p.projectIds.length && p.userId,
    403,
    'user_required',
    'Create organizations with a user credential.',
  );
  await lock(tx, `organizations-user:${p.userId}`);
  const count = (
    await tx.query("SELECT count(*) FROM memberships WHERE user_id=$1 AND role='owner'", [p.userId])
  ).rows[0].count;
  assert(Number(count) < 20, 409, 'organization_limit', 'An account can own up to 20 organizations.');
  const org = id();
  await tx.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [org, name]);
  await tx.query("INSERT INTO memberships VALUES($1,$2,'owner')", [org, p.userId]);
  await tx.query(
    "INSERT INTO product_events(id,organization_id,user_id,name) VALUES($1,$2,$3,'organization.created')",
    [id(), org, p.userId],
  );
  return { id: org, name, role: 'owner' };
}
export async function listMembers(tx: Tx, p: Principal) {
  assert(!p.projectIds.length, 403, 'forbidden', 'Use an unrestricted credential to view the organization.');
  return {
    data: (
      await tx.query(
        'SELECT m.user_id,u.name,u.email,m.role FROM memberships m JOIN auth."user" u ON u.id=m.user_id WHERE m.organization_id=$1 ORDER BY u.name,m.user_id',
        [p.organizationId],
      )
    ).rows,
    next_cursor: null,
  };
}
export async function changeMember(tx: Tx, p: Principal, user: string, role?: string) {
  organizationManager(p);
  // Serialize membership changes and invitation acceptance. Concurrent owner demotions
  // must never leave an organization with no owner.
  await lock(tx, `memberships:${p.organizationId}`);
  const target = (
    await tx.query('SELECT role FROM memberships WHERE organization_id=$1 AND user_id=$2', [
      p.organizationId,
      user,
    ])
  ).rows[0];
  assert(target, 404, 'not_found', 'Member not found.');
  const current = (
    await tx.query('SELECT role FROM memberships WHERE organization_id=$1 AND user_id=$2', [
      p.organizationId,
      p.userId,
    ])
  ).rows[0];
  assert(
    current && ['owner', 'admin'].includes(current.role),
    403,
    'forbidden',
    'Your administration permission changed.',
  );
  assert(
    current.role === 'owner' ||
      (['member', 'viewer'].includes(target.role) && (!role || ['member', 'viewer'].includes(role))),
    403,
    'owner_required',
    'Only owners can change administrators or ownership.',
  );
  if (target.role === 'owner' && role !== 'owner') {
    const owners = await tx.query("SELECT 1 FROM memberships WHERE organization_id=$1 AND role='owner'", [
      p.organizationId,
    ]);
    assert(
      (owners.rowCount || 0) > 1,
      409,
      'last_owner',
      'Promote another owner before removing the last owner.',
    );
  }
  if (role)
    await tx.query('UPDATE memberships SET role=$3 WHERE organization_id=$1 AND user_id=$2', [
      p.organizationId,
      user,
      role,
    ]);
  else
    await tx.query('DELETE FROM memberships WHERE organization_id=$1 AND user_id=$2', [
      p.organizationId,
      user,
    ]);
  if (!role || role === 'viewer') {
    await tx.query(
      'UPDATE api_keys SET revoked_at=now() WHERE organization_id=$1 AND user_id=$2 AND revoked_at IS NULL',
      [p.organizationId, user],
    );
    await tx.query(
      "UPDATE runs SET cancel_requested=true WHERE config->>'user_id'=$1 AND status IN ('queued','provisioning','running','waiting_for_input')",
      [user],
    );
  }
  await audit(tx, p, role ? 'member.role_changed' : 'member.removed', user, {
    previous_role: target.role,
    role: role || null,
  });
}
export async function inviteMember(tx: Tx, p: Principal, email: string, role: 'admin' | 'member' | 'viewer') {
  organizationManager(p);
  assert(
    p.role === 'owner' || role !== 'admin',
    403,
    'owner_required',
    'Only owners can invite administrators.',
  );
  await lock(tx, `memberships:${p.organizationId}`);
  const current = (
    await tx.query('SELECT role FROM memberships WHERE organization_id=$1 AND user_id=$2', [
      p.organizationId,
      p.userId,
    ])
  ).rows[0];
  assert(
    current && (current.role === 'owner' || (current.role === 'admin' && role !== 'admin')),
    403,
    'forbidden',
    'Your invitation permission changed.',
  );
  const count = (
    await tx.query('SELECT count(*) FROM memberships WHERE organization_id=$1', [p.organizationId])
  ).rows[0].count;
  assert(Number(count) < 1000, 409, 'member_limit', 'This organization has reached its member limit.');
  const pending = (
    await tx.query(
      'SELECT count(*) FROM organization_invitations WHERE expires_at>now() AND accepted_at IS NULL AND revoked_at IS NULL',
    )
  ).rows[0].count;
  assert(Number(pending) < 100, 409, 'invitation_limit', 'Revoke old invitations before creating more.');
  const existing = await tx.query(
    'SELECT 1 FROM memberships m JOIN auth."user" u ON u.id=m.user_id WHERE m.organization_id=$1 AND lower(u.email)=$2',
    [p.organizationId, email.toLowerCase()],
  );
  assert(!existing.rowCount, 409, 'already_member', 'This account is already a member.');
  const invitation = id(),
    secret = token('invite'),
    expires = new Date(Date.now() + 7 * 86400000);
  await tx.query(
    'UPDATE organization_invitations SET revoked_at=now() WHERE email=$1 AND accepted_at IS NULL AND revoked_at IS NULL',
    [email.toLowerCase()],
  );
  const result = (
    await tx.query(
      'INSERT INTO organization_invitations(id,organization_id,email,role,token_hash,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,email,role,expires_at,created_at',
      [invitation, p.organizationId, email.toLowerCase(), role, sha256(secret), p.userId, expires],
    )
  ).rows[0];
  await audit(tx, p, 'member.invited', invitation, { role });
  // Encrypted locator avoids a global invite table that exposes recipient addresses.
  return {
    ...result,
    invite_url:
      config.origin +
      '/join?token=' +
      encodeURIComponent(seal({ org: p.organizationId, id: invitation, secret })),
  };
}
export const organizationCookie = () => (isLocal() ? 'platform.organization' : '__Host-organization');
function selectionCookie(org: string) {
  return `${organizationCookie()}=${org}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${isLocal() ? '' : '; Secure'}`;
}
export async function selectOrganization(request: Request) {
  try {
    assert(!request.headers.has('authorization'), 403, 'browser_required', 'Use your signed-in dashboard.');
    const value = z
      .object({ organization_id: z.uuid() })
      .parse(JSON.parse((await boundedBody(request.body, 4096)).toString()));
    await identify(
      new Request(request.url, {
        method: request.method,
        headers: new Headers([...request.headers, ['x-organization-id', value.organization_id]]),
      }),
    );
    return new Response(null, {
      status: 204,
      headers: { 'Set-Cookie': selectionCookie(value.organization_id) },
    });
  } catch (error) {
    const result = errorBody(error, id());
    return Response.json(result.body, { status: result.status });
  }
}
export async function acceptInvitation(request: Request) {
  try {
    assert(!request.headers.has('authorization'), 403, 'browser_required', 'Use your signed-in dashboard.');
    assert(
      request.headers.get('origin') === config.origin,
      403,
      'forbidden',
      'A trusted browser origin is required.',
    );
    const session = await auth.api.getSession({ headers: request.headers });
    assert(
      session?.user.emailVerified,
      401,
      'unauthenticated',
      'Sign in and verify your email before joining.',
    );
    const input = z
      .object({ token: z.string().max(4096) })
      .parse(JSON.parse((await boundedBody(request.body, 8192)).toString()));
    let data: { org: string; id: string; secret: string };
    try {
      data = z.object({ org: z.uuid(), id: z.uuid(), secret: z.string() }).parse(unseal(input.token));
    } catch {
      assert(false, 400, 'invalid_invitation', 'The invitation link is invalid.');
    }
    const result = await transaction(data.org, async (tx) => {
      await lock(tx, `memberships:${data.org}`);
      const invite = (
        await tx.query('SELECT * FROM organization_invitations WHERE id=$1 AND token_hash=$2', [
          data.id,
          sha256(data.secret),
        ])
      ).rows[0];
      assert(
        invite && !invite.revoked_at && !invite.accepted_at && invite.expires_at > new Date(),
        410,
        'invitation_expired',
        'This invitation expired or was already used. Ask an administrator for a new one.',
      );
      assert(
        invite.email === session.user.email.toLowerCase(),
        403,
        'invitation_email_mismatch',
        'Sign in with the email address this invitation was sent to.',
      );
      const inviter = (
        await tx.query('SELECT role FROM memberships WHERE organization_id=$1 AND user_id=$2', [
          data.org,
          invite.created_by,
        ])
      ).rows[0];
      assert(
        inviter && (inviter.role === 'owner' || (inviter.role === 'admin' && invite.role !== 'admin')),
        403,
        'invitation_revoked',
        'The inviter is no longer authorized. Ask an administrator for a new invitation.',
      );
      const count = (await tx.query('SELECT count(*) FROM memberships WHERE organization_id=$1', [data.org]))
        .rows[0].count;
      assert(Number(count) < 1000, 409, 'member_limit', 'The organization has reached its member limit.');
      await tx.query('INSERT INTO memberships VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [
        data.org,
        session.user.id,
        invite.role,
      ]);
      await tx.query('UPDATE organization_invitations SET accepted_at=now() WHERE id=$1', [data.id]);
      await tx.query(
        "INSERT INTO organization_audit(id,organization_id,actor_id,action,subject_id) VALUES($1,$2,$3,'invitation.accepted',$4)",
        [id(), data.org, session.user.id, data.id],
      );
      return { organization_id: data.org };
    });
    return Response.json(result, {
      headers: { 'Set-Cookie': selectionCookie(data.org), 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const result = errorBody(error, id());
    return Response.json(result.body, { status: result.status });
  }
}

export async function updateExecutionPolicy(
  tx: Tx,
  p: Principal,
  input: components['schemas']['ExecutionPolicyPatch'],
) {
  organizationManager(p);
  // Serialize with start claims. Downgrades and lower limits only govern new starts.
  await lock(tx, `organization:${p.organizationId}`);
  const row = (
    await tx.query('SELECT * FROM organizations WHERE id=$1 FOR NO KEY UPDATE', [p.organizationId])
  ).rows[0];
  const plan = planFor(row.plan);
  const concurrency =
    input.concurrency_limit === undefined ? row.run_concurrency_limit : input.concurrency_limit;
  const timeout =
    input.max_timeout_seconds === undefined ? row.run_timeout_seconds : input.max_timeout_seconds;
  for (const [value, max] of [
    [input.concurrency_limit, plan.concurrency_limit],
    [input.max_timeout_seconds, plan.max_timeout_seconds],
  ])
    assert(
      value == null || (Number.isInteger(value) && value >= 1 && value <= max!),
      400,
      'plan_limit_exceeded',
      'Choose an execution limit within your current plan.',
    );
  const updated = (
    await tx.query(
      'UPDATE organizations SET run_concurrency_limit=$2,run_timeout_seconds=$3 WHERE id=$1 RETURNING *',
      [p.organizationId, concurrency, timeout],
    )
  ).rows[0];
  await audit(tx, p, 'execution_policy.updated', p.organizationId, {
    concurrency_limit: concurrency,
    max_timeout_seconds: timeout,
  });
  return executionPolicy(updated);
}
