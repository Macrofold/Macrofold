import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { harnesses } from '../../packages/contracts/harnesses';
import {
  connectionLogoProvider,
  modelLogoProvider,
  providerLogoSource,
  providerName,
} from '../../apps/web/lib/provider-branding';

describe('provider branding', () => {
  it('ships an independent, local mark for every supported harness', () => {
    const sources = harnesses.map(({ id }) => providerLogoSource(id));
    expect(new Set(sources).size).toBe(harnesses.length);
    for (const source of sources) {
      expect(source).toMatch(/^\/brands\/[a-z-]+\.(svg|png)$/);
      expect(existsSync(`apps/web/public${source}`)).toBe(true);
    }
    for (const harness of harnesses) expect(providerName(harness.id)).toBe(harness.name);
  });

  it('keeps the Codex mark black on a white plate and subscriptions on their product marks', () => {
    const source = providerLogoSource('codex');
    expect(source).toBe('/brands/codex.svg');
    const artwork = readFileSync(`apps/web/public${source}`, 'utf8');
    expect(artwork).toContain('fill="#fff"');
    expect(artwork).toContain('fill="#000"');
    expect(providerLogoSource('codex_subscription')).toBe(source);
    expect(providerLogoSource('claude_subscription')).toBe('/brands/claude.svg');
    expect(
      providerLogoSource(connectionLogoProvider({ kind: 'claude_subscription', provider: 'anthropic' })),
    ).toBe('/brands/claude.svg');
    expect(connectionLogoProvider({ kind: 'model', provider: 'anthropic' })).toBe('anthropic');
  });

  it('uses the model publisher independently of its routing provider', () => {
    expect(modelLogoProvider({ id: 'gpt-example', provider: 'openai' })).toBe('openai');
    expect(modelLogoProvider({ id: 'claude-example', provider: 'anthropic' })).toBe('claude');
    expect(modelLogoProvider({ id: 'openai/gpt-example', provider: 'openrouter' })).toBe('openai');
    expect(modelLogoProvider({ id: 'anthropic/claude-example', provider: 'openrouter' })).toBe('claude');
    expect(modelLogoProvider({ id: 'deepseek/example', provider: 'openrouter' })).toBe('deepseek');
    expect(modelLogoProvider({ id: 'unknown', provider: 'openrouter' })).toBe('openrouter');
    expect(modelLogoProvider({ id: '../escape', provider: 'openrouter' })).toBe('openrouter');
    expect(modelLogoProvider({ id: 'fixture-model', provider: 'fixture' })).toBe('fixture');
  });

  it('never requests a broker logo, while retaining individual app marks', () => {
    for (const provider of ['composio', 'Composio', ' COMPOSIO ', 'fixture'])
      expect(providerLogoSource(provider)).toBeUndefined();
    expect(providerLogoSource('gmail')).toBe('https://logos.composio.dev/api/gmail');
    expect(providerLogoSource(connectionLogoProvider({ kind: 'composio', provider: 'slack' }))).toBe(
      'https://logos.composio.dev/api/slack',
    );
    expect(providerLogoSource(connectionLogoProvider({ kind: 'composio' }))).toBeUndefined();
    expect(providerLogoSource('__proto__')).toBe('https://logos.composio.dev/api/__proto__');
    expect(providerName('constructor')).toBe('Constructor');
  });

  it.each(['../openai', 'https://example.test/image.svg', 'name?secret=x', '<svg>', 'a/b', 'x'.repeat(101)])(
    'does not turn arbitrary provider values into image requests: %s',
    (provider) => expect(providerLogoSource(provider)).toBeUndefined(),
  );
});
