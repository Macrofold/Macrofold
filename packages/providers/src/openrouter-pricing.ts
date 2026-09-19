import type { ModelRequestBounds } from '../../core/src/model-protocol';

/** OpenRouter chat and decisions share USD/million-token routing ceilings.
 * Only token charges are supported; separately billed requests are excluded. */
export function openRouterPriceCeiling(
  rates: Pick<ModelRequestBounds, 'inputMicroUsdPerMillion' | 'outputMicroUsdPerMillion'>,
) {
  return {
    prompt: Number(rates.inputMicroUsdPerMillion) / 1_000_000,
    completion: Number(rates.outputMicroUsdPerMillion) / 1_000_000,
    request: 0,
  };
}
