# Billing, budgets, and limits

Plans set organization limits. Usage consumes prepaid credits; BYOK lets your model provider bill model usage directly.

## Plans

These are the application defaults. A hosted operator can configure subscription prices and included credits; the deployment's pricing page and account policy are authoritative.

| Plan    | Monthly subscription | Included credits | Concurrent runs | Maximum execution | Storage | Detailed run history |
| ------- | -------------------- | ---------------- | --------------- | ----------------- | ------- | -------------------- |
| Starter | $0 + usage           | $0               | 2               | 30 minutes        | 1 GiB   | 30 days              |
| Pro     | $29 + usage          | $10              | 10              | 60 minutes        | 10 GiB  | 90 days              |
| Scale   | $199 + usage         | $50              | 50              | 120 minutes       | 50 GiB  | 90 days              |

Starter's API plan identifier is `payg`. Owners and admins can set lower organization concurrency and runtime limits. Concurrency is a maximum shared across projects, not an immediate-start guarantee. One writer per workspace still applies.

## Run budgets and reserved credits

A run declares its maximum cost as a decimal string in micro-USD: `1000000` is $1. The platform reserves its budget when accepting the run. Reserved funds are unavailable to other work until settlement or release.

A queued run can hold its reservation for up to the selected queue deadline, defaulting to 24 hours. Cancellation or expiry before execution releases it. Completed or failed execution settles consumed usage and releases the remainder. A failure is not necessarily free.

## Managed funding and BYOK

Managed inference uses configured platform credentials and the published model rate card. With BYOK, model requests use your encrypted provider connection and incur no platform model charge. Compute, storage, and authorized tools can still consume platform credits. The model provider's own invoice remains authoritative for its charges.

Revoked or unavailable BYOK credentials cause an error; they never silently switch to managed funding. Configure provider-side spending limits as well as a run budget.

## Storage and retention

Storage overage is disabled by default. An owner can enable it with a monthly budget and prepaid balance. The default rate is $0.10 per GiB per 30-day month. Storage is measured periodically; accepted work can finish preserving files before subsequent writes are blocked for exhausted allowance.

Detailed run history expires separately from current project files, retained checkpoints, native session state, and accounting. Purchased credits do not expire; included subscription credits expire at the paid period's end.

See [usage reporting](../operations/README.md), [workspaces](../workspaces/README.md), and [accounting implementation](implementation.md) for more detail.
