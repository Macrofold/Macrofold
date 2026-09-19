'use client';
import { X } from 'lucide-react';
import { attachmentAccept, attachmentIssue } from '../../../packages/contracts/media';
import { Field } from './ui';
import './files/media-preview.css';
export type PendingAttachment = { file: File; path: string };

export function RunAttachments({
  value,
  onChange,
  onError,
  disabled,
}: {
  value: PendingAttachment[];
  onChange: (value: PendingAttachment[]) => void;
  onError: (message: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="run-attachments">
      <Field
        label="Attach files"
        hint="Up to 5 files · images 1 MiB / 2048 px · documents 10 MiB · 20 MiB total"
      >
        <input
          type="file"
          multiple
          disabled={disabled}
          accept={attachmentAccept}
          onChange={(event) => {
            const incoming = [...(event.target.files || [])];
            event.target.value = '';
            const next = [
              ...value,
              ...incoming.map((file) => ({ file, path: `attachments/${crypto.randomUUID()}/${file.name}` })),
            ];
            const issue = attachmentIssue(next.map(({ path, file }) => ({ path, size: file.size })));
            if (issue) {
              onError(issue.message);
              return;
            }
            onChange(next);
            onError('');
          }}
        />
      </Field>
      <p className="form-hint">
        Images need Codex with GPT-5.4 mini or Claude Code with a supported Claude model. PDF and DOCX
        attachments use extracted text; scans and embedded images are not analyzed. Files are saved to the
        selected worktree when you start the run.
      </p>
      {value.length > 0 && (
        <ul className="attachment-list">
          {value.map((item) => (
            <li key={item.path}>
              <span>{item.file.name}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${item.file.name}`}
                disabled={disabled}
                onClick={() => {
                  onChange(value.filter((entry) => entry !== item));
                  onError('');
                }}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
