import Ajv from 'ajv/dist/2020.js';
import { afterEach, expect, it, vi } from 'vitest';
import { decisionExample } from '../../examples/decisions/contracts';
import {
  initializeHttpValidation,
  matchRoute,
  operationParameters,
  routes,
  validateBody,
  validateParameters,
} from '../../packages/core/src/http-contract';
import {
  initializeContextValidation,
  schemaValidator,
  validateContext,
} from '../../packages/core/src/explicit-context';

afterEach(() => vi.restoreAllMocks());

it('prepares shipped request schemas once and reuses registered component validators', () => {
  const expected = new Set<string>();
  for (const { operation } of routes) {
    for (const parameter of operationParameters(operation)) expected.add(JSON.stringify(parameter.schema));
    const body = operation.requestBody?.content['application/json']?.schema;
    if (body) expected.add(JSON.stringify(body));
  }
  const compile = vi.spyOn(Ajv.prototype, 'compile');
  const getSchema = vi.spyOn(Ajv.prototype, 'getSchema');
  initializeHttpValidation();
  const compiled = new Set(
    compile.mock.calls.map(([schema]) => {
      const requestSchema = { ...(schema as Record<string, unknown>) };
      delete requestSchema.components;
      return JSON.stringify(requestSchema);
    }),
  );
  const referenced = [...expected].filter((key) => {
    const schema = JSON.parse(key);
    return Object.keys(schema).length === 1 && typeof schema.$ref === 'string';
  });
  expect(compiled).toEqual(new Set([...expected].filter((key) => !referenced.includes(key))));
  for (const key of referenced) expect(getSchema).toHaveBeenCalledWith(`platform${JSON.parse(key).$ref}`);
  expect(compile).toHaveBeenCalledTimes(expected.size - referenced.length);
  const lookupCount = getSchema.mock.calls.length;

  const request = new Request('https://example.test/v1/inferences', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'readiness-fixture' },
  });
  const { operation, params } = matchRoute(request);
  const body = decisionExample(crypto.randomUUID(), 'triage');
  expect(() => validateParameters(operation, request, params)).not.toThrow();
  expect(() => validateBody(operation, body, false)).not.toThrow();
  const invalid = { ...body, unexpected: true };
  const original = JSON.stringify(invalid);
  expect(() => validateBody(operation, invalid, false)).toThrow(
    expect.objectContaining({ status: 400, code: 'invalid_request' }),
  );
  expect(JSON.stringify(invalid)).toBe(original);
  request.headers.set('X-Organization-Id', 'invalid-uuid');
  expect(() => validateParameters(operation, request, params)).toThrow(
    expect.objectContaining({ status: 400, code: 'invalid_request' }),
  );
  initializeHttpValidation();
  expect(compile).toHaveBeenCalledTimes(expected.size - referenced.length);
  expect(getSchema).toHaveBeenCalledTimes(lookupCount);
});

it('retains inline constraints, reference siblings, and missing-reference failures', () => {
  const inline = matchRoute(
    new Request(`https://example.test/v1/worktrees/${crypto.randomUUID()}/sync`, { method: 'POST' }),
  ).operation;
  expect(() => validateBody(inline, { mode: 'pull_request' }, false)).not.toThrow();
  expect(() => validateBody(inline, { mode: 'unknown' }, false)).toThrow(
    expect.objectContaining({ status: 400, code: 'invalid_request' }),
  );
  expect(() => validateBody(inline, { mode: 1 }, false)).toThrow(
    expect.objectContaining({ status: 400, code: 'invalid_request' }),
  );
  const operation = matchRoute(
    new Request('https://example.test/v1/inferences', { method: 'POST' }),
  ).operation;
  const body = decisionExample(crypto.randomUUID(), 'triage');
  const constrained = {
    ...operation,
    requestBody: {
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/InferenceCreate', maxProperties: 1 } },
      },
    },
  };
  expect(() => validateBody(constrained, body, false)).toThrow(
    expect.objectContaining({ status: 400, code: 'invalid_request' }),
  );
  const missing = {
    ...operation,
    requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Missing' } } } },
  };
  expect(() => validateBody(missing, {}, false)).toThrow(/can't resolve reference/);
});

it('initializes the built-in meta validator without filling or weakening the customer schema cache', () => {
  const meta = vi.spyOn(Ajv.prototype, 'getSchema');
  const compile = vi.spyOn(Ajv.prototype, 'compile');
  initializeContextValidation();
  expect(meta).toHaveBeenCalledWith('https://json-schema.org/draft/2020-12/schema');
  expect(compile).not.toHaveBeenCalled();

  const example = decisionExample(crypto.randomUUID(), 'triage');
  expect(() => validateContext(example.definition, example.input, example.context)).not.toThrow();
  const cached = schemaValidator(example.definition.input_schema);
  initializeContextValidation();
  expect(schemaValidator(example.definition.input_schema)).toBe(cached);
  const invalid = { ...(example.input as Record<string, unknown>), unexpected: true };
  expect(() => validateContext(example.definition, invalid, example.context)).toThrow(
    expect.objectContaining({ status: 400, code: 'input_schema_mismatch' }),
  );
  expect(invalid).toHaveProperty('unexpected', true);
  expect(() => schemaValidator({ $ref: 'https://untrusted.example/schema' })).toThrow(
    expect.objectContaining({ status: 400, code: 'unsupported_schema_keyword' }),
  );
});
