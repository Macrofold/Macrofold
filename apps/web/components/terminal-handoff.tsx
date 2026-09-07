'use client';
import { copyText } from '../lib/clipboard';
import { useState } from 'react';
import { Copy, Terminal } from 'lucide-react';
import { Button, Modal } from './ui';

export function TerminalHandoff({ projectId, workspaceId }: { projectId: string; workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const origin = typeof window === 'undefined' ? 'https://your-domain.example' : window.location.origin;
  // Shell quoting prevents a configured origin from becoming executable shell syntax.
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const commands = `agent login --host ${quote(origin)}\nagent link ${quote(projectId)} --workspace ${quote(workspaceId)}\nagent doctor\nagent chat --harness codex --model YOUR_ENABLED_MODEL`;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Terminal size={15} /> Open in CLI
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Take this workspace to your terminal"
        description="Your agent and files stay hosted. Linking selects this workspace without uploading local files."
      >
        <p className="form-hint">
          Install the CLI using the Developer guide, then run these commands in your local project folder.
          Choose an enabled model from agent doctor.
        </p>
        <pre className="code-block">{commands}</pre>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => copyText(commands, 'Terminal commands copied')}>
            <Copy size={15} /> Copy commands
          </Button>
        </div>
      </Modal>
    </>
  );
}
