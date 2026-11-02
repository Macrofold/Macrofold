import type { NativeModelLimits } from '../../contracts/native-model';
import { assert } from './errors';
import { hasModelTokenLimits, type Model } from './model-policy';
import { museContributorModel, type ModelParameters } from './model-parameters';

function modelCaps(model: Model | undefined) {
  assert(
    hasModelTokenLimits(model),
    503,
    'model_limits_unavailable',
    'The selected model has no verified token limits. Refresh the model catalog.',
  );
  return { context: model.context_tokens, output: model.output_tokens, input: model.input_tokens };
}

export function resolveNativeOutputTokens(
  model: Model,
  parameters: ModelParameters | undefined,
  requested: unknown,
) {
  const caps = modelCaps(model);
  if (requested !== undefined) {
    assert(
      typeof requested === 'number' &&
        Number.isSafeInteger(requested) &&
        requested > 0 &&
        requested <= caps.output,
      400,
      'invalid_request',
      'Maximum output tokens must be a positive integer within the selected model limit.',
      { field: 'limits.max_output_tokens', maximum: caps.output },
    );
    return requested;
  }
  // Reasoning shares output space. Leave answer room without reserving the model's
  // entire window: docs/projects/native-output-budget-tech-design.md#allowance-policy.
  const effort = parameters?.reasoning?.effort;
  const reasoning = effort ? ['high', 'xhigh', 'max'].includes(effort) : model.id === museContributorModel;
  return Math.min(reasoning ? 65536 : 32768, caps.output);
}

export function nativeModelLimits(
  model: Model | undefined,
  maxOutputTokens: number | undefined,
): NativeModelLimits {
  const caps = modelCaps(model);
  assert(
    maxOutputTokens &&
      Number.isSafeInteger(maxOutputTokens) &&
      maxOutputTokens > 0 &&
      maxOutputTokens <= caps.output,
    503,
    'model_limits_unavailable',
    'The Run has no accepted native output allowance.',
  );
  return { contextTokens: caps.context, ...(caps.input ? { inputTokens: caps.input } : {}), maxOutputTokens };
}
