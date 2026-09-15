'use client';
import { request, useData, useDataPages } from '../lib/dashboard-data';
import { PermissionEditor } from './permission-editor';
import { harnesses } from '../../../packages/contracts/harnesses';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, ChevronDown, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { type Schema } from '../lib/client';
import { RunAccess, type RunAccessChoice } from './run-tools';
import { AccessResourceSelect } from './access-resource-select';
import { Select } from './select';
import { ProviderLabel } from './provider-logo';
import { connectionLogoProvider, modelLogoProvider } from '../lib/provider-branding';
import { Button, Field, Modal } from './ui';
export function RunComposer({
  open,
  onOpenChange,
  workspaceId,
  sessionId,
  initialPrompt = '',
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId?: string;
  sessionId?: string;
  initialPrompt?: string;
}) {
  const router = useRouter(),
    client = useQueryClient();
  const [prompt, setPrompt] = useState(initialPrompt),
    [requestedProject, setProject] = useState(''),
    [harness, setHarness] = useState<Schema['SessionCreate']['harness']>('codex'),
    [permissions, setPermissions] = useState<Schema['AgentPermissions']>(),
    [requestedModel, setModel] = useState(''),
    [mode, setMode] = useState<'managed' | 'byok'>('managed'),
    [connection, setConnection] = useState(''),
    [preset, setPreset] = useState(''),
    [accessChoice, setAccessChoice] = useState<{ context: string; value: RunAccessChoice }>(),
    [pendingAccessContext, setPendingAccessContext] = useState<string>(),
    [advanced, setAdvanced] = useState(false),
    [budget, setBudget] = useState('2.00'),
    [timeout, setTimeoutValue] = useState('15'),
    [queueHours, setQueueHours] = useState('24'),
    [schedulingClass, setSchedulingClass] = useState<'interactive' | 'background'>('interactive'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const policy = useData(open ? { operation: 'getExecutionPolicy' } : undefined);
  const maxMinutes = (policy.data?.max_timeout_seconds || 1800) / 60;
  const effectiveTimeout = Math.min(Number(timeout), maxMinutes);
  const projects = useDataPages(open ? { operation: 'listProjects' } : undefined);
  const models = useDataPages(open ? { operation: 'listModels' } : undefined);
  const connections = useDataPages(open ? { operation: 'listConnections' } : undefined);
  const presetQuery = useData(
    open && preset ? { operation: 'getAgent', params: { path: { agent_id: preset } } } : undefined,
  );
  const selectedPreset = presetQuery.data;
  const activeProjects = projects.data?.data.filter((item) => !item.archived) || [];
  const project = requestedProject || activeProjects[0]?.id || '';
  const available = models.data?.data.filter((item) => item.enabled && item.harnesses.includes(harness)) || [];
  const model = available.some((item) => item.id === requestedModel)
    ? requestedModel
    : available[0]?.id || '';
  const accessContext: Schema['ConnectionAccessResolve'] = {
    ...(sessionId
      ? { session_id: sessionId }
      : workspaceId
        ? { workspace_id: workspaceId }
        : { project_id: project }),
    ...(!sessionId && preset ? { agent_id: preset } : {}),
    ...(permissions ? { permissions } : {}),
  };
  const contextKey = JSON.stringify(accessContext);
  // Leaving a context discards its one-run choices, even if the user returns to it.
  if (accessChoice && accessChoice.context !== contextKey) setAccessChoice(undefined);
  const accessPending = pendingAccessContext === contextKey;
  const choice = accessChoice?.context === contextKey ? accessChoice.value : { overrides: [] };
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) setAccessChoice(undefined);
        onOpenChange(next);
      }}
      title={sessionId ? 'Continue the conversation' : 'Start a new run'}
      description="Give your agent a clear task. Follow its progress live or come back when it’s done."
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (accessPending) return;
          setBusy(true);
          setError('');
          try {
            const limits = {
              timeout_seconds: Math.round(effectiveTimeout * 60),
              max_cost_micro_usd: String(Math.round(Number(budget) * 1000000)),
            };
            const body: Schema['RunCreate'] = {
              prompt,
              limits,
              scheduling_class: schedulingClass,
              queue_timeout_seconds: Math.round(Number(queueHours) * 3600),
              ...(sessionId
                ? { queue_if_busy: true }
                : {
                    ...(workspaceId ? { workspace_id: workspaceId } : { project_id: project }),
                    ...(preset
                      ? { agent_id: preset }
                      : {
                          harness,
                          model,
                          billing_mode: mode,
                          ...(mode === 'byok' ? { provider_connection_id: connection } : {}),
                        }),
                  }),
            };
            if (permissions) body.permissions = permissions;
            if (choice.selection !== undefined) body.connection_grants = choice.selection;
            if (choice.overrides.length) body.connection_access_overrides = choice.overrides;
            const result = sessionId
              ? await request('continueSession', {
                  params: { path: { session_id: sessionId } },
                  body: { ...body, queue_if_busy: true },
                })
              : await request('createRun', { body });
            await client.invalidateQueries();
            onOpenChange(false);
            setPrompt('');
            setAccessChoice(undefined);
            router.push(`/runs/${result.run_id}`);
            toast.success('Run saved. Follow its queue status here.');
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {!workspaceId && !sessionId && (
          <AccessResourceSelect
            kind="project"
            label="Project"
            value={project}
            onChange={setProject}
            optional={false}
            activeOnly
          />
        )}
        {!sessionId && (
          <>
            <AccessResourceSelect
              kind="agent"
              label="Agent preset"
              value={preset}
              onChange={setPreset}
              emptyLabel="Custom configuration"
            />
            {selectedPreset && (
              <p className="form-hint">
                {selectedPreset.harness} · {selectedPreset.model} · {selectedPreset.billing_mode} billing.
                Uses the preset's instructions and tool selection.
              </p>
            )}
          </>
        )}
        <Field label="What would you like to get done?">
          <textarea
            className="prompt-input"
            required
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Explore this project, make a change, or investigate a question…"
            autoFocus
            rows={6}
          />
        </Field>
        {!sessionId && !preset && (
          <div className="form-grid">
            <Field label="Harness">
              <Select
                value={harness}
                onValueChange={(next) => {
                  setHarness(next as Schema['SessionCreate']['harness']);
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
                value={model}
                onValueChange={(next) => {
                  setModel(next);
                  setConnection('');
                }}
                required
                options={[
                  ...(!available.length ? [{ value: '', label: 'No models configured' }] : []),
                  ...(available.map((m) => ({
                    value: m.id,
                    label: (
                      <ProviderLabel
                        provider={modelLogoProvider(m)}
                        name={m.id === 'fixture-model' ? 'Simulation · free' : m.id}
                      />
                    ),
                  })) ?? []),
                ]}
              />
            </Field>
          </div>
        )}
        <button
          type="button"
          className="advanced-toggle"
          aria-expanded={advanced}
          aria-controls="run-settings"
          onClick={() => setAdvanced((v) => !v)}
        >
          Run settings <ChevronDown size={14} />
        </button>
        {advanced && (
          <div className="advanced-fields" id="run-settings">
            <div className="form-grid">
              <Field label="Maximum budget (USD)">
                <input
                  type="number"
                  min="0.01"
                  max="1000"
                  step="0.01"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </Field>
              <Field
                label="Execution timeout (minutes)"
                hint={`Account maximum: ${maxMinutes} minutes. Starts when execution is claimed.`}
              >
                <input
                  type="number"
                  min={1 / 60}
                  max={maxMinutes}
                  step="any"
                  value={effectiveTimeout}
                  onChange={(e) => setTimeoutValue(e.target.value)}
                />
              </Field>
            </div>
            <div className="form-grid">
              <Field
                label="Maximum queue wait (hours)"
                hint="Up to 24 hours. Expiry releases held funds and preserves history."
              >
                <input
                  type="number"
                  min={1 / 3600}
                  max="24"
                  step="any"
                  required
                  value={queueHours}
                  onChange={(e) => setQueueHours(e.target.value)}
                />
              </Field>
              <Field label="Scheduling" hint="Interactive work gets first consideration when a slot opens.">
                <Select
                  value={schedulingClass}
                  onValueChange={(v) => setSchedulingClass(v as 'interactive' | 'background')}
                  options={[
                    { value: 'interactive', label: 'Interactive · I’m following along' },
                    { value: 'background', label: 'Background · work asynchronously' },
                  ]}
                />
              </Field>
            </div>
            {!sessionId && <PermissionEditor value={permissions} onChange={setPermissions} />}
            {!sessionId && !preset && (
              <>
                <Field label="Model billing">
                  <Select
                    value={mode}
                    onValueChange={(next) => setMode(next as 'managed' | 'byok')}
                    options={[
                      { value: 'managed', label: 'Use organization credits' },
                      { value: 'byok', label: 'Use my provider API key' },
                    ]}
                  />
                </Field>
                {mode === 'byok' && (
                  <Field label="Provider connection">
                    <Select
                      value={connection}
                      required
                      onValueChange={setConnection}
                      options={[
                        { value: '', label: 'Choose a connection' },
                        ...(connections.data?.data
                          .filter(
                            (c) =>
                              c.kind === 'model' &&
                              c.status === 'healthy' &&
                              c.provider === available.find((m) => m.id === model)?.provider,
                          )
                          .map((c) => ({
                            value: c.id,
                            label: (
                              <ProviderLabel
                                provider={connectionLogoProvider(c)}
                                name={`${c.name} · ${c.provider}`}
                              />
                            ),
                          })) ?? []),
                      ]}
                    />
                  </Field>
                )}
              </>
            )}
            {(sessionId || workspaceId || project) && (
              <RunAccess
                key={contextKey}
                context={accessContext}
                value={choice}
                onChange={(value) => setAccessChoice({ context: contextKey, value })}
                onPendingChange={(pending) =>
                  setPendingAccessContext((current) =>
                    pending ? contextKey : current === contextKey ? undefined : current,
                  )
                }
              />
            )}
          </div>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="composer-footer">
          <span>
            <ShieldCheck size={15} />
            {(selectedPreset?.model || model) === 'fixture-model'
              ? 'Simulation makes no paid API calls'
              : 'Spending is capped by your budget'}
          </span>
          <Button
            busy={busy}
            type="submit"
            disabled={accessPending || !prompt.trim() || (!sessionId && !preset && !model)}
          >
            Start run <ArrowUp size={16} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
