'use client';
import { PermissionEditor } from './permission-editor';

import { Check, Sparkles } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type Schema } from '../lib/client';
import { request, useData } from '../lib/dashboard-data';
import { Button, Field, Modal } from './ui';
import { Select } from './select';
import { WaitingText } from './waiting-text';

/** Validation is advisory; creation repeats it under the workspace's server-side lock. */
export function CreateWorktree({
  workspaceId,
  source,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  source?: Schema['Worktree'];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [permissions, setPermissions] = useState<Schema['AgentPermissions']>();
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('');
  const [branchMode, setBranchMode] = useState<'auto' | 'new' | 'existing'>('auto');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const client = useQueryClient(),
    router = useRouter(),
    listId = useId();
  const search = new URLSearchParams({ name, branch }).toString();
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 200);
    return () => clearTimeout(timer);
  }, [search]);
  const checked = new URLSearchParams(query);
  const options = useData(
    open
      ? {
          operation: 'getWorktreeOptions',
          params: {
            path: { workspace_id: workspaceId },
            query: { name: checked.get('name') ?? '', branch: checked.get('branch') ?? '' },
          },
        }
      : undefined,
  );
  const checking = options.isPending || query !== search;
  const modeError =
    branchMode === 'new' && options.data?.branch_exists
      ? 'This branch already exists.'
      : branchMode === 'existing' && !options.data?.branch_exists
        ? 'Select an existing branch.'
        : '';
  const validation = !checking && (modeError || (options.data?.valid === false ? options.data.message : ''));
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Create worktree"
      description="Give another task an independent copy of your workspace files."
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (checking || validation) return;
          setBusy(true);
          setError('');
          try {
            const op = await request('createWorktree', {
              params: { path: { workspace_id: workspaceId } },
              body: {
                name: name.trim(),
                branch: branch.trim(),
                branch_mode: branchMode,
                permissions,
                ...(source?.latest_checkpoint_id
                  ? { source: { kind: 'checkpoint', checkpoint_id: source.latest_checkpoint_id } }
                  : {}),
              },
            });
            if (!op.result?.worktree_id) throw new Error('The worktree has not finished creating.');
            void client.invalidateQueries({ queryKey: [`/v1/workspaces/${workspaceId}/worktrees`] });
            onOpenChange(false);
            router.push(`/workspaces/${workspaceId}/worktrees/${op.result.worktree_id}`);
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Unable to create worktree.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Name">
          <div className="input-surface worktree-input">
            <Sparkles size={16} aria-hidden="true" />
            <input
              aria-label="Name"
              autoFocus
              maxLength={151}
              placeholder="Smart name — leave empty"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </Field>
        <Field label="Branch">
          <div className="input-surface worktree-input">
            <Sparkles size={16} aria-hidden="true" />
            <input
              aria-label="Branch"
              list={listId}
              maxLength={151}
              placeholder="Smart name — select or type a branch"
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
            />
            {branch.trim() && !checking && !validation && options.data?.valid && (
              <Check
                size={17}
                className="worktree-valid"
                aria-label={options.data.branch_exists ? 'Existing branch' : 'Branch available'}
              />
            )}
          </div>
          <datalist id={listId}>
            {options.data?.branches.map((item) => (
              <option key={item.name} value={item.name} />
            ))}
          </datalist>
        </Field>
        <details className="worktree-advanced">
          <summary>Advanced options</summary>
          <Field label="Branch behavior">
            <Select
              value={branchMode}
              onValueChange={(value) => setBranchMode(value as typeof branchMode)}
              options={[
                { value: 'auto', label: 'Use selected branch or create a new branch' },
                { value: 'new', label: 'Create a new branch' },
                { value: 'existing', label: 'Use an existing branch' },
              ]}
            />
          </Field>
          <PermissionEditor value={permissions} onChange={setPermissions} />
        </details>
        <p className="muted worktree-hint" role="status">
          {checking ? (
            <WaitingText>Checking names…</WaitingText>
          ) : (
            validation ||
            options.error?.message ||
            (options.data?.name
              ? `${options.data.name} · ${options.data.branch}${options.data.branch_exists ? ' (existing branch)' : ' (new branch)'}`
              : 'Leave both empty to name this worktree from its first agent task.')
          )}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            busy={busy}
            disabled={checking || Boolean(validation) || Boolean(options.error)}
          >
            Create worktree
          </Button>
        </div>
      </form>
    </Modal>
  );
}
