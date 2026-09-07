'use client';
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
export function DocsCopy({ text, label = 'Copy page' }: { text: string; label?: string }) {
  const [status, setStatus] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied');
    } catch {
      setStatus('Copy unavailable');
    }
  }
  return (
    <button type="button" className="docs-copy" onClick={copy} aria-label={label}>
      {status === 'Copied' ? <Check size={14} /> : <Copy size={14} />}
      <span aria-live="polite">{status || label}</span>
    </button>
  );
}
