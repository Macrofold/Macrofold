'use client';
import { useState } from 'react';
import { PlugZap } from 'lucide-react';

const local: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  openrouter: 'openrouter',
  brave: 'brave',
  mcp_remote: 'mcp',
  mcp_stdio: 'mcp',
  codex: 'openai',
  'claude-code': 'anthropic',
};
export const providerName = (provider: string) =>
  ({
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    openrouter: 'OpenRouter',
    brave: 'Brave Search',
    gmail: 'Gmail',
    googledrive: 'Google Drive',
    github: 'GitHub',
  })[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);

/** Brand images are decorative alongside an accessible text label. Never inline
 * third-party SVG markup; the browser's image context isolates remote assets. */
export function ProviderLogo({
  provider,
  name,
  size = 36,
}: {
  provider: string;
  name?: string;
  size?: number;
}) {
  const src = local[provider]
    ? `/brands/${local[provider]}.svg`
    : /^[a-z0-9_][a-z0-9_-]{0,99}$/.test(provider)
      ? `https://logos.composio.dev/api/${provider}`
      : '';
  const [failed, setFailed] = useState('');
  return (
    <span className="provider-logo" style={{ width: size, height: size }} aria-hidden="true">
      {src && failed !== src ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(src)}
        />
      ) : name ? (
        <span className="provider-initial">{name.charAt(0).toUpperCase()}</span>
      ) : (
        <PlugZap size={size * 0.65} />
      )}
    </span>
  );
}
export function ProviderLabel({ provider }: { provider: string }) {
  return (
    <span className="provider-label">
      <ProviderLogo provider={provider} size={19} />
      {providerName(provider)}
    </span>
  );
}
