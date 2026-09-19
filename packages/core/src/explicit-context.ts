import Ajv from 'ajv/dist/2020.js';
import type { AnySchema } from 'ajv';
import { assert } from './errors';
import { canonical, sha256 } from './crypto';
import type { ExplicitContext, InferenceDefinition } from './decision';

function configuredLimit(name: string, ceiling: number) {
  const value = Number(process.env[name] ?? ceiling);
  assert(
    Number.isSafeInteger(value) && value > 0 && value <= ceiling,
    500,
    'invalid_context_limits',
    `${name} must be a positive integer no greater than ${ceiling}.`,
  );
  return value;
}
// Operators may lower deployment bounds. Raising the reviewed API ceilings
// requires contract/provider acceptance rather than an unchecked environment flag.
export const contextLimits = {
  get inputBytes() {
    return configuredLimit('DECISION_INPUT_MAX_BYTES', 256 * 1024);
  },
  get totalBytes() {
    return configuredLimit('DECISION_CONTEXT_MAX_BYTES', 2 * 1024 * 1024);
  },
  get items() {
    return configuredLimit('DECISION_CONTEXT_MAX_ITEMS', 64);
  },
};
export const digest = (value: unknown) => sha256(canonical(value));

/** Deliberately finite JSON Schema subset. No references, regexes, dynamic
 * schemas or combinatorial alternatives supplied by an untrusted caller. */
const keywords = new Set([
  'type',
  'properties',
  'items',
  'required',
  'additionalProperties',
  'enum',
  'const',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'description',
  'title',
]);
export function schemaValidator(schema: Record<string, unknown>) {
  let nodes = 0;
  function visit(value: unknown, depth: number): void {
    assert(
      value && typeof value === 'object' && !Array.isArray(value),
      400,
      'invalid_schema',
      'Use an object schema.',
    );
    assert(
      ++nodes <= 128 && depth <= 8,
      400,
      'schema_too_complex',
      'Keep schemas within 128 nodes and eight levels.',
    );
    for (const [key, child] of Object.entries(value)) {
      assert(keywords.has(key), 400, 'unsupported_schema_keyword', `Schema keyword ${key} is not supported.`);
      if (key === 'properties') {
        assert(
          child && typeof child === 'object' && !Array.isArray(child),
          400,
          'invalid_schema',
          'Properties must be an object.',
        );
        for (const property of Object.values(child)) visit(property, depth + 1);
      } else if (key === 'items' || (key === 'additionalProperties' && typeof child !== 'boolean'))
        visit(child, depth + 1);
    }
  }
  assert(
    Buffer.byteLength(canonical(schema)) <= 32768,
    400,
    'schema_too_large',
    'A schema may contain at most 32 KiB.',
  );
  visit(schema, 0);
  try {
    // No coercion/defaults/removal: validation cannot change the submitted evidence.
    return new Ajv({ strict: true, allErrors: false, ownProperties: true }).compile(schema as AnySchema);
  } catch {
    assert(false, 400, 'invalid_schema', 'The definition contains an invalid JSON Schema.');
  }
}

export function validateContext(definition: InferenceDefinition, input: unknown, context: ExplicitContext) {
  assert(
    Buffer.byteLength(canonical(input)) <= contextLimits.inputBytes,
    413,
    'input_too_large',
    'Inline input exceeds the deployment byte limit.',
  );
  validateEvidence(context);
  assert(
    schemaValidator(definition.input_schema)(input),
    400,
    'input_schema_mismatch',
    'Input does not match the definition.',
  );
  schemaValidator(definition.output_schema);
  const items = new Map(context.items.map((item) => [item.id, item]));
  for (const required of definition.required_records || [])
    assert(
      items.has(required),
      400,
      'required_context_missing',
      `Required context record ${required} is absent.`,
    );
  for (const required of definition.required_known || [])
    assert(
      items.get(required)?.status === 'known',
      400,
      'required_context_unknown',
      `Required context value ${required} is not known.`,
    );
  validateConsistency(definition, context);
}

export function validateConsistency(definition: InferenceDefinition, context: ExplicitContext) {
  assert(
    !definition.require_complete || (context.complete && !context.truncated),
    400,
    'context_incomplete',
    'This definition requires complete, untruncated context.',
  );
  assert(
    !definition.require_snapshot || context.consistency === 'snapshot',
    400,
    'context_not_snapshot',
    'This definition requires a consistent snapshot.',
  );
}

export function validateEvidence(context: ExplicitContext) {
  assert(
    Buffer.byteLength(canonical(context)) <= contextLimits.totalBytes &&
      context.items.length <= contextLimits.items,
    413,
    'context_too_large',
    'Context exceeds the item or byte limit.',
  );
  assert(
    new Set(context.items.map((item) => item.id)).size === context.items.length,
    400,
    'duplicate_evidence',
    'Context item IDs must be unique.',
  );
  for (const item of context.items)
    assert(
      item.status !== 'known' || Object.hasOwn(item, 'value'),
      400,
      'known_value_missing',
      'Known evidence requires an explicit value.',
    );
  assert(
    context.consistency !== 'read_interval' ||
      (context.read_completed_at && Date.parse(context.read_completed_at) >= Date.parse(context.observed_at)),
    400,
    'invalid_read_interval',
    'Supply the observation interval end.',
  );
  assert(
    !context.expires_at || Date.parse(context.expires_at) > Date.now(),
    409,
    'stale_input',
    'Context has expired. Submit a fresh snapshot.',
  );
}
