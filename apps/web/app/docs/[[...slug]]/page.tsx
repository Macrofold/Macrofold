import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft, ArrowRight, ArrowUpRight, FileText } from 'lucide-react';
import { config } from '@platform/core/config';
import {
  findPage,
  headings,
  pages,
  markdownUrl,
  absoluteMarkdown,
  setupPrompt,
} from '../../../lib/docs/content';
import { DocsCopy } from '../../../components/docs-copy';
import { docsSourceUrl } from '../../../lib/docs/settings';
import { DocsConnectors } from '../../../components/docs-connectors';
import { publicConnectors } from '../../../lib/docs/connectors';
import { publicProductName } from '../../../components/brand-lockup';

type Props = { params: Promise<{ slug?: string[] }> };
export const dynamic = 'force-static';
export function generateStaticParams() {
  return pages.map((page) => ({ slug: page.slug ? page.slug.split('/') : [] }));
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = findPage((await params).slug?.join('/'));
  if (!page) return { title: 'Guide not found', robots: { index: false } };
  return {
    title: { absolute: `${page.title} · ${publicProductName(config.name)} Docs` },
    description: page.description,
    alternates: {
      canonical: config.origin + page.url,
      types: { 'text/markdown': config.origin + markdownUrl(page.slug) },
    },
    openGraph: {
      title: page.title,
      description: page.description,
      url: config.origin + page.url,
      type: 'article',
      siteName: publicProductName(config.name),
    },
    twitter: { card: 'summary', title: page.title, description: page.description },
  };
}
export default async function Doc({ params }: Props) {
  const page = findPage((await params).slug?.join('/'));
  if (!page) notFound();
  const content = page.markdown.replace(/^# .+\n+/, '');
  const toc = headings(content),
    index = pages.indexOf(page),
    previous = pages[index - 1],
    next = pages[index + 1];
  const headingIds = new Map(toc.map((heading) => [heading.line, heading.id]));
  return (
    <>
      <main id="docs-content" className="docs-main">
        <div className="docs-breadcrumb">{page.section}</div>
        <h1>{page.title}</h1>
        <p className="docs-description">{page.description}</p>
        <div className="docs-page-tools">
          <DocsCopy key={page.slug} text={absoluteMarkdown(page, config.origin)} />
          {['', 'agents', 'api/quickstart'].includes(page.slug) && (
            <DocsCopy
              key={`${page.slug}-prompt`}
              label="Copy setup prompt"
              text={setupPrompt(config.origin)}
            />
          )}
          <a href={markdownUrl(page.slug)}>
            <FileText size={14} /> View Markdown
          </a>
        </div>
        {!page.slug && (
          <div className="docs-start-cards">
            {[
              [
                '/docs/agents',
                'AI-assisted setup',
                'Build with your AI',
                'Describe a feature. Give your coding agent the setup brief.',
              ],
              [
                '/docs/api/quickstart',
                'Quickstart',
                'Make your first request',
                'A workspace, a task, and a complete result.',
              ],
              [
                '/docs/cloud',
                'Cloud',
                'Use Macrofold Cloud',
                'Connect your application to the managed service.',
              ],
              [
                '/docs/self-hosting',
                'Self-hosted',
                'Run it on your infrastructure',
                'Deploy the same API and dashboard in your own accounts.',
              ],
            ].map(([href, label, title, detail]) => (
              <Link href={href} key={href}>
                <span>
                  {label}
                  <ArrowUpRight size={18} />
                </span>
                <strong>{title}</strong>
                <p>{detail}</p>
              </Link>
            ))}
          </div>
        )}
        <article className="docs-prose">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              h2: ({ children, node }) => (
                <h2 id={headingIds.get(node?.position?.start.line || 0)}>{children}</h2>
              ),
              h3: ({ children, node }) => (
                <h3 id={headingIds.get(node?.position?.start.line || 0)}>{children}</h3>
              ),
              table: ({ children }) => (
                <div className="docs-table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
                  <table>{children}</table>
                </div>
              ),
              pre: ({ children, node }) => {
                const code = node?.children.find(
                  (child) => child.type === 'element' && child.tagName === 'code',
                );
                const language =
                  code?.type === 'element'
                    ? String(code.properties.className || '').replace('language-', '')
                    : '';
                const isPrompt = language === 'prompt';
                const text =
                  code?.type === 'element'
                    ? code.children.map((child) => (child.type === 'text' ? child.value : '')).join('')
                    : '';
                const copyText = isPrompt
                  ? absoluteMarkdown({ ...page, markdown: text }, config.origin)
                  : text;
                return (
                  <div className={`docs-code-block${isPrompt ? ' docs-prompt-block' : ''}`}>
                    <div className="docs-code-header">
                      <span>{isPrompt ? 'Give this to your coding agent' : language || 'Example'}</span>
                      <DocsCopy
                        key={`${page.slug}:${node?.position?.start.line}`}
                        text={copyText}
                        label={isPrompt ? 'Copy prompt' : 'Copy code'}
                      />
                    </div>
                    <pre tabIndex={0} role="region" aria-label={isPrompt ? 'Setup prompt' : 'Code example'}>
                      {isPrompt ? <code>{copyText}</code> : children}
                    </pre>
                  </div>
                );
              },
              a: ({ href, children }) =>
                href?.startsWith('/docs') ? (
                  <Link href={href}>{children}</Link>
                ) : (
                  <a href={href}>{children}</a>
                ),
            }}
          >
            {content}
          </Markdown>
        </article>
        {page.slug === 'connectors' && (
          <DocsConnectors initial={publicConnectors.apps.slice(0, 24)} native={publicConnectors.native} />
        )}
        <div className="docs-feedback">
          <a href={docsSourceUrl(page.source)}>
            View source on GitHub <ArrowUpRight size={13} />
          </a>
          <a href="/reference">
            Open the complete interactive API reference <ArrowUpRight size={13} />
          </a>
        </div>
        <nav className="docs-pagination" aria-label="Adjacent guides">
          {previous ? (
            <Link href={previous.url}>
              <ArrowLeft size={16} />
              <span>
                <small>Previous</small>
                {previous.title}
              </span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={next.url}>
              <span>
                <small>Next</small>
                {next.title}
              </span>
              <ArrowRight size={16} />
            </Link>
          )}
        </nav>
      </main>
      <aside className="docs-toc">
        <nav aria-label="On this page">
          <p>On this page</p>
          {toc.map((heading) => (
            <a
              key={heading.id}
              className={heading.level === 3 ? 'docs-toc-nested' : ''}
              href={`#${heading.id}`}
            >
              {heading.text}
            </a>
          ))}
        </nav>
        <div className="docs-agent-note">
          <FileText size={17} />
          <strong>Building with an agent?</strong>
          <p>Start with a setup prompt, then follow the guides for your feature.</p>
          <Link href="/docs/agents">
            Build with AI <ArrowRight size={13} />
          </Link>
        </div>
      </aside>
    </>
  );
}
