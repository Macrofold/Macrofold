import { harnesses } from '../../../packages/contracts/harnesses';
import { isSearchProvider, searchProviders } from '../../../packages/contracts/search';

const localMarks: Record<string, string> = {
  openai: 'openai-mark.svg',
  codex: 'codex.svg',
  codex_subscription: 'codex.svg',
  anthropic: 'anthropic.svg',
  claude: 'claude.svg',
  'claude-code': 'claude.svg',
  claude_subscription: 'claude.svg',
  opencode: 'opencode.svg',
  hermes: 'hermes.png',
  deepseek: 'deepseek.svg',
  pi: 'pi.svg',
  openrouter: 'openrouter.svg',
  brave: 'brave.svg',
  exa: 'exa.svg',
  tavily: 'tavily.svg',
  parallel: 'parallel.svg',
  firecrawl: 'firecrawl.svg',
  mcp_remote: 'mcp.svg',
  mcp_stdio: 'mcp.svg',
};
const aliases: Record<string, string> = {
  'claude code': 'claude-code',
  'deepseek harness': 'deepseek',
  'nous research': 'hermes',
  nousresearch: 'hermes',
};
function keyFor(provider: string): string {
  const key = provider.trim().toLowerCase();
  return Object.hasOwn(aliases, key) ? aliases[key] : key;
}
const displayNames: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  claude: 'Claude',
  claude_subscription: 'Claude subscription',
  codex_subscription: 'Codex subscription',
  openrouter: 'OpenRouter',
  gmail: 'Gmail',
  googledrive: 'Google Drive',
  github: 'GitHub',
};

export function providerName(provider: string) {
  const key = keyFor(provider);
  if (isSearchProvider(key)) return searchProviders[key].name;
  return (
    harnesses.find((harness) => harness.id === key)?.name ||
    (Object.hasOwn(displayNames, key)
      ? displayNames[key]
      : provider.charAt(0).toUpperCase() + provider.slice(1))
  );
}

/** Branding never changes provider IDs or account selection. */
export function providerLogoSource(provider: string): string | undefined {
  const key = keyFor(provider);
  // The broker is an implementation detail, never a displayed service mark.
  if (key === 'composio' || key === 'fixture') return undefined;
  const local = Object.hasOwn(localMarks, key) ? localMarks[key] : undefined;
  if (local) return `/brands/${local}`;
  if (/^[a-z0-9_][a-z0-9_-]{0,99}$/.test(key)) return `https://logos.composio.dev/api/${key}`;
  return undefined;
}

export function modelLogoProvider(model: { id: string; provider: string }): string {
  const provider = keyFor(model.provider);
  if (provider === 'anthropic') return 'claude';
  // OpenRouter IDs identify the publisher before the slash, independently of transport.
  if (provider === 'openrouter' && model.id.includes('/')) {
    const publisher = model.id.split('/')[0];
    if (publisher && /^[a-z0-9_-]+$/i.test(publisher))
      return keyFor(publisher) === 'anthropic' ? 'claude' : keyFor(publisher);
  }
  return provider;
}

export function connectionLogoProvider(connection: { kind: string; provider?: string | null }): string {
  return connection.kind === 'claude_subscription' ? connection.kind : connection.provider || connection.kind;
}
