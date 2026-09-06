import { afterAll, describe, expect, it, vi } from 'vitest';
import { requireProject, requireScopes, type Principal } from '../../packages/core/src/auth';
import { authPool, pool } from '../../packages/db';

// Exercise our pure permission rules without starting Better Auth's database bootstrap.
vi.mock('better-auth', () => ({ betterAuth: () => ({}) }));

const principal: Principal = {
  id: 'member',
  userId: 'member',
  organizationId: 'organization',
  kind: 'user',
  role: 'owner',
  scopes: ['projects:read', 'projects:write', 'projects:delete'],
  projectIds: [],
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
      expect(() => requireScopes({ ...principal, role }, ['projects:read'])).not.toThrow();
    },
  );
  it.each(['owner', 'admin', 'member'] as const)(
    '%s can use an explicitly granted mutation scope',
    (role) => {
      expect(() =>
        requireScopes({ ...principal, role }, ['projects:write', 'projects:delete']),
      ).not.toThrow();
    },
  );
  it.each(['projects:write', 'projects:delete'])(
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
      expect(() => requireScopes({ ...principal, role, scopes: [] }, ['projects:read'])).toThrow(
        expect.objectContaining({ status: 403, code: 'forbidden' }),
      );
    },
  );
  it('requires every requested scope, including when the first scope is granted', () => {
    expect(() => requireScopes(principal, ['projects:read', 'billing:write'])).toThrow(
      expect.objectContaining({ code: 'forbidden' }),
    );
  });
  it('does not let operator designation replace a required customer scope', () => {
    expect(() => requireScopes({ ...principal, operator: true, scopes: [] }, ['projects:read'])).toThrow();
  });
});

describe('project restrictions', () => {
  it('allows an unrestricted principal to proceed to the tenant resource lookup', () => {
    expect(() => requireProject(principal, 'project')).not.toThrow();
  });
  it('accepts a project anywhere in the credential allowlist', () => {
    expect(() => requireProject({ ...principal, projectIds: ['first', 'second'] }, 'second')).not.toThrow();
  });
  it('hides projects outside the allowlist, including from organization owners', () => {
    expect(() => requireProject({ ...principal, projectIds: ['first'] }, 'second')).toThrow(
      expect.objectContaining({ status: 404, code: 'not_found' }),
    );
  });
});
