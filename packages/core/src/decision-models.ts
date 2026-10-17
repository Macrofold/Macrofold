import type { Model } from './catalog';
import { modelPolicy } from './model-policy';
import { assert } from './errors';
import type { DecisionBinding } from './decision';

// These routes share the SystemOne/Decisions scoring protocol, not chat or
// native harness capabilities. Keep routing and reviewed billing policy together.
const decisionOnlyModels: readonly Model[] = [
  {
    id: 'jev-1.13.0',
    name: 'Jev 1.13',
    provider: 'typesafe',
    harnesses: [],
    input_micro_usd_per_million: '42000',
    output_micro_usd_per_million: '0',
    enabled: true,
  },
  {
    id: 'typesafe/jev-1.13',
    name: 'Jev 1.13',
    provider: 'openrouter',
    harnesses: [],
    input_micro_usd_per_million: '42000',
    output_micro_usd_per_million: '0',
    enabled: true,
  },
  {
    id: 'microsoft/microsoft-decision-1',
    name: 'Microsoft Decision 1',
    provider: 'openrouter',
    harnesses: [],
    // Reviewed October 15, 2026; source and protocol in docs/projects/decision-model-routing.md.
    input_micro_usd_per_million: '42000',
    output_micro_usd_per_million: '0',
    enabled: true,
  },
];

export function decisionOnlyModel(provider: string, model: string): Model | undefined {
  return decisionOnlyModels.find((entry) => entry.provider === provider && entry.id === model);
}

/** Decision eligibility is independent of native harness context/tool floors.
 * These exact routes have reviewed protocols and explicit retail rates. */
export function decisionModel(binding: DecisionBinding, catalog: Model[] = []): Model {
  const model =
    decisionOnlyModel(binding.provider, binding.model) ??
    (binding.provider === 'anthropic'
      ? modelPolicy.find((entry) => entry.provider === 'anthropic' && entry.id === binding.model)
      : binding.provider === 'openrouter'
        ? catalog.find((entry) => entry.provider === binding.provider && entry.id === binding.model)
        : undefined);
  assert(
    model && model.id === binding.model && model.enabled,
    400,
    'decision_model_unavailable',
    'Choose an enabled model with configured billing rates.',
  );
  return { ...model, harnesses: [] };
}
