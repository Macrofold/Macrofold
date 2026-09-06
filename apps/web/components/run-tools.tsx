'use client';
import { useState } from 'react';
import { useApi, type Schema } from '../lib/client';

export function RunToolSelection({
  connection,
  selected,
  onChange,
}: {
  connection: Schema['Connection'];
  selected: string[];
  onChange: (tools: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const grants = useApi<Schema['ConnectionGrantSet']>(
    expanded ? `/v1/connections/${connection.id}/grants` : undefined,
  );
  return (
    <details className="run-tool-connection" onToggle={(e) => setExpanded(e.currentTarget.open)}>
      <summary>
        {connection.name}{' '}
        <span className="muted">{selected.length ? `· ${selected.length} selected` : '· choose tools'}</span>
      </summary>
      {expanded &&
        (grants.error ? (
          <p role="alert">{grants.error.message}</p>
        ) : grants.isPending ? (
          <p className="muted">Loading approved tools…</p>
        ) : (
          <div className="tool-selection">
            {!grants.data?.tools.length && (
              <p className="muted">No tools approved yet. Open Connections → Tools to grant access first.</p>
            )}
            {grants.data?.tools.map((tool) => (
              <label key={tool}>
                <input
                  type="checkbox"
                  checked={selected.includes(tool)}
                  onChange={(e) =>
                    onChange(e.target.checked ? [...selected, tool] : selected.filter((t) => t !== tool))
                  }
                />
                <span>{tool}</span>
              </label>
            ))}
          </div>
        ))}
    </details>
  );
}
