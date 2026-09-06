'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Gauge, Layers, Timer } from 'lucide-react';
import { toast } from 'sonner';
import { api, money, type Schema } from '../lib/client';
import { Button, Field } from './ui';
import './scheduling.css';

export function ExecutionPolicy({ policy }: { policy: Schema['ExecutionPolicy'] }) {
  const client = useQueryClient();
  const [concurrency, setConcurrency] = useState(String(policy.concurrency_override ?? ''));
  const [timeout, setTimeoutValue] = useState(String(policy.timeout_override_seconds ?? ''));
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel execution-policy">
      <div className="section-heading">
        <div>
          <h2>
            <Gauge size={18} /> Execution controls
          </h2>
          <p>Keep parallel work and spending within your comfort zone.</p>
        </div>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await api('/v1/organization/execution-policy', 'PATCH', {
              concurrency_limit: concurrency === '' ? null : Number(concurrency),
              max_timeout_seconds: timeout === '' ? null : Number(timeout),
            });
            await client.invalidateQueries();
            toast.success('Execution limits saved');
          } catch (error) {
            toast.error((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <Field
            label="Concurrent jobs"
            hint={`Plan maximum: ${policy.plan_concurrency_limit}. Blank uses the plan default.`}
          >
            <input
              type="number"
              min="1"
              max={policy.plan_concurrency_limit}
              placeholder={String(policy.plan_concurrency_limit)}
              value={concurrency}
              onChange={(e) => setConcurrency(e.target.value)}
            />
          </Field>
          <Field
            label="Execution timeout cap (seconds)"
            hint={`Plan maximum: ${policy.plan_max_timeout_seconds / 60} minutes. Blank uses the plan default.`}
          >
            <input
              type="number"
              min="1"
              max={policy.plan_max_timeout_seconds}
              placeholder={String(policy.plan_max_timeout_seconds)}
              value={timeout}
              onChange={(e) => setTimeoutValue(e.target.value)}
            />
          </Field>
        </div>
        <p className="form-hint">
          Changes apply before the next job starts. Running agents continue. Jobs that exceed a newly lowered
          timeout fail explicitly and release their reserved budget.
        </p>
        <Button variant="secondary" type="submit" busy={busy}>
          Save execution limits
        </Button>
      </form>
    </section>
  );
}

export function PlanOptions({
  billing,
  busy,
  onChoose,
}: {
  billing: Schema['Billing'];
  busy: boolean;
  onChoose: (id: 'pro' | 'scale') => void;
}) {
  return (
    <section aria-label="Available plans" className="tier-grid">
      {billing.plans?.map((plan) => (
        <article className={`panel tier-card ${billing.plan === plan.id ? 'current' : ''}`} key={plan.id}>
          <div className="tier-label">
            <h3>{plan.name}</h3>
            {billing.plan === plan.id && <span>Current plan</span>}
          </div>
          <p className="tier-price">
            {money(plan.monthly_price_micro_usd)}
            <small>/ month + usage</small>
          </p>
          <p>
            <Layers size={15} /> Up to {plan.concurrency_limit} concurrent jobs
          </p>
          <p>
            <Timer size={15} /> {plan.max_timeout_seconds / 60} minutes per job
          </p>
          <p>
            {money(plan.included_credit_micro_usd)} monthly credit · {plan.storage_gib} GiB storage
          </p>
          {billing.plan === 'payg' && plan.id !== 'payg' && (
            <Button
              variant={plan.id === 'pro' ? 'primary' : 'secondary'}
              busy={busy}
              onClick={() => onChoose(plan.id as 'pro' | 'scale')}
            >
              Choose {plan.name}
            </Button>
          )}
        </article>
      ))}
      <p className="form-hint tier-footnote">
        All plans include the API, CLI, persistent projects and a 24-hour queue deadline. Concurrency is a
        maximum, not reserved capacity. Existing subscribers change plans in the billing portal.
      </p>
    </section>
  );
}
