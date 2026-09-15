import { describe, expect, it } from 'vitest';
import cliContract from '../../docs/api/cli.json';
import { apiSpec, routes, matchRoute, projectResponse } from '../../packages/core/src/http-contract';

describe('API path decoding', () => {
  it.each(['%', '%ZZ', '%E0%A4'])('rejects malformed escape %s as a client error', (value) => {
    expect(() => matchRoute(new Request(`https://example.test/v1/projects/${value}`))).toThrow(
      expect.objectContaining({ status: 400, code: 'invalid_request' }),
    );
  });

  it('decodes a valid path parameter once', () => {
    expect(matchRoute(new Request('https://example.test/v1/projects/project%2520name')).params).toEqual({
      project_id: 'project%20name',
    });
  });
});

it('preserves open operation metadata while projecting typed file entries and closed resource fields', () => {
  const result = projectResponse(
    {
      id: crypto.randomUUID(),
      status: 'succeeded',
      kind: 'file_rename',
      created_at: new Date().toISOString(),
      required_scopes: ['files:read'],
      project_id: 'private-binding',
      result: {
        project_id: 'public-result-id',
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
  expect(result).not.toHaveProperty('project_id');
  expect(result).toHaveProperty('result.project_id', 'public-result-id');
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
