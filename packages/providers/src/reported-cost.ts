import type { ModelUsage } from '../../core/src/model-protocol';

/** OpenRouter usage.cost is its account charge; upstream cost is a separate
 * fact (not an amount to add to it). Neither replaces Macrofold's retail charge. */
export function reportedCost(
  usage: unknown,
): Pick<ModelUsage, 'providerReportedCostUsd' | 'upstreamInferenceCostUsd'> {
  if (!usage || typeof usage !== 'object') return {};
  const value = usage as Record<string, unknown>;
  const details = value.cost_details as Record<string, unknown> | null | undefined;
  const amount = (input: unknown) => typeof input === 'number' && Number.isFinite(input) && input >= 0;
  return {
    ...(amount(value.cost) ? { providerReportedCostUsd: value.cost as number } : {}),
    ...(amount(details?.upstream_inference_cost)
      ? { upstreamInferenceCostUsd: details!.upstream_inference_cost as number }
      : {}),
  };
}
