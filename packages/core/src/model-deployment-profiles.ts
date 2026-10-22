import type { components } from '../../contracts/api';
import { assert } from './errors';
import type { DeploymentRuntime, ModelDeploymentCapabilities } from './model-deployment-types';

export const servingImage =
  'vllm/vllm-openai:v0.32.0@sha256:6ee133356d49ed24cee03dd0cda3d3980279a11c107ce3e752c89e76540f41c9';
// The application wrapper must be built from this repository before enabling
// managed starts. Never send credentials to the unwrapped upstream image.
export function modelServingImage() {
  const image = process.env.MODEL_SERVING_IMAGE;
  assert(
    image && /^\S+@sha256:[a-f0-9]{64}$/.test(image),
    503,
    'model_runtime_unconfigured',
    'Build and configure the qualified immutable Macrofold model-serving image.',
  );
  return image;
}
export const defaultRuntimeParameters: components['schemas']['ModelDeploymentRuntimeParameters'] = {
  context_window_tokens: 4096,
  max_output_tokens: 1024,
  max_concurrent_requests: 4,
  dtype: 'auto',
  tensor_parallel_size: 1,
  gpu_memory_utilization: 0.9,
};
export function runtimeMemoryFits(
  memoryBytes: string,
  estimatedBytes: string,
  parameters: components['schemas']['ModelDeploymentRuntimeParameters'],
  gpuCount = parameters.tensor_parallel_size ?? 1,
) {
  // vLLM reserves only this fraction of aggregate VRAM for weights and cache.
  // Compare decimal fractions exactly rather than rounding large byte counts.
  const [whole, fraction = ''] = String(parameters.gpu_memory_utilization ?? 0.9).split('.');
  const numerator = BigInt(whole + fraction);
  const denominator = 10n ** BigInt(fraction.length);
  return BigInt(memoryBytes) * BigInt(gpuCount) * numerator >= BigInt(estimatedBytes) * denominator;
}
export const chatParameters = [
  'messages',
  'temperature',
  'top_p',
  'top_k',
  'min_p',
  'max_tokens',
  'max_completion_tokens',
  'frequency_penalty',
  'presence_penalty',
  'repetition_penalty',
  'seed',
  'stop',
  'n',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'response_format',
  'stream',
  'stream_options',
  'logprobs',
  'top_logprobs',
];
export function runtimeCapabilities(runtime: DeploymentRuntime): ModelDeploymentCapabilities {
  assert(
    'profile_id' in runtime && runtime.profile_id === 'vllm-0.32.0-text',
    422,
    'unsupported_model_source',
    'Choose the reviewed text-generation runtime.',
  );
  const p = runtime.parameters;
  assert(
    p.max_output_tokens <= p.context_window_tokens,
    422,
    'invalid_model_deployment',
    'Output capacity must fit the selected context window.',
  );
  return {
    protocol: 'openai_chat',
    input_modalities: ['text'],
    chat_completions: true,
    json_object: true,
    json_schema: true,
    tools: !!p.tool_call_parser,
    streaming: true,
    stream_usage: true,
    schema_keywords: [
      'type',
      'properties',
      'required',
      'additionalProperties',
      'items',
      'enum',
      'const',
      'anyOf',
      '$ref',
      '$defs',
      'minimum',
      'maximum',
      'minItems',
      'maxItems',
      'minLength',
      'maxLength',
      'pattern',
    ],
    accepted_parameters: chatParameters,
    schema_dialect: 'https://json-schema.org/draft/2020-12/schema',
    context_window_tokens: p.context_window_tokens,
    max_output_tokens: p.max_output_tokens,
    max_concurrent_requests: p.max_concurrent_requests,
  };
}
