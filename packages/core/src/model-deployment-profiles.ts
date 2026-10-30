import type { components } from '../../contracts/api';
import { assert } from './errors';
import type { DeploymentRuntime, ModelDeploymentCapabilities } from './model-deployment-types';

export function managedRuntimeProfile(profileId: string) {
  assert(
    ['vllm-0.32.0-text', 'kev-systemone-v1'].includes(profileId),
    422,
    'unsupported_model_source',
    'Choose a reviewed model-serving runtime.',
  );
  return profileId === 'kev-systemone-v1'
    ? {
        task: 'decision' as const,
        protocol: 'systemone' as const,
        imageSetting: 'MODEL_DECISION_SERVING_IMAGE',
        defaultImage:
          'ghcr.io/macrofold/model-serving-kev@sha256:f64e30cc0f40085bf15fa7c65a6886b5953edf3dbc8b8783f820ecd770780d5a',
        cuda: '12.8',
      }
    : {
        task: 'text_generation' as const,
        protocol: 'openai_chat' as const,
        imageSetting: 'MODEL_SERVING_IMAGE',
        defaultImage:
          'ghcr.io/macrofold/model-serving@sha256:ad0c99ffaaa3a868f1ff5c493af89feb9eafecc379b79449991d2a8ddacce385',
        cuda: '13.0',
      };
}
export function modelServingImage(profileId = 'vllm-0.32.0-text') {
  const profile = managedRuntimeProfile(profileId);
  // Revisions freeze the reviewed immutable wrapper. Operators may override it,
  // but invalid explicit values must never silently select another image.
  const image = process.env[profile.imageSetting] ?? profile.defaultImage;
  assert(
    image && /^\S+@sha256:[a-f0-9]{64}$/.test(image),
    503,
    'model_runtime_unconfigured',
    `Configure the qualified immutable Macrofold model-serving image in ${profile.imageSetting}.`,
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
export const defaultDecisionRuntimeParameters: components['schemas']['ModelDeploymentRuntimeParameters'] = {
  context_window_tokens: 8192,
  max_output_tokens: 1024,
  max_concurrent_requests: 4,
  dtype: 'bfloat16',
  tensor_parallel_size: 1,
  gpu_memory_utilization: 0.9,
};
export function validateRuntimeParameters(runtime: DeploymentRuntime) {
  assert('profile_id' in runtime, 422, 'unsupported_model_source', 'Choose a reviewed managed runtime.');
  managedRuntimeProfile(runtime.profile_id);
  const p = runtime.parameters;
  assert(
    p.max_output_tokens <= p.context_window_tokens,
    422,
    'invalid_model_deployment',
    'Output capacity must fit the selected context window.',
  );
  if (runtime.profile_id === 'kev-systemone-v1')
    assert(
      p.context_window_tokens <= 65536 &&
        p.max_concurrent_requests <= 64 &&
        (p.tensor_parallel_size ?? 1) === 1 &&
        !p.quantization &&
        !p.tool_call_parser &&
        !p.reasoning_parser &&
        ['auto', 'bfloat16', 'float'].includes(p.dtype ?? 'auto'),
      422,
      'unsupported_model_capability',
      'The native Kev runtime supports one GPU, bf16 or float32, up to 65,536 packed tokens and 64 concurrent requests; quantization and chat parsers are unsupported.',
    );
}
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
  'chat_template_kwargs',
  'stream',
  'stream_options',
  'logprobs',
  'top_logprobs',
];
export function runtimeCapabilities(runtime: DeploymentRuntime): ModelDeploymentCapabilities {
  validateRuntimeParameters(runtime);
  assert('profile_id' in runtime, 422, 'unsupported_model_source', 'Choose a managed runtime.');
  const p = runtime.parameters;
  if (runtime.profile_id === 'kev-systemone-v1')
    return {
      protocol: 'systemone',
      input_modalities: ['text'],
      chat_completions: false,
      json_object: false,
      json_schema: false,
      tools: false,
      streaming: false,
      stream_usage: false,
      schema_keywords: [],
      accepted_parameters: ['state', 'questions'],
      schema_dialect: null,
      context_window_tokens: p.context_window_tokens,
      max_output_tokens: p.max_output_tokens,
      max_concurrent_requests: p.max_concurrent_requests,
    };
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
