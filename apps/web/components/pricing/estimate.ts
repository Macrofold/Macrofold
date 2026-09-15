export type PricingPlan = {
  id: string;
  name: string;
  monthlyMicro: string;
  includedMicro: string;
  concurrency: number;
  minutes: number;
  storage: number;
  history: number;
};

export function dollars(micro: string | bigint, maximumFractionDigits = 2) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits,
  }).format(Number(micro) / 1_000_000);
}

// Estimate in integer microdollars, using hundredths of an hour (36 seconds).
// This is an illustrative monthly total, not the per-run settlement ledger.
function hundredths(value: string) {
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  return result <= 100_000_000n ? result : null;
}

export function estimateMonthlyCost({
  hours,
  modelSpend,
  byok,
  plan,
  computeMicroPerMinute,
}: {
  hours: string;
  modelSpend: string;
  byok: boolean;
  plan: Pick<PricingPlan, 'monthlyMicro' | 'includedMicro'>;
  computeMicroPerMinute: string;
}) {
  const time = hundredths(hours);
  const model = hundredths(modelSpend);
  if (time === null || model === null) return null;
  const compute = (time * 60n * BigInt(computeMicroPerMinute) + 99n) / 100n;
  const models = model * 10_000n;
  const usage = compute + (byok ? 0n : models);
  const allowance = BigInt(plan.includedMicro);
  const credit = usage < allowance ? usage : allowance;
  const subscription = BigInt(plan.monthlyMicro);
  const platform = subscription + usage - credit;
  const provider = byok ? models : 0n;
  return { compute, models, credit, subscription, platform, provider, total: platform + provider };
}
