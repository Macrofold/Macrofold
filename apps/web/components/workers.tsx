'use client';
import { useState } from 'react';
import type { Result } from 'macrofold';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Cpu, Plus } from 'lucide-react';
import { request, useData, useDataPages } from '../lib/dashboard-data';
import { money, type Schema } from '../lib/client';
import { Badge, Button, Empty, ErrorState, Field, Loading, Modal, More, PageHeading, Select } from './ui';
import { CopyButton } from './copy-button';

type Worker = Schema['Worker'];
type Offering = Schema['WorkerOffering'];
const profile = (value: Pick<Offering, 'compute' | 'dedicated' | 'isolate_runs'>) => `${value.compute}:${value.dedicated}:${value.isolate_runs}`;
const profileLabel = (value: Pick<Offering, 'compute' | 'dedicated' | 'isolate_runs'>) =>
  `${value.compute === 'server' ? 'Server compute' : 'On-demand sandbox'} · ${value.dedicated ? 'dedicated capacity' : 'metered capacity'} · ${value.isolate_runs ? 'isolated Runs' : 'trusted sharing'}`;
function usd(value: string): string {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error('Enter a nonnegative USD amount with at most six decimal places.');
  const [whole, fraction = ''] = value.split('.');
  return (BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))).toString();
}
const dollars = (value: string) => `${BigInt(value) / 1000000n}.${(BigInt(value) % 1000000n).toString().padStart(6, '0')}`;

