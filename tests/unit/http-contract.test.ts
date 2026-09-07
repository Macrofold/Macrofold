import { describe, expect, it } from 'vitest';
import cliContract from '../../docs/api/cli.json';
import { apiSpec, routes, matchRoute } from '../../packages/core/src/http-contract';

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
