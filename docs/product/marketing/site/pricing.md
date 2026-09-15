# Public pricing

The pricing page explains subscription capacity, metered usage, and an estimated monthly total. It uses the homepage’s Saddle logo, sticky navigation, dark cyan surfaces, and material reflections. [Billing](../../../features/billing/README.md) owns actual charging and entitlement policy; [Design Language](../../design-language.md#pricing) owns the visual direction.

## Reading path

Start with Starter, Pro, and Scale cards: monthly subscription, included credits, concurrency, maximum run duration, retained storage, and detailed history. Shared features follow once, avoiding a repetitive comparison matrix. Usage cards separate compute, models, and retained storage; a disclosure covers tool fees. Short FAQs explain credits, BYOK, waiting, retention, and budgets. The calculator sits at the bottom and is directly reachable from the hero.

Business is a $1,000/month sales-assisted offer. Enterprise has individually agreed pricing. Their capacity and credits require a proposal before activation; they are not additional self-serve plan IDs, checkout options, or deployed entitlement policies. Sales links use the configured public support email. When it is absent or a placeholder, the cards link to the billing guide instead. Activation and contact setup are tracked in [maintainer TODO](../../../maintainers/TODO.md#marketing-publication).

## Estimate semantics

The visitor selects a self-serve plan, total execution hours across all agents, expected model spend in dollars, and managed credits or BYOK. The standard sandbox has 2 vCPU and 4 GB memory. Its fixed size is displayed rather than offering unsupported RAM configurations or asking for GB-hours. Ten agents running for one hour contribute ten execution hours.

The server supplies plan prices, included credits, and the configured compute rate. At the default $0.008/minute, 100 total execution hours cost $48. Managed mode applies eligible included credits to compute plus the entered managed-model cost, then adds the subscription. BYOK applies credits to platform compute only and adds the estimated direct provider bill separately. Unused allowance never becomes a refund or reduces the subscription.

The estimate assumes one full monthly subscription period. It uses integer microdollars and accepts up to two decimal places for hours and model dollars, between zero and one million. Invalid or cleared fields remove the total and show an error instead of implying zero cost. The result is illustrative: actual per-run settlement, model rates, taxes, tool fees, and storage beyond the plan allowance can change the invoice. Model spend is supplied by the visitor, not predicted from runtime. Different managed and provider rates should be reflected in that input.

## Implementation

The [pricing route](../../../../apps/web/app/pricing/page.tsx) reads public catalog values on the server. The [page component](../../../../apps/web/components/pricing/site.tsx) renders content and disclosures; the [calculator](../../../../apps/web/components/pricing/calculator.tsx) is a small client component backed by a [pure estimate function](../../../../apps/web/components/pricing/estimate.ts). No billing mutation, analytics event, provider call, new dependency, or simulated checkout is involved. Inputs use native labeled controls with styled radio groups and a live result announcement.

The layout is original. [HarnessRouter’s pricing page](https://harnessrouter.ai/pricing) informed the decision to make tier limits explicit, while our flow uses separate plan, usage, and estimate sections. Its prices, discounts, billing semantics, and feature promises were not adopted.

[Site verification](verification.md) owns measured browser and arithmetic checks. Cloud billing acceptance remains separate from a passing public calculator.
