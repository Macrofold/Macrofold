import { describe, expect, it } from 'vitest';
import contract from '../../docs/api/openapi.json';
import { availableKeyPermissions, resolveKeyPermissions } from '../../apps/web/lib/key-permissions';

const customerScopes = Object.keys(
  contract.components.securitySchemes.CustomerOAuth.flows.authorizationCode.scopes,
);
const reads = [
  'identity:read',
  'projects:read',
  'files:read',
  'runs:read',
  'connections:read',
  'usage:read',
  'webhooks:read',
  'organizations:read',
  'triggers:read',
];
const administration = ['billing:write', 'keys:write', 'organizations:write', 'projects:delete'];

describe('API-key permission shortcuts', () => {
  it('read-only includes every supported read permission and no mutations', () => {
    expect(resolveKeyPermissions({ preset: 'read-only' }, customerScopes).sort()).toEqual(reads.sort());
  });
  it('read-write supports ordinary integration work without account administration', () => {
    const scopes = resolveKeyPermissions({ preset: 'read-write' }, customerScopes);
    expect(scopes.sort()).toEqual(
      [
        ...reads,
        'projects:write',
        'files:write',
        'runs:write',
        'connections:write',
        'webhooks:write',
        'triggers:write',
      ].sort(),
    );
    for (const scope of administration) expect(scopes).not.toContain(scope);
  });
  it('full access covers customer API permissions, excluding OAuth refresh and operator authority', () => {
    const scopes = resolveKeyPermissions({ preset: 'full-access' }, [
      ...customerScopes,
      'accounts:pii:read',
      'operations:read',
    ]);
    expect(scopes.sort()).toEqual(customerScopes.filter((scope) => scope !== 'offline_access').sort());
    expect(
      availableKeyPermissions(customerScopes)
        .map(({ scope }) => scope)
        .sort(),
    ).toEqual(scopes);
  });
  it.each(['read-only', 'read-write', 'full-access'] as const)(
    '%s never adds scopes outside current authority',
    (preset) => {
      expect(resolveKeyPermissions({ preset }, ['identity:read', 'files:read'])).toEqual([
        'identity:read',
        'files:read',
      ]);
      expect(resolveKeyPermissions({ preset }, [])).toEqual([]);
    },
  );
  it('custom retains exactly selected, supported, still-authorized scopes without implicit dependencies', () => {
    expect(
      resolveKeyPermissions(
        {
          preset: 'custom',
          scopes: ['files:write', 'files:write', 'keys:write', 'offline_access', 'unknown:read'],
        },
        ['files:read', 'files:write', 'offline_access', 'unknown:read'],
      ),
    ).toEqual(['files:write']);
  });
  it('empty custom selection remains empty', () => {
    expect(resolveKeyPermissions({ preset: 'custom', scopes: [] }, customerScopes)).toEqual([]);
  });
});
