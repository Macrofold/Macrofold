'use client';
import { ArrowLeft, Box, Globe, KeyRound, Search, ShieldCheck, Terminal } from 'lucide-react';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, useApi, type Schema } from '../lib/client';
import { Button, ErrorState, Field, Modal, Select } from './ui';
import { ConnectorBrowser } from './connector-browser';
import { ProviderLabel, ProviderLogo, providerName } from './provider-logo';
import { searchProviders, isSearchProvider } from '../../../packages/contracts/search';

const kinds = [
  { id: 'composio', label: 'Apps', icon: Globe },
  { id: 'model', label: 'Model key', icon: KeyRound },
  { id: 'mcp_remote', label: 'MCP server', icon: Terminal },
  { id: 'mcp_stdio', label: 'Sandbox MCP', icon: Box },
  { id: 'search', label: 'Web search', icon: Search },
] as const;
type Kind = (typeof kinds)[number]['id'];
const descriptions: Record<Kind, string> = {
  composio: 'Bring the apps you use every day into your agents’ workspace.',
  model: 'Use your own provider account. Your API key stays encrypted on the server.',
  mcp_remote: 'Connect a remote MCP server and choose the tools your agents can use.',
  mcp_stdio: 'Run a reviewed MCP server inside your agent’s sandbox.',
  search: 'Give your agents up-to-date information from your preferred search provider.',
};
export function AddConnectionDialog({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('composio');
  const [selected, setSelected] = useState<Schema['ConnectorCatalogEntry']>();
  const [name, setName] = useState(''),
    [provider, setProvider] = useState('openai'),
    [url, setUrl] = useState(''),
    [secret, setSecret] = useState(''),
    [auth, setAuth] = useState('bearer'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [packageKey, setPackageKey] = useState(''),
    [environment, setEnvironment] = useState<Record<string, string>>({});
  const client = useQueryClient();
  const catalog = useApi<Schema['ConnectorCatalog']>(
    kind === 'composio' ? '/v1/connector-catalog' : undefined,
  );
  const packages = useApi<Schema['StdioPackagePage']>(
    kind === 'mcp_stdio' ? '/v1/stdio-packages' : undefined,
  );
  const selectedPackage =
    packages.data?.data.find((p) => `${p.package}@${p.version}` === packageKey) || packages.data?.data[0];
  const browse = kind === 'composio' && !selected;
  function changeKind(next: Kind) {
    setKind(next);
    setSelected(undefined);
    setError('');
    setSecret('');
    setEnvironment({});
    setName('');
    setUrl('');
    setProvider(next === 'search' ? 'brave' : 'openai');
    setAuth(next === 'search' ? 'none' : 'bearer');
  }
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title="Add a connection"
      description="Your favorite tools. A little more connected."
      className="connector-dialog"
    >
      <div className="connector-kind-tabs" aria-label="Connection type">
        {kinds.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            aria-pressed={kind === id}
            onClick={() => changeKind(id)}
            disabled={busy}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
      </div>
      {kind === 'composio' && (
        <div className="connector-browser-pane" hidden={!browse}>
          <ConnectorBrowser
            active={browse}
            catalog={catalog.data}
            loading={catalog.isPending}
            error={catalog.error}
            retry={() => {
              void catalog.refetch();
            }}
            onSelect={(entry) => {
              setSelected(entry);
              setProvider(entry.slug);
              setName(`${entry.name} account`);
              setError('');
            }}
          />
        </div>
      )}
      {!browse && (
        <div className="connector-setup-scroll">
          <div className="connector-setup">
            {kind === 'composio' && (
              <button
                type="button"
                className="connector-back"
                onClick={() => setSelected(undefined)}
                disabled={busy}
              >
                <ArrowLeft size={16} />
                All apps
              </button>
            )}
            <div className="connector-setup-heading">
              <span className="connector-logo-tile">
                <ProviderLogo
                  provider={
                    kind === 'composio'
                      ? provider
                      : kind === 'model'
                        ? provider
                        : kind === 'search'
                          ? provider
                          : kind
                  }
                  name={selected?.name}
                  size={36}
                />
              </span>
              <div>
                <h3>
                  {kind === 'composio'
                    ? selected?.name
                    : kind === 'model'
                      ? `Connect ${providerName(provider)}`
                      : kinds.find((item) => item.id === kind)?.label}
                </h3>
                <p>{selected?.description || descriptions[kind]}</p>
              </div>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                try {
                  await api('/v1/connections', 'POST', {
                    name,
                    kind,
                    auth_method:
                      kind === 'model'
                        ? 'api_key'
                        : kind === 'composio'
                          ? 'oauth'
                          : kind === 'mcp_stdio'
                            ? 'none'
                            : auth,
                    ...(kind === 'mcp_remote'
                      ? { url }
                      : kind === 'mcp_stdio'
                        ? {
                            package: selectedPackage?.package,
                            package_version: selectedPackage?.version,
                            secret_env: environment,
                          }
                        : { provider }),
                    ...(secret ? { secret } : {}),
                  });
                  onClose();
                  setSecret('');
                  await client.invalidateQueries();
                  toast.success('Connection added');
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label="Connection name">
                <input
                  autoFocus
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. My research tools"
                />
              </Field>
              {kind === 'mcp_stdio' ? (
                <>
                  <Field label="Approved package">
                    <Select
                      required
                      value={selectedPackage ? `${selectedPackage.package}@${selectedPackage.version}` : ''}
                      onValueChange={(next) => {
                        setPackageKey(next);
                        setEnvironment({});
                      }}
                      options={[
                        ...(packages.data?.data.map((p) => ({
                          value: String(`${p.package}@${p.version}`),
                          label: (
                            <>
                              {p.label} · {p.version}
                            </>
                          ),
                        })) ?? []),
                      ]}
                    />
                  </Field>
                  {packages.error && <ErrorState error={packages.error} />}
                  {selectedPackage?.environment_keys.map((key) => (
                    <Field key={key} label={key}>
                      <input
                        type="password"
                        autoComplete="off"
                        value={environment[key] || ''}
                        onChange={(e) => setEnvironment({ ...environment, [key]: e.target.value })}
                      />
                    </Field>
                  ))}
                  <div className="info-note">
                    <ShieldCheck size={18} />
                    <p>
                      The pinned server runs inside your agent’s sandbox and can access its files. Any
                      environment credentials you enter are visible to that process. Only the tools you grant
                      will be exposed through the broker.
                    </p>
                  </div>
                </>
              ) : kind === 'search' ? (
                <>
                  <Field label="Search provider">
                    <Select
                      value={provider}
                      onValueChange={(next) => {
                        setProvider(next);
                        setAuth('api_key');
                        setSecret('');
                        setError('');
                      }}
                      options={Object.entries(searchProviders).map(([value, info]) => ({
                        value,
                        label: info.name,
                      }))}
                    />
                  </Field>
                  <Field label="Search funding">
                    <Select
                      value={auth}
                      onValueChange={(next) => {
                        setAuth(next);
                        setSecret('');
                      }}
                      options={[
                        ...(isSearchProvider(provider) && searchProviders[provider].managed
                          ? [{ value: 'none', label: 'Managed \u00B7 charged to your run budget' }]
                          : []),
                        { value: 'api_key', label: `Bring your ${providerName(provider)} API key` },
                      ]}
                    />
                  </Field>
                  {auth === 'api_key' && (
                    <p className="field-hint">
                      Search usage is billed by your provider. These charges are separate from your run
                      budget.
                    </p>
                  )}
                </>
              ) : kind === 'model' ? (
                <Field label="Provider">
                  <Select
                    value={provider}
                    onValueChange={setProvider}
                    options={['openai', 'anthropic', 'openrouter'].map((provider) => ({
                      value: provider,
                      label: <ProviderLabel provider={provider} />,
                    }))}
                  />
                </Field>
              ) : kind === 'mcp_remote' ? (
                <>
                  <Field
                    label="MCP endpoint URL"
                    hint="Use the server’s public HTTPS Streamable HTTP endpoint."
                  >
                    <input
                      type="url"
                      required
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://mcp.example.com/mcp"
                    />
                  </Field>
                  <Field label="Authentication">
                    <Select
                      value={auth}
                      onValueChange={setAuth}
                      options={[
                        { value: 'oauth', label: 'OAuth \u00B7 Connect your account' },
                        { value: 'bearer', label: 'Bearer token' },
                        { value: 'none', label: 'No authentication' },
                      ]}
                    />
                  </Field>
                </>
              ) : null}
              {(kind === 'model' ||
                (kind === 'mcp_remote' && auth === 'bearer') ||
                (kind === 'search' && auth === 'api_key')) && (
                <Field
                  label={
                    kind === 'model'
                      ? 'Provider API key'
                      : kind === 'search'
                        ? `${providerName(provider)} API key`
                        : 'Bearer token'
                  }
                  hint="Encrypted on the server. Never returned after creation."
                >
                  <input
                    type="password"
                    autoComplete="off"
                    required
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="Paste your secret"
                  />
                </Field>
              )}
              {kind === 'composio' && (
                <div className="info-note">
                  <ShieldCheck size={18} />
                  <p>
                    {selected?.connectable
                      ? 'After adding this connection, choose Connect to authorize your account. You’ll select the tools your agents can use next.'
                      : 'An administrator needs to enable this app before you can authorize an account. You can add the connection now and connect it later.'}
                  </p>
                </div>
              )}
              {error && <div className="form-error">{error}</div>}
              <div className="dialog-actions">
                <Button type="submit" busy={busy}>
                  Add connection
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Modal>
  );
}
