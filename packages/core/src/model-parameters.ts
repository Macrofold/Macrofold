import type { components } from '../../contracts/api';
import { assert } from './errors';

export type ModelParameters = components['schemas']['ModelParameters'];
export const museContributorModel = 'meta/muse-spark-1.3-contributor';

export function validateModelParameters(parameters: ModelParameters | undefined, provider: string, model: string) {
  if (parameters === undefined) return;
  assert(
    provider === 'openrouter' && model !== 'typesafe/jev-1.13',
    400, 'unsupported_model_parameters', 'Model parameters require an OpenRouter chat model.',
  );
  assert(
    !parameters.reasoning || parameters.provider?.require_parameters !== false,
    400, 'unsupported_model_parameters', 'Reasoning effort requires strict provider parameter support.',
  );
  assert(
    model !== museContributorModel ||
      (parameters.reasoning?.effort !== 'none' && parameters.reasoning?.effort !== 'max'),
    400, 'unsupported_model_parameters',
    'Muse Spark Contributor supports minimal, low, medium, high, and xhigh reasoning effort.',
  );
}
