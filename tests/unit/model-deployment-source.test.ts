import { afterEach, expect, it, vi } from 'vitest';
import {
  normalizeHuggingFaceSource,
  inspectHuggingFace,
} from '../../packages/providers/src/model-deployment-source';
import { huggingFaceMetadataFetch } from '../../packages/providers/src/network';

vi.mock('../../packages/providers/src/network', () => ({ huggingFaceMetadataFetch: vi.fn() }));
const commit = 'a'.repeat(40),
  tokenizerCommit = 'b'.repeat(40);
afterEach(() => vi.resetAllMocks());
function fixtures(
  options: {
    remoteCode?: boolean;
    tokenizerRemoteCode?: boolean;
    missingTemplate?: boolean;
    template?: unknown;
    weights?: string[];
    architecture?: string;
    license?: string;
    gated?: boolean;
  } = {},
) {
  const fetch = vi.mocked(huggingFaceMetadataFetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === 'https://huggingface.co/api/models/fixture/model/revision/main?blobs=true')
      return Response.json({
        sha: commit,
        pipeline_tag: 'text-generation',
        gated: options.gated ?? false,
        cardData: { license: options.license ?? 'apache-2.0' },
        siblings: (options.weights ?? ['model.safetensors']).map((rfilename) => ({
          rfilename,
          lfs: { size: 1_000_000_000 },
        })),
      });
    if (url === `https://huggingface.co/fixture/model/resolve/${commit}/config.json`)
      return Response.json({
        architectures: [options.architecture ?? 'LlamaForCausalLM'],
        ...(options.remoteCode ? { auto_map: { AutoModelForCausalLM: 'modeling_custom.CustomModel' } } : {}),
        num_hidden_layers: 2,
        num_key_value_heads: 2,
        num_attention_heads: 4,
        hidden_size: 128,
        max_position_embeddings: 8192,
      });
    if (url === `https://huggingface.co/fixture/model/resolve/${commit}/tokenizer_config.json`)
      return Response.json({
        ...(options.missingTemplate ? {} : { chat_template: options.template ?? '{{ messages }}' }),
        ...(options.tokenizerRemoteCode ? { auto_map: { AutoTokenizer: ['custom.Tokenizer', null] } } : {}),
      });
    if (url === 'https://huggingface.co/api/models/fixture/tokenizer/revision/stable?blobs=true')
      return Response.json({ sha: tokenizerCommit, siblings: [] });
    if (url === `https://huggingface.co/fixture/tokenizer/resolve/${tokenizerCommit}/tokenizer_config.json`)
      return Response.json({ chat_template: '{{ messages }}' });
    throw new Error(`Unexpected metadata URL: ${url}; authenticated=${Boolean(init?.headers)}`);
  });
  return fetch;
}
const inspection = (source = { kind: 'hugging_face' as const, repository: 'fixture/model' }) => ({
  source,
  task: 'text_generation' as const,
});

it('normalizes model URLs and resolves slash-containing references only through the explicit revision', () => {
  expect(
    normalizeHuggingFaceSource({
      kind: 'hugging_face',
      repository: 'https://huggingface.co/fixture/model/tree/stable',
    }),
  ).toEqual({ kind: 'hugging_face', repository: 'fixture/model', revision: 'stable' });
  expect(
    normalizeHuggingFaceSource({
      kind: 'hugging_face',
      repository: 'fixture/model',
      revision: 'feature/model',
    }),
  ).toHaveProperty('revision', 'feature/model');
});
it.each([
  'https://user:secret@huggingface.co/fixture/model',
  'https://example.test/fixture/model',
  'https://huggingface.co/datasets/fixture/model',
  'https://huggingface.co/spaces/fixture/model',
  'https://huggingface.co/fixture/model?download=1',
  'https://huggingface.co/fixture/model#readme',
  '../model',
  'fixture/../model',
  'https://huggingface.co/fixture/model/tree/%2e%2e',
  'https://huggingface.co/fixture/model/tree/feature%2Fbranch',
])('rejects non-model or unsafe source %s without a metadata request', (repository) => {
  expect(() => normalizeHuggingFaceSource({ kind: 'hugging_face', repository })).toThrow(
    expect.objectContaining({ code: 'unsupported_model_source' }),
  );
  expect(huggingFaceMetadataFetch).not.toHaveBeenCalled();
});
it('rejects conflicting URL/explicit revisions and unsafe selected weight paths', () => {
  expect(() =>
    normalizeHuggingFaceSource({
      kind: 'hugging_face',
      repository: 'https://huggingface.co/fixture/model/tree/stable',
      revision: 'another',
    }),
  ).toThrow(expect.objectContaining({ code: 'unsupported_model_source' }));
  expect(() =>
    normalizeHuggingFaceSource({
      kind: 'hugging_face',
      repository: 'fixture/model',
      weight_files: ['model*.safetensors'],
    }),
  ).toThrow(expect.objectContaining({ code: 'unsupported_model_source' }));
  expect(() =>
    normalizeHuggingFaceSource({
      kind: 'hugging_face',
      repository: 'fixture/model',
      weight_files: ['../model.safetensors'],
    }),
  ).toThrow(expect.objectContaining({ code: 'unsupported_model_source' }));
});

