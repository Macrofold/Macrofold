'use client';
import { defaultRunBudgetMicroUsd } from '../../../packages/contracts/run-defaults';
import { ConnectionSelection } from './run-tools';
import { harnesses } from '../../../packages/contracts/harnesses';
import { CopyButton } from './copy-button';
import { ProviderLabel, ProviderLogo } from './provider-logo';
import { connectionLogoProvider, modelLogoProvider } from '../lib/provider-branding';
import { SchedulingReport } from './scheduling-report';
import { ExecutionPolicy, PlanOptions } from './execution-policy';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowUpRight,
  Bot,
  ChartNoAxesCombined,
  Check,
  CreditCard,
  KeyRound,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { KeyPermissions } from './key-permissions';
import { resolveKeyPermissions, type KeyPermissionSelection } from '../lib/key-permissions';
import { request } from '../lib/dashboard-data';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { api, money, relative, useApi, usePages, type Schema } from '../lib/client';
import { Stat } from './dashboard-shared';
import { GrowthDetails } from './growth';
import { RequestsTable } from './requests-table';
import { Select } from './select';
import { StoragePanel } from './storage';
import { templatePreset } from './templates/catalog';
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
} from './ui';

export function KeysView() {
  const keys = usePages<Schema['ApiKey']>('/v1/api-keys'),
    identity = useApi<Schema['Identity']>('/v1/me'),
    projects = usePages<Schema['Project']>('/v1/projects');
  const [open, setOpen] = useState(false),
    [name, setName] = useState(''),
    [permissions, setPermissions] = useState<KeyPermissionSelection>({ preset: 'read-write' }),
    [project, setProject] = useState(''),
    [days, setDays] = useState('90'),
    [secret, setSecret] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [revoke, setRevoke] = useState<Schema['ApiKey']>();
  const client = useQueryClient();
  const scopes = resolveKeyPermissions(permissions, identity.data?.effective_scopes ?? []);
  function openCreate() {
    setName('');
    setPermissions({ preset: 'read-write' });
    setProject('');
    setDays('90');
    setSecret('');
    setError('');
    setOpen(true);
  }
  return (
    <div className="page">
      <PageHeading
        eyebrow="SECURE BY DEFAULT"
        title="API keys"
        description="Connect your applications, scripts, and CI to your hosted agents."
        action={
          <Button onClick={openCreate}>
            <Plus size={17} />
            Create API key
          </Button>
        }
      />
      <div className="info-note key-note">
        <ShieldCheck size={20} />
        <div>
          <strong>Give each integration its own key.</strong>
          <p>
            Choose the access it needs. Secrets are shown once, stored as hashes, and can be revoked at any
            time.
          </p>
        </div>
      </div>
      {keys.isPending ? (
        <Loading />
      ) : keys.error ? (
        <ErrorState error={keys.error} />
      ) : !keys.data?.data.length ? (
        <Empty
          icon={<KeyRound />}
          title="Your first integration starts here"
          description="Generate a scoped key to use the API, CLI, or SDK."
          action={<Button onClick={openCreate}>Create API key</Button>}
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Scopes</th>
                <th>Last used</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.data.data.map((key) => (
                <tr key={key.id}>
                  <td>
                    <strong>{key.name}</strong>
                  </td>
                  <td>
                    <code>{key.prefix}••••••••</code>
                  </td>
                  <td>
                    <span className="scope-count" title={key.scopes.join(', ')}>
                      {key.scopes.length} scopes
                    </span>
                  </td>
                  <td>{key.last_used_at ? relative(key.last_used_at) : 'Never'}</td>
                  <td>
                    <Badge
                      status={
                        key.revoked_at
                          ? 'revoked'
                          : key.expires_at && Date.parse(key.expires_at) < Date.now()
                            ? 'expired'
                            : 'active'
                      }
                    />
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      disabled={Boolean(key.revoked_at)}
                      aria-label={`Revoke ${key.name}`}
                      onClick={() => setRevoke(key)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <More query={keys} label="More keys" />
      <Modal
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setSecret('');
        }}
        title={secret ? 'Your new API key' : 'Create an API key'}
        description={
          secret
            ? 'Copy this secret now. It will not be shown again.'
            : 'Choose a purpose, permissions, and expiration for this key.'
        }
      >
        {secret ? (
          <>
            <div className="secret-display">
              <code>{secret}</code>
              <CopyButton text={secret} />
            </div>
            <div className="info-note">
              <ShieldCheck size={18} />
              <p>
                Store this key in a secret manager or environment variable. Never commit it to a repository or
                include it in client-side code.
              </p>
            </div>
            <div className="dialog-actions">
              <Button
                onClick={() => {
                  setOpen(false);
                  setSecret('');
                }}
              >
                I’ve saved the key
              </Button>
            </div>
          </>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy || identity.isPending || identity.error || !scopes.length) return;
              setBusy(true);
              setError('');
              try {
                const key = await request('createApiKey', {
                  body: {
                    name,
                    scopes,
                    ...(project ? { project_id: project } : {}),
                    ...(days
                      ? { expires_at: new Date(Date.now() + Number(days) * 86400000).toISOString() }
                      : {}),
                  },
                });
                setSecret(key.secret);
                await client.invalidateQueries();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Name">
              <input
                autoFocus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Production backend"
              />
            </Field>
            <div className="form-grid">
              <Field label="Project access">
                <Select
                  value={project}
                  onValueChange={setProject}
                  options={[
                    { value: '', label: 'All authorized projects' },
                    ...(projects.data?.data.map((p) => ({ value: p.id, label: p.name })) ?? []),
                  ]}
                />
              </Field>
              <More query={projects} label="More projects" />
              <Field label="Expires after">
                <Select
                  value={days}
                  onValueChange={setDays}
                  options={[
                    { value: '30', label: '30 days' },
                    { value: '90', label: '90 days' },
                    { value: '365', label: '1 year' },
                    { value: '', label: 'No expiration' },
                  ]}
                />
              </Field>
            </div>
            {identity.isPending ? (
              <Loading label="Loading permissions" />
            ) : identity.error ? (
              <ErrorState error={identity.error} retry={() => identity.refetch()} />
            ) : (
              <KeyPermissions
                value={permissions}
                onChange={setPermissions}
                effectiveScopes={identity.data.effective_scopes}
              />
            )}
            {error && <div className="form-error">{error}</div>}
            <div className="dialog-actions">
              <Button busy={busy} type="submit" disabled={!scopes.length || Boolean(identity.error)}>
                Create key
              </Button>
            </div>
          </form>
        )}
      </Modal>
      <Modal
        open={Boolean(revoke)}
        onOpenChange={() => setRevoke(undefined)}
        title="Revoke this API key?"
        description={`Requests using ${revoke?.name || 'this key'} will be denied immediately. This cannot be undone.`}
      >
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setRevoke(undefined)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await api(`/v1/api-keys/${revoke!.id}`, 'DELETE');
                setRevoke(undefined);
                await client.invalidateQueries();
                toast.success('API key revoked');
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Revoke key
          </Button>
        </div>
      </Modal>
    </div>
  );
}
export { ConnectionsView } from './connections';
export function BillingView() {
  const query = useApi<Schema['Billing']>('/v1/billing'),
    [amount, setAmount] = useState('25'),
    [busy, setBusy] = useState(false);
  async function checkout(body: unknown) {
    setBusy(true);
    try {
      const result = await api<Schema['Redirect']>('/v1/billing/checkout', 'POST', body);
      location.assign(result.url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page narrow-page">
      <PageHeading
        eyebrow="CLEAR, CONTROLLED SPENDING"
        title="Billing"
        description="Fund your agents, set limits, and keep every charge visible."
      />
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} />
      ) : (
        <>
          <div className="balance-card">
            <div>
              <span>Available credits</span>
              <strong>{money(query.data!.available_micro_usd)}</strong>
              <p>{money(query.data!.reserved_micro_usd)} reserved for active and queued runs</p>
            </div>
            <div className="balance-icon">
              <CreditCard size={32} />
            </div>
          </div>
          {(query.data!.billing_hold || Number(query.data!.outstanding_micro_usd || 0) > 0) && (
            <div className="info-note key-note" role="status">
              <CreditCard size={20} />
              <div>
                <strong>
                  {query.data!.billing_status === 'reconciliation_review'
                    ? 'Your account is paused for a billing review.'
                    : 'A payment issue needs attention.'}
                </strong>
                <p>
                  {query.data!.billing_status === 'reconciliation_review'
                    ? 'Contact support to resume new runs. Your existing files and results remain available.'
                    : Number(query.data!.outstanding_micro_usd || 0) > 0
                      ? `${money(query.data!.outstanding_micro_usd)} outstanding after a payment reversal. Add credit to cover this amount before starting more work.`
                      : 'Open the billing portal to resolve your payment status. Existing files and results remain accessible.'}
                </p>
              </div>
            </div>
          )}
          <div className="billing-grid">
            <section className="panel">
              <SectionHeading
                title="Add execution credits"
                description="Pay for what your agents use. Minimum top-up is $10."
              />
              <div className="credit-options">
                {['10', '25', '50', '100'].map((v) => (
                  <button className={amount === v ? 'selected' : ''} key={v} onClick={() => setAmount(v)}>
                    ${v}
                  </button>
                ))}
              </div>
              <Button
                busy={busy}
                onClick={() =>
                  checkout({ kind: 'topup', amount_micro_usd: String(Number(amount) * 1000000) })
                }
              >
                Add ${amount} in credits <ArrowUpRight size={15} />
              </Button>
              <p className="fine-print">
                Checkout is handled securely by Stripe. No payment is taken until you complete checkout.
              </p>
            </section>
            <section className="panel plan-card">
              <div className="plan-heading">
                <h2>{query.data!.execution_policy?.plan_name || query.data!.plan}</h2>
                <Badge status="active" />
              </div>
              <div className="plan-price">
                {money(query.data!.subscription_price_micro_usd)}
                <span>/ month</span>
              </div>
              <ul>
                <li>
                  <Check size={15} />
                  {query.data!.concurrency_limit} concurrent runs
                </li>
                <li>
                  <Check size={15} />
                  {Math.round(Number(query.data!.storage_allowance_bytes) / 1024 ** 3)} GiB storage allowance
                </li>
                <li>
                  <Check size={15} />
                  Bring your own model keys
                </li>
                <li>
                  <Check size={15} />
                  Dashboard, API, and CLI
                </li>
              </ul>
            </section>
          </div>
          <PlanOptions
            billing={query.data!}
            busy={busy}
            onChoose={(plan) => checkout({ kind: 'subscription', plan })}
          />
          {query.data!.execution_policy && (
            <ExecutionPolicy
              key={JSON.stringify(query.data!.execution_policy)}
              policy={query.data!.execution_policy}
            />
          )}
          <div className="panel billing-portal">
            <div>
              <h2>Invoices & payment details</h2>
              <p>Update your payment method, download invoices, or manage your subscription.</p>
            </div>
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  const result = await api<Schema['Redirect']>('/v1/billing/portal', 'POST', {});
                  location.assign(result.url);
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              Billing portal <ArrowUpRight size={15} />
            </Button>
          </div>
          {!!query.data!.credit_lots?.length && (
            <section className="panel">
              <SectionHeading
                title="Your credit balance"
                description="Monthly credits are used first. Purchased credits do not expire. Active reservations protect credits until the run settles."
              />
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Remaining</th>
                      <th>Expires</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data!.credit_lots!.map((lot) => (
                      <tr key={lot.id}>
                        <td>{lot.kind.replaceAll('_', ' ')}</td>
                        <td>{money(lot.remaining_micro_usd)}</td>
                        <td>{lot.expires_at ? new Date(lot.expires_at).toLocaleDateString() : 'Never'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <StoragePanel />
          <p className="fine-print">
            Rate card: {query.data!.rate_card_version}. BYOK charges go to your model provider; platform
            execution and storage charges still apply.
          </p>
        </>
      )}
    </div>
  );
}
export function AgentsView() {
  const params = useSearchParams();
  const router = useRouter();
  const templateSlug = params.get('template');
  return (
    <AgentPresets
      key={templateSlug || 'blank'}
      templateSlug={templateSlug}
      schedule={params.get('schedule') === 'true'}
      schedulePreset={(id) => router.push(`/scheduled-tasks?agent=${id}&template=${templateSlug || ''}`)}
      clearTemplate={() => router.replace('/agents', { scroll: false })}
    />
  );
}
function AgentPresets({
  templateSlug,
  schedule,
  schedulePreset,
  clearTemplate,
}: {
  templateSlug: string | null;
  schedule: boolean;
  schedulePreset: (id: string) => void;
  clearTemplate: () => void;
}) {
  const starter = templatePreset(templateSlug);
  const query = usePages<Schema['Agent']>('/v1/agents'),
    models = usePages<Schema['Model']>('/v1/models'),
    connections = usePages<Schema['Connection']>('/v1/connections'),
    identity = useApi<Schema['Identity']>('/v1/me');
  const [toolDefaults, setToolDefaults] = useState<Schema['Grant'][] | undefined>();
  const [open, setOpen] = useState(Boolean(starter)),
    [name, setName] = useState(starter?.name || ''),
    [harness, setHarness] = useState('codex'),
    [instructions, setInstructions] = useState(starter?.instructions || ''),
    [requestedModel, setModel] = useState(''),
    [billing, setBilling] = useState<Schema['AgentCreate']['billing_mode']>('managed'),
    [connection, setConnection] = useState(''),
    [budget, setBudget] = useState(String(Number(defaultRunBudgetMicroUsd) / 1000000)),
    [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const available = models.data?.data.filter((model) => model.enabled && model.harnesses.includes(harness)) || [];
  const model = available.find((item) => item.id === requestedModel) || available[0];
  return (
    <div className="page">
      <PageHeading
        eyebrow="REPEAT YOUR BEST WORK"
        title="Agent presets"
        description="Save harness, model, and instructions for tasks you run often."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={17} />
            New preset
          </Button>
        }
      />
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : !query.data?.data.length ? (
        <Empty
          icon={<Bot />}
          title="Make your best workflow repeatable"
          description="Start with an example, or save your own instructions and model as a reusable preset."
          action={
            <Link className="button secondary" href="/templates">
              Explore examples <ArrowUpRight size={15} />
            </Link>
          }
        />
      ) : (
        <div className="connections-grid">
          {query.data?.data.map((a) => (
            <div className="connection-card agent-card" key={a.id}>
              <div className="connection-card-top">
                <span className="connection-icon">
                  <ProviderLogo provider={a.harness} size={26} />
                </span>
                <span className="model-label">{a.harness}</span>
              </div>
              <h3>{a.name}</h3>
              <p>{a.instructions || 'Ready for your next task.'}</p>
              {a.provider_connection_id && (
                <p>
                  {connections.data?.data.find((item) => item.id === a.provider_connection_id)?.name ||
                    a.provider_connection_id}
                </p>
              )}
              <Link className="text-link" href={`/scheduled-tasks?agent=${a.id}`}>Schedule this preset →</Link>
              <div className="agent-model">
                <span className="tiny-dot" />
                {a.model === 'fixture-model' ? 'Local simulation' : a.model}
              </div>
              <div className="copy-field">
                <code>{a.id.slice(0, 18)}…</code>
                <CopyButton
                  variant="plain"
                  className="icon-button"
                  text={a.id}
                  label="Copy agent ID"
                  iconOnly
                />
              </div>
            </div>
          ))}
        </div>
      )}
      <More query={query} label="More presets" />
      <Modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setToolDefaults(undefined);
          if (!next && starter) clearTemplate();
        }}
        title="Create an agent preset"
        description={
          starter
            ? `Starting from ${starter.name}. Review the setup and make it yours.`
            : 'Reuse a consistent setup across projects and API calls.'
        }
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              if (!model) throw new Error('No compatible model is configured.');
              const preset = await request('createAgent', { body: {
                name,
                harness: harness as Schema['AgentCreate']['harness'],
                limits: { max_cost_micro_usd: String(Math.round(Number(budget) * 1000000)) },
                model: model.id,
                billing_mode: billing,
                ...(billing !== 'managed' ? { provider_connection_id: connection } : {}),
                instructions,
                ...(toolDefaults !== undefined ? { connection_grants: toolDefaults } : {}),
              } });
              setOpen(false);
              setToolDefaults(undefined);
              if (schedule) schedulePreset(preset.id);
              else if (starter) clearTemplate();
              await client.invalidateQueries();
              toast.success('Preset created');
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Name">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Research partner"
            />
          </Field>
          <Field label="Harness">
            <Select
              value={harness}
              onValueChange={(value) => {
                setHarness(value);
                setBilling('managed');
                setConnection('');
              }}
              options={harnesses.map(({ id, name }) => ({
                value: id,
                label: <ProviderLabel provider={id} name={name} />,
              }))}
            />
          </Field>
          <Field label="Model">
            <Select
              value={model?.id || ''}
              required
              onValueChange={(value) => {
                setModel(value);
                setBilling('managed');
                setConnection('');
              }}
              options={available.map((item) => ({
                value: item.id,
                label: <ProviderLabel provider={modelLogoProvider(item)} name={item.id} />,
              }))}
            />
          </Field>
          <More query={models} label="More models" />
          <Field label="Model funding">
            <Select
              value={billing}
              onValueChange={(value) => {
                setBilling(value as Schema['AgentCreate']['billing_mode']);
                setConnection('');
              }}
              options={[
                { value: 'managed', label: 'Managed API usage' },
                { value: 'byok', label: 'Your API-key connection' },
                ...(harness === 'claude-code' && model?.provider === 'anthropic'
                  ? [
                      {
                        value: 'subscription',
                        label: (
                          <ProviderLabel
                            provider="claude_subscription"
                            name="Claude subscription · not yet available"
                          />
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </Field>
          {billing !== 'managed' && (
            <>
              <Field label="Authentication connection">
                <Select
                  value={connection}
                  required
                  onValueChange={setConnection}
                  options={[
                    { value: '', label: 'Choose a named account', disabled: true },
                    ...(connections.data?.data
                      .filter(
                        (item) =>
                          item.owner_subject_id === identity.data?.user_id &&
                          (billing === 'subscription'
                            ? item.kind === 'claude_subscription'
                            : item.kind === 'model' &&
                              (model?.provider === 'fixture' || item.provider === model?.provider) &&
                              item.status === 'healthy'),
                      )
                      .map((item) => ({
                        value: item.id,
                        label: <ProviderLabel provider={connectionLogoProvider(item)} name={item.name} />,
                      })) || []),
                  ]}
                />
              </Field>
              <More query={connections} label="More connections" />
            </>
          )}
          {billing === 'subscription' && (
            <p className="form-hint">
              This preset can be saved, but cannot run until subscription authentication is available. It will
              not silently use an API key.
            </p>
          )}
          <Field label="Budget per run (USD)" hint="Maximum total platform charge per run, including tools and compute. This is a limit, not a cost estimate.">
            <input type="number" required min="0.01" max="999999" step="0.01" value={budget} onChange={(event) => setBudget(event.target.value)} />
          </Field>
          <ConnectionSelection value={toolDefaults} onChange={setToolDefaults} label="Default tools" />
          <Field label="Instructions">
            <textarea
              rows={5}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="How should this agent approach its work?"
            />
          </Field>
          <div className="dialog-actions">
            <Button type="submit" busy={busy}>
              {schedule ? 'Save and choose schedule' : 'Create preset'}
            </Button>
          </div>
          {starter && (
            <p className="form-hint">
              Saving a preset does not run the agent or create tool grants. Choose the project, connections,
              and run budget when you start a task.
            </p>
          )}
        </form>
      </Modal>
    </div>
  );
}
export function OperatorView() {
  const [accountSearch, setAccountSearch] = useState(''),
    [selectedAccount, setSelectedAccount] = useState<string>();
  const summary = useApi<Schema['AccountSummary']>(
    selectedAccount ? `/admin/v1/accounts/${selectedAccount}` : undefined,
  );
  const platformUsage = useApi<Schema['Report']>('/admin/v1/metrics/usage', 15000);
  const growth = useApi<Schema['Report']>('/admin/v1/metrics/growth', 10000),
    health = useApi<Schema['Report']>('/admin/v1/infrastructure/health', 10000),
    accounts = usePages<Schema['Account']>(`/admin/v1/accounts?query=${encodeURIComponent(accountSearch)}`),
    requests = usePages<Schema['RequestRecord']>('/admin/v1/requests?limit=25', 10000);
  if (growth.error)
    return (
      <div className="page">
        <ErrorState error={growth.error} />
      </div>
    );
  const metrics = growth.data?.metrics || [];
  const value = (name: string) => String(metrics.find((m) => m.name === name)?.value ?? '—');
  return (
    <div className="page">
      <PageHeading
        eyebrow="OPERATOR WORKSPACE"
        title="The bigger picture."
        description="Read-only operations, growth, and account reporting. Every query is audited."
      />
      <div className="stats-grid">
        <Stat
          label="Registered users"
          value={value('users_total')}
          detail="All registered accounts"
          icon={<Bot />}
        />
        <Stat
          label="Daily active humans"
          value={value('human_dau')}
          detail="Qualifying human activity"
          icon={<Activity />}
        />
        <Stat
          label="Weekly active humans"
          value={value('human_wau')}
          detail="Rolling 7-day window"
          icon={<ChartNoAxesCombined />}
        />
        <Stat
          label="Active service keys"
          value={value('active_service_principals')}
          detail="Separate from human activity"
          icon={<KeyRound />}
        />
      </div>
      <SectionHeading
        title="Platform usage"
        description="Recorded activity in the last 30 days. Missing provider usage is kept explicit."
      />
      {platformUsage.error ? (
        <ErrorState error={platformUsage.error} />
      ) : (
        <div className="health-grid">
          {platformUsage.data?.metrics
            .filter((m) =>
              ['requests', 'runs', 'input_tokens', 'output_tokens', 'cost_micro_usd'].includes(m.name),
            )
            .map((m) => (
              <div className="health-item" key={m.name}>
                <span>{m.name.replaceAll('_', ' ')}</span>
                <strong>
                  {m.name === 'cost_micro_usd' ? money(String(m.value || 0)) : String(m.value ?? 'Unknown')}
                </strong>
                {m.status !== 'known' && <small>Incomplete</small>}
              </div>
            ))}
        </div>
      )}
      <GrowthDetails report={growth.data} />
      <SchedulingReport />
      <SectionHeading title="Infrastructure" description="Observed health and configuration readiness." />
      <div className="health-grid">
        {health.data?.metrics.map((m) => (
          <div className="health-item" key={m.name}>
            <span className={m.status === 'known' ? 'tiny-dot' : 'tiny-dot neutral'} />
            <span>{m.name.replaceAll('_', ' ')}</span>
            <strong>{String(m.value ?? 'Unknown')}</strong>
          </div>
        ))}
      </div>
      <SectionHeading
        title="Accounts"
        description="Account metadata only. User files and prompts are excluded."
      />
      <div className="view-toolbar">
        <div className="search-input input-surface">
          <Search size={16} />
          <input
            aria-label="Search accounts"
            placeholder="Search organizations…"
            value={accountSearch}
            onChange={(e) => setAccountSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Plan</th>
              <th>Members</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {accounts.data?.data.map((a) => (
              <tr key={a.id}>
                <td>
                  <button className="text-button" onClick={() => setSelectedAccount(a.id)}>
                    {a.name}
                  </button>
                </td>
                <td>{a.plan}</td>
                <td>{a.member_count}</td>
                <td>{relative(a.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <More query={accounts} label="More accounts" />
      <SectionHeading title="Platform request activity" />
      {requests.data && <RequestsTable records={requests.data.data} />}
      <More query={requests} label="Older requests" />
      <Modal
        open={!!selectedAccount}
        onOpenChange={() => setSelectedAccount(undefined)}
        title={summary.data?.account.name || 'Account details'}
        description="Read-only billing and usage projection. Contact details require a separate PII scope."
      >
        {summary.isPending ? (
          <Loading />
        ) : summary.error ? (
          <ErrorState error={summary.error} />
        ) : (
          summary.data && (
            <div className="account-summary">
              <p>
                Plan: <strong>{summary.data.billing.plan}</strong>
              </p>
              <p>
                Available credits: <strong>{money(summary.data.billing.available_micro_usd)}</strong>
              </p>
              <p>
                Reserved credits: <strong>{money(summary.data.billing.reserved_micro_usd)}</strong>
              </p>
              <p>
                Billing: <strong>{summary.data.billing.billing_status}</strong>
              </p>
              <div className="health-grid">
                {summary.data.usage.metrics
                  .filter((m) => ['requests', 'runs', 'input_tokens', 'output_tokens'].includes(m.name))
                  .map((m) => (
                    <div className="health-item" key={m.name}>
                      <span>{m.name.replaceAll('_', ' ')}</span>
                      <strong>{String(m.value ?? 'Unknown')}</strong>
                    </div>
                  ))}
              </div>
            </div>
          )
        )}
      </Modal>
    </div>
  );
}
