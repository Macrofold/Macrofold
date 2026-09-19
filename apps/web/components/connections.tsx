'use client';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Globe,
  KeyRound,
  PlugZap,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Terminal,
  Trash2,
  Pencil,
} from 'lucide-react';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useData, useDataPages } from '../lib/dashboard-data';
import { useConnectionAccess } from '../lib/connection-access';
import { ConnectionAccess } from './connection-access';
import { AccessResourceSelect } from './access-resource-select';
import { toast } from 'sonner';
import { api, useApi, usePages, type Schema } from '../lib/client';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Field,
  Loading,
  Modal,
  More,
  PageHeading,
  SectionHeading,
  Select,
} from './ui';
import { AddConnectionDialog } from './add-connection';
import { ProviderLogo, ProviderLabel, providerName } from './provider-logo';
import { connectionLogoProvider } from '../lib/provider-branding';
export function ConnectionsView() {
  const filters = useSearchParams(),
    router = useRouter();
  const workspace = filters.get('workspace_id') || '',
    agent = filters.get('agent_id') || '';
  const query = useDataPages({
    operation: 'listConnections',
    params: { query: { ...(workspace ? { workspace_id: workspace } : {}), ...(agent ? { agent_id: agent } : {}) } },
  });
  const identity = useData({ operation: 'getIdentity' });
  const [accessConnection, setAccessConnection] = useState<Schema['Connection']>();
  function filter(name: string, value: string) {
    const next = new URLSearchParams(filters.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    router.replace(`/connections${next.size ? `?${next}` : ''}`, { scroll: false });
  }
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState<Schema['Connection']>(),
    [editing, setEditing] = useState<Schema['Connection']>(),
    [remove, setRemove] = useState<Schema['Connection']>();
  const client = useQueryClient();
  const total = query.data?.data.length || 0;
  return (
    <div className="page">
      <PageHeading
        eyebrow="CONNECTED TO YOUR WORLD"
        title="Connections"
        description="Bring your models, tools, and apps into your agents’ worktree."
        action={
          <Button
            onClick={() => {
              setOpen(true);
            }}
          >
            <Plus size={17} />
            Add connection
          </Button>
        }
      />
      <div className="connection-intro">
        <div>
          <div className="intro-icon">
            <PlugZap size={23} />
          </div>
          <h2>More context. More capability.</h2>
          <p>
            Use your own model keys, connect an MCP server, or authorize the apps you already use. You control
            which tools each agent can access.
          </p>
        </div>
        <div className="connection-types">
          <span>
            <KeyRound size={17} />
            Model API keys
          </span>
          <span>
            <Terminal size={17} />
            MCP servers
          </span>
          <span>
            <Globe size={17} />
            Connected apps
          </span>
        </div>
      </div>
      <SectionHeading
        title={`Your connections${total ? ` · ${total}` : ''}`}
        description="Credentials stay encrypted. Approve tools, then choose where they may be used."
      />
      <div className="form-grid">
        <AccessResourceSelect
          kind="workspace"
          label="Workspace filter"
          value={workspace}
          onChange={(value) => filter('workspace_id', value)}
          onUnavailable={() => filter('workspace_id', '')}
        />
        <AccessResourceSelect
          kind="agent"
          label="Preset filter"
          value={agent}
          onChange={(value) => filter('agent_id', value)}
          onUnavailable={() => filter('agent_id', '')}
        />
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} />
      ) : !total ? (
        <Empty
          icon={<PlugZap />}
          title={workspace || agent ? 'No connections match these filters' : 'Connect your first tool'}
          description={
            workspace || agent
              ? 'Choose another workspace or preset, or clear the filters to see your connections.'
              : 'Give your agents access to the services that make your work possible.'
          }
          action={
            workspace || agent ? (
              <Button variant="secondary" onClick={() => router.replace('/connections', { scroll: false })}>
                Clear filters
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setOpen(true)}>
                <Plus size={15} /> Add connection
              </Button>
            )
          }
        />
      ) : (
        <div className="connections-grid">
          {query.data?.data.map((c) => (
            <div className="connection-card" key={c.id}>
              <div className="connection-card-top">
                <span className="connection-icon">
                  <ProviderLogo provider={connectionLogoProvider(c)} name={c.name} size={30} />
                </span>
                <Badge status={c.status} />
              </div>
              <h3>{c.name}</h3>
              <p>
                {c.kind === 'claude_subscription'
                  ? 'Claude subscription · Authentication not yet available'
                  : c.kind === 'model'
                    ? `${providerName(c.provider || '')} · Your API key`
                    : c.kind === 'composio'
                      ? `${providerName(c.provider || '')} · Connected app`
                      : c.kind === 'search'
                        ? `${providerName(c.provider || '')} · ${c.auth_method === 'api_key' ? 'Your API key' : 'Managed usage'}`
                        : c.kind === 'mcp_stdio'
                          ? `${c.package} · ${c.package_version}`
                          : c.url || c.kind}
              </p>
              {c.account_identity && <p>Account: {c.account_identity}</p>}
              {c.access_match?.scopes.length ? (
                <p className="form-hint">
                  {c.access_match.conditional
                    ? workspace
                      ? `Requires preset: ${c.access_match.matching_rules
                          .map((rule) => rule.agent_name)
                          .filter(Boolean)
                          .join(', ')}`
                      : agent
                        ? `Requires workspace: ${c.access_match.matching_rules
                            .map((rule) => rule.workspace_name)
                            .filter(Boolean)
                            .join(', ')}`
                        : `Requires: ${c.access_match.matching_rules.map((rule) => [rule.workspace_name, rule.agent_name].filter(Boolean).join(' + ')).join(', ')}`
                    : 'Available in this context'}{' '}
                  · {c.access_match.scopes.map((scope) => scope.replaceAll('_', ' + ')).join(', ')}
                  {c.access_match.matched_rule_count > 0 &&
                    ` · ${c.access_match.matched_rule_count} matching permissions`}
                  {c.access_match.matching_rules_truncated && ' · examples shown'}
                </p>
              ) : (
                !['model', 'claude_subscription'].includes(c.kind) && (
                  <p className="form-hint">No matching access</p>
                )
              )}
              {c.approved_tools?.length === 0 && <p className="form-hint">No tools enabled</p>}
              {c.owner_subject_id === identity.data?.user_id && (
                <div className="connection-card-actions">
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      try {
                        const result = await api<Schema['ConnectionTest']>(
                          `/v1/connections/${c.id}/test`,
                          'POST',
                          {},
                        );
                        await client.invalidateQueries();
                        toast[result.status === 'error' ? 'error' : 'info'](result.message || result.status);
                      } catch (e) {
                        toast.error((e as Error).message);
                      }
                    }}
                  >
                    <RefreshCw size={14} />
                    Test
                  </Button>
                  {(c.kind === 'composio' || c.auth_method === 'oauth') && c.status !== 'healthy' ? (
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        try {
                          const link = await api<Schema['AuthorizationLink']>(
                            `/v1/connections/${c.id}/authorize`,
                            'POST',
                            {},
                          );
                          location.assign(link.authorization_url);
                        } catch (e) {
                          toast.error((e as Error).message);
                        }
                      }}
                    >
                      Connect <ArrowUpRight size={13} />
                    </Button>
                  ) : !['model', 'claude_subscription'].includes(c.kind) ? (
                    <Button variant="secondary" onClick={() => setSelected(c)}>
                      <SlidersHorizontal size={14} />
                      Tools
                    </Button>
                  ) : null}
                  {!['model', 'claude_subscription'].includes(c.kind) && (
                    <Button variant="secondary" onClick={() => setAccessConnection(c)}>
                      Access
                    </Button>
                  )}
                  <button className="icon-button" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                    <Pencil size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Remove ${c.name}`}
                    onClick={() => setRemove(c)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <More query={query} label="More connections" />
      {open && <AddConnectionDialog onClose={() => setOpen(false)} />}
      {accessConnection && (
        <ConnectionAccess connection={accessConnection} onClose={() => setAccessConnection(undefined)} />
      )}
      {selected && <ConnectionTools connection={selected} onClose={() => setSelected(undefined)} />}
      {editing && <ConnectionSettings connection={editing} onClose={() => setEditing(undefined)} />}
      <Modal
        open={Boolean(remove)}
        onOpenChange={() => setRemove(undefined)}
        title="Remove connection?"
        description="Future runs will lose access to this connection. Revoke upstream credentials separately if needed."
      >
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setRemove(undefined)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await api(`/v1/connections/${remove!.id}`, 'DELETE');
                setRemove(undefined);
                await client.invalidateQueries();
                toast.success('Connection removed');
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Remove connection
          </Button>
        </div>
      </Modal>
    </div>
  );
}
function ConnectionSettings({
  connection,
  onClose,
}: {
  connection: Schema['Connection'];
  onClose: () => void;
}) {
  const originalBackup = connection.api_fallback?.connection_id || '';
  const originalBudget = connection.api_fallback?.enabled
    ? String(Number(connection.api_fallback.max_cost_micro_usd) / 1_000_000)
    : '';
  const [name, setName] = useState(connection.name),
    [backup, setBackup] = useState(originalBackup),
    [budget, setBudget] = useState(originalBudget),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const subscription = connection.kind === 'claude_subscription';
  const identity = useApi<Schema['Identity']>(subscription ? '/v1/me' : undefined);
  const connections = usePages<Schema['Connection']>(subscription ? '/v1/connections' : undefined);
  const client = useQueryClient();
  return (
    <Modal
      open
      onOpenChange={() => {
        if (!busy) onClose();
      }}
      title="Edit connection"
      description="Names help you recognize accounts. Agents keep using the same connection ID."
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            await api(`/v1/connections/${connection.id}`, 'PATCH', {
              name,
              ...(subscription && (backup !== originalBackup || budget !== originalBudget)
                ? {
                    api_fallback: backup
                      ? {
                          enabled: true,
                          connection_id: backup,
                          max_cost_micro_usd: String(Math.round(Number(budget) * 1_000_000)),
                        }
                      : { enabled: false },
                  }
                : {}),
            });
            await client.invalidateQueries();
            onClose();
            toast.success('Connection saved');
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Connection name">
          <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Connection ID">
          <input readOnly value={connection.id} />
        </Field>
        {subscription && (
          <>
            <p className="form-hint">
              Subscription authentication and automatic fallback are not enabled yet. You can save the
              intended policy.
            </p>
            <Field label="Backup Anthropic API key">
              <Select
                value={backup}
                onValueChange={setBackup}
                options={[
                  { value: '', label: 'Disabled · never fall back to paid API usage' },
                  ...(connections.data?.data
                    .filter(
                      (item) =>
                        item.kind === 'model' &&
                        item.provider === 'anthropic' &&
                        item.status === 'healthy' &&
                        item.owner_subject_id === identity.data?.user_id,
                    )
                    .map((item) => ({
                      value: item.id,
                      label: <ProviderLabel provider={connectionLogoProvider(item)} name={item.name} />,
                    })) || []),
                ]}
              />
            </Field>
            <More query={connections} label="More connections" />
            {backup && (
              <Field
                label="Per-run API limit (USD)"
                hint="Infrastructure charges are separate. No paid fallback is enabled until subscription support is available."
              >
                <input
                  required
                  type="number"
                  min="0.000001"
                  max="999999.999999"
                  step="0.000001"
                  value={budget}
                  onChange={(event) => setBudget(event.target.value)}
                />
              </Field>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <Button type="submit" busy={busy}>
            Save connection
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function ConnectionTools({ connection, onClose }: { connection: Schema['Connection']; onClose: () => void }) {
  const tools = useDataPages({
    operation: 'listConnectionTools',
    params: { path: { connection_id: connection.id } },
  });
  const access = useConnectionAccess(connection.id);
  const [selection, setSelection] = useState<string[] | null>(null);
  const selected = selection ?? access.data?.tools ?? [];
  const catalog = tools.data?.data || [];
  const names = [...new Set([...catalog.map((tool) => tool.name), ...selected])];
  return (
    <Modal
      open
      onOpenChange={onClose}
      title={`Tools · ${connection.name}`}
      description="Choose the approved tool ceiling. New tools are never approved automatically. Access rules are managed separately."
      wide
    >
      {tools.isPending || access.isPending ? (
        <Loading />
      ) : tools.error || access.error ? (
        <ErrorState
          error={(tools.error || access.error)!}
          retry={() => {
            void tools.refetch();
            void access.refetch();
          }}
        />
      ) : (
        <>
          {access.errorMessage && (
            <div role="alert">
              <p>{access.errorMessage}</p>
              <p>Current approved tools: {access.data!.tools.join(', ') || 'None'}.</p>
            </div>
          )}
          {!names.length && <p>No tools discovered yet.</p>}
          <div className="tool-selection">
            {names.map((name) => (
              <label key={name}>
                <input
                  type="checkbox"
                  checked={selected.includes(name)}
                  disabled={
                    access.busy ||
                    !(selected.includes(name) ? access.data!.can_revoke : access.data!.can_grant)
                  }
                  onChange={(event) => {
                    access.beginDraft();
                    setSelection(
                      event.target.checked ? [...selected, name] : selected.filter((tool) => tool !== name),
                    );
                  }}
                />
                <span>
                  <strong>{name}</strong>
                  <small>{catalog.find((tool) => tool.name === name)?.description}</small>
                </span>
              </label>
            ))}
          </div>
          <More query={tools} label="More tools" />
          <div className="dialog-actions">
            <span className="muted">{selected.length} approved tools</span>
            <Button
              busy={access.busy}
              disabled={!access.data!.can_revoke}
              onClick={async () => {
                if (await access.patch({ tools: selected })) {
                  toast.success('Approved tools saved');
                  onClose();
                }
              }}
            >
              Save tools
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
