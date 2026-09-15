import { plans } from '@platform/core/plans';
import { computeRate } from '@platform/core/catalog';
import { config } from '@platform/core/config';
import { Pricing } from '../../components/marketing';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: { absolute: 'Pricing · Macrofold' },
  description:
    'Compare cloud agent plans, concurrency limits, and usage rates. Estimate monthly execution and model costs with the Macrofold pricing calculator.',
};
export default function Page() {
  return (
    <Pricing
      name={config.name}
      plans={plans().map((p) => ({
        id: p.id,
        name: p.name,
        monthlyMicro: p.monthly_price_micro_usd,
        includedMicro: p.included_credit_micro_usd,
        concurrency: p.concurrency_limit,
        minutes: p.max_timeout_seconds / 60,
        storage: p.storage_gib,
        history: p.history_days,
      }))}
      computeMicroPerMinute={computeRate()}
      searchMicroPerCall={process.env.BRAVE_SEARCH_MICRO_USD_PER_CALL || null}
      connectorMicroPerCall={process.env.COMPOSIO_MICRO_USD_PER_CALL || null}
      contactHref={
        process.env.SUPPORT_EMAIL?.includes('@')
          ? `mailto:${process.env.SUPPORT_EMAIL}?subject=Cloud%20agent%20capacity`
          : undefined
      }
    />
  );
}
