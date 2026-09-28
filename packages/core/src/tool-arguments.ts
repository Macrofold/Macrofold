import Ajv, { type ValidateFunction } from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import type { components } from '../../contracts/api';
import { AppError, assert } from './errors';

type InputSchema = components['schemas']['Tool']['input_schema'];
const draft7 = new Ajv({ strict: false, addUsedSchema: false });
const draft2020 = new Ajv2020({ strict: false, addUsedSchema: false });
const validators = new WeakMap<InputSchema, ValidateFunction>();

/** Validate before reserving funds or dispatching any external action. */
export function validateToolArguments(schema: InputSchema, args: Record<string, unknown>): void {
  let validate = validators.get(schema);
  if (!validate) {
    // Draft 2020 changes keyword semantics; registering only its meta-schema on draft 7 is unsafe.
    // See docs/features/identity-integrations/tools-security.md#tool-input-schemas.
    const ajv =
      schema.$schema === 'https://json-schema.org/draft/2020-12/schema' ||
      schema.$schema === 'https://json-schema.org/draft/2020-12/schema#'
        ? draft2020
        : draft7;
    try {
      validate = ajv.compile(schema);
      if ('$async' in validate && validate.$async) throw new Error('Async tool schemas are unsupported');
      validators.set(schema, validate);
    } catch {
      // Compiler errors can contain private schema content. Return a useful, safe boundary error.
      throw new AppError(
        502,
        'invalid_tool_schema',
        'The connector returned an invalid or unsupported input schema. Ask its maintainer to provide a self-contained JSON Schema using draft-7 or draft 2020-12.',
      );
    } finally {
      // Discovery creates fresh objects. Keep only weak references, and never share remote $ids
      // between connections; local $refs within each compiled schema continue to work.
      ajv.removeSchema();
    }
  }
  assert(validate(args), 400, 'invalid_tool_arguments', 'Tool arguments do not match the connector schema.');
}
