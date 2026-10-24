import { afterEach, expect, it, vi } from 'vitest';
import {
  inspectHuggingFace,
  prepareHuggingFaceSource,
} from '../../packages/providers/src/model-deployment-source';
import { huggingFaceMetadataFetch } from '../../packages/providers/src/network';
import { runtimeCapabilities, modelServingImage } from '../../packages/core/src/model-deployment-profiles';
import type { components } from '../../packages/contracts/api';

vi.mock('../../packages/providers/src/network', () => ({ huggingFaceMetadataFetch: vi.fn() }));
const commit = 'a'.repeat(40),
  baseCommit = 'b'.repeat(40);
const request = (): components['schemas']['ModelDeploymentInspectionInput'] => ({
  source: { kind: 'hugging_face', repository: 'fixture/kev' },
  task: 'decision',
});
function file(rfilename: string, size = 128) {
  return {
    rfilename,
    size,
    blobId: 'c'.repeat(40),
    ...(rfilename.endsWith('.safetensors') || rfilename === 'head.pt'
      ? { lfs: { size, sha256: 'd'.repeat(64) } }
      : {}),
  };
}
function fixture(
  options: {
    full?: boolean;
    head?: boolean;
    missingWeights?: boolean;
    missingHash?: boolean;
    missingProvenance?: boolean;
    missingLicense?: boolean;
    conflictingBase?: boolean;
    adapterBase?: string;
    remoteCode?: boolean;
    architecture?: string;
    quantized?: boolean;
  } = {},
) {
  vi.mocked(huggingFaceMetadataFetch).mockImplementation(async (input) => {
    const url = String(input);
    const base = { base: 'fixture/base', base_revision: baseCommit };
    if (url === 'https://huggingface.co/api/models/fixture/kev/revision/main?blobs=true')
      return Response.json({
        sha: commit,
        pipeline_tag: 'text-classification',
        gated: false,
        cardData: { license: options.missingLicense ? undefined : 'apache-2.0' },
        siblings: [
          file(options.head === false ? 'head.safetensors' : 'head.pt', 5000000),
          ...(options.missingProvenance ? [] : [file('provenance.json'), file('training_config.json')]),
          ...(options.full ? [file('config.json')] : [file('adapter_config.json')]),
          ...(options.missingWeights
            ? []
            : [
                options.missingHash
                  ? { rfilename: 'adapter_model.safetensors', size: 128000000 }
                  : file(options.full ? 'model.safetensors' : 'adapter_model.safetensors', 128000000),
              ]),
        ],
      });
    if (url === `https://huggingface.co/fixture/kev/resolve/${commit}/provenance.json`)
      return Response.json({ config: base });
    if (url === `https://huggingface.co/fixture/kev/resolve/${commit}/training_config.json`)
      return Response.json({
        args: { ...base, ...(options.conflictingBase ? { base_revision: 'e'.repeat(40) } : {}) },
      });
    if (url === `https://huggingface.co/fixture/kev/resolve/${commit}/adapter_config.json`)
      return Response.json({
        base_model_name_or_path: options.adapterBase ?? 'fixture/base',
        peft_type: 'LORA',
        revision: null,
      });
    if (url === `https://huggingface.co/api/models/fixture/base/revision/${baseCommit}?blobs=true`)
      return Response.json({
        sha: baseCommit,
        gated: true,
        cardData: { license: 'apache-2.0' },
        siblings: [
          file('config.json'),
          file('tokenizer_config.json'),
          file('tokenizer.json'),
          file('model.safetensors', 8000000000),
          file('model.safetensors.index.json'),
          file('LICENSE'),
        ],
      });
    if (
      [
        `https://huggingface.co/fixture/base/resolve/${baseCommit}/config.json`,
        `https://huggingface.co/fixture/kev/resolve/${commit}/config.json`,
      ].includes(url)
    )
      return Response.json({
        architectures: [options.architecture ?? 'Qwen3_5ForConditionalGeneration'],
        ...(options.remoteCode ? { auto_map: { AutoModel: 'custom.py' } } : {}),
        ...(options.quantized ? { quantization_config: { quant_method: 'fp8' } } : {}),
        text_config: {
          dtype: 'bfloat16',
          num_hidden_layers: 32,
          num_attention_heads: 16,
          num_key_value_heads: 4,
          hidden_size: 2560,
          head_dim: 256,
          max_position_embeddings: 262144,
        },
      });
    if (url === `https://huggingface.co/fixture/base/resolve/${baseCommit}/tokenizer_config.json`)
      return Response.json({ tokenizer_class: 'Qwen2Tokenizer' });
    throw new Error(`Unexpected fixture URL: ${url}`);
  });
}
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

