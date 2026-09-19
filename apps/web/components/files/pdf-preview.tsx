'use client';
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { Button, ErrorState, Loading } from '../ui';
import { mediaLimits } from '../../../../packages/contracts/media';

/** Render passive pixels and plain text only. No PDF scripts, forms, or annotations.
 * PDF.js and its worker load on demand; one bounded page is rendered at a time. */
export default function PdfPreview({ url }: { url: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1),
    [text, setText] = useState('');
  const [error, setError] = useState<Error>(),
    [rendering, setRendering] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
    void (async () => {
      try {
        const lib = await import('pdfjs-dist');
        if (cancelled) return;
        lib.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();
        task = lib.getDocument({ url, maxImageSize: 16_000_000, verbosity: 0 });
        const document = await task.promise;
        if (document.numPages > mediaLimits.pdfPages) {
          await task.destroy();
          throw new Error('Download this PDF to view more than 100 pages.');
        }
        if (!cancelled) setPdf(document);
      } catch {
        if (!cancelled)
          setError(new Error('This PDF cannot be previewed. Download the original file to view it.'));
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [url]);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let cancelled = false;
    let renderingTask: RenderTask | undefined;
    setRendering(true);
    setText('');
    void (async () => {
      try {
        const current = await pdf.getPage(page);
        if (cancelled) return;
        const original = current.getViewport({ scale: 1 });
        const viewport = current.getViewport({
          scale: Math.min(1.5, 1600 / Math.max(original.width, original.height)),
        });
        const target = canvas.current!;
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        renderingTask = current.render({ canvas: target, viewport });
        await renderingTask.promise;
        const content = await current.getTextContent();
        if (!cancelled) {
          setText(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
          setRendering(false);
        }
        current.cleanup();
      } catch {
        if (!cancelled)
          setError(new Error('This PDF page cannot be previewed. Download the original file to view it.'));
      }
    })();
    return () => {
      cancelled = true;
      renderingTask?.cancel();
    };
  }, [pdf, page]);
  if (error) return <ErrorState error={error} />;
  return (
    <section className="pdf-preview" aria-label="PDF preview">
      {!pdf ? (
        <Loading />
      ) : (
        <div className="pdf-controls">
          <Button variant="secondary" disabled={page === 1 || rendering} onClick={() => setPage(page - 1)}>
            Previous page
          </Button>
          <span aria-live="polite">
            Page {page} of {pdf.numPages}
          </span>
          <Button
            variant="secondary"
            disabled={page === pdf.numPages || rendering}
            onClick={() => setPage(page + 1)}
          >
            Next page
          </Button>
        </div>
      )}
      <canvas ref={canvas} aria-hidden="true" hidden={rendering} />
      {pdf && rendering && <Loading />}
      <p className="sr-only">
        {text || (!rendering ? 'This page has no extractable text. Download it for another viewer.' : '')}
      </p>
    </section>
  );
}
