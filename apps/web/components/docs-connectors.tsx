'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, Search } from 'lucide-react';
import { ProviderLogo } from './provider-logo';
import type { PublicConnectors } from '../lib/docs/connectors';

const pageSize = 24;
export function DocsConnectors({
  initial,
  native,
}: {
  initial: PublicConnectors['apps'];
  native: PublicConnectors['native'];
}) {
  const [apps, setApps] = useState(initial);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(pageSize);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    void fetch('/docs/connectors/catalog.json', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Catalog unavailable');
        const result = (await response.json()) as PublicConnectors;
        if (!Array.isArray(result.apps)) throw new Error('Catalog unavailable');
        if (!controller.signal.aborted) {
          setApps(result.apps);
          setStatus('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
    return () => controller.abort();
  }, [attempt]);
  const term = query.trim().toLowerCase();
  const filtered = apps.filter((app) =>
    `${app.name} ${app.slug} ${app.description} ${app.categories.join(' ')}`.toLowerCase().includes(term),
  );
  const filteredNative = native.filter((app) =>
    `${app.name} ${app.category} ${app.description}`.toLowerCase().includes(term),
  );
  return (
    <section className="docs-connectors" aria-label="Connector directory">
      <label className="docs-connector-search input-surface">
        <Search size={18} />
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(pageSize);
          }}
          placeholder="Search apps, tools, or categories…"
          aria-label="Search connectors"
        />
      </label>
      {status === 'loading' && (
        <p role="status" className="waiting-text">
          Loading the complete catalog…
        </p>
      )}
      {status === 'error' && (
        <p role="alert">
          The complete catalog couldn’t load. The featured entries are still available.{' '}
          <button type="button" onClick={() => setAttempt(attempt + 1)}>
            Try again
          </button>
        </p>
      )}
      {filteredNative.length > 0 && (
        <>
          <h2 id="directory-native-integrations">Native integrations</h2>
          <div className="docs-connector-grid">
            {filteredNative.map((app) => (
              <a key={app.id} href={app.href}>
                <ProviderLogo provider={app.provider} name={app.name} size={24} />
                <strong>{app.name}</strong>
                <small>{app.category}</small>
                <p>{app.description}</p>
              </a>
            ))}
          </div>
        </>
      )}
      <h2 id="directory-app-catalog">Application catalog</h2>
      <p role="status" aria-label="Catalog results">
        {status === 'ready' ? `${filtered.length.toLocaleString('en-US')} apps` : 'Featured apps'}
        {query ? ` matching “${query}”` : ''}
      </p>
      <div className="docs-connector-grid">
        {filtered.slice(0, limit).map((app) => (
          <a key={app.slug} href={`https://docs.composio.dev/toolkits/${app.slug}`}>
            <ProviderLogo provider={app.slug} name={app.name} size={24} />
            <strong>{app.name}</strong>
            <small>
              {app.tool_count.toLocaleString('en-US')} tools <ArrowUpRight size={11} />
            </small>
            <p>{app.description}</p>
          </a>
        ))}
      </div>
      {filtered.length === 0 && filteredNative.length === 0 && status === 'ready' && (
        <p>No matching connectors. Try an app name or category, or connect a custom MCP server.</p>
      )}
      {limit < filtered.length && (
        <button type="button" className="docs-connector-more" onClick={() => setLimit(limit + pageSize)}>
          Show more apps ({Math.min(limit, filtered.length)} of {filtered.length})
        </button>
      )}
      <noscript>
        <p>
          The featured catalog above works without JavaScript. Browse the complete machine-readable list at{' '}
          <a href="/docs/connectors/catalog.json">the public catalog export</a>.
        </p>
      </noscript>
    </section>
  );
}