it('inspects a native adapter without a chat template, freezes exact base/artifact/license evidence and keeps recipe out of the public result', async () => {
  fixture();
  const prepared = await prepareHuggingFaceSource(request(), 'synthetic-hf-token');
  expect(prepared.inspection).toMatchObject({
    supported: true,
    license: 'apache-2.0',
    license_acknowledgement_required: true,
    source: { repository: 'fixture/kev', revision: commit, weight_files: ['adapter_model.safetensors'] },
    runtime_profiles: [
      {
        profile_id: 'kev-systemone-v1',
        parameters: { context_window_tokens: 8192, dtype: 'bfloat16' },
        capabilities: {
          protocol: 'systemone',
          streaming: false,
          accepted_parameters: ['state', 'questions'],
        },
      },
    ],
  });
  expect(BigInt(prepared.inspection.memory_estimate_bytes ?? 0)).toBeGreaterThan(14000000000n);
  expect(prepared.nativeRecipe).toMatchObject({
    format: 'kev',
    version: 1,
    weights: 'lora',
    base: { repository: 'fixture/base', revision: baseCommit },
    licenses: [
      { repository: 'fixture/kev', gated: false },
      { repository: 'fixture/base', gated: true },
    ],
  });
  expect(prepared.nativeRecipe?.checkpoint_files).toContainEqual({
    path: 'head.pt',
    size_bytes: 5000000,
    sha256: 'd'.repeat(64),
    git_blob_sha1: 'c'.repeat(40),
  });
  expect(prepared.nativeRecipe?.base.files.map((file) => file.path)).toContain('model.safetensors');
  expect(prepared.inspection).not.toHaveProperty('nativeRecipe');
  for (const [, init] of vi.mocked(huggingFaceMetadataFetch).mock.calls)
    expect(init?.headers).toEqual({ Authorization: 'Bearer synthetic-hf-token' });
});

it('supports publisher full backbone checkpoints and fetches only base tokenizer data', async () => {
  fixture({ full: true });
  const prepared = await prepareHuggingFaceSource(request());
  expect(prepared.inspection.supported).toBe(true);
  expect(prepared.nativeRecipe?.weights).toBe('full');
  expect(prepared.nativeRecipe?.checkpoint_files.map((file) => file.path)).toContain('model.safetensors');
  expect(prepared.nativeRecipe?.base.files.map((file) => file.path)).not.toContain('model.safetensors');
});

it.each([
  [{ head: false }, 'incompatible_native_checkpoint'],
  [{ missingWeights: true }, 'incomplete_native_checkpoint'],
  [{ missingProvenance: true }, 'missing_native_base_revision'],
  [{ conflictingBase: true }, 'native_base_mismatch'],
  [{ adapterBase: 'fixture/other' }, 'native_base_mismatch'],
  [{ missingHash: true }, 'missing_artifact_integrity'],
  [{ missingLicense: true }, 'missing_model_license'],
  [{ remoteCode: true }, 'remote_code_required'],
  [{ architecture: 'UnreviewedModel' }, 'unsupported_architecture'],
  [{ quantized: true }, 'unsupported_native_quantization'],
] as const)('rejects native incompatibility before any compute: %j', async (options, code) => {
  fixture(options);
  const result = await inspectHuggingFace(request());
  expect(result.supported).toBe(false);
  expect(result.runtime_profiles).toEqual([]);
  expect(result.findings).toContainEqual(expect.objectContaining({ code }));
});

it('rejects native tokenizer overrides and partial selected weights visibly', async () => {
  fixture();
  const result = await inspectHuggingFace({
    ...request(),
    source: {
      ...request().source,
      tokenizer: { repository: 'fixture/other' },
      weight_files: ['unrelated.safetensors'],
    },
  });
  expect(result.findings.map((f) => f.code)).toEqual(
    expect.arrayContaining(['unsupported_native_option', 'incomplete_native_checkpoint']),
  );
});

it.each([
  { tensor_parallel_size: 2 },
  { quantization: 'fp8' as const },
  { dtype: 'half' as const },
  { tool_call_parser: 'hermes' as const },
  { max_concurrent_requests: 65 },
  { context_window_tokens: 65537 },
])('rejects unsupported native runtime controls before metadata: %j', async (parameters) => {
  fixture();
  await expect(
    inspectHuggingFace({
      ...request(),
      runtime_preferences: {
        profile_id: 'kev-systemone-v1',
        parameters: {
          context_window_tokens: 8192,
          max_output_tokens: 1024,
          max_concurrent_requests: 4,
          ...parameters,
        },
      },
    }),
  ).rejects.toMatchObject({ code: 'unsupported_model_capability' });
});

it('enforces task/profile agreement and uses the independent native immutable image setting', async () => {
  fixture();
  await expect(
    inspectHuggingFace({ ...request(), runtime_preferences: { profile_id: 'vllm-0.32.0-text' } }),
  ).rejects.toMatchObject({ code: 'unsupported_model_capability' });
  vi.stubEnv('MODEL_SERVING_IMAGE', `fixture/chat@sha256:${'a'.repeat(64)}`);
  vi.stubEnv('MODEL_DECISION_SERVING_IMAGE', `fixture/native@sha256:${'b'.repeat(64)}`);
  expect(modelServingImage()).toContain('fixture/chat@');
  expect(modelServingImage('kev-systemone-v1')).toContain('fixture/native@');
  expect(
    runtimeCapabilities({
      profile_id: 'kev-systemone-v1',
      parameters: { context_window_tokens: 8192, max_output_tokens: 1024, max_concurrent_requests: 4 },
    }),
  ).toMatchObject({ protocol: 'systemone', tools: false, json_schema: false });
});
