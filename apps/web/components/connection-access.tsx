'use client';
import { useState } from 'react';
import type { Schema } from '../lib/client';
import { useData } from '../lib/dashboard-data';
import { useConnectionAccess } from '../lib/connection-access';
import { AccessResourceSelect } from './access-resource-select';
import { Button, ErrorState, Field, Loading, Modal, Select } from './ui';

export function ConnectionAccess({
  connection,
  onClose,
}: {
  connection: Schema['Connection'];
  onClose: () => void;
}) {
  const access = useConnectionAccess(connection.id);
  const [project, setProject] = useState(''),
    [agent, setAgent] = useState('');
  const [sort, setSort] = useState<'project' | 'agent' | 'created_at'>('created_at');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const [cursors, setCursors] = useState<string[]>([]);
  const [draft, setDraft] = useState<{
    id?: string;
    scope: 'project' | 'agent' | 'project_agent';
    project: string;
    agent: string;
  }>();
  const [toggle, setToggle] = useState<boolean>();
  const rules = useData({
    operation: 'listConnectionAccessRules',
    params: {
      path: { connection_id: connection.id },
      query: {
        ...(project ? { project_id: project } : {}),
        ...(agent ? { agent_id: agent } : {}),
        sort,
        direction,
        ...(cursors.length ? { cursor: cursors.at(-1) } : {}),
      },
    },
  });
  function edit(next: NonNullable<typeof draft>) {
    access.beginDraft();
    setDraft(next);
  }
  function cancelEdit() {
    setDraft(undefined);
    access.cancelDraft();
  }
  const accessError = access.errorMessage && access.data && (
    <div role="alert">
      <p>{access.errorMessage}</p>
      <p>
        Current organization access: {access.data.organization_wide ? 'On' : 'Off'}. Approved tools:{' '}
        {access.data.tools.join(', ') || 'None'}.
      </p>
    </div>
  );
  return (
    <Modal
      open
      onOpenChange={onClose}
      title={`Access · ${connection.name}`}
      description="Choose where this connection may be used. Approved tools are managed separately."
      wide
    >
      {access.isPending ? (
        <Loading />
      ) : access.error ? (
        <ErrorState error={access.error} />
      ) : (
        <>
          <label className="checkbox-row">
            <input
              type="checkbox"
              role="switch"
              checked={toggle ?? access.data!.organization_wide}
              disabled={
                access.busy ||
                !(access.data!.organization_wide ? access.data!.can_revoke : access.data!.can_grant)
              }
              onChange={async (event) => {
                const value = event.target.checked;
                setToggle(value);
                await access.patch({ organization_wide: value });
                setToggle(undefined);
              }}
            />{' '}
            Available across the organization
          </label>
          <p className="form-hint">
            Turning this off keeps the permissions below. A matching permission still allows access.
          </p>
          {!access.data!.can_grant && (
            <p className="form-hint">
              Only the connection’s owner, with organization administrator access, can add permissions.
            </p>
          )}
          {!draft && accessError}
          <div className="form-grid">
            <AccessResourceSelect
              kind="project"
              label="Project filter"
              value={project}
              onChange={(value) => {
                setProject(value);
                setCursors([]);
              }}
            />
            <AccessResourceSelect
              kind="agent"
              label="Preset filter"
              value={agent}
              onChange={(value) => {
                setAgent(value);
                setCursors([]);
              }}
            />
            <Field label="Sort permissions">
              <Select
                value={sort}
                onValueChange={(value) => {
                  setSort(value as typeof sort);
                  setCursors([]);
                }}
                options={[
                  { value: 'created_at', label: 'Created' },
                  { value: 'project', label: 'Project' },
                  { value: 'agent', label: 'Preset' },
                ]}
              />
            </Field>
            <Field label="Sort direction">
              <Select
                value={direction}
                onValueChange={(value) => {
                  setDirection(value as typeof direction);
                  setCursors([]);
                }}
                options={[
                  { value: 'asc', label: 'Ascending' },
                  { value: 'desc', label: 'Descending' },
                ]}
              />
            </Field>
          </div>
          {rules.isPending ? (
            <Loading label="Loading permissions…" />
          ) : rules.error ? (
            <ErrorState error={rules.error} retry={() => void rules.refetch()} />
          ) : !rules.data?.data.length ? (
            <p>
              No permissions added{project || agent ? ' for these filters' : ''}.{' '}
              {access.data!.organization_wide
                ? 'Organization access is on.'
                : 'Add a permission to allow access.'}
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Permission</th>
                    <th
                      aria-sort={
                        sort === 'project' ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
                      }
                    >
                      Project
                    </th>
                    <th
                      aria-sort={
                        sort === 'agent' ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
                      }
                    >
                      Preset
                    </th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.data.data.map((rule) => (
                    <tr key={rule.id}>
                      <td>
                        {rule.scope === 'project_agent'
                          ? 'Project + preset'
                          : rule.scope === 'agent'
                            ? 'Preset'
                            : 'Project'}
                        {rule.unavailable && ' · unavailable'}
                      </td>
                      <td>{rule.project_id ? rule.project_name || 'Unavailable project' : 'Any'}</td>
                      <td>{rule.agent_id ? rule.agent_name || 'Unavailable preset' : 'Any'}</td>
                      <td>
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={!access.data!.can_grant || access.busy}
                          onClick={() =>
                            edit({
                              id: rule.id,
                              scope: rule.scope,
                              project: rule.project_id || '',
                              agent: rule.agent_id || '',
                            })
                          }
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={!access.data!.can_revoke || access.busy}
                          onClick={() => void access.deleteRule(rule.id)}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="dialog-actions">
            {!!cursors.length && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCursors((current) => current.slice(0, -1))}
              >
                Previous permissions
              </Button>
            )}
            {rules.data?.next_cursor && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCursors((current) => [...current, rules.data!.next_cursor!])}
              >
                Next permissions
              </Button>
            )}
            <Button
              type="button"
              disabled={!access.data!.can_grant || access.busy}
              onClick={() => edit({ scope: 'project', project: '', agent: '' })}
            >
              Add permission
            </Button>
          </div>
          {draft && (
            <Modal
              open
              title={draft.id ? 'Edit permission' : 'New permission'}
              description="Allow this project, preset, or exact combination to use the approved tools."
              onOpenChange={(open) => {
                if (!open) cancelEdit();
              }}
            >
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  const body: Schema['ConnectionAccessRuleInput'] =
                    draft.scope === 'project'
                      ? { scope: 'project', project_id: draft.project }
                      : draft.scope === 'agent'
                        ? { scope: 'agent', agent_id: draft.agent }
                        : { scope: 'project_agent', project_id: draft.project, agent_id: draft.agent };
                  if (await access.saveRule(body, draft.id)) {
                    setDraft(undefined);
                    setCursors([]);
                  }
                }}
              >
                {accessError}
                <Field label="Permission scope">
                  <Select
                    value={draft.scope}
                    onValueChange={(value) => setDraft({ ...draft, scope: value as typeof draft.scope })}
                    options={[
                      { value: 'project', label: 'Project' },
                      { value: 'agent', label: 'Agent preset' },
                      { value: 'project_agent', label: 'Project + agent preset' },
                    ]}
                  />
                </Field>
                <div className="form-grid">
                  {draft.scope !== 'agent' && (
                    <AccessResourceSelect
                      kind="project"
                      label="Permission project"
                      optional={false}
                      value={draft.project}
                      onChange={(value) => setDraft({ ...draft, project: value })}
                    />
                  )}
                  {draft.scope !== 'project' && (
                    <AccessResourceSelect
                      kind="agent"
                      label="Permission preset"
                      optional={false}
                      value={draft.agent}
                      onChange={(value) => setDraft({ ...draft, agent: value })}
                    />
                  )}
                </div>
                <div className="dialog-actions">
                  <Button type="button" variant="secondary" onClick={cancelEdit}>
                    Cancel edit
                  </Button>
                  <Button
                    type="submit"
                    busy={access.busy}
                    disabled={
                      (draft.scope !== 'agent' && !draft.project) ||
                      (draft.scope !== 'project' && !draft.agent)
                    }
                  >
                    Save permission
                  </Button>
                </div>
              </form>
            </Modal>
          )}
        </>
      )}
    </Modal>
  );
}
