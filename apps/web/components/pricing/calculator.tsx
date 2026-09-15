'use client';

import { useState } from 'react';
import { ArrowUpRight, Cpu, Info } from 'lucide-react';
import Link from 'next/link';
import { dollars, estimateMonthlyCost, type PricingPlan } from './estimate';

export function CostCalculator({
  plans,
  computeMicroPerMinute,
}: {
  plans: PricingPlan[];
  computeMicroPerMinute: string;
}) {
  const [planId, setPlanId] = useState(plans[0]!.id);
  const [hours, setHours] = useState('100');
  const [modelSpend, setModelSpend] = useState('20');
  const [byok, setByok] = useState(false);
  const plan = plans.find((item) => item.id === planId) || plans[0]!;
  const estimate = estimateMonthlyCost({ hours, modelSpend, byok, plan, computeMicroPerMinute });
  return (
    <div className="mp-calculator">
      <div className="mp-inputs">
        <fieldset className="mp-choice">
          <legend>Your plan</legend>
          <div>
            {plans.map((item) => (
              <label key={item.id}>
                <input
                  type="radio"
                  name="estimate-plan"
                  value={item.id}
                  checked={item.id === plan.id}
                  onChange={() => setPlanId(item.id)}
                />
                <span>
                  {item.name}
                  <small>{dollars(item.monthlyMicro).replace(/\.00$/, '')}/mo</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mp-number-field">
          <label htmlFor="estimate-hours">Total execution time</label>
          <div>
            <input
              id="estimate-hours"
              type="number"
              min="0"
              max="1000000"
              step="0.01"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              aria-describedby="estimate-hours-help"
              aria-invalid={!estimate && !/^\d+(\.\d{1,2})?$/.test(hours)}
            />
            <span>hours / month</span>
          </div>
          <p id="estimate-hours-help">
            Across all your agents. Ten agents running for one hour use ten hours.
          </p>
        </div>
        <div className="mp-memory">
          <Cpu size={19} aria-hidden="true" />
          <span>
            <strong>4 GB memory · 2 vCPU</strong>
            <small>Per sandbox, included in the execution price. No GB-hour math.</small>
          </span>
        </div>
        <fieldset className="mp-choice mp-model-choice">
          <legend>How you pay for models</legend>
          <div>
            <label>
              <input type="radio" name="estimate-model" checked={!byok} onChange={() => setByok(false)} />
              <span>Use credits</span>
            </label>
            <label>
              <input type="radio" name="estimate-model" checked={byok} onChange={() => setByok(true)} />
              <span>Bring your own key</span>
            </label>
          </div>
        </fieldset>
        <div className="mp-number-field">
          <label htmlFor="estimate-model-spend">Estimated model spend</label>
          <div>
            <span>$</span>
            <input
              id="estimate-model-spend"
              type="number"
              min="0"
              max="1000000"
              step="0.01"
              value={modelSpend}
              onChange={(event) => setModelSpend(event.target.value)}
              aria-describedby="estimate-model-help"
            />
            <span>/ month</span>
          </div>
          <p id="estimate-model-help">
            {byok
              ? 'Use the amount you expect your model provider to bill directly.'
              : 'Use the token spend you expect at the published managed model rates.'}{' '}
            Include input, output, and repeated context.
          </p>
        </div>
      </div>
      <div className="mp-estimate" role="region" aria-label="Monthly cost estimate">
        <p className="mp-kicker">Estimated monthly total</p>
        {estimate ? (
          <>
            <output className="mp-total" data-testid="estimate-total" aria-live="polite" aria-atomic="true">
              {dollars(estimate.total)}
              <small>/ mo</small>
            </output>
            <p className="mp-estimate-description">
              {byok ? 'Platform costs + your direct provider bill.' : 'Plan + usage, after included credits.'}
            </p>
            <dl>
              <div>
                <dt>{plan.name} subscription</dt>
                <dd>{dollars(estimate.subscription)}</dd>
              </div>
              <div>
                <dt>
                  Execution{' '}
                  <small>
                    {hours} h × {dollars(BigInt(computeMicroPerMinute) * 60n, 3)}/h
                  </small>
                </dt>
                <dd>{dollars(estimate.compute)}</dd>
              </div>
              <div>
                <dt>Models {byok && <small>billed by your provider</small>}</dt>
                <dd>{dollars(estimate.models)}</dd>
              </div>
              <div className="mp-credit">
                <dt>Included credits applied</dt>
                <dd>−{dollars(estimate.credit)}</dd>
              </div>
            </dl>
            <div className="mp-platform-total">
              <span>Paid to Macrofold</span>
              <strong data-testid="estimate-platform">{dollars(estimate.platform)}</strong>
            </div>
            {byok && (
              <div className="mp-provider-total">
                <span>Paid to your model provider</span>
                <strong>{dollars(estimate.provider)}</strong>
              </div>
            )}
            <Link href="/register" className="mf-primary">
              Start building
              <ArrowUpRight size={17} />
            </Link>
            <p className="mp-estimate-note">
              <Info size={14} aria-hidden="true" />
              Estimate only. Excludes taxes, tools, and storage above your plan allowance. Actual use and
              model rates determine your bill.
            </p>
          </>
        ) : (
          <p role="alert">
            Enter an amount between 0 and 1,000,000 with up to two decimal places in each field.
          </p>
        )}
      </div>
    </div>
  );
}
