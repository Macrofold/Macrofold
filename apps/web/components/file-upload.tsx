'use client';
import { useState } from 'react';
import { Upload, File, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { api, type Schema } from '../lib/client';
import { Button, Field, Modal } from './ui';
export function FileUpload({ workspace, disabled }: { workspace: Schema['Workspace']; disabled?: boolean }) {
  const [open, setOpen] = useState(false),
    [files, setFiles] = useState<globalThis.File[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState('');
  const client = useQueryClient();
  function choose(incoming: globalThis.File[]) {
    const next = [...new Map([...files, ...incoming].map((f) => [f.name, f])).values()];
    if (
      next.some((f) => f.size > 25 * 1024 * 1024) ||
      next.length > 1000 ||
      next.reduce((n, f) => n + f.size, 0) > 250 * 1024 * 1024
    ) {
      setError('Choose up to 1,000 files, 25 MiB per file and 250 MiB in total.');
      return;
    }
    setFiles(next);
    setError('');
  }
  async function upload() {
    setBusy(true);
    setError('');
    try {
      setProgress('Preparing your files…');
      const current = await api<Schema['Workspace']>(`/v1/workspaces/${workspace.id}`);
      const entries: Schema['FileEntry'][] = [];
      let cursor: string | null = null;
      do {
        const page: Schema['FileListing'] = await api<Schema['FileListing']>(
          `/v1/workspaces/${workspace.id}/files?limit=100${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`,
        );
        entries.push(...page.entries);
        cursor = page.next_cursor;
      } while (cursor);
      const manifest = [];
      for (const file of files) {
        const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        manifest.push({
          path: file.name,
          local_sha256: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''),
          local_size_bytes: file.size,
          baseline_known: true,
          baseline_sha256: entries.find((e) => e.path === file.name)?.sha256 || null,
        });
      }
      const plan = await api<Schema['Transfer']>(`/v1/workspaces/${workspace.id}/transfers`, 'POST', {
        direction: 'push',
        base_revision: current.revision,
        paths: files.map((f) => f.name),
        manifest,
      });
      if (plan.status === 'conflicted')
        throw new Error(
          'Some paths conflict with remote files. Rename those files or use the CLI to resolve them.',
        );
      let count = 0;
      for (const action of plan.actions.filter((a) => a.action === 'upload')) {
        setProgress(
          `Uploading ${++count} of ${plan.actions.filter((a) => a.action === 'upload').length}: ${action.path}`,
        );
        const headers = { ...action.required_headers };
        // Browsers set Content-Length from the File body; JavaScript may not set it.
        for (const key of Object.keys(headers))
          if (key.toLowerCase() === 'content-length') delete headers[key];
        const response = await fetch(action.url!, {
          method: 'PUT',
          headers,
          body: files.find((f) => f.name === action.path)!,
          credentials: 'omit',
          redirect: 'error',
        });
        if (!response.ok)
          throw new Error(
            `Upload failed for ${action.path} (${response.status}). Your project is unchanged.`,
          );
      }
      setProgress('Verifying and saving your checkpoint…');
      await api(`/v1/transfers/${plan.id}/apply`, 'POST', { expected_revision: current.revision });
      await client.invalidateQueries();
      setOpen(false);
      setFiles([]);
      toast.success('Files uploaded and checkpointed');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }
  return (
    <>
      <button
        className="icon-button"
        title="Upload files"
        aria-label="Upload files"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          setError('');
        }}
      >
        <Upload size={16} />
      </button>
      <Modal
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
        title="Bring your files"
        description="Upload files to this workspace. Matching filenames replace their current version; earlier checkpoints preserve your history."
      >
        <div className="form-stack">
          <div
            className="upload-zone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!busy) choose([...e.dataTransfer.files]);
            }}
          >
            <Upload size={24} />
            <strong>Drop files here</strong>
            <Field label="Choose files" hint="25 MiB per file · 250 MiB per upload">
              <input
                type="file"
                multiple
                disabled={busy}
                onChange={(e) => {
                  choose([...(e.target.files || [])]);
                  e.target.value = '';
                }}
              />
            </Field>
          </div>
          {files.length > 0 && (
            <div className="upload-list">
              {files.map((file) => (
                <div key={file.name}>
                  <File size={15} />
                  <span>
                    {file.name}
                    <small>{(file.size / 1024).toFixed(1)} KiB</small>
                  </span>
                  <button
                    className="icon-button"
                    aria-label={'Remove ' + file.name}
                    disabled={busy}
                    onClick={() => setFiles(files.filter((f) => f.name !== file.name))}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {progress && <p role="status">{progress}</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button busy={busy} disabled={!files.length} onClick={upload}>
            Upload {files.length || ''} {files.length === 1 ? 'file' : 'files'}
          </Button>
        </div>
      </Modal>
    </>
  );
}
