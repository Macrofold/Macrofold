'use client';
import { CopyButton } from './copy-button';
import { useState } from 'react';
import { Terminal } from 'lucide-react';
import { Button, Modal } from './ui';

export function TerminalHandoff({ workspaceId, worktreeId }: { workspaceId: string; worktreeId: string }) {
  const [open, setOpen] = useState(false);
  const origin = typeof window === 'undefined' ? 'https://your-domain.example' : window.location.origin;
  // Shell quoting prevents a configured origin from becoming executable shell syntax.
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const commands = `macrofold login --host ${quote(origin)}\nmacrofold link ${quote(workspaceId)} --worktree ${quote(worktreeId)}\nmacrofold doctor\nmacrofold chat --harness codex --model YOUR_ENABLED_MODEL`;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Terminal size={15} /> Open in CLI
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Take this worktree to your terminal"
        description="Your agent and files stay hosted. Linking selects this worktree without uploading local files."
      >
        <p className="form-hint">
          Install the CLI using the Developer guide, then run these commands in your local workspace folder.
          Choose an enabled model from macrofold doctor.
        </p>
        <pre className="code-block">{commands}</pre>
        <div className="dialog-actions">
          <CopyButton text={commands} label="Copy commands" />
        </div>
      </Modal>
    </>
  );
}
