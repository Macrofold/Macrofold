'use client';

// Preview composition adapted from MIT-licensed Orca; see ORCA-LICENSE.txt.
import { ExternalLink, FileImage, ListTree } from 'lucide-react';
import { Children, isValidElement, memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { markdownTaskLabels } from '../../lib/markdown-accessibility';
import { CopyButton } from '../copy-button';
import { extractMarkdownFrontMatter, resolveMarkdownLink, worktreeHeadingAnchors } from './markdown-model';
import './files.css';

const remarkPlugins = [remarkGfm];
const rehypePlugins = [worktreeHeadingAnchors, markdownTaskLabels];

function plainText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      return isValidElement<{ children?: ReactNode }>(child) ? plainText(child.props.children) : '';
    })
    .join('');
}

const MarkdownBody = memo(function MarkdownBody({
  content,
  components,
}: {
  content: string;
  components: Components;
}) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
      {content}
    </ReactMarkdown>
  );
});

export function MarkdownPreview({
  content,
  filePath = '',
  onOpenFile,
  initialAnchor,
}: {
  content: string;
  filePath?: string;
  onOpenFile?: (path: string, anchor?: string) => void;
  initialAnchor?: string | null;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const onOpenFileRef = useRef(onOpenFile);
  const canOpenFile = Boolean(onOpenFile);
  const [outline, setOutline] = useState<{ id: string; title: string; level: number }[]>([]);
  const frontMatter = useMemo(() => extractMarkdownFrontMatter(content), [content]);
  const body = frontMatter?.body ?? content;
  useEffect(() => {
    onOpenFileRef.current = onOpenFile;
  }, [onOpenFile]);

  // Renderer identity owns block state. Reset it for a changed document, not a refreshed callback.
  const components = useMemo<Components>(() => {
    const openAnchor = (anchor: string) => {
      const heading = Array.from(
        bodyRef.current?.querySelectorAll<HTMLElement>('[data-worktree-heading]') ?? [],
      ).find((element) => element.dataset.worktreeHeading === anchor || element.id === anchor);
      heading?.scrollIntoView({ block: 'start' });
      heading?.focus({ preventScroll: true });
    };
    return {
      a: ({ href, children, title }) => {
        const link = resolveMarkdownLink(href ?? '', filePath);
        if (link.kind === 'external')
          return (
            <a
              href={link.href}
              title={title}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
            >
              {children}
              <ExternalLink size={11} aria-hidden="true" />
            </a>
          );
        if (link.kind === 'anchor')
          return (
            <a
              href={`#worktree-heading-${link.anchor}`}
              title={title}
              onClick={(event) => {
                event.preventDefault();
                openAnchor(link.anchor);
              }}
            >
              {children}
            </a>
          );
        if (link.kind === 'file' && canOpenFile)
          return (
            <button
              type="button"
              className="worktree-markdown-link"
              title={link.path}
              onClick={() => onOpenFileRef.current?.(link.path, link.anchor)}
            >
              {children}
            </button>
          );
        return (
          <span title={link.kind === 'blocked' ? 'This link is unavailable in the preview' : link.path}>
            {children}
          </span>
        );
      },
      img: ({ src, alt }) => {
        const link = resolveMarkdownLink(typeof src === 'string' ? src : '', filePath);
        const caption = alt || (link.kind === 'file' ? link.path : 'Image');
        if (link.kind === 'file' && canOpenFile)
          return (
            <button
              type="button"
              className="worktree-markdown-image"
              onClick={() => onOpenFileRef.current?.(link.path)}
            >
              <FileImage size={20} aria-hidden="true" />
              <span>
                {caption}
                <small>Open worktree image</small>
              </span>
            </button>
          );
        if (link.kind === 'external' && /^https?:/i.test(link.href))
          return (
            <a
              className="worktree-markdown-image"
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
            >
              <FileImage size={20} aria-hidden="true" />
              <span>
                {caption}
                <small>Open external image</small>
              </span>
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          );
        return (
          <span className="worktree-markdown-image">
            <FileImage size={20} aria-hidden="true" />
            {caption}
          </span>
        );
      },
      pre: ({ children }) => {
        const code = Children.toArray(children).find((child) => isValidElement(child));
        const language = isValidElement<{ className?: string }>(code)
          ? code.props.className?.replace(/^language-/, '')
          : undefined;
        return (
          <div className="worktree-markdown-code">
            <div className="worktree-markdown-codebar">
              <span>{language || 'Code'}</span>
              <CopyButton text={plainText(children).replace(/\n$/, '')} label="Copy code" variant="plain" />
            </div>
            <pre>{children}</pre>
          </div>
        );
      },
      table: ({ children }) => (
        <div className="worktree-markdown-table" tabIndex={0} role="region" aria-label="Markdown table">
          <table>{children}</table>
        </div>
      ),
      h1: ({ children, ...props }) => (
        <h1
          id={props.id}
          tabIndex={-1}
          data-worktree-heading={props.node?.properties['data-worktree-heading']}
        >
          {children}
        </h1>
      ),
      h2: ({ children, ...props }) => (
        <h2
          id={props.id}
          tabIndex={-1}
          data-worktree-heading={props.node?.properties['data-worktree-heading']}
        >
          {children}
        </h2>
      ),
      h3: ({ children, ...props }) => (
        <h3
          id={props.id}
          tabIndex={-1}
          data-worktree-heading={props.node?.properties['data-worktree-heading']}
        >
          {children}
        </h3>
      ),
      h4: ({ children, ...props }) => (
        <h4
          id={props.id}
          tabIndex={-1}
          data-worktree-heading={props.node?.properties['data-worktree-heading']}
        >
          {children}
        </h4>
      ),
      h5: ({ children, ...props }) => (
        <h5
          id={props.id}
          tabIndex={-1}
          data-worktree-heading={props.node?.properties['data-worktree-heading']}
        >
          {children}
        </h5>
      ),
      h6: ({ children, ...props }) => (
        <h6
          id={props.id}
          tabIndex={-1}
          data-worktree-heading={props.node?.properties['data-worktree-heading']}
        >
          {children}
        </h6>
      ),
    };
  }, [filePath, canOpenFile, content]);

  useEffect(() => {
    const headings = Array.from(
      bodyRef.current?.querySelectorAll<HTMLElement>('[data-worktree-heading]') ?? [],
    );
    setOutline(
      headings.map((heading) => ({
        id: heading.id,
        title: heading.textContent ?? '',
        level: Number(heading.tagName.slice(1)),
      })),
    );
    if (initialAnchor)
      headings
        .find((heading) => heading.dataset.worktreeHeading === initialAnchor)
        ?.scrollIntoView({ block: 'start' });
  }, [body, initialAnchor]);

  return (
    <section className="worktree-markdown-preview" aria-label="Markdown preview">
      {outline.length > 2 && (
        <details className="worktree-markdown-outline">
          <summary>
            <ListTree size={15} aria-hidden="true" />
            On this page
          </summary>
          <nav aria-label="Document outline">
            {outline.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                style={{ paddingLeft: Math.max(0, item.level - 1) * 12 + 8 }}
                onClick={(event) => {
                  event.preventDefault();
                  const target = Array.from(
                    bodyRef.current?.querySelectorAll<HTMLElement>('[data-worktree-heading]') ?? [],
                  ).find((heading) => heading.id === item.id);
                  target?.scrollIntoView({ block: 'start' });
                  target?.focus({ preventScroll: true });
                }}
              >
                {item.title}
              </a>
            ))}
          </nav>
        </details>
      )}
      {frontMatter && (
        <details className="worktree-markdown-frontmatter">
          <summary>Document metadata</summary>
          <pre>{frontMatter.raw}</pre>
        </details>
      )}
      <div ref={bodyRef} className="worktree-markdown-body">
        <MarkdownBody content={body} components={components} />
      </div>
    </section>
  );
}
