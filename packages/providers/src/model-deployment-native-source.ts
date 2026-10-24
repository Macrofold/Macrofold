import { z } from 'zod';
import type { components } from '../../contracts/api';
import { assert } from '../../core/src/errors';
import {
  defaultDecisionRuntimeParameters,
  runtimeCapabilities,
} from '../../core/src/model-deployment-profiles';
import {
  nativeModelRecipeSchema,
  type ModelArtifact,
  type NativeModelRecipe,
} from '../../core/src/model-deployment-types';
import type {
  HuggingFaceModelInfo,
  huggingFaceModelInfo,
  huggingFaceModelMetadata,
} from './model-deployment-source';

type Schema = components['schemas'];
type Reader = { metadata: typeof huggingFaceModelMetadata; info: typeof huggingFaceModelInfo };
const reference = z.object({
  base: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/),
  base_revision: z.string().regex(/^[a-f0-9]{40}$/),
});
const adapterSchema = z.object({
  base_model_name_or_path: z.string(),
  revision: z.string().nullable().optional(),
  peft_type: z.literal('LORA'),
});
const dimensions = z.object({
  dtype: z.string().nullish(),
  torch_dtype: z.string().nullish(),
  num_hidden_layers: z.number().int().positive(),
  num_key_value_heads: z.number().int().positive().optional(),
  num_attention_heads: z.number().int().positive(),
  hidden_size: z.number().int().positive(),
  head_dim: z.number().int().positive().optional(),
  max_position_embeddings: z.number().int().positive(),
  quantization_config: z.unknown().optional(),
});
const nativeConfig = z
  .object({
    architectures: z.array(z.string()),
    auto_map: z.unknown().optional(),
    quantization_config: z.unknown().optional(),
    text_config: dimensions.optional(),
  })
  .passthrough();
const checkpointData =
  /^(head\.pt|adapter_config\.json|adapter_model\.safetensors|config\.json|model[^/]*\.safetensors(?:\.index\.json)?|provenance\.json|training_config\.json|tokenizer(?:_config)?\.json|special_tokens_map\.json|added_tokens\.json|vocab\.(?:json|txt)|merges\.txt|tokenizer\.model|LICENSE(?:\.[^/]*)?|NOTICE(?:\.[^/]*)?)$/;
const baseData =
  /^(config\.json|model[^/]*\.safetensors(?:\.index\.json)?|tokenizer(?:_config)?\.json|special_tokens_map\.json|added_tokens\.json|vocab\.(?:json|txt)|merges\.txt|tokenizer\.model|LICENSE(?:\.[^/]*)?|NOTICE(?:\.[^/]*)?)$/;
function license(info: HuggingFaceModelInfo) {
  const value = info.cardData?.license;
  return Array.isArray(value) ? value.join(', ') : value || null;
}
function artifact(file: HuggingFaceModelInfo['siblings'][number]): ModelArtifact | undefined {
  const size = file.lfs?.size ?? file.size;
  if (size === undefined || (!file.lfs?.sha256 && !file.blobId)) return;
  return {
    path: file.rfilename,
    size_bytes: size,
    sha256: file.lfs?.sha256 ?? null,
    git_blob_sha1: file.blobId ?? null,
  };
}

/** Inspect data only. Python checkpoint metadata is checked by the safe native
 * loader after download; it is never deserialized on the API host. */
