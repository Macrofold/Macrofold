import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyModelPolicy,
  rateCardVersion,
  tokenPrice,
  type DiscoveredModel,
} from '../../packages/core/src/model-policy';
import { providerModelCatalog } from '../../packages/providers/src/model-catalog';

afterEach(() => vi.unstubAllEnvs());
const routed = (overrides: Partial<DiscoveredModel> = {}): DiscoveredModel => ({
  id: 'openai/gpt-5.4-mini',
  name: 'Upstream',
  tools: true,
    context_tokens: 128000,
    output_tokens: 8192,
  text: true,
  pricing: {
    prompt: '0.00000075',
    completion: '0.0000045',
    request: '0',
    input_cache_read: '0.000000075',
    web_search: '0.01',
  },
  ...overrides,
});

describe('reviewed model policy', () => {
  it.each([
    ['0', '0'],
    ['0.00000075', '750000'],
    ['0.0000000000001', '1'],
    ['0.000004500000000001', '4500001'],
    ['-1', undefined],
    ['NaN', undefined],
    ['1e-6', undefined],
    ['1\n', undefined],
    ['1000', undefined],
    [0, undefined],
    [null, undefined],
  ])('converts price %j without floating point or rounding down', (input, expected) => {
    expect(tokenPrice(input)).toBe(expected);
  });
  it('ships usable direct-provider defaults without enabling unreviewed discoveries', () => {
    expect(applyModelPolicy('openai')[0]).toMatchObject({ enabled: true, harnesses: ['codex', 'opencode', 'hermes', 'deepseek', 'pi'] });
    expect(applyModelPolicy('openai', [{ id: 'unknown', name: 'Unknown' }])[0].enabled).toBe(false);
    expect(
      applyModelPolicy('openai', [{ id: 'unknown', name: 'Unknown' }]).some((m) => m.id === 'unknown'),
    ).toBe(false);
    expect(applyModelPolicy('openrouter')[0].enabled).toBe(false);
    expect(applyModelPolicy('anthropic').every((model) => !model.harnesses.includes('codex'))).toBe(true);
  });
  it('admits new compatible OpenRouter models without widening native protocol families', () => {
    const model = applyModelPolicy('openrouter', [routed({ id: 'example/new-model', name: 'New model' })])[0];
    expect(model).toMatchObject({ id: 'example/new-model', name: 'New model', enabled: true,
      harnesses: ['opencode', 'hermes', 'deepseek', 'pi'], input_micro_usd_per_million: '750000' });
    expect(applyModelPolicy('openrouter', [routed({ id: 'openrouter/auto' })])).toEqual([]);
  });
  it('versions accepted prices independently of display metadata', () => {
    const model = applyModelPolicy('openrouter', [routed()])[0];
    expect(model).toMatchObject({
      enabled: true,
      input_micro_usd_per_million: '750000',
      output_micro_usd_per_million: '4500000',
    });
    expect(rateCardVersion(model)).toBe(rateCardVersion({ ...model, name: 'Renamed', enabled: false }));
    expect(rateCardVersion(model)).not.toBe(
      rateCardVersion({ ...model, output_micro_usd_per_million: '4500001' }),
    );
  });
  it.each([
    { pricing: undefined },
    { pricing: { prompt: '-1', completion: '0' } },
    { pricing: { prompt: '0.1', completion: '0.1', request: '0.01' } },
    { pricing: { prompt: '0.1', completion: '0.1', unknown_fee: { tier: 1 } } },
    { pricing: { prompt: '0.1', completion: '0.1', input_cache_read: '0.2' } },
    { pricing: { prompt: '0.1', completion: '0.1', input_cache_write: '0.01' } },
    { context_tokens: 32000 },
    { context_tokens: undefined },
    { output_tokens: 4096 },
    { output_tokens: undefined },
    { tools: false },
    { text: false },
  ])('disables routes with missing capabilities or unaccounted charges: %j', (overrides) => {
    expect(applyModelPolicy('openrouter', [routed(overrides)])[0].enabled).toBe(false);
  });
});

describe('provider model discovery', () => {
  it('uses only the fixed OpenAI metadata endpoint and strips unneeded account metadata', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'synthetic');
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe('https://api.openai.com/v1/models');
      expect(init).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer synthetic' } });
      return Response.json({ data: [{ id: 'gpt-5.4-mini', owned_by: 'private-account' }] });
    });
    expect(await providerModelCatalog(transport)('openai')).toEqual([
      { id: 'gpt-5.4-mini', name: 'gpt-5.4-mini' },
    ]);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('does not read customer credentials or send an OpenRouter key to public discovery', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('OPENROUTER_API_KEY', 'must-not-send');
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe('https://openrouter.ai/api/v1/models');
      expect(init?.headers).toEqual({});
      return Response.json({
        data: [
          {
            ...routed(),
            context_length: 128000,
            top_provider: { context_length: 128000, max_completion_tokens: 8192 },
            supported_parameters: ['tools'],
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
          },
        ],
      });
    });
    const source = providerModelCatalog(transport);
    expect(await source('openai')).toBeUndefined();
    expect(await source('anthropic')).toBeUndefined();
    expect(await source('openrouter')).toEqual([routed()]);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('collects Anthropic pages completely with a bounded, encoded cursor', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic');
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      expect(init?.headers).toMatchObject({ 'x-api-key': 'synthetic', 'anthropic-version': '2023-06-01' });
      return new URL(String(url)).searchParams.has('after_id')
        ? Response.json({ data: [{ id: 'second', display_name: 'Second' }], has_more: false })
        : Response.json({ data: [{ id: 'first', display_name: 'First' }], has_more: true, last_id: 'first' });
    });
    expect(await providerModelCatalog(transport)('anthropic')).toEqual([
      { id: 'first', name: 'First' },
      { id: 'second', name: 'Second' },
    ]);
    expect(String(transport.mock.calls[1][0])).toContain('after_id=first');
  });
  it.each(['cursor', 'missing-cursor', 'duplicates', 'invalid-json', 'oversized', 'rate-limit'])(
    'rejects %s without retrying or accepting partial discovery',
    async (kind) => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic');
      const transport = vi.fn<typeof fetch>(async () => {
        if (kind === 'rate-limit') return new Response('secret provider error', { status: 429 });
        if (kind === 'invalid-json') return new Response('{');
        if (kind === 'oversized') return new Response('x'.repeat(8 * 1024 * 1024 + 1));
        if (kind === 'duplicates') return Response.json({ data: [{ id: 'same' }, { id: 'same' }] });
        return Response.json({
          data: [{ id: 'same' }],
          has_more: true,
          ...(kind === 'cursor' ? { last_id: 'same' } : {}),
        });
      });
      await expect(providerModelCatalog(transport)('anthropic')).rejects.toThrow();
      expect(transport.mock.calls.length).toBe(kind === 'cursor' ? 2 : 1);
    },
  );
});
