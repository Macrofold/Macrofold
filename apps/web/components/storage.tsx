'use client';
import { useQueryClient } from '@tanstack/react-query';
import { HardDrive, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, relative, useApi, type Schema } from '../lib/client';
import { Button, ErrorState, Field, Loading, SectionHeading } from './ui';
const gib = (bytes: string) =>
  `${(Number(bytes) / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 2 })} GiB`;
export function StoragePanel() {
  const query = useApi<Schema['Storage']>('/v1/storage', 15000),
    identity = useApi<Schema['Identity']>('/v1/me');
  const current = identity.data?.organizations.find((o) => o.id === identity.data?.organization_id),
    manage = current && ['owner', 'admin'].includes(current.role);
  const [enabled, setEnabled] = useState<boolean>(),
    [budget, setBudget] = useState<string>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const client = useQueryClient();
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;
  const data = query.data!,
    allowed = enabled ?? data.overage_enabled;
  return (
    <section className="panel storage-panel">
      <SectionHeading
        title="Persistent storage"
        description="Current files, retained checkpoints and artifacts share one physical storage meter. Identical stored objects count once."
      />
      <div className="storage-summary">
        <div className="intro-icon">
          <HardDrive size={22} />
        </div>
        <div>
          <strong>{data.observed_at ? gib(data.physical_bytes) : 'Waiting for first measurement'}</strong>
          <p>
            {gib(data.allowance_bytes)} included ·{' '}
            {data.observed_at
              ? 'Checked ' + relative(data.observed_at)
              : 'The background worker will measure retained objects.'}
          </p>
        </div>
      </div>
      <div
        className="storage-meter"
        role="progressbar"
        aria-label="Included storage used"
        aria-valuenow={Math.min(
          100,
          Math.round((Number(data.physical_bytes) / Number(data.allowance_bytes)) * 100),
        )}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          style={{
            width: Math.min(100, (Number(data.physical_bytes) / Number(data.allowance_bytes)) * 100) + '%',
          }}
        />
      </div>
      {data.over_quota && (
        <div className="form-error" role="status">
          New runs and uploads are paused by your storage limit. Your files, downloads, and recovery remain
          available.
        </div>
      )}
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            const amount = budget ?? String(Number(data.monthly_budget_micro_usd) / 1000000);
            if (!/^\d{1,5}(\.\d{1,2})?$/.test(amount))
              throw new Error('Enter a dollar amount with at most two decimal places.');
            await api('/v1/storage', 'PATCH', {
              overage_enabled: allowed,
              monthly_budget_micro_usd: String(Math.round(Number(amount) * 1000000)),
            });
            setEnabled(undefined);
            setBudget(undefined);
            await client.invalidateQueries();
            toast.success('Storage budget saved');
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={allowed}
            disabled={!manage || busy}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enable storage beyond the included allowance
        </label>
        <p className="muted">
          Additional storage costs $0.10 per GiB over a 30-day month, prorated from measured bytes. Charges
          use your prepaid balance and stay within the budget below. No overage charge applies while this
          option is off.
        </p>
        <Field
          label="Monthly storage budget (USD)"
          hint="A spending ceiling, not a prepaid purchase. Measured storage may exceed the allowance during an already accepted run; its files are still preserved."
        >
          <input
            type="text"
            inputMode="decimal"
            required
            disabled={!manage || busy}
            value={budget ?? String(Number(data.monthly_budget_micro_usd) / 1000000)}
            onChange={(e) => setBudget(e.target.value)}
          />
        </Field>
        {manage && <Button busy={busy}>Save storage budget</Button>}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </form>
      <p className="storage-retention">
        <ShieldCheck size={17} />
        All checkpoints for 24 hours, daily for 30 days, and weekly for 12 weeks. Current, base, pinned and
        recent run checkpoints are protected. Unreferenced objects have a 14-day recovery grace period before
        collection.
      </p>
    </section>
  );
}