export async function inspectNativeHuggingFace(
  input: Schema['ModelDeploymentInspectionInput'],
  source: Schema['ModelDeploymentHuggingFaceSource'],
  info: HuggingFaceModelInfo,
  reader: Reader,
  secret?: string,
): Promise<{ inspection: Schema['ModelDeploymentInspection']; nativeRecipe?: NativeModelRecipe }> {
  assert(
    !input.runtime_preferences?.profile_id || input.runtime_preferences.profile_id === 'kev-systemone-v1',
    422,
    'unsupported_model_capability',
    'Choose the native Kev runtime for decisions.',
  );
  const parameters = { ...defaultDecisionRuntimeParameters, ...input.runtime_preferences?.parameters };
  const capabilities = runtimeCapabilities({ profile_id: 'kev-systemone-v1', parameters });
  const findings: Schema['ModelDeploymentInspection']['findings'] = [];
  const add = (code: string, message: string) => findings.push({ code, message });
  const checkpointLicense = license(info);
  const inspection: Schema['ModelDeploymentInspection'] = {
    supported: false,
    findings,
    source,
    runtime_profiles: [],
    hosting_options: [],
    memory_estimate_bytes: null,
    license: checkpointLicense,
    license_acknowledgement_required: true,
  };
  if (source.tokenizer || source.chat_template)
    add(
      'unsupported_native_option',
      'Native Kev uses the checkpoint’s exact base tokenizer and no chat template; remove tokenizer/template overrides.',
    );
  const files = new Map(info.siblings.map((file) => [file.rfilename, file]));
  if (!files.has('head.pt')) {
    add(
      'incompatible_native_checkpoint',
      files.has('head.safetensors')
        ? 'This separate merged scoring head is not the publisher Kev checkpoint format. Its native loader, calibration and prompt layout need a separately reviewed runtime; chat weights are not a decision model.'
        : 'The native Kev runtime requires the publisher head.pt checkpoint containing its scoring head, calibration and base identity.',
    );
    return { inspection };
  }
  const weights = files.has('adapter_config.json') ? 'lora' : 'full';
  const selectedWeights = info.siblings.filter((file) =>
    weights === 'lora'
      ? file.rfilename === 'adapter_model.safetensors'
      : /^model[^/]*\.safetensors$/.test(file.rfilename),
  );
  if (!selectedWeights.length || (weights === 'full' && !files.has('config.json')))
    add(
      'incomplete_native_checkpoint',
      'A native checkpoint must contain its complete safetensors adapter or full backbone as well as head.pt.',
    );
  const selected = selectedWeights.map((file) => file.rfilename);
  if (
    selectedWeights.some((file) => (file.lfs?.size ?? file.size ?? 0) <= 0) ||
    (files.get('head.pt')?.lfs?.size ?? files.get('head.pt')?.size ?? 0) <= 0
  )
    add(
      'incomplete_native_checkpoint',
      'The native scoring head and checkpoint weights must contain nonempty model data.',
    );
  if (weights === 'lora' && info.siblings.some((file) => /^model[^/]*\.safetensors$/.test(file.rfilename)))
    add(
      'ambiguous_native_checkpoint',
      'Select a checkpoint with one publisher layout: an adapter or full backbone, not both.',
    );
  if (
    source.weight_files &&
    (source.weight_files.length !== selected.length ||
      source.weight_files.some((file) => !selected.includes(file)))
  )
    add(
      'incomplete_native_checkpoint',
      'Native Kev requires the complete checkpoint weight set; a partial or alternative weight selection is unsupported.',
    );
  source = { ...source, weight_files: selected };
  inspection.source = source;
  const [rawAdapter, rawProvenance, rawTraining] = await Promise.all([
    weights === 'lora'
      ? reader.metadata(`${source.repository}/resolve/${info.sha}/adapter_config.json`, secret, true)
      : null,
    files.has('provenance.json')
      ? reader.metadata(`${source.repository}/resolve/${info.sha}/provenance.json`, secret, true)
      : null,
    files.has('training_config.json')
      ? reader.metadata(`${source.repository}/resolve/${info.sha}/training_config.json`, secret, true)
      : null,
  ]);
  const provenance = z.object({ config: reference }).safeParse(rawProvenance);
  const training = z.object({ args: reference }).safeParse(rawTraining);
  const base = provenance.success ? provenance.data.config : training.success ? training.data.args : null;
  if (!base || base.base.includes('..')) {
    add(
      'missing_native_base_revision',
      'Provide publisher provenance.json or training_config.json with the exact base repository and full base_revision; mutable base references are unsupported.',
    );
    return { inspection };
  }
  if (
    provenance.success &&
    training.success &&
    (provenance.data.config.base !== training.data.args.base ||
      provenance.data.config.base_revision !== training.data.args.base_revision)
  )
    add(
      'native_base_mismatch',
      'The checkpoint provenance and training metadata disagree on the immutable base.',
    );
  const adapter = adapterSchema.safeParse(rawAdapter);
  if (
    weights === 'lora' &&
    (!adapter.success ||
      adapter.data.base_model_name_or_path !== base.base ||
      (adapter.data.revision && adapter.data.revision !== base.base_revision))
  )
    add(
      'native_base_mismatch',
      'The adapter must be a LoRA for the exact base recorded by the checkpoint provenance.',
    );
  const baseInfo = await reader.info(base.base, base.base_revision, secret);
  if (baseInfo.sha !== base.base_revision)
    add('native_base_mismatch', 'The base metadata did not resolve to the requested immutable commit.');
  const [rawConfig, tokenizer] = await Promise.all([
    reader.metadata(
      `${weights === 'full' ? source.repository : base.base}/resolve/${weights === 'full' ? info.sha : baseInfo.sha}/config.json`,
      secret,
      true,
    ),
    reader.metadata(`${base.base}/resolve/${baseInfo.sha}/tokenizer_config.json`, secret, true),
  ]);
  const parsedConfig = nativeConfig.safeParse(rawConfig);
  const c = parsedConfig.success ? parsedConfig.data : undefined;
  if (
    !c ||
    !c.architectures.some((a) =>
      ['Qwen3ForCausalLM', 'Qwen3_5ForConditionalGeneration', 'Qwen3_5ForCausalLM'].includes(a),
    )
  )
    add('unsupported_architecture', 'This native profile supports reviewed Qwen3 and Qwen3.5 Kev backbones.');
  if (c?.quantization_config || c?.text_config?.quantization_config)
    add(
      'unsupported_native_quantization',
      'This native runtime requires unquantized checkpoint/base weights; quantized backbones need a separately qualified loader.',
    );
  if (
    c?.auto_map ||
    (tokenizer && typeof tokenizer === 'object' && 'auto_map' in tokenizer && tokenizer.auto_map)
  )
    add(
      'remote_code_required',
      'The native runtime does not execute repository-defined model or tokenizer code.',
    );
  const d = dimensions.safeParse(c?.text_config ?? rawConfig);
  if (!d.success || parameters.context_window_tokens > d.data.max_position_embeddings)
    add(
      'context_window_unsupported',
      'The immutable backbone must declare sufficient context and memory dimensions.',
    );
  const baseFiles = baseInfo.siblings.filter(
    (file) =>
      baseData.test(file.rfilename) && (weights === 'lora' || !file.rfilename.endsWith('.safetensors')),
  );
  if (
    !baseFiles.some((file) => file.rfilename === 'tokenizer_config.json') ||
    !baseFiles.some((file) =>
      ['tokenizer.json', 'tokenizer.model', 'vocab.json', 'vocab.txt'].includes(file.rfilename),
    )
  )
    add(
      'missing_tokenizer',
      'The immutable base must include its tokenizer configuration and tokenizer data.',
    );
  if (weights === 'lora' && !baseFiles.some((file) => /^model[^/]*\.safetensors$/.test(file.rfilename)))
    add('unsupported_weight_format', 'The native adapter requires complete safetensors base weights.');
  if (
    weights === 'lora' &&
    baseFiles.some(
      (file) => file.rfilename.endsWith('.safetensors') && (file.lfs?.size ?? file.size ?? 0) <= 0,
    )
  )
    add(
      'incomplete_native_checkpoint',
      'The native adapter’s base weights must contain nonempty model data.',
    );
  const checkpointFiles = info.siblings.filter((file) => checkpointData.test(file.rfilename));
  const checkpointArtifacts = checkpointFiles.map(artifact),
    baseArtifacts = baseFiles.map(artifact);
  if (checkpointArtifacts.some((file) => !file) || baseArtifacts.some((file) => !file))
    add(
      'missing_artifact_integrity',
      'Every selected native model artifact must have an exact size and an upstream SHA-256 or Git blob identity.',
    );
  const baseLicense = license(baseInfo);
  if (!checkpointLicense || !baseLicense)
    add(
      'missing_model_license',
      'Both the native checkpoint and immutable base must declare their model license before managed deployment.',
    );
  inspection.license = [...new Set([checkpointLicense, baseLicense].filter(Boolean))].join(', ') || null;
  if (findings.length) return { inspection };
  const nativeRecipe = nativeModelRecipeSchema.parse({
    format: 'kev',
    version: 1,
    weights,
    checkpoint_files: checkpointArtifacts.filter((file): file is ModelArtifact => file !== undefined),
    base: {
      repository: base.base,
      revision: base.base_revision,
      files: baseArtifacts.filter((file): file is ModelArtifact => file !== undefined),
    },
    licenses: [
      { repository: source.repository, revision: info.sha, license: checkpointLicense, gated: !!info.gated },
      { repository: base.base, revision: baseInfo.sha, license: baseLicense, gated: !!baseInfo.gated },
    ],
  });
  if (d.success) {
    const bytes = [...nativeRecipe.checkpoint_files, ...(weights === 'lora' ? nativeRecipe.base.files : [])]
      .filter((file) => file.path.endsWith('.safetensors') || file.path === 'head.pt')
      .reduce((sum, file) => sum + BigInt(file.size_bytes), 0n);
    const factor =
      parameters.dtype === 'float' && !['float32', 'float'].includes(d.data.dtype ?? d.data.torch_dtype ?? '')
        ? 2n
        : 1n;
    const headDim = d.data.head_dim ?? d.data.hidden_size / d.data.num_attention_heads;
    const cache =
      2 *
      d.data.num_hidden_layers *
      (d.data.num_key_value_heads ?? d.data.num_attention_heads) *
      headDim *
      (parameters.dtype === 'float' ? 4 : 2) *
      parameters.context_window_tokens *
      parameters.max_concurrent_requests;
    assert(
      Number.isSafeInteger(cache),
      422,
      'unsupported_model_source',
      'The model memory estimate is outside supported bounds.',
    );
    // Conservative packed attention/cache and loading headroom; no model reload
    // or hardware discovery belongs in the request path.
    inspection.memory_estimate_bytes = (
      (bytes * factor * 12n) / 10n +
      BigInt(cache) +
      2n * 1024n ** 3n
    ).toString();
  }
  inspection.supported = true;
  inspection.runtime_profiles = [
    {
      profile_id: 'kev-systemone-v1',
      image:
        process.env.MODEL_DECISION_SERVING_IMAGE ??
        'MODEL_DECISION_SERVING_IMAGE (operator configuration required)',
      parameters,
      capabilities,
    },
  ];
  return { inspection, nativeRecipe };
}
