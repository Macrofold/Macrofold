import { z } from 'zod';
import { huggingFaceMetadataFetch } from './network';
import { assert, AppError } from '../../core/src/errors';
import { boundedBody } from '../../core/src/body';
import type { components } from '../../contracts/api';
import {
  defaultRuntimeParameters,
  runtimeCapabilities,
  servingImage,
} from '../../core/src/model-deployment-profiles';
type Source = components['schemas']['ModelDeploymentHuggingFaceSource'];
type Inspection = components['schemas']['ModelDeploymentInspection'];
const byteSize = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const infoSchema = z
  .object({
    sha: z.string().regex(/^[a-f0-9]{40}$/),
    pipeline_tag: z.string().optional(),
    gated: z.union([z.boolean(), z.string()]).optional(),
    cardData: z
      .object({ license: z.union([z.string(), z.array(z.string())]).optional() })
      .passthrough()
      .optional(),
    siblings: z
      .array(
        z.object({
          rfilename: z.string(),
          size: byteSize.optional(),
          lfs: z.object({ size: byteSize }).passthrough().optional(),
        }),
      )
      .max(20000),
  })
  .passthrough();
const configSchema = z
  .object({
    architectures: z.array(z.string()).optional(),
    auto_map: z.unknown().optional(),
    dtype: z.string().nullish(),
    torch_dtype: z.string().nullish(),
    num_hidden_layers: z.number().int().positive().optional(),
    num_key_value_heads: z.number().int().positive().optional(),
    num_attention_heads: z.number().int().positive().optional(),
    hidden_size: z.number().int().positive().optional(),
    head_dim: z.number().int().positive().optional(),
    max_position_embeddings: z.number().int().positive().optional(),
    quantization_config: z.object({ quant_method: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();
export function normalizeHuggingFaceSource(input: Source): Source {
  let repository = input.repository,
    revision = input.revision;
  if (repository.startsWith('https://')) {
    for (const segment of repository.split(/[?#]/, 1)[0].split('/').slice(3)) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        throw new AppError(400, 'unsupported_model_source', 'Use a valid Hugging Face model URL.');
      }
      assert(
        !['.', '..'].includes(decoded) && !/[\\/\x00-\x20]/.test(decoded),
        400,
        'unsupported_model_source',
        'Use a model URL without path traversal; references containing slashes belong in the explicit revision field.',
      );
    }
    let url: URL;
    try {
      url = new URL(repository);
    } catch {
      throw new AppError(400, 'unsupported_model_source', 'Use a valid Hugging Face model URL.');
    }
    assert(
      url.origin === 'https://huggingface.co' && !url.username && !url.password && !url.search && !url.hash,
      400,
      'unsupported_model_source',
      'Use a Hugging Face model repository URL without credentials, query or fragment.',
    );
    const parts = url.pathname.replace(/\/$/, '').split('/').slice(1);
    assert(
      parts.length === 2 || (parts.length === 4 && parts[2] === 'tree'),
      400,
      'unsupported_model_source',
      'Use a model repository or its /tree/revision URL.',
    );
    repository = parts.slice(0, 2).join('/');
    if (parts[3]) {
      const ref = decodeURIComponent(parts[3]);
      assert(
        !revision || revision === ref,
        400,
        'unsupported_model_source',
        'The URL revision and explicit revision must agree.',
      );
      revision = ref;
    }
  }
  assert(
    /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository) &&
      !repository.includes('..') &&
      !/^(datasets|spaces)\//i.test(repository),
    400,
    'unsupported_model_source',
    'Use owner/model for a model repository.',
  );
  assert(
    !revision ||
      (!revision.includes('..') && !revision.split('/').includes('.') && !/[\x00-\x20\\]/.test(revision)),
    400,
    'unsupported_model_source',
    'Choose a valid explicit model revision.',
  );
  assert(
    input.weight_files === undefined || input.weight_files.length > 0,
    400,
    'unsupported_model_source',
    'Select at least one safetensors file, or omit weight_files to inspect the complete variant.',
  );
  for (const file of input.weight_files || [])
    assert(
      !file.startsWith('/') &&
        !file.includes('\\') &&
        !file.split('/').includes('..') &&
        !/[*?\[\]]/.test(file) &&
        file.endsWith('.safetensors'),
      400,
      'unsupported_model_source',
      'Select literal safetensors paths inside the repository without traversal or glob patterns.',
    );
  return { ...input, repository, ...(revision ? { revision } : {}) };
}
async function metadata(path: string, secret?: string, optional = false, text = false): Promise<unknown> {
  const signal = AbortSignal.timeout(15000);
  const pinned =
    /^([^/]+\/[^/]+)\/resolve\/([a-f0-9]{40})\/(config\.json|tokenizer_config\.json|chat_template\.jinja)$/.exec(
      path,
    );
  let url = new URL(`https://huggingface.co/${path}`);
  let response: Response | undefined;
  for (let redirects = 0; redirects <= 3; redirects++) {
    response = await huggingFaceMetadataFetch(url, {
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      signal,
    });
    if (response.status < 300 || response.status >= 400 || response.status === 304) break;
    const location = response.headers.get('location');
    await response.body?.cancel();
    assert(
      location && pinned && redirects < 3,
      503,
      'deployment_provider_unavailable',
      'Hugging Face returned an unsupported metadata redirect.',
    );
    const next = new URL(location, url);
    assert(
      next.origin === 'https://huggingface.co' &&
        !next.username &&
        !next.password &&
        !next.hash &&
        (next.pathname === `/${pinned[1]}/resolve/${pinned[2]}/${pinned[3]}` ||
          next.pathname === `/api/resolve-cache/models/${pinned[1]}/${pinned[2]}/${pinned[3]}`),
      503,
      'deployment_provider_unavailable',
      'Hugging Face metadata redirected outside the pinned source.',
    );
    url = next;
  }
  assert(response, 503, 'deployment_provider_unavailable', 'Hugging Face metadata is unavailable.');
  if (!response.ok) await response.body?.cancel();
  if (optional && response.status === 404) return null;
  assert(
    response.ok,
    response.status === 401 || response.status === 403 ? 403 : response.status === 404 ? 404 : 503,
    response.status === 401 || response.status === 403
      ? 'model_source_access_denied'
      : 'deployment_provider_unavailable',
    'Hugging Face metadata is unavailable. Check the repository and this owner’s gated/private access.',
  );
  return text
    ? (await boundedBody(response.body, 64 * 1024, 15000, signal)).toString('utf8')
    : response.json();
}
export async function inspectHuggingFace(
  input: components['schemas']['ModelDeploymentInspectionInput'],
  secret?: string,
): Promise<Inspection> {
  const source = normalizeHuggingFaceSource(input.source);
  try {
    const info = infoSchema.parse(
      await metadata(
        `api/models/${source.repository}/revision/${encodeURIComponent(source.revision || 'main')}?blobs=true`,
        secret,
      ),
    );
    const pinned = { ...source, revision: info.sha };
    const [rawConfig, tokenizer] = await Promise.all([
      metadata(`${source.repository}/resolve/${info.sha}/config.json`, secret, true),
      metadata(`${source.repository}/resolve/${info.sha}/tokenizer_config.json`, secret, true),
    ]);
    const findings: Inspection['findings'] = [];
    const add = (code: string, message: string) => findings.push({ code, message });
    const parsed = configSchema.safeParse(rawConfig);
    if (!parsed.success)
      add('missing_model_config', 'A supported causal language-model configuration is required.');
    const c = parsed.success ? parsed.data : {};
    const supported = new Set([
      'LlamaForCausalLM',
      'MistralForCausalLM',
      'Qwen2ForCausalLM',
      'Qwen3ForCausalLM',
      'Qwen3MoeForCausalLM',
      'GemmaForCausalLM',
      'Gemma2ForCausalLM',
      'Gemma3ForCausalLM',
      'Phi3ForCausalLM',
      'GPTNeoXForCausalLM',
    ]);
    if (!c.architectures?.some((a) => supported.has(a)))
      add(
        'unsupported_architecture',
        'This architecture is not in the reviewed vLLM text profile. Use a compatible external endpoint.',
      );
    if (c.auto_map)
      add(
        'remote_code_required',
        'Repository-defined model code is outside this managed runtime. Use a compatible external endpoint.',
      );
    if (info.pipeline_tag && info.pipeline_tag !== 'text-generation')
      add('unsupported_task', 'The initial managed profile serves text generation.');
    if (info.siblings.some((f) => f.rfilename === 'adapter_config.json'))
      add('adapter_only_source', 'Select complete model weights rather than an adapter-only repository.');
    const weights = info.siblings.filter((f) => f.rfilename.endsWith('.safetensors'));
    if (!weights.length)
      add(
        'unsupported_weight_format',
        'This profile requires safetensors weights. GGUF and other engines can use an external endpoint.',
      );
    if (!source.weight_files && weights.some((f) => f.rfilename.includes('/')))
      add('ambiguous_weight_variant', 'Select the exact weight_files for one compatible weight variant.');
    const weightPaths = new Set(weights.map((weight) => weight.rfilename));
    const selectedPaths = source.weight_files ? new Set(source.weight_files) : undefined;
    if (source.weight_files?.some((file) => !weightPaths.has(file)))
      add('missing_weight_file', 'One selected safetensors file does not exist at this revision.');
    const selected = weights.filter((weight) => !selectedPaths || selectedPaths.has(weight.rfilename));
    pinned.weight_files = selected.map((f) => f.rfilename);
    if (selected.length) normalizeHuggingFaceSource(pinned);
    let tokenizerConfig = tokenizer;
    let tokenizerSource = { repository: source.repository, revision: info.sha, siblings: info.siblings };
    if (source.tokenizer) {
      const normalized = normalizeHuggingFaceSource({ kind: 'hugging_face', ...source.tokenizer });
      const ti = infoSchema.parse(
        await metadata(
          `api/models/${normalized.repository}/revision/${encodeURIComponent(normalized.revision || 'main')}?blobs=true`,
          secret,
        ),
      );
      pinned.tokenizer = { repository: normalized.repository, revision: ti.sha };
      tokenizerSource = { repository: normalized.repository, revision: ti.sha, siblings: ti.siblings };
      tokenizerConfig = await metadata(
        `${normalized.repository}/resolve/${ti.sha}/tokenizer_config.json`,
        secret,
        true,
      );
    }
    if (
      tokenizerConfig &&
      typeof tokenizerConfig === 'object' &&
      'auto_map' in tokenizerConfig &&
      tokenizerConfig.auto_map
    )
      add(
        'remote_code_required',
        'The tokenizer declares repository-defined code outside this managed runtime.',
      );
    const template =
      tokenizerConfig && typeof tokenizerConfig === 'object' && 'chat_template' in tokenizerConfig
        ? tokenizerConfig.chat_template
        : null;
    let usableTemplate = typeof template === 'string' && template.trim().length > 0;
    if (Array.isArray(template)) {
      const entries = z
        .array(z.object({ name: z.string(), template: z.string().min(1) }))
        .safeParse(template);
      usableTemplate =
        entries.success &&
        (entries.data.length === 1 || entries.data.filter((entry) => entry.name === 'default').length === 1);
    } else if (template && typeof template === 'object') {
      const entries = z.record(z.string(), z.string().min(1)).safeParse(template);
      usableTemplate =
        entries.success && (Object.keys(entries.data).length === 1 || Object.hasOwn(entries.data, 'default'));
    }
    if (
      !usableTemplate &&
      tokenizerSource.siblings.some((file) => file.rfilename === 'chat_template.jinja')
    ) {
      const standalone = await metadata(
        `${tokenizerSource.repository}/resolve/${tokenizerSource.revision}/chat_template.jinja`,
        secret,
        true,
        true,
      );
      usableTemplate = typeof standalone === 'string' && standalone.trim().length > 0;
    }
    if (!usableTemplate)
      add(
        'missing_chat_template',
        'The pinned tokenizer needs an unambiguous chat template or a named default.',
      );
    const parameters = { ...defaultRuntimeParameters, ...input.runtime_preferences?.parameters };
    if (c.max_position_embeddings && parameters.context_window_tokens > c.max_position_embeddings)
      add('context_window_unsupported', 'The selected context exceeds the model configuration.');
    if (c.quantization_config?.quant_method && parameters.quantization !== c.quantization_config.quant_method)
      add(
        'quantization_required',
        `Select the model’s ${c.quantization_config.quant_method} quantization if supported by the profile.`,
      );
    const bytes = selected.every((w) => Number.isSafeInteger(w.lfs?.size ?? w.size))
      ? selected.reduce((n, w) => n + BigInt(w.lfs?.size ?? w.size ?? 0), 0n)
      : null;
    const dimension =
      c.head_dim ??
      (c.hidden_size && c.num_attention_heads ? c.hidden_size / c.num_attention_heads : undefined);
    const kv =
      c.num_hidden_layers && (c.num_key_value_heads || c.num_attention_heads) && dimension
        ? 2 *
          c.num_hidden_layers *
          (c.num_key_value_heads || c.num_attention_heads || 0) *
          dimension *
          (parameters.dtype === 'float' ? 4 : 2) *
          parameters.context_window_tokens *
          parameters.max_concurrent_requests
        : null;
    // The native engine can widen unquantized source weights. A missing source
    // dtype cannot justify assuming half precision when float32 was requested.
    const sourceDtype = c.dtype ?? c.torch_dtype;
    const sourceElementBytes = ['float32', 'float'].includes(sourceDtype ?? '')
      ? 4
      : ['float16', 'half', 'bfloat16'].includes(sourceDtype ?? '')
        ? 2
        : 1;
    const weightMultiplier =
      parameters.dtype === 'float' && !parameters.quantization ? 4 / sourceElementBytes : 1;
    const memory =
      bytes !== null && kv !== null && Number.isSafeInteger(kv)
        ? (bytes * BigInt(weightMultiplier) * 12n) / 10n + BigInt(kv) + 2n * 1024n ** 3n
        : null;
    const license = Array.isArray(info.cardData?.license)
      ? info.cardData.license.join(', ')
      : info.cardData?.license || null;
    return {
      supported: !findings.length,
      findings,
      source: pinned,
      runtime_profiles: findings.length
        ? []
        : [
            {
              profile_id: 'vllm-0.32.0-text',
              image: servingImage,
              parameters,
              capabilities: runtimeCapabilities({ profile_id: 'vllm-0.32.0-text', parameters }),
            },
          ],
      hosting_options: [],
      memory_estimate_bytes: memory?.toString() ?? null,
      license,
      license_acknowledgement_required: !!info.gated || !!license,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      503,
      'deployment_provider_unavailable',
      'Hugging Face returned incomplete metadata or did not respond within the inspection deadline.',
    );
  }
}
