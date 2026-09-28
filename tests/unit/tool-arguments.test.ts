import { expect, it } from 'vitest';
import { validateToolArguments } from '../../packages/core/src/tool-arguments';
import { errorBody } from '../../packages/core/src/errors';

const handleSchema = {
  type: 'object',
  properties: { contextHandle: { type: 'string', minLength: 32, maxLength: 256 } },
  additionalProperties: false,
};

it.each([
  undefined,
  'http://json-schema.org/draft-07/schema#',
  'https://json-schema.org/draft/2020-12/schema',
  'https://json-schema.org/draft/2020-12/schema#',
])('validates optional bounded handles without changing arguments (%s)', ($schema) => {
  const schema = { ...handleSchema, ...($schema ? { $schema } : {}) };
  for (const args of [{}, { contextHandle: 'a'.repeat(32) }, { contextHandle: 'a'.repeat(256) }]) {
    expect(validateToolArguments(schema, args)).toBeUndefined();
  }
  for (const args of [
    { contextHandle: 'a'.repeat(31) },
    { contextHandle: 'a'.repeat(257) },
    { contextHandle: 123 },
    { unexpected: 'value' },
  ]) {
    const before = structuredClone(args);
    expect(() => validateToolArguments(schema, args)).toThrowError(
      expect.objectContaining({ status: 400, code: 'invalid_tool_arguments' }),
    );
    expect(args).toEqual(before);
  }
});

it.each([
  {
    $schema: 'http://json-schema.org/draft-07/schema#',
    tuple: { items: [{ type: 'string' }], additionalItems: false },
  },
  {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    tuple: { prefixItems: [{ type: 'string' }], items: false },
  },
])('enforces the dialect-specific tuple keywords ($schema)', ({ $schema, tuple }) => {
  const schema = { $schema, type: 'object', properties: { values: { type: 'array', ...tuple } } };
  expect(validateToolArguments(schema, { values: ['first'] })).toBeUndefined();
  for (const values of [[1], ['first', 'extra']]) {
    expect(() => validateToolArguments(schema, { values })).toThrowError(
      expect.objectContaining({ code: 'invalid_tool_arguments' }),
    );
  }
});

it('enforces 2020-12 references and unevaluated properties across composed schemas', () => {
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    $defs: { handle: { type: 'string', minLength: 32 } },
    allOf: [{ properties: { contextHandle: { $ref: '#/$defs/handle' } } }],
    unevaluatedProperties: false,
  };
  expect(validateToolArguments(schema, { contextHandle: 'a'.repeat(32) })).toBeUndefined();
  expect(() => validateToolArguments(schema, { extra: true })).toThrowError(
    expect.objectContaining({ code: 'invalid_tool_arguments' }),
  );
});

it.each([
  { ...handleSchema, $schema: 'https://fixture.invalid/unsupported-dialect' },
  { type: 'object', properties: { private_field: { type: 'not-a-type' } } },
  { ...handleSchema, $async: true },
  { type: 'object', $ref: 'https://fixture.invalid/missing-schema' },
])('returns a safe schema error without skipping validation (%j)', (schema) => {
  let error: unknown;
  try {
    validateToolArguments(schema, {});
  } catch (caught) {
    error = caught;
  }
  expect(errorBody(error, 'fixture-request')).toMatchObject({
    status: 502,
    body: { error: { code: 'invalid_tool_schema', details: {} } },
  });
  expect(errorBody(error, 'fixture-request').body.error.message).not.toContain('private_field');
});

it('isolates repeated schema IDs and rejects references to another connection schema', () => {
  const first = { ...handleSchema, $id: 'https://fixture.invalid/shared', required: ['contextHandle'] };
  const second = {
    $id: first.$id,
    type: 'object',
    properties: { count: { type: 'integer' } },
    additionalProperties: false,
  };
  expect(validateToolArguments(first, { contextHandle: 'a'.repeat(32) })).toBeUndefined();
  expect(validateToolArguments(second, { count: 1 })).toBeUndefined();
  expect(() => validateToolArguments(first, { count: 1 })).toThrowError(
    expect.objectContaining({ code: 'invalid_tool_arguments' }),
  );
  expect(() => validateToolArguments({ type: 'object', $ref: first.$id }, {})).toThrowError(
    expect.objectContaining({ code: 'invalid_tool_schema' }),
  );
});
