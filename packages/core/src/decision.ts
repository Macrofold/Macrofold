import { modelInputBound } from './model-content';
import { decisionOnlyModel } from './decision-models';
import type { components } from '../../contracts/api';
import type { ModelRequestBounds, ModelUsage } from './model-protocol';
import { AppError } from './errors';

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
  /** Actual upstream transport status, independent of normalized outcome. */
  httpStatus?: number;
  /** Trusted transport completion time, captured before provider normalization. */
  completedAt?: string;
  /** Same-process monotonic completion marker; never compare across hosts. */
  completedAtMonotonicMs?: number;
  incomplete?: string;
  /** Provider output retained when typed parsing would lose original
   * text (including invalid JSON). Sealed evidence for tracing, never authority. */
  providerResponse?: unknown;
  value: unknown;
  refused: boolean;
  evidence?: { confidence?: number; probabilities?: Record<string, number> };
  usage: ModelUsage;
  requestId: string | null;
  modelRevision: string | null;
};
/** Bounded transport evidence survives normalization failure. Only invocation
 * storage may retain this customer content; public errors must not expose it. */
export type ProviderEvidence = {
  response: unknown;
  httpStatus: number;
  requestId: string | null;
  modelRevision: string | null;
  usage: ModelUsage;
  complete: boolean;
  completedAt: string | null;
  completedAtMonotonicMs: number | null;
};
export class DecisionProviderError extends AppError {
  #evidence: ProviderEvidence;
  constructor(code: string, message: string, evidence: ProviderEvidence) {
    // Raw bodies are deliberately separate from serializable public error details.
    super(502, code, message);
    this.#evidence = evidence;
  }
  get evidence(): ProviderEvidence {
    return this.#evidence;
  }
}
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
  /** Optional transient diagnostics are not authority. Complete but malformed
   * responses throw DecisionProviderError with independently validated evidence. */
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
  serialized?: string,
) {
  return native && !decisionOnlyModel(provider, model)
    ? modelInputBound(body, {
        provider,
        model,
        harness: provider === 'anthropic' ? 'claude-code' : 'opencode',
      })
    : Buffer.byteLength(serialized ?? JSON.stringify(body)) + 1024;
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
