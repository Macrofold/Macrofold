'use client';

import { mediaFormat } from '../../../../packages/contracts/media';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { toast } from 'sonner';
import { type Schema } from '../../lib/client';
import { request, readDocument } from '../../lib/dashboard-data';
import { publishFileMutation } from '../../lib/workspace-files';

/** Owns a document's buffer, committed baseline and conflict revision. Presentation
 * selects the document; remote refreshes cannot replace a dirty or saving buffer.
 * Keep this independent of CodeMirror/Tiptap so both editors share save semantics. */
export function useFileDocument({
  worktree,
  selected,
  isMutating,
  onCreated,
  onCreateError,
}: {
  worktree: Schema['Worktree'];
  selected: Schema['FileEntry'] | null;
  isMutating: () => boolean;
  onCreated: (entry: Schema['FileEntry']) => void;
  onCreateError: (message: string) => void;
}) {
  const client = useQueryClient();
  const rootPath = `/v1/worktrees/${worktree.id}`;
  const selectedPath = selected?.path ?? '';
  const isFile = Boolean(selected && selected.type !== 'directory');
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(worktree.revision);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const draft = useRef('');
  const savedText = useRef('');
  const savingRef = useRef(false);
  function changeText(value: string) {
    draft.current = value;
    setText(value);
    setDirty(savingRef.current || value !== savedText.current);
  }
  function reset() {
    draft.current = savedText.current = '';
    setText('');
    setDirty(false);
    setSaveError('');
  }
  function discard() {
    setSaveError('');
    setDirty(false);
    void content.refetch();
  }
  useEffect(() => {
    if (!dirty) return;
    const unloading = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const navigating = (event: MouseEvent) => {
      const link =
        event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || link.download || link.target === '_blank') return;
      const target = new URL(link.href, location.href);
      if (
        target.pathname.startsWith('/v1/') ||
        target.pathname.startsWith('/objects/') ||
        target.href === location.href
      )
        return;
      if (!window.confirm('Leave this page and discard your unsaved draft?')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('beforeunload', unloading);
    document.addEventListener('click', navigating, true);
    return () => {
      window.removeEventListener('beforeunload', unloading);
      document.removeEventListener('click', navigating, true);
    };
  }, [dirty]);
  const content = useQuery({
    queryKey: ['file', worktree.id, selectedPath],
    enabled: Boolean(
      isFile &&
      selected?.type === 'file' &&
      (!mediaFormat(selectedPath) || mediaFormat(selectedPath)?.kind === 'text') &&
      Number(selected.size_bytes ?? 0) <= 4 * 1024 * 1024,
    ),
    queryFn: ({ signal }) => readDocument(worktree.id, selectedPath, signal),
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useEffect(() => {
    // A remote checkpoint must never replace a dirty draft or its conflict revision.
    if (content.data && !dirty && !saving) {
      draft.current = savedText.current = content.data.text;
      setText(content.data.text);
      setRevision(content.data.revision);
    }
  }, [content.data, dirty, saving]);

  async function save(filePath = selectedPath, value = draft.current, create = false) {
    if (savingRef.current || isMutating()) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    if (create) onCreateError('');
    try {
      const current = client.getQueryData<Schema['Worktree']>([rootPath]);
      const operation = await request('writeFile', {
        params: {
          path: { worktree_id: worktree.id },
          query: { path: filePath, ...(create ? { create_only: true } : {}) },
          header: { 'If-Match': create ? (current?.revision ?? worktree.revision) : revision },
        },
        body: value,
      });
      const result = await publishFileMutation(client, worktree.id, operation);
      const savedRevision = result.revision;
      savedText.current = value;
      setRevision(savedRevision);
      await client.cancelQueries({ queryKey: ['file', worktree.id, filePath] });
      client.setQueryData(['file', worktree.id, filePath], { text: value, revision: savedRevision });
      // Existing edits retain their buffer until their own committed file refreshes.
      // Other dashboard queries never delay the editor's completion.
      if (!create)
        await client.invalidateQueries(
          { queryKey: ['file', worktree.id, filePath] },
          { throwOnError: true },
        );
      setDirty(!create && draft.current !== value);
      if (create) {
        draft.current = value;
        setText(value);
        onCreated(result.entry ?? { path: filePath, type: 'file', revision: savedRevision });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save this file.';
      if (create) onCreateError(message);
      else {
        setSaveError(message);
        toast.error(message);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  const autosave = useEffectEvent(() => {
    void save();
  });
  useEffect(() => {
    if (!dirty || saving || saveError || !isFile || worktree.status === 'busy') return;
    const timer = setTimeout(autosave, 2000);
    return () => clearTimeout(timer);
  }, [text, dirty, saving, saveError, isFile, worktree.status]);
  return {
    text,
    dirty,
    revision,
    saving,
    saveError,
    content,
    baseline: savedText.current,
    changeText,
    save,
    reset,
    discard,
    isSaving: () => savingRef.current,
  };
}
