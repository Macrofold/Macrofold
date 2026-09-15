'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { clipboardUnavailable, useCopyFeedback } from '../lib/clipboard';
import { CopyButton, CopyFeedback } from './copy-button';
import { Button, Modal } from './ui';

/** Read the canonical public brief only when requested, keeping the shell bundle small. */
export function SetupPrompt({ label = 'Copy setup prompt', goal }: { label?: string; goal?: string }) {
  const [prompt, setPrompt] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { copy, status, copied } = useCopyFeedback(goal);
  const request = useRef(0);
  useEffect(() => {
    setBusy(false);
    setPrompt('');
    setOpen(false);
    setError('');
    return () => {
      request.current += 1;
    };
  }, [goal]);
  async function prepare() {
    const current = ++request.current;
    setBusy(true);
    setError('');
    try {
      const { setupPrompt } = await import('../lib/docs/content');
      if (current !== request.current) return;
      const text = setupPrompt(window.location.origin)
        .replace(
          'Deployment: [Macrofold Cloud, or my self-hosted/local origin.]',
          `Deployment: ${window.location.origin}`,
        )
        .replace(
          'Feature to build: [Describe what the user should be able to do.]',
          `Feature to build: ${goal || 'Add persistent agent execution to this application.'}`,
        );
      setPrompt(text);
      setOpen(true);
      await copy(text);
    } catch {
      if (current === request.current)
        setError('The setup guide could not be loaded. Open the Build with AI guide and copy its prompt.');
    } finally {
      if (current === request.current) setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="secondary"
        className="copy-button"
        aria-label={label}
        aria-description={status === 'error' ? clipboardUnavailable : undefined}
        busy={busy}
        onClick={prepare}
        data-copy-state={status}
      >
        <CopyFeedback status={status} copied={copied} label={label} />
      </Button>
      {error && (
        <p role="alert">
          {error} <a href="/docs/agents">Open guide</a>
        </p>
      )}
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Ready for your coding agent"
        description="Paste this into the agent working in your application. Keep API keys in your secret environment, never in chat."
        wide
      >
        <div className="setup-prompt-note">
          <Sparkles size={16} /> Includes your deployment URL and current documentation links.
        </div>
        <pre className="code-block setup-prompt-text" tabIndex={0}>
          {prompt}
        </pre>
        <div className="dialog-footer">
          <a className="text-link" href="/docs/agents">
            Read the setup guide
          </a>
          <CopyButton variant="primary" text={prompt} label="Copy prompt" />
        </div>
      </Modal>
    </>
  );
}
