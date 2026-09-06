import { plans } from '@platform/core/plans';
import { config } from '@platform/core/config';
import { Pricing } from '../../components/marketing';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pricing' };
export default function Page() {
  const usd = (v: string) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 3 }).format(
      Number(v) / 1000000,
    );
  return (
    <Pricing
      name={config.name}
      plans={plans().map((p) => ({
        name: p.name,
        price: usd(p.monthly_price_micro_usd),
        included: usd(p.included_credit_micro_usd),
        concurrency: p.concurrency_limit,
        minutes: p.max_timeout_seconds / 60,
        storage: p.storage_gib,
        history: p.history_days,
      }))}
      compute={usd(process.env.COMPUTE_MICRO_USD_PER_MINUTE || '8000')}
      search={usd(process.env.BRAVE_SEARCH_MICRO_USD_PER_CALL || '6000')}
    />
  );
}
