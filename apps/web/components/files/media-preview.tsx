'use client';
import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { mediaFormat } from '../../../../packages/contracts/media';
import { Empty, ErrorState, Loading } from '../ui';
import './media-preview.css';
const PdfPreview = dynamic(() => import('./pdf-preview'), { ssr: false, loading: () => <Loading /> });

/** Only passive, allowlisted formats are embedded, from an authorized download.
 * Blob URLs are page-local and revoked on replacement/unmount. No HTML/SVG. */
export function MediaPreview({
  worktreeId,
  path,
  revision,
  size,
}: {
  worktreeId: string;
  path: string;
  revision: string;
  size: number;
}) {
  const format = mediaFormat(path);
  const [url, setUrl] = useState(''),
    [error, setError] = useState<Error>();
  const [attempt, setAttempt] = useState(0);
  const supported =
    format && ['image', 'pdf', 'video', 'audio'].includes(format.kind) && size <= 25 * 1024 * 1024;
  useEffect(() => {
    if (!supported) return;
    const controller = new AbortController();
    let objectURL = '';
    setUrl('');
    setError(undefined);
    void (async () => {
      try {
        const response = await fetch(
          `/v1/worktrees/${worktreeId}/file?path=${encodeURIComponent(path)}&download=true`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error('This file could not be loaded. Download it or try again.');
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        const reader = response.body?.getReader();
        if (!reader) throw new Error('This file has no content.');
        let total = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            total += part.value.byteLength;
            if (total > 25 * 1024 * 1024) throw new Error('Download this file to view it.');
            chunks.push(new Uint8Array(part.value));
          }
        } finally {
          await reader.cancel();
        }
        if (controller.signal.aborted) return;
        objectURL = URL.createObjectURL(new Blob(chunks, { type: format.mime }));
        setUrl(objectURL);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause as Error);
      }
    })();
    return () => {
      controller.abort();
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [worktreeId, path, revision, supported, format?.mime, attempt]);
  if (!supported)
    return (
      <Empty
        icon={<FileText />}
        title="Download to view"
        description="This file is preserved in its original format. Use the download button above to open it in your preferred app."
      />
    );
  if (error) return <ErrorState error={error} retry={() => setAttempt((value) => value + 1)} />;
  if (!url) return <Loading />;
  const cannotPreview = () =>
    setError(
      new Error('This file cannot be previewed in your browser. Download the original file to view it.'),
    );
  return (
    <div className="media-preview">
      {format.kind === 'image' ? (
        <img src={url} alt={path.split('/').pop()} onError={cannotPreview} />
      ) : format.kind === 'video' ? (
        <video src={url} controls preload="metadata" aria-label={path} onError={cannotPreview} />
      ) : format.kind === 'audio' ? (
        <audio src={url} controls preload="metadata" aria-label={path} onError={cannotPreview} />
      ) : (
        <PdfPreview key={url} url={url} />
      )}
      <p className="form-hint">
        {format.kind === 'video' || format.kind === 'audio'
          ? 'Playback depends on your browser’s supported codecs. Automatic analysis is not available.'
          : 'Original file preview. Download is available above.'}
      </p>
    </div>
  );
}
