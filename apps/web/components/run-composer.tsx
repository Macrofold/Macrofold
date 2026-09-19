'use client';
import { RunAttachments, type PendingAttachment } from './run-attachments';
import { attachmentIssue } from '../../../packages/contracts/media';
import { uploadWorktreeFiles } from '../lib/upload-workspace-files';
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
import { Button, ErrorState, Field, Loading, Modal } from './ui';
export function RunComposer({
  open,
  onOpenChange,
  worktreeId,
  sessionId,
  initialPrompt = '',
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  worktreeId?: string;
  sessionId?: string;
  initialPrompt?: string;
}) {
  const router = useRouter(),
    client = useQueryClient();
  const [prompt, setPrompt] = useState(initialPrompt),
    [requestedWorkspace, setWorkspace] = useState(''),
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
    [error, setError] = useState(''),
    [attachments, setAttachments] = useState<PendingAttachment[]>([]),
    [uploadProgress, setUploadProgress] = useState('');
  const policy = useData(open ? { operation: 'getExecutionPolicy' } : undefined);
  const maxMinutes = (policy.data?.max_timeout_seconds || 1800) / 60;
  const effectiveTimeout = Math.min(Number(timeout), maxMinutes);
  const workspaces = useDataPages(open ? { operation: 'listWorkspaces' } : undefined);
  const models = useDataPages(open ? { operation: 'listModels' } : undefined);
  const connections = useDataPages(open ? { operation: 'listConnections' } : undefined);
  const presetQuery = useData(
    open && preset ? { operation: 'getAgent', params: { path: { agent_id: preset } } } : undefined,
  );
  const selectedPreset = presetQuery.data;
  const sessionQuery = useData(
    open && sessionId ? { operation: 'getSession', params: { path: { session_id: sessionId } } } : undefined,
  );
  const activeWorkspaces = workspaces.data?.data.filter((item) => !item.archived) || [];
  const workspace = requestedWorkspace || activeWorkspaces[0]?.id || '';
  const available =
    models.data?.data.filter((item) => item.enabled && item.harnesses.includes(harness)) || [];
  const model = available.some((item) => item.id === requestedModel)
    ? requestedModel
    : available[0]?.id || '';
  const selectedConfiguration = sessionId ? sessionQuery.data : preset ? selectedPreset : { harness, model };
  const attachmentConfigurationPending =
    attachments.length > 0 &&
    (models.isPending || (sessionId ? sessionQuery.isPending : !!preset && presetQuery.isPending));
  const attachmentQueryFailure =
    attachments.length > 0
      ? [models, ...(sessionId ? [sessionQuery] : preset ? [presetQuery] : [])].find((query) => query.error)
      : undefined;
  // Recompute against the active selection, including presets and immutable sessions.
  // An unsupported choice leaves the draft intact and prevents uploads or run creation.
  const attachmentError = attachmentIssue(
    attachments.map(({ path, file }) => ({ path, size: file.size })),
    {
      harness: selectedConfiguration?.harness || '',
      model: selectedConfiguration?.model || '',
      provider: models.data?.data.find((item) => item.id === selectedConfiguration?.model)?.provider || '',
    },
  )?.message;
  const accessContext: Schema['ConnectionAccessResolve'] = {
    ...(sessionId
      ? { session_id: sessionId }
      : worktreeId
        ? { worktree_id: worktreeId }
        : { workspace_id: workspace }),
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
        if (busy) return;
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
          if (accessPending || attachmentConfigurationPending || attachmentQueryFailure || attachmentError)
            return;
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
                    ...(worktreeId ? { worktree_id: worktreeId } : { workspace_id: workspace }),
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
            if (attachments.length) {
              const target =
                worktreeId ||
                (sessionId
                  ? (await request('getSession', { params: { path: { session_id: sessionId } } }))
                      .worktree_id
                  : (await request('getWorkspace', { params: { path: { workspace_id: workspace } } }))
                      .default_worktree_id);
              if (!target) throw new Error('Create a worktree in this workspace before attaching files.');
              await uploadWorktreeFiles(target, attachments, setUploadProgress);
              body.attachments = attachments.map((item) => item.path);
              if (!sessionId) {
                delete body.workspace_id;
                body.worktree_id = target;
              }
            }
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
            setAttachments([]);
            setAccessChoice(undefined);
            router.push(`/runs/${result.run_id}`);
            toast.success('Run saved. Follow its queue status here.');
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
            setUploadProgress('');
          }
        }}
      >
        {!worktreeId && !sessionId && (
          <AccessResourceSelect
            kind="workspace"
            label="Workspace"
            value={workspace}
            onChange={setWorkspace}
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
            placeholder="Explore this workspace, make a change, or investigate a question…"
            autoFocus
            rows={6}
          />
        </Field>
        <RunAttachments value={attachments} onChange={setAttachments} onError={setError} disabled={busy} />
        {attachmentConfigurationPending && <Loading label="Checking attachment compatibility…" />}
        {attachmentQueryFailure?.error && (
          <ErrorState
            error={attachmentQueryFailure.error}
            retry={() => void attachmentQueryFailure.refetch()}
          />
        )}
        {uploadProgress && <p role="status">{uploadProgress}</p>}
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
            {(sessionId || worktreeId || workspace) && (
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
        {(error || (!attachmentConfigurationPending && !attachmentQueryFailure && attachmentError)) && (
          <div className="form-error" role="alert">
            {error || attachmentError}
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
            disabled={
              accessPending ||
              attachmentConfigurationPending ||
              !!attachmentQueryFailure ||
              !!attachmentError ||
              !prompt.trim() ||
              (!sessionId && !preset && !model)
            }
          >
            Start run <ArrowUp size={16} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
