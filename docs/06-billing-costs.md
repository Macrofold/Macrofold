# Credits, billing and cost model

## Product prices and funding

Three plans share the same metered usage rates. `payg` remains the API identifier for Starter so existing accounts keep working. Execution caps can be lowered per customer through Billing → Execution controls or `PATCH /v1/organization/execution-policy` and reset with null. Only verified Stripe state assigns paid plans.

| Plan             | Monthly subscription | Monthly credit | Concurrent jobs | Execution maximum | Included storage | Detailed history |
| ---------------- | -------------------: | -------------: | --------------: | ----------------: | ---------------: | ---------------: |
| Starter (`payg`) |           $0 + usage |             $0 |               2 |        30 minutes |            1 GiB |          30 days |
| Pro (`pro`)      |          $29 + usage |            $10 |              10 |        60 minutes |           10 GiB |          90 days |
| Scale (`scale`)  |         $199 + usage |            $50 |              50 |       120 minutes |           50 GiB |          90 days |

Starter suits a person running one foreground task and one independent task. Pro supports several repositories or a small team. Scale supports a power user doing a 50-worktree sweep or a substantial batch of independent projects. These prices are launch hypotheses, not validated willingness-to-pay or profitability guarantees. The existing Pro price and concurrency are preserved. Scale adds support/storage/control-plane room while billing every execution minute and model/tool call. Included credits are usage discounts, not unrestricted compute.

All plans default to a **24-hour queue deadline**, configurable downward per request. Execution defaults to 900 seconds, or a lower customer cap, and begins at provisioning admission. Provisioning, input waits, execution and persistence occupy slots; waiting in the queue does not. Account limits are maxima, not reservations. Interactive jobs get first consideration when slots open; no running job is interrupted. Unused capacity can be borrowed. See [scheduler and scaling design](25-scheduling.md).

Purchased credits do not expire; monthly inclusion expires at its period boundary. A queued run's maximum budget remains reserved and unavailable to other work until settlement, cancellation or expiry; the UI and API expose the held amount. Queue expiry creates a failed run/event and releases funds without deleting history. Current files and terminal/accounting identities have separate retention. The public pricing page and Billing use the same `plans.ts` catalog and deployed price/credit environment settings.

For a useful upper-compute example at the existing $0.008/minute retail rate: a full 30-minute Starter job costs $0.24 compute, a 60-minute Pro job $0.48, and a 120-minute Scale job $0.96, **plus model/tools/storage where applicable**. Fifty simultaneous two-hour jobs represent $48 of retail compute, not $199 of unlimited usage. At Vercel's documented iad1 rates, fully utilized 2-vCPU/4-GB compute is roughly $0.3408/hour before other costs; 100 sandbox-hours are $34.08. Model usage, control-plane cost, outbound traffic and recovery can dominate that margin. These are arithmetic scenarios, not observed invoices. [Vercel pricing](https://vercel.com/docs/sandbox/pricing).

