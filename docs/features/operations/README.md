# Usage and operator reporting

Understand product activity and execution demand through the dashboard, REST API, and a read-only management MCP. Reports use stored facts with explicit observation times and missing-source indicators.

## Organization usage

The **Usage** view shows activity charts, requests, runs, token consumption, and charges for your organization. Customer endpoints `/v1/usage` and `/v1/requests` expose authorized usage data. HTTP retries count as separate request attempts; idempotent replay does not create another run.

## Operator metrics

The **Operations** dashboard requires separately configured operator access. It provides growth, active humans and service credentials, activation, cohorts, aggregate usage, account drilldowns, and infrastructure health.

| Metric                      | Definition                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| Human DAU / WAU / MAU       | Distinct successful human product actors over rolling 1 / 7 / 30-day windows               |
| Service credential activity | Successful API-key activity, reported separately from human activity                       |
| Activation                  | An organization's first successful non-simulator run                                       |
| Execution demand            | Active runs versus ceiling, eligible backlog, oldest eligible wait, and waiting by account |
| Token usage                 | Gateway observations, including exact or provisional status                                |

Polling and page impressions do not count as human product activity. Reports use UTC and include definition version, filters, observation time, units, and missing sources. Provider invoices and live vendor quotas are not inferred from application usage.

## Management API and MCP

Operator REST lives at `/admin/v1`; Streamable HTTP MCP lives at `/admin/mcp`. Customer API keys are not accepted. Provision a separate operator client and obtain tokens for the exact resource audience.

Default scopes are `metrics:read`, `operations:read`, and `accounts:read`. Contact information additionally requires `accounts:pii:read` and an explicit request. The [MCP tool catalog](../../api/admin-mcp.json) defines available tools and REST mappings.

Tools report on growth, usage, infrastructure, accounts, requests, run diagnostics, and operating reports. They do not expose customer files, prompts, secrets, arbitrary SQL, refunds, or infrastructure mutation. Operators review recommendations and carry out changes separately.

## Reporting limits

Queries default to 30 days and support at most 366 days, with bounded dimensions and explicit truncation. Metadata and detailed run content have distinct retention policies. Missing historical observations remain missing; reports do not invent downtime data.

Native reporting needs no analytics vendor. An optional PostHog export sends a bounded metadata projection when explicitly configured. There is no browser session-replay dependency.

See [reporting implementation](implementation.md), [self-hosting](../../operations/README.md), and [scaling](../../operations/scaling.md).
