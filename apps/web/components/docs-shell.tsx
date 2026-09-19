'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowUpRight, Search, X, Menu, ChevronRight, FileText } from 'lucide-react';
import type { navigation } from '../lib/docs/content';
import { docsRepository } from '../lib/docs/settings';

import { searchDocs, type SearchEntry } from '../lib/docs/search';
import { BrandLockup } from './brand-lockup';
import { ThemeControl } from './theme';
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
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
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
  const matches = searchDocs(index || [], query);
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
          <BrandLockup name={name} />
        </Link>
        <Link className="docs-home-link" href="/docs">
          Docs
        </Link>
        <button
          ref={searchTrigger}
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
          <Link className="docs-dashboard-link" href="/login">
            Dashboard <ArrowUpRight size={13} />
          </Link>
        </div>
        <div className="docs-appearance">
          <ThemeControl />
        </div>
        <button
          ref={menuTrigger}
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
          <Dialog.Content
            className="docs-mobile-menu"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              menuTrigger.current?.focus();
            }}
          >
            <Dialog.Title>Documentation</Dialog.Title>
            <Dialog.Description className="docs-sr-only">Choose a guide.</Dialog.Description>
            <Dialog.Close className="docs-close" aria-label="Close menu">
              <X size={18} />
            </Dialog.Close>
            <div className="docs-menu-appearance">
              <span>Appearance</span>
              <ThemeControl />
            </div>
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
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              searchTrigger.current?.focus();
            }}
          >
            <Dialog.Title className="docs-sr-only">Search documentation</Dialog.Title>
            <Dialog.Description className="docs-sr-only">
              Search guides, concepts, and API documentation. Tab through matching pages.
            </Dialog.Description>
            <div className="docs-search-input input-surface">
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
                <p role="status" className="waiting-text">
                  Loading documentation…
                </p>
              ) : (
                <>
                  <p className="docs-search-label" role="status">
                    {query ? `${matches.length} matching pages` : 'Explore the documentation'}
                  </p>
                  {!matches.length && <p>No matching pages. Try “worktree”, “API”, or “billing”.</p>}
                  {matches.map((entry) => (
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