The subscription-plus-usage structure is consistent with established services, though products differ: [E2B Pro](https://e2b.dev/pricing) lists $150/month plus usage and 100 sandbox concurrency; [Trigger.dev](https://trigger.dev/pricing) also prices concurrency and metered execution separately. Our lower initial concurrency is an operational launch choice, not a Vercel provider limit.

| Component                | Default retail rate              | Funding behavior                                            |
| ------------------------ | -------------------------------- | ----------------------------------------------------------- |
| 2-vCPU/4-GB execution    | $0.008/minute, prorated          | Platform prepaid balance                                    |
| Managed inference        | Reviewed catalog rates           | Operator provider key; platform prepaid balance             |
| BYOK inference           | Zero platform model charge       | Exact user-selected provider key, billed by that provider   |
| Brave search             | $0.006/call managed              | Search BYOK has no platform search charge                   |
| Composio tool            | $0.003/call configurable         | Platform balance; vendor subscription also an operator cost |
| Storage beyond allowance | $0.10/GiB per fixed 30-day month | Explicit opt-in, monthly budget, unreserved credit          |

Catalog token prices are the **retail** micro-USD per million rates. Cache reads use the full input rate; Anthropic cache writes use twice that rate. OpenAI cached input is already a subset and is not added again; reported output includes reasoning. This is a disclosed retail policy, not every vendor cache discount. Set them to the desired provider price plus markup; there is no second hidden automatic 20% markup. The offline estimator uses a separately stated assumed 20% markup. Keep those inputs consistent when choosing launch prices. BYOK never falls back to a managed key. BYOK does not remove platform compute/storage or separately managed connector charges. Simulation records zero model tokens and has no provider charge.

## Financial implementation

`ledger.ts`, `model-gateway.ts`, `billing.ts` and `maintenance.ts` implement integer micro-USD accounting. JSON exposes decimal strings. Append-only balanced journals, business-event uniqueness, credit lots, reservations and debt are distinct facts. The runtime role cannot update/delete/truncate journals or payment deduplication facts; corrections append new entries. Subscription MRR, cash purchases and metered usage are not interchangeable concepts.

Admission locks the organization, reserves the run maximum and commits it with the run/outbox. Every model/tool call rechecks current actor, lease, deadline, cancellation, permitted route and remaining liability before upstream dispatch. The gateway conservatively bounds supported text/tool protocols and rejects hosted billable tools, media and unsupported passthroughs. Parallel requests cannot spend the same remaining allowance. An unsupported or unbounded route stays disabled.

Usage is read from provider protocol frames, not inferred from transcript text. Missing final usage is provisional, not zero. Input/output categories avoid counting cached or reasoning subsets twice. A provider response exceeding an authorized bound is recorded, customer charging remains capped, and a circuit breaker prevents further calls until the operator resolves it. The platform absorbs excess/recovery liability; a price cap is not a claim that every upstream bill is perfectly predictable.

Model rate snapshots are frozen at run admission. Compute covers the configured execution window; provisioning, checkpointing, failures, retained emergency snapshots and control-plane activity remain operator costs. Existing reservations protect credit until settlement. Earliest-expiring eligible credit is consumed first, unused reservations are released, and unused expired inclusion is removed by an immutable expiration journal.

Refunds/disputes after consumption can create debt. New funds repay debt before becoming available. Open disputes stop new spending and request cancellation. Reversals are capped against the same underlying funding so overlapping refund/dispute notifications cannot debit twice. Successful dispute compensation becomes a nonexpiring correction credit, deliberately favoring the customer over reinstating an already expired lot.

## Payment lifecycle

Stripe Checkout orders bind organization/customer, expected amount, kind and session ID. Webhooks verify the exact raw-body signature and deduplicate event IDs. A success redirect grants no credit. Subscription processing retrieves current provider state under the organization lock so an old notification cannot restore a cancelled entitlement. A paid recurring invoice grants one inclusion journal for its period and records funding-payment bindings. The portal handles payment methods, invoices and cancellation.

Local tests use Stripe's actual signature verifier with intercepted provider HTTP; they have not contacted a Stripe account. Before launch the operator must configure test-mode prices/portal/webhook events, exercise payment and subscription lifecycles, then complete live business/bank verification. Failed/unrecognized receipt handling remains inspectable in SQL and the provider delivery console. Redeliver the original signed event or repair its mapping; never invent a credit from a browser screenshot.

Hourly reconciliation independently compares lot remainder, debt, ledger balance and live run reservations. A mismatch sets a spending hold and records evidence. It never fabricates a correcting journal. Financial reports are read-only and include pending expiration in displayed availability. Platform usage cost is recorded customer consumption, not a reconciled provider invoice. Provider-confirmed aggregate bills, tax accounting and recognized revenue are operator accounting inputs, not implemented automatic invoice readers.

## Storage meter

Completed physical-byte inventories count retained encrypted content once per organization, including the delayed collection grace period. Raw staging and provider VM snapshots are excluded from retail storage. Proration uses integer fractional carry; a meter outage does not back-bill more than two hours of unobserved time. The customer's monthly budget and unreserved prepaid balance cap debits. Existing work is preserved even if it overshoots measured storage; subsequent admissions/writes stop after quota observation. See [persistence](03-workspaces.md).

## Offline estimator and initial budget

Run `python3 scripts/estimate-costs.py`, or `python3 scripts/estimate-costs.py --runs 10000 --byok 0.5 --csv`. All editable assumptions are in [cost-inputs.json](cost-inputs.json); [cost-scenarios.csv](cost-scenarios.csv) is generated output. The estimator never reads credentials or calls a service. Decimal tests cover token categories, BYOK, credit caps, volume scaling and memory billing increments.

The baseline assumes 1,000 monthly five-minute runs, two vCPUs/four GB, 20% CPU utilization, 40,000 uncached input and 4,000 output tokens at assumed $2/$10 per million, two $0.005 searches, no connector calls and 600 Workflow events per attempt. Six hundred is a planning allowance for bounded polling transitions and their multiple events, not a measured provider counter. Measure real event count and snapshot/data volume during the live pilot. Do not assume one Workflow event per run or token.

Additional assumptions include 100 GB retained R2 content, explicit R2 request counts, native snapshot/data retention, $75 fixed services, payment fees and maintenance/recovery allowance. The base case adds 5% additional attempts. The high case doubles duration, uses full CPU, adds 20% attempts and triples recovery allowance. These cases are sensitivity analyses, not upper bounds.

| 1,000-run scenario | Variable vendor cost | Total vendor cost | Retail usage value |
| ------------------ | -------------------: | ----------------: | -----------------: |
| Low                |              $152.31 |           $231.67 |            $176.00 |
| Base               |              $166.25 |           $265.61 |            $205.80 |
| High               |              $244.56 |           $438.92 |            $283.20 |

These assumptions show why $250–350/month can be a useful small-pilot budget and **cannot** be a scaling guarantee or profitability claim. Base retail usage alone does not cover the whole baseline. Subscription cash, included credits, payment timing, refunds/debt, taxes and actual hosting utilization matter. The script separates retail usage value from cash revenue and direct BYOK user expense. At ten times the run count, variable cost scales roughly tenfold under unchanged workload assumptions; fixed services must be revised for measured capacity.

Planning rates were reviewed September 5–6, 2026: Sandbox active CPU $0.128/vCPU-hour, provisioned memory $0.0212/GB-hour with minute granularity, creation $0.60/million, network $0.15/GB, snapshots $0.08/GB-month; Workflow events $0.02/1,000 and separate data/Function/Queue charges. Reconfirm account, region, included credit and price changes before launch. The estimator subtracts only an explicitly confirmed eligible credit, once. Vendor GB and customer GiB are different units.

Sources: [Vercel Pro](https://vercel.com/docs/plans/pro-plan), [Sandbox pricing](https://vercel.com/docs/sandbox/pricing), [Workflow pricing](https://vercel.com/docs/workflows/pricing), [R2 pricing](https://developers.cloudflare.com/r2/pricing/). Model/search/connector examples are editable workload assumptions, not a current model recommendation or guaranteed vendor quote. There are no Vercel Connect fees in this implementation because it uses direct MCP/optional Composio instead.

### Three-tier Stripe configuration

Create exactly the two approved monthly USD prices: Pro $29 and Scale $199. Configure `STRIPE_PRO_PRICE_ID` / `STRIPE_SCALE_PRICE_ID` and matching `PRO_` / `SCALE_` monthly-price and included-credit settings. Open checkouts are bound to their selected plan; choosing another tier while one is pending returns `checkout_pending` instead of silently charging for the wrong tier. A Starter owner chooses either paid plan in Checkout; a paid owner switches through the Portal. Enable only those two prices, one subscription item, quantity one, monthly interval. The server validates that shape against current Stripe state on every relevant event. Unknown prices or inactive subscriptions do not confer a paid entitlement. Never give clients an arbitrary Stripe price override.

Included credits are granted once on a paid `subscription_create` or `subscription_cycle` invoice, using its approved line's plan. Proration/`subscription_update` invoices do not mint another monthly inclusion. Upgrades can immediately gain limits after the verified subscription update; credit changes take effect on the next qualifying invoice. Prefer period-end downgrades in the Portal. If a downgrade reduces caps below current activity, existing work drains naturally; queued runs exceeding the new runtime cap fail with `execution_limit_changed` and release their reservation. Current files remain available, and existing storage-overage controls apply. Stripe test-mode Checkout, Portal switching, recurring invoices and live quota checks remain mandatory before launch.
