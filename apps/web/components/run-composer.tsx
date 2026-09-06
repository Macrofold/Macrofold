'use client';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, ChevronDown, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, useApi, usePages, type Schema } from '../lib/client';
import { RunToolSelection } from './run-tools';
import { Select } from './select';
import { Button, Field, Modal, More } from './ui';
export function RunComposer({
  open,
  onOpenChange,
  workspaceId,
  sessionId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId?: string;
  sessionId?: string;
}) {
  const router = useRouter(),
    client = useQueryClient();
  const [prompt, setPrompt] = useState(''),
    [requestedProject, setProject] = useState(''),
    [harness, setHarness] = useState('codex'),
    [requestedModel, setModel] = useState(''),
    [mode, setMode] = useState<'managed' | 'byok'>('managed'),
    [connection, setConnection] = useState(''),
    [preset, setPreset] = useState(''),
    [toolSelection, setToolSelection] = useState<Record<string, string[]>>({}),
    [advanced, setAdvanced] = useState(false),
    [budget, setBudget] = useState('2.00'),
    [timeout, setTimeoutValue] = useState('15'),
    [queueHours, setQueueHours] = useState('24'),
    [schedulingClass, setSchedulingClass] = useState<'interactive' | 'background'>('interactive'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const policy = useApi<Schema['ExecutionPolicy']>(open ? '/v1/organization/execution-policy' : undefined);
  const maxMinutes = (policy.data?.max_timeout_seconds || 1800) / 60;
  const effectiveTimeout = Math.min(Number(timeout), maxMinutes);
  const projects = usePages<Schema['Project']>(open ? '/v1/projects' : undefined);
  const models = usePages<Schema['Model']>(open ? '/v1/models' : undefined);
  const connections = usePages<Schema['Connection']>(open ? '/v1/connections' : undefined);
  const presets = usePages<Schema['Agent']>(open && !sessionId ? '/v1/agents' : undefined);
  const selectedPreset = presets.data?.data.find((a) => a.id === preset);
  const activeProjects = projects.data?.data.filter((item) => !item.archived) || [];
  const project = activeProjects.some((item) => item.id === requestedProject)
    ? requestedProject
    : activeProjects[0]?.id || '';
  const available = models.data?.data.filter((item) => item.harnesses.includes(harness)) || [];
  const model = available.some((item) => item.id === requestedModel)
    ? requestedModel
    : available[0]?.id || '';
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={sessionId ? 'Continue the conversation' : 'Start a new run'}
      description="Give your agent a clear task. Follow its progress live or come back when it’s done."
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            const limits = {
              timeout_seconds: Math.round(effectiveTimeout * 60),
              max_cost_micro_usd: String(Math.round(Number(budget) * 1000000)),
            };
            const result = await api<Schema['RunAccepted']>(
              sessionId ? `/v1/sessions/${sessionId}/messages` : '/v1/runs',
              'POST',
              {
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
                            connection_grants: Object.entries(toolSelection)
                              .filter(([, tools]) => tools.length)
                              .map(([connection_id, tools]) => ({ connection_id, tools })),
                          }),
                    }),
              },
            );
            await client.invalidateQueries();
            onOpenChange(false);
            setPrompt('');
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
          <Field label="Project">
            <Select
              value={project}
              onValueChange={setProject}
              required
              options={[
                { value: '', label: 'Select a project', disabled: true },
                ...(projects.data?.data
                  .filter((p) => !p.archived)
                  .map((p) => ({ value: p.id, label: p.name })) ?? []),
              ]}
            />
          </Field>
        )}
        {!workspaceId && !sessionId && <More query={projects} label="More projects" />}
        {!sessionId && !!presets.data?.data.length && (
          <>
            <Field label="Agent preset">
              <Select
                value={preset}
                onValueChange={setPreset}
                options={[
                  { value: '', label: 'Custom configuration' },
                  ...(presets.data.data.map((agent) => ({ value: agent.id, label: agent.name })) ?? []),
                ]}
              />
            </Field>
            <More query={presets} label="More presets" />
            {selectedPreset && (
              <p className="form-hint">
                {selectedPreset.harness} · {selectedPreset.model} · {selectedPreset.billing_mode} billing.
                Uses the preset's instructions and tool grants.
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
                  setHarness(next);
                  setConnection('');
                }}
                options={[
                  { value: 'codex', label: 'Codex' },
                  { value: 'claude-code', label: 'Claude Code' },
                  { value: 'opencode', label: 'OpenCode' },
                ]}
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
                    label: m.id === 'fixture-model' ? 'Simulation · free' : m.id,
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
            {!sessionId && !preset && (
              <>
                <Field label="Model billing">
                  <Select
                    value={mode}
                    onValueChange={(next) => setMode(next as 'managed' | 'byok')}
                    options={[
                      { value: 'managed', label: 'Use workspace credits' },
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
                              <>
                                {c.name} · {c.provider}
                              </>
                            ),
                          })) ?? []),
                      ]}
                    />
                  </Field>
                )}
                <fieldset className="run-tools">
                  <legend>Tools for this run</legend>
                  <p className="form-hint">
                    Choose from previously approved tools. Each selected tool can act as its connected account
                    for this conversation.
                  </p>
                  {connections.data?.data
                    .filter(
                      (c) =>
                        ['mcp_remote', 'mcp_stdio', 'composio', 'search'].includes(c.kind) &&
                        c.status === 'healthy',
                    )
                    .map((c) => (
                      <RunToolSelection
                        key={c.id}
                        connection={c}
                        selected={toolSelection[c.id] || []}
                        onChange={(tools) => setToolSelection((current) => ({ ...current, [c.id]: tools }))}
                      />
                    ))}
                  {!connections.data?.data.some(
                    (c) => c.kind !== 'model' && c.kind !== 'github' && c.status === 'healthy',
                  ) && (
                    <p className="muted">Add and authorize a connection to use app, search or MCP tools.</p>
                  )}
                  <More query={connections} label="More connections" />
                </fieldset>
              </>
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
          <Button busy={busy} type="submit" disabled={!prompt.trim() || (!sessionId && !preset && !model)}>
            Start run <ArrowUp size={16} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
