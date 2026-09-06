'use client';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronRight, LayoutGrid, LoaderCircle, Search, X } from 'lucide-react';
import type { Schema } from '../lib/client';
import { Button, ErrorState } from './ui';
import { ProviderLogo } from './provider-logo';

type Entry = Schema['ConnectorCatalogEntry'];
export function categoryLabel(value: string) {
  return value
    .split(' ')
    .map((word) =>
      ['ai', 'crm', 'hr', 'it', 'sms', 'url'].includes(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
}

export function ConnectorBrowser({
  catalog,
  loading,
  error,
  retry,
  onSelect,
  active = true,
}: {
  catalog?: Schema['ConnectorCatalog'];
  loading: boolean;
  error: Error | null;
  retry: () => void;
  onSelect: (entry: Entry) => void;
  active?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const deferredSearch = useDeferredValue(search);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (active) searchInput.current?.focus();
  }, [active]);
  const entries = catalog?.data || [];
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries)
      for (const name of entry.categories) counts.set(name, (counts.get(name) || 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);
  const filtered = useMemo(() => {
    const words = deferredSearch.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return entries.filter(
      (entry) =>
        (category === 'all' || entry.categories.includes(category)) &&
        words.every((word) =>
          `${entry.name} ${entry.slug} ${entry.description} ${entry.categories.join(' ')}`
            .toLowerCase()
            .includes(word),
        ),
    );
  }, [entries, deferredSearch, category]);
  return (
    <div className="connector-browser">
      <nav className="connector-categories" aria-label="App categories">
        <div className="connector-category-heading">CATEGORIES</div>
        <button
          type="button"
          className="connector-category-all"
          aria-pressed={category === 'all'}
          onClick={() => setCategory('all')}
        >
          <LayoutGrid size={16} />
          <span>All</span>
          <small>{entries.length.toLocaleString()}</small>
        </button>
        <div className="connector-category-list">
          {categories.map(([name, count]) => (
            <button
              key={name}
              type="button"
              aria-pressed={category === name}
              onClick={() => setCategory(name)}
            >
              <span>{categoryLabel(name)}</span>
              <small>{count}</small>
            </button>
          ))}
        </div>
      </nav>
      <div className="connector-catalog-main">
        <div className="connector-search-area">
          <label className="connector-search">
            <Search size={19} aria-hidden="true" />
            <input
              ref={searchInput}
              autoFocus
              type="search"
              aria-label="Search apps"
              placeholder="Search apps, tools, or categories…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button
                type="button"
                aria-label="Clear app search"
                className="icon-button"
                onClick={() => {
                  setSearch('');
                  searchInput.current?.focus();
                }}
              >
                <X size={16} />
              </button>
            )}
          </label>
          <div className="connector-results-heading">
            <h3>
              {category === 'all'
                ? search.trim()
                  ? 'Search results'
                  : 'Explore all apps'
                : categoryLabel(category)}
            </h3>
            <span role="status" aria-live="polite">
              {loading ? 'Loading catalog…' : `${filtered.length.toLocaleString()} apps`}
            </span>
          </div>
        </div>
        {loading ? (
          <div className="connector-catalog-loading" role="status">
            <LoaderCircle className="spin" size={22} />
            Finding your next connection…
          </div>
        ) : error ? (
          <ErrorState error={error} retry={retry} />
        ) : (
          <CatalogResults
            key={`${deferredSearch}:${category}`}
            entries={filtered}
            onSelect={onSelect}
            reset={() => {
              setSearch('');
              setCategory('all');
            }}
          />
        )}
        <div className="connector-catalog-footer">
          <span>
            {catalog?.source === 'snapshot' ? 'Public app catalog' : 'App catalog'}
            {catalog?.updated_at
              ? ` · Updated ${new Date(catalog.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
              : ''}
          </span>
          <span>You choose each agent’s permissions.</span>
        </div>
      </div>
    </div>
  );
}

function CatalogResults({
  entries,
  onSelect,
  reset,
}: {
  entries: Entry[];
  onSelect: (entry: Entry) => void;
  reset: () => void;
}) {
  const [visible, setVisible] = useState(48);
  const scroll = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const hasMore = visible < entries.length;
  useEffect(() => {
    if (!hasMore || !sentinel.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible((count) => Math.min(count + 48, entries.length));
      },
      { root: scroll.current, rootMargin: '0px 0px 320px 0px' },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasMore, visible, entries.length]);
  return (
    <div ref={scroll} className="connector-results-scroll" tabIndex={0} aria-label="App results">
      {!entries.length ? (
        <div className="connector-no-results">
          <Search size={28} />
          <h3>No apps found</h3>
          <p>Try another name or browse all categories.</p>
          <Button variant="secondary" onClick={reset}>
            Clear filters
          </Button>
        </div>
      ) : (
        <>
          <div className="connector-cards">
            {entries.slice(0, visible).map((entry) => (
              <button
                key={entry.slug}
                type="button"
                className="connector-app-card"
                aria-label={`Set up ${entry.name}`}
                onClick={() => onSelect(entry)}
              >
                <div className="connector-app-card-top">
                  <span className="connector-logo-tile">
                    <ProviderLogo provider={entry.slug} name={entry.name} size={32} />
                  </span>
                  <ChevronRight size={15} className="connector-card-arrow" aria-hidden="true" />
                </div>
                <strong>{entry.name}</strong>
                <p>{entry.description || `Connect ${entry.name} to your agents’ workspace.`}</p>
                <div className="connector-app-meta">
                  <span>{categoryLabel(entry.categories[0] || 'Other')}</span>
                  <small>{entry.tool_count.toLocaleString()} tools</small>
                </div>
              </button>
            ))}
          </div>
          <div ref={sentinel} className="connector-scroll-end">
            {hasMore ? (
              <Button variant="ghost" onClick={() => setVisible((count) => count + 48)}>
                Show more apps <ArrowUpRight size={14} />
              </Button>
            ) : (
              <span>You’ve reached the end · {entries.length.toLocaleString()} apps</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
