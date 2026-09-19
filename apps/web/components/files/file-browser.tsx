'use client';

import { mediaFormat } from '../../../../packages/contracts/media';
import { MediaPreview } from './media-preview';
import { markdown } from '@codemirror/lang-markdown';
import { useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronRight,
  CircleAlert,
  CloudUpload,
  Code2,
  Download,
  Eye,
  EyeOff,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { toast } from 'sonner';
import { type Schema } from '../../lib/client';
import {
  ancestorDirectories,
  parentDirectory,
  publishFileMutation,
  useDirectoryListings,
} from '../../lib/workspace-files';
import { request, useDataPages } from '../../lib/dashboard-data';
import { useResizablePanel } from '../../lib/use-resizable-panel';
import { FileUpload } from '../file-upload';
import { useResolvedTheme } from '../theme';
import { Button, Empty, ErrorState, Field, Loading, Modal, More } from '../ui';
import { WaitingText } from '../waiting-text';
import { FileTree, type FileTreeNode } from './file-tree';
import { FileIcon } from './file-icon';
import { MarkdownPreview } from './markdown-preview';
import type { FileMenuAction } from './file-menu';
import { duplicateFilePath } from './file-tree-model';
import { useFileDocument } from './use-file-document';
import './file-browser.css';

const CodeMirror = dynamic(() => import('@uiw/react-codemirror'), { ssr: false, loading: () => <Loading /> });
const RichMarkdownEditor = dynamic(() => import('./rich-markdown-editor'), {
  ssr: false,
  loading: () => <Loading />,
});
const MarkdownChanges = dynamic(() => import('./markdown-changes'), { loading: () => <Loading /> });
const isMarkdown = (path: string) => /\.(md|markdown|mdown)$/i.test(path);
const visibleEntry = (entry: Schema['FileEntry'], hidden: boolean) =>
  hidden || !entry.path.split('/').some((part) => part.startsWith('.'));
type FileAction = 'file' | 'folder' | 'delete';

export function FileBrowser({
  worktree,
  onDirtyChange,
}: {
  worktree: Schema['Worktree'];
  onDirtyChange: (dirty: boolean) => void;
}) {
  const client = useQueryClient();
  const theme = useResolvedTheme();
  const [selected, setSelected] = useState<Schema['FileEntry'] | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [anchor, setAnchor] = useState<string | undefined>();
  const [mode, setMode] = useState<'rich' | 'source' | 'changes' | 'preview'>('rich');
  const [action, setAction] = useState<FileAction | null>(null);
  const [path, setPath] = useState('');
  const [targetPath, setTargetPath] = useState('');
  const [renamePath, setRenamePath] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [mutating, setMutating] = useState(false);
  const mutationRef = useRef(false);
  const choseEntry = useRef(false);
  const document = useFileDocument({
    worktree,
    selected,
    isMutating: () => mutationRef.current,
    onCreateError: setActionError,
    onCreated(entry) {
      choseEntry.current = true;
      setSelected(entry);
      setMode('source');
      expandTo(entry.path);
      setSearch('');
      setAction(null);
      toast.success('File created and checkpointed');
    },
  });
  const { text, dirty, revision, saving, saveError, content, changeText, save } = document;
  const rootPath = `/v1/worktrees/${worktree.id}`;
  const selectedPath = selected?.path ?? '';
  const format = mediaFormat(selectedPath);
  const mediaFile = Boolean(format && format.kind !== 'text');
  const textDocument =
    selected?.type === 'file' &&
    !mediaFile &&
    Number(selected.size_bytes ?? 0) <= 4 * 1024 * 1024 &&
    !text.includes('\0');
  const markdownFile =
    isMarkdown(selectedPath) || (!selectedPath.split('/').pop()?.includes('.') && /^#{1,6}\s+\S/m.test(text));
  const currentDirectory = selected?.type === 'directory' ? selected.path : parentDirectory(selectedPath);
  const isFile = Boolean(selected && selected.type !== 'directory');
  const selectionBlocked = saving || mutating;
  const writesBlocked = worktree.status === 'busy' || dirty || selectionBlocked;
  const panel = useResizablePanel({
    storageKey: 'macrofold.files.width',
    defaultWidth: 260,
    minWidth: 190,
    maxWidth: 520,
  });
  const directories = new Set(['', ...expanded, currentDirectory]);
  const listing = useDirectoryListings(worktree.id, directories);
  const matches = useDataPages(
    search
      ? {
          operation: 'listFiles',
          params: { path: { worktree_id: worktree.id }, query: { limit: 100, query: search } },
        }
      : undefined,
    false,
  );
  const entries = new Map<string, Schema['FileEntry']>();
  for (const directory of listing.results.values())
    for (const entry of directory.entries) entries.set(entry.path, entry);
  for (const entry of matches.data?.data ?? []) entries.set(entry.path, entry);
  const treeEntries = search ? (matches.data?.data ?? []) : [...entries.values()];
  const treeMap = new Map<string, FileTreeNode>();
  for (const entry of treeEntries.filter((entry) => visibleEntry(entry, showHidden))) {
    for (const folder of ancestorDirectories(entry.path))
      treeMap.set(folder, {
        path: folder,
        name: folder.split('/').pop() ?? folder,
        kind: 'directory',
        children: [],
      });
    treeMap.set(entry.path, {
      path: entry.path,
      name: entry.path.split('/').pop() ?? entry.path,
      kind: entry.type,
      ...(entry.type === 'directory' ? { children: [] } : {}),
    });
  }
  const nodes: FileTreeNode[] = [];
  for (const node of treeMap.values()) {
    const parent = treeMap.get(parentDirectory(node.path));
    if (parent) parent.children?.push(node);
    else nodes.push(node);
  }
  const expandedPaths = search
    ? new Set([...treeMap.values()].filter((node) => node.kind === 'directory').map((node) => node.path))
    : expanded;
  const loadingPaths = new Set(
    [...listing.results].filter(([, value]) => value.loading).map(([path]) => path),
  );
  const hasMorePaths = new Set(
    [...listing.results].filter(([, value]) => value.nextCursor).map(([path]) => path),
  );
  const errors = new Map(
    [...listing.results].flatMap(([path, value]) =>
      value.error ? [[path, value.error.message] as const] : [],
    ),
  );
  const root = listing.results.get('');

  function expandTo(filePath: string) {
    setExpanded((previous) => new Set([...previous, ...ancestorDirectories(filePath)]));
  }
  function openEntry(entry: Schema['FileEntry'] | null) {
    if (selectionBlocked) return;
    if (dirty) {
      toast.error('Save or discard your changes before opening another file.');
      return;
    }
    choseEntry.current = true;
    if (entry?.path !== selectedPath) {
      document.reset();
    }
    setSelected(entry);
    setMode('rich');
    setAnchor(undefined);
    if (entry?.type === 'directory') setExpanded((previous) => new Set([...previous, entry.path]));
    if (entry) expandTo(entry.path);
  }
  function openPath(filePath: string, heading?: string) {
    if (selectionBlocked || dirty) {
      openEntry(null);
      return;
    }
    openEntry(entries.get(filePath) ?? { path: filePath, type: 'file', revision: worktree.revision });
    setAnchor(heading);
  }
  function begin(next: FileAction, target = selectedPath) {
    setActionError('');
    setTargetPath(target);
    const directory = entries.get(target)?.type === 'directory' ? target : parentDirectory(target);
    setPath(directory ? `${directory}/` : '');
    setAction(next);
  }
  function treeAction(target: string, next: FileMenuAction) {
    if (writesBlocked) return;
    if (next === 'rename') {
      setActionError('');
      setRenamePath(target);
    } else if (next === 'duplicate')
      void mutate('duplicate', target, duplicateFilePath(target, new Set(entries.keys())));
    else begin(next, target);
  }
  function moveFile(source: string, directory: string) {
    if (writesBlocked || parentDirectory(source) === directory) return;
    void mutate('rename', source, [directory, source.split('/').pop()].filter(Boolean).join('/'));
  }
  useEffect(() => {
    onDirtyChange(dirty || selectionBlocked);
  }, [dirty, selectionBlocked, onDirtyChange]);
  const initialEntry =
    root?.entries.find((entry) => entry.path === 'README.md') ??
    root?.entries.find((entry) => entry.type === 'file' && visibleEntry(entry, false));
  useEffect(() => {
    if (!choseEntry.current && initialEntry) {
      choseEntry.current = true;
      setSelected(initialEntry);
    }
  }, [initialEntry]);
  async function mutate(
    kind: 'folder' | 'rename' | 'delete' | 'duplicate',
    source = targetPath,
    destination = path,
  ): Promise<boolean> {
    if (mutationRef.current || document.isSaving() || dirty || worktree.status === 'busy') return false;
    mutationRef.current = true;
    setMutating(true);
    setActionError('');
    try {
      const current = client.getQueryData<Schema['Worktree']>([rootPath]);
      const headers = { 'If-Match': current?.revision ?? worktree.revision };
      const params = { path: { worktree_id: worktree.id }, header: headers };
      const operation =
        kind === 'folder'
          ? await request('createFolder', { params, body: { path: destination } })
          : kind === 'duplicate'
            ? await request('duplicateFile', { params, body: { path: source, new_path: destination } })
            : kind === 'rename'
              ? await request('renameFile', {
                  params: { ...params, query: { path: source } },
                  body: { new_path: destination },
                })
              : await request('deleteFile', { params: { ...params, query: { path: source } } });
      const result = await publishFileMutation(client, worktree.id, operation);
      choseEntry.current = true;
      if (kind === 'delete' && source === selectedPath) {
        await client.cancelQueries({ queryKey: ['file', worktree.id, selectedPath] });
        client.removeQueries({ queryKey: ['file', worktree.id, selectedPath] });
        setSelected(
          currentDirectory ? { path: currentDirectory, type: 'directory', revision: result.revision } : null,
        );
      } else if (kind !== 'delete') {
        const next = result.entry ?? {
          path: result.path,
          type: kind === 'folder' ? 'directory' : 'file',
          revision: result.revision,
        };
        if (kind === 'rename') {
          // A concurrent source edit can precede this rename. Only the destination GET
          // can pair its actual bytes with a revision; never relabel an old source buffer.
          await client.cancelQueries({ queryKey: ['file', worktree.id] });
          client.removeQueries({ queryKey: ['file', worktree.id, result.path] });
          client.removeQueries({ queryKey: ['file', worktree.id, selectedPath] });
          document.reset();
        }
        setSelected(next);
        expandTo(result.path);
        if (kind === 'folder') setExpanded((previous) => new Set([...previous, result.path]));
      }
      setSearch('');
      setAction(null);
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to update this file.');
      return false;
    } finally {
      mutationRef.current = false;
      setMutating(false);
    }
  }
  const reading = textDocument && content.isPending;
  const readFailed = Boolean(content.error && !dirty);
  const saveLabel = saving
    ? 'Saving…'
    : reading
      ? 'Loading…'
      : saveError
        ? 'Not saved'
        : readFailed
          ? 'Unable to read'
          : dirty
            ? 'Unsaved changes'
            : 'Saved';
  const SaveIcon = saveError || readFailed ? CircleAlert : dirty ? CloudUpload : Check;
  const directory = listing.results.get(selectedPath);
  const title =
    action === 'file' ? 'Create a file' : action === 'folder' ? 'Create a folder' : 'Delete this file?';
  const description =
    action === 'file'
      ? 'Use a relative path. Folders are created automatically.'
      : action === 'folder'
        ? 'Create a folder in this worktree.'
        : `${targetPath} will be removed from the current worktree. Earlier checkpoints remain available.`;
  return (
    <>
      <div
        className="file-browser worktree-file-browser"
        data-resizing={panel.isResizing || undefined}
        style={{ '--file-tree-width': `${panel.width}px` } as CSSProperties}
      >
        <div className="file-tree" id="worktree-file-explorer">
          <div className="file-tree-heading">
            <strong>Explorer</strong>
            <div className="file-tree-actions">
              <FileUpload worktree={worktree} disabled={writesBlocked} directory={currentDirectory} />
              <button
                className="icon-button"
                title="New folder"
                aria-label="New folder"
                disabled={writesBlocked}
                onClick={() => begin('folder')}
              >
                <FolderPlus size={16} />
              </button>
              <button
                className="icon-button"
                title="New file"
                aria-label="New file"
                disabled={writesBlocked}
                onClick={() => begin('file')}
              >
                <FilePlus2 size={16} />
              </button>
            </div>
          </div>
          <div className="file-search input-surface">
            <Search size={14} />
            <input
              aria-label="Filter files"
              placeholder="Find files…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="explorer-scroll">
            <button
              className={`explorer-root ${!selected ? 'selected' : ''}`}
              onClick={() => openEntry(null)}
              disabled={selectionBlocked}
              onDragOver={(event) => {
                if (!writesBlocked && event.dataTransfer.types.includes('application/x-macrofold-file'))
                  event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (writesBlocked) return;
                try {
                  const file = JSON.parse(event.dataTransfer.getData('application/x-macrofold-file'));
                  if (file.worktreeId === worktree.id && typeof file.path === 'string')
                    moveFile(file.path, '');
                } catch {
                  /* Ignore unrelated payloads. */
                }
              }}
            >
              <FolderOpen size={15} />
              {worktree.name ?? 'Untitled worktree'}
            </button>
            {(search ? matches.isPending : root?.loading && !root.entries.length) ? (
              <Loading />
            ) : (search ? matches.error : root?.error) ? (
              <ErrorState
                error={(search ? matches.error : root?.error) ?? new Error('Unable to list files.')}
                retry={() => (search ? void matches.refetch() : listing.retry(''))}
              />
            ) : (
              <>
                <FileTree
                  nodes={nodes}
                  worktreeId={worktree.id}
                  writesBlocked={writesBlocked}
                  renamePath={renamePath}
                  onRenameStart={setRenamePath}
                  onRename={(source, name) =>
                    mutate('rename', source, [parentDirectory(source), name].filter(Boolean).join('/'))
                  }
                  onAction={treeAction}
                  onMove={moveFile}
                  expandedPaths={expandedPaths}
                  selectedPath={selectedPath}
                  loadingPaths={loadingPaths}
                  errors={errors}
                  disabled={selectionBlocked}
                  onToggle={(folder) =>
                    setExpanded((previous) => {
                      const next = new Set(previous);
                      if (next.has(folder)) next.delete(folder);
                      else next.add(folder);
                      return next;
                    })
                  }
                  onSelect={(path) =>
                    openEntry(entries.get(path) ?? { path, type: 'directory', revision: worktree.revision })
                  }
                  onRetry={listing.retry}
                  hasMorePaths={search ? undefined : hasMorePaths}
                  onLoadMore={listing.loadMore}
                />
                {!nodes.length && (
                  <p className="file-tree-empty">
                    {search
                      ? 'No matching files.'
                      : 'No files yet. Add your first file or start an agent run.'}
                  </p>
                )}
                {search ? (
                  <More query={matches} label="More matching files" />
                ) : (
                  hasMorePaths.has('') && (
                    <Button variant="ghost" onClick={() => listing.loadMore('')}>
                      More files
                    </Button>
                  )
                )}
              </>
            )}
          </div>
          <div className="file-tree-footer">
            <span className="tiny-dot" />
            {dirty
              ? 'Draft not saved'
              : worktree.status === 'busy'
                ? 'Last verified checkpoint'
                : 'All files persisted'}
            <button
              className="icon-button"
              aria-label={showHidden ? 'Hide hidden files' : 'Show hidden files'}
              title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
              aria-pressed={showHidden}
              onClick={() => setShowHidden((value) => !value)}
            >
              {showHidden ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
        <div
          {...panel.handleProps}
          className="resize-handle file-resize-handle"
          aria-label="Resize file explorer"
          aria-controls="worktree-file-explorer"
          data-resizing={panel.isResizing || undefined}
        />
        <section className="file-editor" aria-label="File viewer">
          <div className="editor-bar">
            <nav className="file-breadcrumbs" aria-label="File location">
              <button
                title="Worktree root"
                aria-label="Worktree root"
                onClick={() => openEntry(null)}
                disabled={selectionBlocked}
              >
                <FolderOpen size={15} />
              </button>
              {selectedPath
                .split('/')
                .filter(Boolean)
                .map((part, index, parts) => {
                  const path = parts.slice(0, index + 1).join('/');
                  return (
                    <span key={path}>
                      <ChevronRight size={12} />
                      {index === parts.length - 1 ? (
                        <strong title={selectedPath}>{part}</strong>
                      ) : (
                        <button
                          onClick={() => openEntry({ path, type: 'directory', revision: worktree.revision })}
                          disabled={selectionBlocked}
                        >
                          {part}
                        </button>
                      )}
                    </span>
                  );
                })}
              {!selectedPath && <strong>{worktree.name ?? 'Untitled worktree'}</strong>}
              {dirty && <span className="dirty-dot" title="Unsaved changes" />}
            </nav>
            {isFile && (
              <div className="file-editor-actions">
                {markdownFile && (
                  <div className="view-switcher file-view-switcher" role="group" aria-label="Markdown view">
                    <button aria-pressed={mode === 'rich'} onClick={() => setMode('rich')}>
                      <Eye size={14} />
                      Rich
                    </button>
                    <button aria-pressed={mode === 'source'} onClick={() => setMode('source')}>
                      <Code2 size={14} />
                      Source
                    </button>
                    <button aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>
                      Preview
                    </button>
                    <button aria-pressed={mode === 'changes'} onClick={() => setMode('changes')}>
                      Changes
                    </button>
                  </div>
                )}
                {dirty && (
                  <Button
                    variant="ghost"
                    disabled={saving}
                    onClick={() => {
                      if (window.confirm('Discard your unsaved changes and reload the saved file?')) {
                        document.discard();
                      }
                    }}
                  >
                    Discard
                  </Button>
                )}
                <button
                  className="icon-button"
                  aria-label="Rename selected file"
                  title="Rename file"
                  onClick={() => treeAction(selectedPath, 'rename')}
                  disabled={writesBlocked}
                >
                  <Pencil size={15} />
                </button>
                <a
                  className="icon-button"
                  aria-label="Download selected file"
                  title="Download file"
                  href={`${rootPath}/file?path=${encodeURIComponent(selectedPath)}&download=true`}
                >
                  <Download size={15} />
                </a>
                <button
                  className="icon-button"
                  aria-label="Delete selected file"
                  title="Delete file"
                  onClick={() => begin('delete')}
                  disabled={writesBlocked}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )}
          </div>
          {actionError && !action && (
            <div className="form-error" role="alert">
              {actionError}
            </div>
          )}
          {saveError && (
            <div className="form-error" role="alert">
              {saveError} Your draft is still here.
              <Button
                variant="ghost"
                disabled={saving || worktree.status === 'busy'}
                onClick={() => void save()}
              >
                Retry save
              </Button>
            </div>
          )}
          <div className="file-viewer-content">
            {!isFile ? (
              <div className="directory-view">
                <div className="directory-view-heading">
                  <FolderOpen size={23} />
                  <h2>{selectedPath.split('/').pop() || worktree.name || 'Untitled worktree'}</h2>
                </div>
                {directory?.loading && !directory.entries.length ? (
                  <Loading />
                ) : directory?.error ? (
                  <ErrorState error={directory.error} retry={() => listing.retry(selectedPath)} />
                ) : (
                  <>
                    <div className="directory-entries">
                      {directory?.entries
                        .filter((entry) => visibleEntry(entry, showHidden))
                        .sort(
                          (a, b) =>
                            Number(b.type === 'directory') - Number(a.type === 'directory') ||
                            a.path.localeCompare(b.path, undefined, { numeric: true }),
                        )
                        .map((entry) => (
                          <button
                            key={entry.path}
                            disabled={selectionBlocked}
                            onClick={() => openEntry(entry)}
                          >
                            <FileIcon path={entry.path} kind={entry.type} />
                            <span>{entry.path.split('/').pop()}</span>
                            <small>
                              {entry.type === 'directory'
                                ? 'Folder'
                                : entry.type === 'symlink'
                                  ? 'Symbolic link'
                                  : `${Math.ceil(Number(entry.size_bytes ?? 0) / 1024)} KB`}
                            </small>
                            <ChevronRight size={14} />
                          </button>
                        ))}
                    </div>
                    {!directory?.entries.some((entry) => visibleEntry(entry, showHidden)) && (
                      <Empty
                        icon={<FolderOpen />}
                        title={selectedPath ? 'This folder is empty' : 'Your files live here'}
                        description="Add files or folders to organize your worktree."
                        action={
                          <Button variant="secondary" disabled={writesBlocked} onClick={() => begin('file')}>
                            <FilePlus2 size={15} />
                            New file
                          </Button>
                        }
                      />
                    )}
                    {directory?.nextCursor && (
                      <Button variant="ghost" onClick={() => listing.loadMore(selectedPath)}>
                        More files
                      </Button>
                    )}
                  </>
                )}
              </div>
            ) : selected?.type === 'symlink' ? (
              <Empty
                icon={<FileIcon path={selectedPath} kind="symlink" />}
                title="Symbolic link"
                description="Open the target file from the explorer. Links are never followed outside the worktree."
              />
            ) : mediaFile ? (
              <MediaPreview
                key={selectedPath}
                worktreeId={worktree.id}
                path={selectedPath}
                revision={worktree.revision}
                size={Number(selected?.size_bytes || 0)}
              />
            ) : Number(selected?.size_bytes ?? 0) > 4 * 1024 * 1024 ||
              (!content.isPending && !content.error && text.includes('\0')) ? (
              <Empty
                icon={<FileIcon path={selectedPath} />}
                title={Number(selected?.size_bytes ?? 0) > 4 * 1024 * 1024 ? 'Large file' : 'Binary file'}
                description="Download this file to view it in a compatible application."
                action={
                  <a
                    className="button secondary"
                    href={`${rootPath}/file?path=${encodeURIComponent(selectedPath)}&download=true`}
                  >
                    Download file
                  </a>
                }
              />
            ) : content.isPending ? (
              <Loading />
            ) : content.error ? (
              <ErrorState error={content.error} retry={() => void content.refetch()} />
            ) : markdownFile && mode === 'preview' ? (
              <MarkdownPreview
                content={text}
                filePath={selectedPath}
                onOpenFile={openPath}
                initialAnchor={anchor}
              />
            ) : markdownFile && mode === 'changes' ? (
              <MarkdownChanges
                before={document.baseline}
                after={text}
                filePath={selectedPath}
                onOpenFile={openPath}
              />
            ) : markdownFile && mode === 'rich' ? (
              <RichMarkdownEditor
                key={selectedPath}
                content={text}
                filePath={selectedPath}
                onOpenFile={openPath}
                initialAnchor={anchor}
                editable={worktree.status !== 'busy'}
                onChange={changeText}
              />
            ) : (
              <CodeMirror
                value={text}
                theme={theme}
                height="100%"
                extensions={markdownFile ? [markdown()] : []}
                editable={worktree.status !== 'busy'}
                onChange={changeText}
                basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
                onCreateEditor={(view) => view.contentDOM.setAttribute('aria-label', 'File editor')}
                aria-label="File editor"
              />
            )}
          </div>
          <div className="editor-footer">
            <span>
              {isFile
                ? worktree.status === 'busy'
                  ? 'Read only while an agent is working'
                  : textDocument
                    ? 'UTF-8'
                    : 'Original file'
                : 'Folders and files'}
            </span>
            {textDocument && (
              <span className="file-save-status" role="status" aria-live="polite">
                {!saving && !reading && <SaveIcon size={14} aria-hidden="true" />}
                <WaitingText active={saving || reading}>{saveLabel}</WaitingText>
              </span>
            )}
            <span>
              {dirty
                ? 'Autosaves after 2 seconds of inactivity'
                : `Revision ${textDocument ? revision : worktree.revision}`}
            </span>
          </div>
        </section>
      </div>
      <Modal
        open={action !== null}
        onOpenChange={(open) => {
          if (!open && !selectionBlocked) setAction(null);
        }}
        title={title}
        description={description}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (action === 'file') void save(path, '', true);
            else if (action) void mutate(action);
          }}
        >
          {action !== 'delete' && (
            <Field label={action === 'folder' ? 'Folder path' : 'File path'}>
              <input
                autoFocus
                required
                disabled={selectionBlocked}
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder={action === 'folder' ? 'notes/research' : 'notes/ideas.md'}
              />
            </Field>
          )}
          {actionError && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}
          <div className="dialog-actions">
            <Button
              variant="secondary"
              type="button"
              disabled={selectionBlocked}
              onClick={() => setAction(null)}
            >
              {action === 'delete' ? 'Keep file' : 'Cancel'}
            </Button>
            <Button
              variant={action === 'delete' ? 'danger' : 'primary'}
              type="submit"
              busy={selectionBlocked}
            >
              {action === 'file' ? 'Create file' : action === 'folder' ? 'Create folder' : 'Delete file'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
