/** Provider-neutral token counts. Input includes cached reads and cache writes;
 * cacheWrite is a subset charged at the published additional input rate. */
export type ModelUsage = {
  input: number;
  output: number;
  cached: number;
  cacheWrite: number;
  complete: boolean;
  /** Independently verified counts when the full usage record is incomplete.
   * An absent count remains unknown, including when its placeholder is zero. */
  known?: Partial<Record<'input' | 'output' | 'cached' | 'cacheWrite', boolean>>;
  /** Diagnostic USD amounts reported by the provider, never customer settlement.
   * Omitted means unknown; retain sub-micro-dollar precision and genuine zero. */
  providerReportedCostUsd?: number;
  upstreamInferenceCostUsd?: number;
};
export const emptyUsage = (): ModelUsage => ({
  input: 0,
  output: 0,
  cached: 0,
  cacheWrite: 0,
  complete: false,
});

export type ModelRequestBounds = {
  modelParameters?: import('./model-parameters').ModelParameters;
  maxOutput: number;
  inputMicroUsdPerMillion: string;
  outputMicroUsdPerMillion: string;
};

/** Wire adaptation only. Authority, credentials selection, reservations, settlement
 * and the set of billable dimensions stay in the gateway. Unknown tools must fail closed. */
export interface ModelProtocol {
  readonly base: string;
  readonly paths: readonly string[];
  readonly cacheWrites: boolean;
  prepare(payload: Record<string, unknown>, path: string, bounds: ModelRequestBounds): void;
  headers(secret: string, incoming: Headers): Record<string, string>;
  usage(event: Record<string, unknown>, previous: ModelUsage): ModelUsage;
}