function WorkerForm({ initial, offerings, defaults, onSaved }: {
  initial: Worker | null; offerings: Offering[]; defaults: Result<'listWorkerOfferings'>['limits']; onSaved: () => void;
}) {
  const preferred = initial ?? offerings.find(item => item.compute === 'server' && item.dedicated && !item.isolate_runs) ?? offerings[0];
  const [selection, setSelection] = useState(preferred ? profile(preferred) : '');
  const [name, setName] = useState(initial?.name || '');
  const [cap, setCap] = useState(dollars(initial?.max_hourly_compute_cost_micro_usd ?? defaults.default_hourly_compute_cost_micro_usd));
  const [minimum, setMinimum] = useState(String(initial?.min_instances ?? 0));
  const [maximum, setMaximum] = useState(String(initial?.max_instances ?? defaults.default_max_instances));
  const [concurrency, setConcurrency] = useState(String(initial?.max_concurrency ?? defaults.default_max_concurrency));
  const [idle, setIdle] = useState(String(initial?.idle_timeout_seconds ?? 300));
  const [keepAlive, setKeepAlive] = useState(initial?.idle_timeout_seconds === null);
  const [expiry, setExpiry] = useState(initial?.expires_at || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choices = [...new Map([...offerings, ...(initial?.accepted_offerings || [])].map(item => [profile(item), item])).values()];
  const selected = choices.find(item => profile(item) === selection);
  const disruptiveAllowed = !initial || (initial.status === 'paused' && initial.occupied_slots === 0 && initial.ready_instances + initial.starting_instances + initial.draining_instances === 0);
  return <form onSubmit={async event => {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setError('');
    try {
      const body: Schema['WorkerCreate'] = {
        name, compute: selected.compute, dedicated: selected.dedicated, isolate_runs: selected.isolate_runs,
        max_hourly_compute_cost_micro_usd: usd(cap), max_concurrency: Number(concurrency),
        ...(selected.dedicated ? { min_instances: Number(minimum), max_instances: Number(maximum) } : {}),
        idle_timeout_seconds: keepAlive ? null : Number(idle), expires_at: expiry ? new Date(expiry).toISOString() : null,
      };
      if (initial) await request('patchWorker', { params: { path: { worker_id: initial.id } }, body: { ...body, expected_revision: initial.revision } });
      else await request('createWorker', { body });
      onSaved();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }}>
    <Field label="Name"><input value={name} maxLength={100} required onChange={event => setName(event.target.value)} /></Field>
    <Field label="Compute offering" hint={disruptiveAllowed ? 'Macrofold sizes and places work within this economic and isolation contract.' : 'Pause and finish draining before changing compute or isolation.'}>
      <Select value={selection} disabled={!disruptiveAllowed} onValueChange={setSelection}
        options={choices.map(item => ({ value: profile(item), label: profileLabel(item) }))} />
    </Field>
    <Field label="Maximum compute rate (USD/hour)" hint="Aggregate scaling ceiling, not a monthly budget or a cap on model/tool usage. Existing commitments cannot be lowered away.">
      <input inputMode="decimal" value={cap} required onChange={event => setCap(event.target.value)} />
    </Field>
    {selected && <p className="form-hint">{selected.price.kind === 'allocation'
      ? `Allocated capacity starts at ${money(selected.price.hourly_micro_usd)}/hour and is billed while running, including idle time.`
      : `Resource rates: ${money(selected.price.cpu_hour_micro_usd)}/active CPU-hour and ${money(selected.price.gib_hour_micro_usd)}/allocated GiB-hour.`}
      {' '}Accepted resource shapes and rates remain visible after creation. <Link href="/docs/execution/workers">Compute and billing guide</Link>.
    </p>}
    <details>
      <summary>Scaling and lifecycle</summary>
      <div className="form-grid">
        {selected?.dedicated && <>
          <Field label="Minimum instances" hint="Use 1 for an always-available baseline while enabled."><input type="number" min="0" max={defaults.max_instances} value={minimum} required onChange={event => setMinimum(event.target.value)} /></Field>
          <Field label="Maximum instances"><input type="number" min="1" max={defaults.max_instances} value={maximum} required onChange={event => setMaximum(event.target.value)} /></Field>
        </>}
        <Field label="Maximum concurrent Runs" hint={`Account limit: ${defaults.max_concurrency}. Resource requirements may impose a lower active count.`}><input type="number" min="1" max={defaults.max_concurrency} value={concurrency} required onChange={event => setConcurrency(event.target.value)} /></Field>
        <Field label="Idle timeout (seconds)"><input type="number" min="0" value={idle} disabled={keepAlive} required={!keepAlive} onChange={event => setIdle(event.target.value)} /></Field>
      </div>
      <label><input type="checkbox" checked={keepAlive} onChange={event => setKeepAlive(event.target.checked)} /> Keep running when idle</label>
      <Field label="Expiration (optional ISO timestamp)" hint="Expires the logical Worker. Provider machine replacement never extends this date."><input value={expiry} placeholder="2026-12-01T00:00:00Z" onChange={event => setExpiry(event.target.value)} /></Field>
      <p className="form-hint">Use the API or CLI for explicit size, region, runtime, per-Run resources, and Worker-restricted credentials.</p>
    </details>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="button-row"><Button type="submit" busy={busy} disabled={!selected}>{initial ? 'Save Worker' : 'Create Worker'}</Button></div>
  </form>;
}

export function WorkersView() {
  const client = useQueryClient();
  const workers = useDataPages({ operation: 'listWorkers', params: { query: { limit: 25 } } }, 10000);
  const catalog = useData({ operation: 'listWorkerOfferings' });
  const [edit, setEdit] = useState<Worker | null | undefined>();
  const [action, setAction] = useState<{ worker: Worker; kind: 'pause' | 'resume' | 'destroy' }>();
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function refresh() {
    await client.invalidateQueries({ predicate: query => typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/v1/workers') });
  }
  return <div className="page">
    <PageHeading title="Workers" description="Control compute economics and scaling independently of your agents’ files and conversations."
      action={<Button onClick={() => setEdit(null)} disabled={!catalog.data}><Plus size={16} /> Create Worker</Button>} />
    <p className="form-hint">Most Runs need no Worker selection. Create a reusable target when you need explicit cost, sharing, or availability controls.</p>
    {workers.isPending ? <Loading /> : workers.error ? <ErrorState error={workers.error} retry={() => void workers.refetch()} /> : !workers.data?.data.length ?
      <Empty icon={<Cpu />} title="No Workers yet" description="Automatic execution is still available. A Worker adds a reusable, cost-controlled compute target." /> : <>
        {workers.data.data.map(worker => <section className="panel" key={worker.id} aria-label={worker.name || worker.id}>
          <div className="section-heading"><h2>{worker.name || worker.id}</h2><Badge status={worker.status} /></div>
          <p>{profileLabel(worker)}</p>
          <p><code>{worker.id}</code> <CopyButton text={worker.id} variant="ghost" /></p>
          <div className="form-grid">
            <p><strong>{worker.active_runs}</strong> active · {worker.queued_runs} queued · {worker.occupied_slots} occupied slots</p>
            <p>{worker.ready_instances} ready · {worker.starting_instances} starting · {worker.draining_instances} draining instances</p>
            <p>{money(worker.committed_hourly_compute_cost_micro_usd)}/hour committed · ceiling {money(worker.max_hourly_compute_cost_micro_usd)}/hour</p>
            <p>{money(worker.cost_micro_usd)} compute charged · {money(worker.reserved_micro_usd)} held for authorized capacity</p>
          </div>
          {worker.failure_code && <p className="form-error" role="status">Allocation status: {worker.failure_code.replaceAll('_', ' ')}. Existing files and conversations remain independent of compute.</p>}
          <div className="button-row">
            <Button variant="secondary" disabled={worker.desired_state === 'destroyed' || !catalog.data} onClick={() => setEdit(worker)}>Settings</Button>
            <Button variant="secondary" disabled={worker.desired_state === 'destroyed'} onClick={() => { setForce(false); setError(''); setAction({ worker, kind: worker.desired_state === 'paused' ? 'resume' : 'pause' }); }}>
              {worker.desired_state === 'paused' ? 'Resume' : 'Pause'}
            </Button>
            <Button variant="danger" disabled={worker.desired_state === 'destroyed'} onClick={() => { setForce(false); setError(''); setAction({ worker, kind: 'destroy' }); }}>Destroy</Button>
          </div>
        </section>)}
        <More query={workers} />
      </>}
    {catalog.error && <ErrorState error={catalog.error} retry={() => void catalog.refetch()} />}
    <Modal open={edit !== undefined} onOpenChange={open => { if (!open) setEdit(undefined); }} title={edit ? 'Worker settings' : 'Create Worker'} description="Choose economics first. Machine placement and scaling follow your limits.">
      {edit !== undefined && catalog.data && <WorkerForm key={edit?.id || 'create'} initial={edit} offerings={catalog.data.data} defaults={catalog.data.limits}
        onSaved={() => { setEdit(undefined); void refresh(); }} />}
    </Modal>
    <Modal open={!!action} onOpenChange={open => { if (!busy && !open) setAction(undefined); }} title={action ? `${action.kind[0].toUpperCase()}${action.kind.slice(1)} Worker` : 'Worker action'}
      description={action?.kind === 'resume' ? 'Enable new admissions. Baseline capacity may start accruing compute charges.' : 'Stop new admissions and drain active Runs. Files and Sessions are not deleted.'}>
      {action && <form onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError('');
        try {
          const params = { path: { worker_id: action.worker.id } };
          if (action.kind === 'resume') await request('resumeWorker', { params });
          else if (action.kind === 'pause') await request('pauseWorker', { params, body: { force } });
          else await request('destroyWorker', { params, body: { force } });
          setAction(undefined); await refresh();
        } catch (failure) { setError((failure as Error).message); }
        finally { setBusy(false); }
      }}>
        <p>{action.worker.name}</p>
        {action.kind !== 'resume' && <label><input type="checkbox" checked={force} onChange={event => setForce(event.target.checked)} /> Interrupt active Runs instead of waiting for completion</label>}
        {action.kind === 'destroy' && <p>Queued Runs are cancelled. The destroyed Worker cannot be resumed.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" variant={action.kind === 'destroy' ? 'danger' : 'primary'} busy={busy}>Confirm {action.kind}</Button>
      </form>}
    </Modal>
  </div>;
}
