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
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, useApi, usePages, type Schema } from '../lib/client';
import { Badge, Button, Empty, ErrorState, Loading, Modal, More, PageHeading, SectionHeading } from './ui';
import { AddConnectionDialog } from './add-connection';
import { ProviderLogo, providerName } from './provider-logo';
export function ConnectionsView() {
  const query = usePages<Schema['Connection']>('/v1/connections');
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState<Schema['Connection']>(),
    [remove, setRemove] = useState<Schema['Connection']>();
  const client = useQueryClient();
  const total = query.data?.data.length || 0;
  return (
    <div className="page">
      <PageHeading
        eyebrow="CONNECTED TO YOUR WORLD"
        title="Connections"
        description="Bring your models, tools, and apps into your agents’ workspace."
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
        description="Credentials stay encrypted. Tool access starts with explicit grants."
      />
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} />
      ) : !total ? (
        <Empty
          icon={<PlugZap />}
          title="Connect your first tool"
          description="Give your agents access to the services that make your work possible."
          action={
            <Button variant="secondary" onClick={() => setOpen(true)}>
              <Plus size={15} />
              Add connection
            </Button>
          }
        />
      ) : (
        <div className="connections-grid">
          {query.data?.data.map((c) => (
            <div className="connection-card" key={c.id}>
              <div className="connection-card-top">
                <span className="connection-icon">
                  <ProviderLogo provider={c.provider || c.kind} name={c.name} size={30} />
                </span>
                <Badge status={c.status} />
              </div>
              <h3>{c.name}</h3>
              <p>
                {c.kind === 'model'
                  ? `${providerName(c.provider || '')} · Your API key`
                  : c.kind === 'composio'
                    ? `${providerName(c.provider || '')} · Connected app`
                    : c.kind === 'search'
                      ? `Brave Search · ${c.auth_method === 'api_key' ? 'Your API key' : 'Managed usage'}`
                      : c.kind === 'mcp_stdio'
                        ? `${c.package} · ${c.package_version}`
                        : c.url || c.kind}
              </p>
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
                ) : c.kind !== 'model' ? (
                  <Button variant="secondary" onClick={() => setSelected(c)}>
                    <SlidersHorizontal size={14} />
                    Tools
                  </Button>
                ) : null}
                <button className="icon-button" aria-label={`Remove ${c.name}`} onClick={() => setRemove(c)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <More query={query} label="More connections" />
      {open && <AddConnectionDialog onClose={() => setOpen(false)} />}
      {selected && <ConnectionTools connection={selected} onClose={() => setSelected(undefined)} />}
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
function ConnectionTools({ connection, onClose }: { connection: Schema['Connection']; onClose: () => void }) {
  const tools = usePages<Schema['Tool']>(`/v1/connections/${connection.id}/tools`),
    grants = useApi<Schema['ConnectionGrantSet']>(`/v1/connections/${connection.id}/grants`);
  const [selection, setSelection] = useState<string[] | null>(null),
    [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const selected = selection ?? grants.data?.tools ?? [];
  return (
    <Modal
      open
      onOpenChange={onClose}
      title={`Tools · ${connection.name}`}
      description="Choose exactly which tools agents may request. New tools are never granted automatically."
      wide
    >
      {tools.isPending || grants.isPending ? (
        <Loading />
      ) : tools.error ? (
        <ErrorState error={tools.error} />
      ) : (
        <>
          <div className="tool-selection">
            {tools.data?.data.map((t) => (
              <label key={t.name}>
                <input
                  type="checkbox"
                  checked={selected.includes(t.name)}
                  onChange={(e) =>
                    setSelection(
                      e.target.checked ? [...selected, t.name] : selected.filter((v) => v !== t.name),
                    )
                  }
                />
                <span>
                  <strong>{t.name}</strong>
                  <small>{t.description}</small>
                </span>
              </label>
            ))}
          </div>
          <More query={tools} label="More tools" />
          <div className="dialog-actions">
            <span className="muted">{selected.length} tools selected</span>
            <Button
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/v1/connections/${connection.id}/grants`, 'PUT', {
                    ...grants.data,
                    tools: selected,
                  });
                  await client.invalidateQueries();
                  toast.success('Tool grants saved');
                  onClose();
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save permissions
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
