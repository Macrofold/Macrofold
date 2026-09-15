'use client';
import { useState } from 'react';
import { FlaskConical, PlugZap } from 'lucide-react';
import { providerLogoSource, providerName } from '../lib/provider-branding';
import './provider-logo.css';
export { providerName } from '../lib/provider-branding';

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
  const src = providerLogoSource(provider);
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
      ) : provider === 'fixture' ? (
        <FlaskConical size={size * 0.72} />
      ) : name && provider.trim().toLowerCase() !== 'composio' ? (
        <span className="provider-initial">{name.charAt(0).toUpperCase()}</span>
      ) : (
        <PlugZap size={size * 0.65} />
      )}
    </span>
  );
}
export function ProviderLabel({ provider, name }: { provider: string; name?: string }) {
  return (
    <span className="provider-label">
      <ProviderLogo provider={provider} size={19} />
      <span>{name || providerName(provider)}</span>
    </span>
  );
}
