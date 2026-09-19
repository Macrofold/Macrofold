import type { Model } from './catalog';
import { modelPolicy } from './model-policy';
import { assert } from './errors';
import type { DecisionBinding } from './decision';

/** Decision eligibility is independent of native harness context/tool floors.
 * These exact routes have reviewed protocols and explicit retail rates. */
export function decisionModel(binding: DecisionBinding): Model {
  const model =
    binding.provider !== 'anthropic'
      ? {
          id: binding.provider === 'openrouter' ? 'typesafe/jev-1.13' : 'jev-1.13.0',
          name: 'Jev 1.13',
          provider: binding.provider,
          harnesses: [],
          input_micro_usd_per_million: '42000',
          output_micro_usd_per_million: '0',
          enabled: true,
        }
      : modelPolicy.find((entry) => entry.provider === 'anthropic' && entry.id === binding.model);
  assert(
    model && model.id === binding.model && model.enabled,
    400,
    'decision_model_unavailable',
    'Choose an explicitly supported decision model; mutable provider aliases are not accepted.',
  );
  return { ...model, harnesses: [] };
}
