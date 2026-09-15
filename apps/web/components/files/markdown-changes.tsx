'use client';
import { diffLines } from 'diff';
import { useState } from 'react';
import { MarkdownPreview } from './markdown-preview';
import './rich-markdown.css';

/** Compare the live draft to its last confirmed save, without requesting or inventing history. */
export default function MarkdownChanges({
  before,
  after,
  filePath,
  onOpenFile,
}: {
  before: string;
  after: string;
  filePath: string;
  onOpenFile: (path: string, anchor?: string) => void;
}) {
  const [rich, setRich] = useState(true);
  return (
    <div className="markdown-changes">
      <div className="rich-diff-heading">
        <span>Changes since last save</span>
        <div className="view-switcher">
          <button aria-pressed={rich} onClick={() => setRich(true)}>
            Rich diff
          </button>
          <button aria-pressed={!rich} onClick={() => setRich(false)}>
            Source diff
          </button>
        </div>
      </div>
      {before === after ? (
        <p className="rich-editor-note">No unsaved changes.</p>
      ) : (
        diffLines(before, after).map((part, index) => (
          <div
            key={index}
            className={`markdown-change ${part.added ? 'added' : part.removed ? 'removed' : ''}`}
          >
            <span className="sr-only">{part.added ? 'Added' : part.removed ? 'Removed' : 'Unchanged'}</span>
            {rich ? (
              <MarkdownPreview content={part.value} filePath={filePath} onOpenFile={onOpenFile} />
            ) : (
              <pre>{part.value}</pre>
            )}
          </div>
        ))
      )}
    </div>
  );
}
