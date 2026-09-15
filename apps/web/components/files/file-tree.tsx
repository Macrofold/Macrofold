'use client';

// Navigation and visible-row structure adapted from MIT-licensed Orca; see ORCA-LICENSE.txt.
import { ChevronRight } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { WaitingText } from '../waiting-text';
import { FileMenu, type FileMenuAction } from './file-menu';
import { FileIcon } from './file-icon';
import { fileTreeNavigation, visibleFileTreeRows, type FileTreeNode } from './file-tree-model';
import './files.css';

export { compareFileNames, compareFileTreeNodes } from './file-tree-model';
export type { FileTreeNode } from './file-tree-model';

export function FileTree({
  nodes,
  expandedPaths,
  selectedPath,
  loadingPaths,
  errors,
  hasMorePaths,
  disabled = false,
  onToggle,
  onSelect,
  onRetry,
  onLoadMore,
  label = 'Worktree files',
  workspaceId,
  writesBlocked = false,
  renamePath,
  onRenameStart,
  onRename,
  onAction,
  onMove,
}: {
  nodes: FileTreeNode[];
  expandedPaths: ReadonlySet<string>;
  selectedPath?: string | null;
  loadingPaths?: ReadonlySet<string>;
  errors?: ReadonlyMap<string, string>;
  hasMorePaths?: ReadonlySet<string>;
  disabled?: boolean;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onRetry?: (path: string) => void;
  onLoadMore?: (path: string) => void;
  label?: string;
  workspaceId?: string;
  writesBlocked?: boolean;
  renamePath?: string | null;
  onRenameStart?: (path: string | null) => void;
  onRename?: (path: string, name: string) => Promise<boolean>;
  onAction?: (path: string, action: FileMenuAction) => void;
  onMove?: (path: string, directory: string) => void;
}) {
  const rows = useMemo(() => {
    const actions = new Map<string, 'retry' | 'more'>();
    if (onLoadMore) for (const path of hasMorePaths ?? []) if (path) actions.set(path, 'more');
    if (onRetry) for (const [path] of errors ?? []) if (path) actions.set(path, 'retry');
    return visibleFileTreeRows(nodes, expandedPaths, actions);
  }, [nodes, expandedPaths, errors, hasMorePaths, onLoadMore, onRetry]);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const rowElements = useRef(new Map<string, HTMLDivElement>());
  const typeahead = useRef({ text: '', time: 0 });
  const tabStop =
    rows.find((row) => row.node.path === focusedPath)?.node.path ??
    rows.find((row) => row.node.path === selectedPath)?.node.path ??
    rows[0]?.node.path;
  const focus = (index: number) => {
    const row = rows[index];
    if (!row) return;
    setFocusedPath(row.node.path);
    rowElements.current.get(row.node.path)?.focus();
  };

  return (
    <div className="workspace-file-tree" role="tree" aria-label={label} aria-disabled={disabled || undefined}>
      {rows.map((row, index) => {
        const { node, depth } = row;
        const directory = node.kind === 'directory';
        const expanded = expandedPaths.has(node.path);
        const action = row.action;
        const loading = loadingPaths?.has(action?.path ?? node.path);
        const activate = () => {
          if (action) {
            if (loading) return;
            // Loading can remove this auxiliary row; keep focus on its stable folder.
            focus(rows.findIndex((candidate) => candidate.node.path === action.path));
            if (action.kind === 'retry') onRetry?.(action.path);
            else onLoadMore?.(action.path);
          } else if (!disabled) onSelect(node.path);
        };
        return (
          <div
            key={node.path}
            ref={(element) => {
              if (element) rowElements.current.set(node.path, element);
              else rowElements.current.delete(node.path);
            }}
            role="treeitem"
            tabIndex={tabStop === node.path ? 0 : -1}
            aria-label={
              action
                ? `${node.name} in ${action.path}`
                : node.kind === 'symlink'
                  ? `${node.name}, symbolic link`
                  : node.name
            }
            aria-level={depth}
            aria-posinset={row.position}
            aria-setsize={hasMorePaths?.has(row.parentPath ?? '') ? -1 : row.siblings}
            aria-selected={action ? undefined : selectedPath === node.path}
            aria-expanded={directory ? expanded : undefined}
            aria-busy={loading || undefined}
            aria-disabled={action ? loading || undefined : disabled || undefined}
            className={`workspace-tree-row${action ? ' workspace-tree-status' : ''}`}
            style={{ paddingLeft: (depth - 1) * 16 + 8 }}
            title={action?.path ?? node.path}
            onFocus={() => setFocusedPath(node.path)}
            draggable={!directory && !action && !writesBlocked && renamePath !== node.path}
            onDragStart={(event) => {
              event.dataTransfer.setData(
                'application/x-macrofold-file',
                JSON.stringify({ workspaceId, path: node.path }),
              );
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(event) => {
              if (
                directory &&
                !writesBlocked &&
                event.dataTransfer.types.includes('application/x-macrofold-file')
              ) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                event.currentTarget.dataset.drop = 'true';
              }
            }}
            onDragLeave={(event) => {
              delete event.currentTarget.dataset.drop;
            }}
            onDrop={(event) => {
              delete event.currentTarget.dataset.drop;
              if (!directory || writesBlocked) return;
              event.preventDefault();
              try {
                const file = JSON.parse(event.dataTransfer.getData('application/x-macrofold-file'));
                if (file.workspaceId === workspaceId && typeof file.path === 'string')
                  onMove?.(file.path, node.path);
              } catch {
                /* Ignore unrelated drag payloads. */
              }
            }}
            onClick={activate}
            onDoubleClick={() => {
              if (directory && !expanded) onToggle(node.path);
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget || event.altKey || event.metaKey || event.ctrlKey)
                return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (directory && event.key === 'Enter' && !expanded) onToggle(node.path);
                activate();
                return;
              }
              const navigation = fileTreeNavigation(event.key, index, rows, expandedPaths);
              if (navigation) {
                event.preventDefault();
                if ('toggle' in navigation) onToggle(navigation.toggle);
                else focus(navigation.index);
              } else if (event.key.length === 1 && !event.nativeEvent.isComposing) {
                const now = Date.now();
                typeahead.current.text =
                  now - typeahead.current.time < 700 ? typeahead.current.text + event.key : event.key;
                typeahead.current.time = now;
                const query = typeahead.current.text.toLocaleLowerCase();
                const candidates = [...rows.slice(index + 1), ...rows.slice(0, index + 1)];
                const match = candidates.find((candidate) =>
                  candidate.node.name.toLocaleLowerCase().startsWith(query),
                );
                if (match) {
                  event.preventDefault();
                  focus(rows.indexOf(match));
                }
              }
            }}
          >
            {action ? (
              <>
                {action.kind === 'retry' && <span role="alert">{errors?.get(action.path)}</span>}
                <span className="workspace-tree-action">
                  {loading ? <WaitingText>Loading…</WaitingText> : node.name}
                </span>
              </>
            ) : directory ? (
              <button
                type="button"
                className="workspace-tree-chevron"
                tabIndex={-1}
                aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggle(node.path);
                  rowElements.current.get(node.path)?.focus();
                }}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <ChevronRight size={13} aria-hidden="true" data-expanded={expanded} />
              </button>
            ) : (
              <span className="workspace-tree-chevron" aria-hidden="true" />
            )}
            {!action && (
              <>
                <FileIcon path={node.path} kind={node.kind} expanded={expanded} />
                {renamePath === node.path ? (
                  <InlineFileName
                    key={node.path}
                    name={node.name}
                    disabled={disabled}
                    onCancel={() => onRenameStart?.(null)}
                    onCommit={async (name) => {
                      if (await onRename?.(node.path, name)) onRenameStart?.(null);
                    }}
                  />
                ) : (
                  <span className="workspace-tree-name">
                    <WaitingText active={Boolean(loading)}>{node.name}</WaitingText>
                  </span>
                )}
                {onAction && (
                  <FileMenu
                    path={node.path}
                    directory={directory}
                    disabled={writesBlocked}
                    onAction={(action) => onAction(node.path, action)}
                  />
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function InlineFileName({
  name,
  disabled,
  onCancel,
  onCommit,
}: {
  name: string;
  disabled: boolean;
  onCancel: () => void;
  onCommit: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState(name);
  return (
    <input
      className="workspace-tree-rename"
      aria-label={`Rename ${name}`}
      autoFocus
      value={value}
      disabled={disabled}
      onFocus={(event) => {
        event.stopPropagation();
        event.currentTarget.select();
      }}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
        if (event.key === 'Enter' && value.trim() && !value.includes('/')) {
          event.preventDefault();
          void onCommit(value.trim());
        }
      }}
    />
  );
}
