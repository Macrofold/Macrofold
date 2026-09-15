'use client';
import { CopyButton } from './copy-button';
export function DocsCopy({ text, label = 'Copy page' }: { text: string; label?: string }) {
  return <CopyButton variant="plain" className="docs-copy" text={text} label={label} />;
}
