'use client';
import { useState } from 'react';
import { Upload, File, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { uploadWorktreeFiles } from '../lib/upload-workspace-files';
import { type Schema } from '../lib/client';
import { Button, Field, Modal } from './ui';
export function FileUpload({
  worktree,
  disabled,
  directory = '',
}: {
  worktree: Schema['Worktree'];
  disabled?: boolean;
  directory?: string;
}) {
  const [open, setOpen] = useState(false),
    [files, setFiles] = useState<globalThis.File[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState('');
  const client = useQueryClient();
  const remotePath = (file: globalThis.File) => (directory ? `${directory}/${file.name}` : file.name);
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
      await uploadWorktreeFiles(
        worktree.id,
        files.map((file) => ({ file, path: remotePath(file) })),
        setProgress,
      );
      await client.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return (
            typeof key[0] === 'string' &&
            (key[0].startsWith(`/v1/worktrees/${worktree.id}`) ||
              (key[0] === 'file' && key[1] === worktree.id))
          );
        },
      });
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
        description={`Upload files to ${directory || 'the worktree root'}. Matching filenames replace their current version; earlier checkpoints preserve your history.`}
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