it('pins all reads to the resolved commit and preserves private access and license evidence without loading code', async () => {
  const fetch = fixtures({ gated: true });
  const result = await inspectHuggingFace(inspection(), 'fixture-hf-token');
  expect(result).toMatchObject({
    supported: true,
    source: { repository: 'fixture/model', revision: commit, weight_files: ['model.safetensors'] },
    license: 'apache-2.0',
    license_acknowledgement_required: true,
  });
  expect(result.memory_estimate_bytes).not.toBeNull();
  expect(result.runtime_profiles[0]).toMatchObject({
    profile_id: 'vllm-0.32.0-text',
    parameters: { context_window_tokens: 4096, max_concurrent_requests: 4 },
  });
  expect(fetch).toHaveBeenCalledTimes(3);
  for (const [, init] of fetch.mock.calls)
    expect(init).toMatchObject({ headers: { Authorization: 'Bearer fixture-hf-token' } });
  expect(fetch.mock.calls.map(([url]) => String(url))).not.toContain(
    `https://huggingface.co/fixture/model/resolve/main/config.json`,
  );
});

it.each([
  [{ remoteCode: true }, 'remote_code_required'],
  [{ tokenizerRemoteCode: true }, 'remote_code_required'],
  [{ missingTemplate: true }, 'missing_chat_template'],
  [{ architecture: 'FixtureEmbeddingModel' }, 'unsupported_architecture'],
  [{ weights: ['model.gguf'] }, 'unsupported_weight_format'],
  [{ weights: ['q4/model.safetensors', 'q8/model.safetensors'] }, 'ambiguous_weight_variant'],
  [
    {
      template: [
        { name: 'chat', template: '{{messages}}' },
        { name: 'other', template: '{{messages}}' },
      ],
    },
    'missing_chat_template',
  ],
] as const)(
  'reports definitive compatibility blocker %s without inventing a supported runtime',
  async (options, code) => {
    fixtures(options);
    const result = await inspectHuggingFace(inspection());
    expect(result.supported).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({ code }));
    expect(result.runtime_profiles).toEqual([]);
  },
);

it('follows a same-source pinned HF cache redirect without changing the commit or credential origin', async () => {
  const base = fixtures();
  const original = base.getMockImplementation();
  if (!original) throw new Error('Missing fixture transport');
  base.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === `https://huggingface.co/fixture/model/resolve/${commit}/config.json`)
      return new Response(null, {
        status: 307,
        headers: { location: `/api/resolve-cache/models/fixture/model/${commit}/config.json?etag=fixture` },
      });
    if (
      url ===
      `https://huggingface.co/api/resolve-cache/models/fixture/model/${commit}/config.json?etag=fixture`
    )
      return original(`https://huggingface.co/fixture/model/resolve/${commit}/config.json`, init);
    return original(input, init);
  });
  const result = await inspectHuggingFace(inspection(), 'fixture-hf-token');
  expect(result.supported).toBe(true);
  expect(base).toHaveBeenCalledTimes(4);
  expect(base.mock.calls.every(([url]) => new URL(String(url)).origin === 'https://huggingface.co')).toBe(
    true,
  );
});

it.each([
  'https://attacker.example.test/config.json',
  `/api/resolve-cache/models/fixture/other/${commit}/config.json`,
  `/api/resolve-cache/models/fixture/model/${tokenizerCommit}/config.json`,
])(
  'rejects a metadata redirect outside the exact source %s before forwarding credentials',
  async (location) => {
    const base = fixtures();
    const original = base.getMockImplementation();
    if (!original) throw new Error('Missing fixture transport');
    base.mockImplementation(async (input, init) =>
      String(input).endsWith('/config.json')
        ? new Response(null, { status: 307, headers: { location } })
        : original(input, init),
    );
    await expect(inspectHuggingFace(inspection(), 'fixture-hf-token')).rejects.toMatchObject({
      code: 'deployment_provider_unavailable',
    });
    expect(base.mock.calls.every(([url]) => !String(url).includes('attacker'))).toBe(true);
    expect(base).toHaveBeenCalledTimes(3);
  },
);

it('pins a separately selected tokenizer and checks only the selected weight variant', async () => {
  fixtures({ weights: ['q4/model.safetensors', 'q8/model.safetensors'] });
  const result = await inspectHuggingFace({
    source: {
      kind: 'hugging_face',
      repository: 'fixture/model',
      weight_files: ['q4/model.safetensors'],
      tokenizer: { repository: 'fixture/tokenizer', revision: 'stable' },
    },
    task: 'text_generation',
  });
  expect(result.supported).toBe(true);
  expect(result.source).toMatchObject({
    revision: commit,
    tokenizer: { repository: 'fixture/tokenizer', revision: tokenizerCommit },
    weight_files: ['q4/model.safetensors'],
  });
});

it('distinguishes inaccessible or unavailable metadata from a definitive unsupported model', async () => {
  vi.mocked(huggingFaceMetadataFetch).mockResolvedValue(new Response('', { status: 403 }));
  await expect(inspectHuggingFace(inspection())).rejects.toMatchObject({
    code: 'model_source_access_denied',
    status: 403,
  });
  vi.mocked(huggingFaceMetadataFetch).mockRejectedValue(new Error('fixture unavailable'));
  await expect(inspectHuggingFace(inspection())).rejects.toMatchObject({
    code: 'deployment_provider_unavailable',
    status: 503,
  });
});
