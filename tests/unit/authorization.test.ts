import { afterAll, describe, expect, it, vi } from 'vitest';
import { requireWorkspace, requireScopes, type Principal } from '../../packages/core/src/auth';
import { authPool, pool } from '../../packages/db';

// Exercise our pure permission rules without starting Better Auth's database bootstrap.
vi.mock('better-auth', () => ({ betterAuth: () => ({}) }));

const principal: Principal = {
  id: 'member',
  userId: 'member',
  organizationId: 'organization',
  kind: 'user',
  role: 'owner',
  scopes: ['workspaces:read', 'workspaces:write', 'workspaces:delete'],
  workspaceIds: [],
  operator: false,
};
afterAll(async () => {
  await pool.end();
  await authPool.end();
});

describe('role and credential authority intersect', () => {
  it.each(['owner', 'admin', 'member', 'viewer'] as const)(
    '%s can use an explicitly granted read scope',
    (role) => {
      expect(() => requireScopes({ ...principal, role }, ['workspaces:read'])).not.toThrow();
    },
  );
  it.each(['owner', 'admin', 'member'] as const)(
    '%s can use an explicitly granted mutation scope',
    (role) => {
      expect(() =>
        requireScopes({ ...principal, role }, ['workspaces:write', 'workspaces:delete']),
      ).not.toThrow();
    },
  );
  it.each(['workspaces:write', 'workspaces:delete'])(
    'viewer cannot use %s even if a credential grants it',
    (scope) => {
      expect(() => requireScopes({ ...principal, role: 'viewer' }, [scope])).toThrow(
        expect.objectContaining({ status: 403, code: 'forbidden' }),
      );
    },
  );
  it.each(['owner', 'admin', 'member', 'viewer'] as const)(
    '%s cannot substitute its role for a missing credential scope',
    (role) => {
      expect(() => requireScopes({ ...principal, role, scopes: [] }, ['workspaces:read'])).toThrow(
        expect.objectContaining({ status: 403, code: 'forbidden' }),
      );
    },
  );
  it('requires every requested scope, including when the first scope is granted', () => {
    expect(() => requireScopes(principal, ['workspaces:read', 'billing:write'])).toThrow(
      expect.objectContaining({ code: 'forbidden' }),
    );
  });
  it('does not let operator designation replace a required customer scope', () => {
    expect(() => requireScopes({ ...principal, operator: true, scopes: [] }, ['workspaces:read'])).toThrow();
  });
});

describe('workspace restrictions', () => {
  it('allows an unrestricted principal to proceed to the tenant resource lookup', () => {
    expect(() => requireWorkspace(principal, 'workspace')).not.toThrow();
  });
  it('accepts a workspace anywhere in the credential allowlist', () => {
    expect(() => requireWorkspace({ ...principal, workspaceIds: ['first', 'second'] }, 'second')).not.toThrow();
  });
  it('hides workspaces outside the allowlist, including from organization owners', () => {
    expect(() => requireWorkspace({ ...principal, workspaceIds: ['first'] }, 'second')).toThrow(
      expect.objectContaining({ status: 404, code: 'not_found' }),
    );
  });
});
