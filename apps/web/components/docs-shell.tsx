'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowUpRight, BookOpen, Search, X, Menu, ChevronRight, FileText } from 'lucide-react';
import type { navigation } from '../lib/docs/content';
import { docsRepository } from '../lib/docs/settings';

type SearchEntry = { title: string; url: string; text: string; section: string };
export function DocsShell({
  name,
  items,
  children,
}: {
  name: string;
  items: typeof navigation;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false),
    [mobile, setMobile] = useState(false);
  const [query, setQuery] = useState(''),
    [index, setIndex] = useState<SearchEntry[] | null>(null);
  const [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);
  useEffect(() => {
    setOpen(false);
    setMobile(false);
    setQuery('');
  }, [pathname]);
  useEffect(() => {
    if (!open || index) return;
    const controller = new AbortController();
    setError(false);
    fetch('/docs/search-index.json', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Search unavailable');
        const entries: SearchEntry[] = await response.json();
        setIndex(entries);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [open, index, attempt]);
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = (index || [])
    .map((entry) => ({
      entry,
      score: terms.reduce((score, term) => score + (entry.title.toLowerCase().includes(term) ? 10 : 0), 0),
    }))
    .filter(({ entry }) => terms.every((term) => `${entry.title} ${entry.text}`.toLowerCase().includes(term)))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  const sidebar = (
    <nav aria-label="Documentation navigation">
      {[...new Set(items.map((item) => item.section))].map((section) => (
        <div className="docs-nav-group" key={section}>
          <h2>{section}</h2>
          {items
            .filter((item) => item.section === section)
            .map((item) => (
              <Link
                key={item.slug}
                href={item.url}
                aria-current={pathname === item.url ? 'page' : undefined}
                onClick={() => setMobile(false)}
              >
                {item.title}
                {pathname === item.url && <ChevronRight size={13} />}
              </Link>
            ))}
        </div>
      ))}
      <a className="docs-reference-link" href="/reference">
        API reference <ArrowUpRight size={14} />
      </a>
    </nav>
  );
  return (
    <div className="docs-site">
      <a href="#docs-content" className="docs-skip">
        Skip to content
      </a>
      <header className="docs-header">
        <Link className="docs-brand" href="/">
          <BookOpen size={21} />
          <strong>{name}</strong>
          <span>Docs</span>
        </Link>
        <button
          className="docs-search-trigger"
          aria-label="Search documentation"
          onClick={() => setOpen(true)}
        >
          <Search size={16} />
          <span>Search documentation</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="docs-header-links">
          <a href={docsRepository}>
            GitHub <ArrowUpRight size={13} />
          </a>
          <Link href="/login">
            Dashboard <ArrowUpRight size={13} />
          </Link>
        </div>
        <button
          className="docs-mobile-trigger"
          aria-label="Open documentation menu"
          onClick={() => setMobile(true)}
        >
          <Menu size={20} />
        </button>
      </header>
      <div className="docs-layout">
        <aside className="docs-sidebar">{sidebar}</aside>
        {children}
      </div>
      <Dialog.Root open={mobile} onOpenChange={setMobile}>
        <Dialog.Portal>
          <Dialog.Overlay className="docs-overlay" />
          <Dialog.Content className="docs-mobile-menu">
            <Dialog.Title>Documentation</Dialog.Title>
            <Dialog.Description className="docs-sr-only">Choose a guide.</Dialog.Description>
            <Dialog.Close className="docs-close" aria-label="Close menu">
              <X size={18} />
            </Dialog.Close>
            {sidebar}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="docs-overlay" />
          <Dialog.Content
            className="docs-search-dialog"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              input.current?.focus();
            }}
          >
            <Dialog.Title className="docs-sr-only">Search documentation</Dialog.Title>
            <Dialog.Description className="docs-sr-only">
              Search guides, concepts, and API documentation. Tab through matching pages.
            </Dialog.Description>
            <div className="docs-search-input">
              <Search size={21} />
              <input
                ref={input}
                aria-label="Search documentation"
                placeholder="Search for a guide or concept…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={200}
              />
              <Dialog.Close aria-label="Close search">
                <X size={18} />
              </Dialog.Close>
            </div>
            <div className="docs-search-results">
              {error ? (
                <p role="alert">
                  Search could not load.{' '}
                  <button onClick={() => setAttempt((value) => value + 1)}>Try again</button>
                </p>
              ) : !index ? (
                <p role="status">Loading documentation…</p>
              ) : (
                <>
                  <p className="docs-search-label" role="status">
                    {query ? `${matches.length} matching pages` : 'Explore the documentation'}
                  </p>
                  {!matches.length && <p>No matching pages. Try “workspace”, “API”, or “billing”.</p>}
                  {matches.map(({ entry }) => (
                    <Link href={entry.url} key={entry.url} onClick={() => setOpen(false)}>
                      <FileText size={18} />
                      <span>
                        <small>{entry.section}</small>
                        <strong>{entry.title}</strong>
                        <span>{entry.text.slice(0, 145)}…</span>
                      </span>
                      <ChevronRight size={15} />
                    </Link>
                  ))}
                </>
              )}
            </div>
            <div className="docs-search-footer">
              Search runs locally in your browser. <kbd>Esc</kbd> to close
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
