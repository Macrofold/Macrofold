import type { components } from '../../contracts/api';
import type { ModelRequestBounds, ModelUsage } from './model-protocol';

type Schema = components['schemas'];
export type InferenceCreate = Schema['InferenceCreate'];
export type InferenceDefinition = Schema['InferenceDefinition'];
export type ExplicitContext = Schema['ExplicitContext'];
export type InferenceReceipt = Schema['InferenceReceipt'];
export type DecisionBinding = Schema['DecisionBinding'];
export type ResolvedContext = ExplicitContext & {
  organization_id: string;
  workspace_id: string | null;
  application_namespace: string;
  admitted_at: string;
};
export type DecisionRequest = {
  model: string;
  definition: InferenceDefinition;
  input: unknown;
  context: ResolvedContext;
  maxOutputTokens: number;
  rates: Pick<ModelRequestBounds, 'inputMicroUsdPerMillion' | 'outputMicroUsdPerMillion'>;
  steps?: { artifact_id: string; context: ExplicitContext }[];
};
export type DecisionResponse = {
  value: unknown;
  refused: boolean;
  evidence?: { confidence?: number; probabilities?: Record<string, number> };
  usage: ModelUsage;
  requestId: string | null;
  modelRevision: string | null;
};
/** Prepared bodies contain no credentials. Persist their digest before dispatch;
 * replay consumes saved responses and never repeats an ambiguous provider call. */
export interface DecisionProtocol {
  readonly version: string;
  readonly kinds: readonly InferenceDefinition['question']['kind'][];
  readonly maxInputTokens: number;
  readonly capabilities: {
    structuredOutput: boolean;
    brokeredTools: boolean;
    streaming: boolean;
    immutableModelRevision: boolean;
  };
  prepare(request: DecisionRequest): Record<string, unknown>;
  /** Optional transient diagnostics; the raw response is never added to recovery storage. */
  invoke(
    body: Record<string, unknown>,
    secret: string,
    signal: AbortSignal,
    observeResponse?: (response: unknown) => void,
  ): Promise<DecisionResponse>;
}
