'use client';

import { useDeferredValue } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { markdownTaskLabels } from '../lib/markdown-accessibility';

const remarkPlugins = [remarkGfm];
const rehypePlugins = [markdownTaskLabels];

/** Keep typing/navigation responsive while parsing live Markdown. New blocks fade once;
 * existing text stays visible, and final/replayed output is never artificially paced. */
export function MarkdownOutput({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const deferred = useDeferredValue(text);
  return (
    <div className="markdown-output" data-streaming={streaming || undefined}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {streaming ? deferred : text}
      </ReactMarkdown>
    </div>
  );
}
