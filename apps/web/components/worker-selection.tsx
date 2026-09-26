'use client';
import { useDataPages } from '../lib/dashboard-data';
import { money } from '../lib/client';
import { ErrorState, Field, More, Select } from './ui';

export type WorkerPlacement = { worker_id?: string; memory_mib?: number; cpu_millis?: number };
/** A paginated optional selector; choosing files or a Session never implicitly chooses compute. */
export function WorkerSelection({ value, onChange }: { value: WorkerPlacement; onChange: (value: WorkerPlacement) => void }) {
  const workers = useDataPages({ operation: 'listWorkers', params: { query: { limit: 25 } } });
  const enabled = workers.data?.data.filter(worker => worker.desired_state === 'enabled' && worker.status !== 'expired') || [];
  const selected = enabled.find(worker => worker.id === value.worker_id);
  return <>
    <Field label="Compute" hint="Automatic execution is isolated and billed per Run. Explicit Worker compute is billed separately under the Worker's accepted rates.">
      <Select value={value.worker_id || ''} onValueChange={worker_id => onChange(worker_id ? { ...value, worker_id } : {})}
        options={[
          { value: '', label: 'Automatic isolated compute' },
          ...enabled.map(worker => ({ value: worker.id, label: `${worker.name} · ${worker.compute} · ${worker.status}` })),
          ...(value.worker_id && !selected ? [{ value: value.worker_id, label: `${value.worker_id} · not available in the loaded page` }] : []),
        ]} />
    </Field>
    <More query={workers} label="Load more Workers" />
    {workers.error && <ErrorState error={workers.error} retry={() => void workers.refetch()} />}
    {selected && <p className="form-hint">{selected.active_runs} active · {selected.queued_runs} queued · {money(selected.max_hourly_compute_cost_micro_usd)}/hour aggregate ceiling. {selected.isolate_runs ? 'Each Run receives an isolated allocation.' : 'Runs share a trusted execution environment.'}</p>}
    {value.worker_id && <div className="form-grid">
      <Field label="Memory per Run (MiB, optional)"><input type="number" min="1" max="1048576" value={value.memory_mib ?? ''}
        onChange={event => onChange({ ...value, memory_mib: event.target.value ? Number(event.target.value) : undefined })} /></Field>
      <Field label="CPU per Run (millicores, optional)" hint="1000 means one CPU core."><input type="number" min="1" max="1024000" value={value.cpu_millis ?? ''}
        onChange={event => onChange({ ...value, cpu_millis: event.target.value ? Number(event.target.value) : undefined })} /></Field>
    </div>}
  </>;
}
