import { describe, expect, it } from 'vitest';
import cliContract from '../../docs/api/cli.json';
import { apiSpec, routes, matchRoute, workspaceResponse } from '../../packages/core/src/http-contract';

describe('API path decoding', () => {
  it.each(['%', '%ZZ', '%E0%A4'])('rejects malformed escape %s as a client error', (value) => {
    expect(() => matchRoute(new Request(`https://example.test/v1/workspaces/${value}`))).toThrow(
      expect.objectContaining({ status: 400, code: 'invalid_request' }),
    );
  });

  it('decodes a valid path parameter once', () => {
    expect(matchRoute(new Request('https://example.test/v1/workspaces/workspace%2520name')).params).toEqual({
      workspace_id: 'workspace%20name',
    });
  });
});

it('preserves open operation metadata while workspaceing typed file entries and closed resource fields', () => {
  const result = workspaceResponse(
    {
      id: crypto.randomUUID(),
      status: 'succeeded',
      kind: 'file_rename',
      created_at: new Date().toISOString(),
      required_scopes: ['files:read'],
      workspace_id: 'private-binding',
      result: {
        workspace_id: 'public-result-id',
        download_url: 'https://objects.example.test/download',
        path: 'renamed.txt',
        previous_path: 'original.txt',
        entry: {
          path: 'renamed.txt',
          type: 'file',
          revision: '4',
          size_bytes: '0',
          key: 'private-object-key',
          mode: 0o600,
        },
      },
    },
    { $ref: '#/components/schemas/Operation' },
  );
  expect(result).not.toHaveProperty('required_scopes');
  expect(result).not.toHaveProperty('workspace_id');
  expect(result).toHaveProperty('result.workspace_id', 'public-result-id');
  expect(result).toHaveProperty('result.download_url', 'https://objects.example.test/download');
  expect(result).toHaveProperty('result.entry', {
    path: 'renamed.txt',
    type: 'file',
    revision: '4',
    size_bytes: '0',
  });
});

it('publishes resolvable security schemes and matching customer scope metadata', () => {
  for (const { operation } of routes) {
    for (const requirement of operation.security || []) {
      for (const name of Object.keys(requirement))
        expect(apiSpec.components.securitySchemes, operation.operationId).toHaveProperty(name);
      if (requirement.CustomerOAuth)
        expect(operation, operation.operationId).toHaveProperty(
          'x-required-scopes',
          requirement.CustomerOAuth,
        );
    }
  }
});

it('keeps CLI consent discovery aligned with the available customer OAuth scopes', () => {
  expect(Object.keys(cliContract.scope_catalog).sort()).toEqual(
    Object.keys(apiSpec.components.securitySchemes.CustomerOAuth.flows.authorizationCode.scopes).sort(),
  );
});
