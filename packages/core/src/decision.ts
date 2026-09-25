import { modelInputBound } from './model-content';
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
  stream?: boolean;
  modelParameters?: import('./model-parameters').ModelParameters;
  definition: InferenceDefinition;
  input: unknown;
  context: ResolvedContext;
  maxOutputTokens: number;
  rates: Pick<ModelRequestBounds, 'inputMicroUsdPerMillion' | 'outputMicroUsdPerMillion'>;
  steps?: { artifact_id: string; context: ExplicitContext }[];
};
export type DecisionResponse = {
  incomplete?: string;
  /** Assembled streaming output retained when typed parsing would lose original
   * text (including invalid JSON). Sealed evidence for tracing, never authority. */
  providerResponse?: unknown;
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
    nativeResponse?: boolean,
    output?: InferenceOutputSink,
  ): Promise<DecisionResponse>;
}

/** Conservative billing reservation only, not a tokenizer or context-window check.
 * Share native media bounds with the gateway instead of pricing remote content as URL text.
 * Providers enforce their actual model/tokenizer-specific context limits. */
export function inferenceInputBound(
  body: Record<string, unknown>,
  provider: string,
  model: string,
  native: boolean,
) {
  return native && provider !== 'typesafe' && model !== 'typesafe/jev-1.13'
    ? modelInputBound(body, {
        provider,
        model,
        harness: provider === 'anthropic' ? 'claude-code' : 'opencode',
      })
    : Buffer.byteLength(JSON.stringify(body)) + 1024;
}

/** Transport-neutral fragments. Partial tool arguments are never executable authority. */
export type InferenceOutput = {
  type:
    'output.started' | 'output.delta' | 'output.finished' | 'output.refusal.delta' | 'tool.arguments.delta';
  data: {
    invocation_id?: string;
    message_id: string;
    content_index: number;
    choice_index?: number;
    tool_call_id?: string;
    text?: string;
    stop_reason?: string;
  };
};
export type InferenceOutputSink = (event: InferenceOutput) => void | Promise<void>;
