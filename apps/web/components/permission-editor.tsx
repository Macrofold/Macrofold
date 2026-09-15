'use client';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Schema } from '../lib/client';
import { request } from '../lib/dashboard-data';
import { Button, Field } from './ui';
import { Select } from './select';

type Policy = Schema['AgentPermissions'];
function PatternInput({
  value,
  onChange,
  ...props
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const emitted = useRef(value);
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setDraft(value);
    }
  }, [value]);
  return (
    <textarea
      {...props}
      value={draft}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        emitted.current = text
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .join('\n');
        onChange(text);
      }}
    />
  );
}
/** The same editor configures each layer; it never flattens inherited allows. */
export function PermissionEditor({ value, onChange }: { value?: Policy; onChange: (value: Policy) => void }) {
  const policy: Policy = value || { version: 1 };
  function setPattern(action: 'read' | 'write', field: 'include' | 'exclude', text: string) {
    const patterns = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    onChange({
      ...policy,
      files: {
        ...policy.files,
        [action]: { ...policy.files?.[action], [field]: patterns.length ? patterns : undefined },
      },
    });
  }
  return (
    <fieldset className="permission-editor">
      <legend>Agent permissions</legend>
      <p className="form-hint">
        Restrictions inherit from the project and worktree. Exclusions always win. Use one relative pattern
        per line, such as src/** or **/*.env. Leave blank to inherit.
      </p>
      {(['read', 'write'] as const).map((action) => (
        <div className="form-grid" key={action}>
          <Field label={`${action === 'read' ? 'Read' : 'Write'} included files`}>
            <PatternInput
              aria-label={`${action} included files`}
              rows={2}
              placeholder="Inherit all files"
              value={policy.files?.[action]?.include?.join('\n') || ''}
              disabled={policy.files?.[action]?.include?.length === 0}
              onChange={(text) => setPattern(action, 'include', text)}
            />
          </Field>
          <Field label={`${action === 'read' ? 'Read' : 'Write'} excluded files`}>
            <PatternInput
              aria-label={`${action} excluded files`}
              rows={2}
              placeholder="e.g. secrets/**"
              value={policy.files?.[action]?.exclude?.join('\n') || ''}
              onChange={(text) => setPattern(action, 'exclude', text)}
            />
          </Field>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={policy.files?.[action]?.include?.length === 0}
              onChange={(event) =>
                onChange({
                  ...policy,
                  files: {
                    ...policy.files,
                    [action]: { ...policy.files?.[action], include: event.target.checked ? [] : undefined },
                  },
                })
              }
            />
            Deny all {action}s
          </label>
        </div>
      ))}
      <Field label="Shell access">
        <Select
          value={policy.shell || 'inherit'}
          onValueChange={(value) => onChange({ ...policy, shell: value === 'inherit' ? undefined : 'deny' })}
          options={[
            { value: 'inherit', label: 'Inherit' },
            { value: 'deny', label: 'Disable shell' },
          ]}
        />
      </Field>
      <Field
        label="Excluded connector tools"
        hint="Use connection-ID/tool-name patterns. Existing connection grants are always required."
      >
        <PatternInput
          rows={2}
          placeholder="e.g. **/SEND_EMAIL"
          value={policy.tools?.exclude?.join('\n') || ''}
          onChange={(text) =>
            onChange({
              ...policy,
              tools: {
                ...policy.tools,
                exclude: text
                  .split('\n')
                  .map((v) => v.trim())
                  .filter(Boolean),
              },
            })
          }
        />
      </Field>
      <p className="form-hint">
        File restrictions apply to every supported harness and disable shell, subagents and local stdio
        connectors. Stop pending runs before changing project or worktree permissions; changed policies
        require a new conversation.
      </p>
    </fieldset>
  );
}
export function PermissionSettings({
  scope,
  id,
  value,
}: {
  scope: 'project' | 'worktree';
  id: string;
  value?: Policy;
}) {
  const [policy, setPolicy] = useState<Policy>(value || { version: 1 });
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  return (
    <form
      className="panel"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          if (scope === 'project')
            await request('updateProject', {
              params: { path: { project_id: id } },
              body: { permissions: policy },
            });
          else
            await request('updateWorkspace', {
              params: { path: { workspace_id: id } },
              body: { permissions: policy },
            });
          await client.invalidateQueries();
          toast.success('Agent permissions saved');
        } catch (error) {
          toast.error((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{scope === 'project' ? 'Project' : 'Worktree'} permissions</h2>
      <PermissionEditor value={policy} onChange={setPolicy} />
      <Button type="submit" busy={busy}>
        Save {scope} permissions
      </Button>
    </form>
  );
}
