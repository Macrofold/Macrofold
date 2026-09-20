import type { InferenceCreate, InferenceDefinition, ExplicitContext } from './decision';
import { assert } from './errors';

type PreparedInput = InferenceCreate & {
  definition: NonNullable<InferenceCreate['definition']>;
  context: NonNullable<InferenceCreate['context']>;
};

/** Native requests use the same durable executor without exposing its decision envelope. */
export function normalizeInferenceInput(
  input: InferenceCreate,
  organizationId: string,
  kind: 'inference' | 'bounded_agent' = 'inference',
): PreparedInput {
  if (input.definition) {
    assert(input.context, 400, 'context_required', 'Supply context when using a decision definition.');
    return { ...input, definition: input.definition, context: input.context };
  }
  assert(kind === 'inference', 400, 'definition_required', 'Bounded agents require a definition and context.');
  assert(input.limits, 400, 'limits_required', 'Supply spending, output-token and timeout limits.');
  const definition: InferenceDefinition = {
    revision: 'native-provider/1',
    prompt: 'Native provider request',
    question: { kind: 'provider' },
    input_schema: {},
    output_schema: {},
    allowed_models: [{ provider: input.model_binding.provider, model: input.model_binding.model }],
    limits: input.limits,
  };
  const context: ExplicitContext = {
    schema_version: 1,
    template_revision: 'native-provider/1',
    audience: { kind: 'application', id: input.workspace_id ?? organizationId },
    items: [],
    complete: true,
    truncated: false,
    consistency: 'snapshot',
    observed_at: new Date().toISOString(),
    dependency_tokens: {},
  };
  return { ...input, definition, context: input.context ?? context };
}
