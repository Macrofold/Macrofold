# Usage and operator reporting

Understand product activity and execution demand through the dashboard, REST API, and a read-only management MCP. Reports use stored facts with explicit observation times and missing-source indicators.

## Organization usage

The **Usage** view shows activity charts, requests, runs, token consumption, and charges for your organization. Customer endpoints `/v1/usage` and `/v1/requests` expose authorized usage data. Retained HTTP retries are separate request observations; idempotent replay does not create another run. Request collection is best effort and can be disabled by the operator. Counts describe retained observations, so an empty request list does not establish zero traffic. Run, token and charge accounting use their own authoritative records.

## Operator metrics

The **Operations** dashboard requires separately configured operator access. It provides growth, active humans and service credentials, activation, cohorts, aggregate usage, account drilldowns, and infrastructure health.

| Metric                      | Definition                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| Human DAU / WAU / MAU       | Distinct successful human product actors over rolling 1 / 7 / 30-day windows               |
| Service credential activity | Distinct service keys in retained successful request observations; may be incomplete       |
| Activation                  | An organization's first successful non-simulator run                                       |
| Execution demand            | Active runs versus ceiling, eligible backlog, oldest eligible wait, and waiting by account |
| Token usage                 | Gateway observations, including exact or provisional status                                |

Polling and page impressions do not count as human product activity. Reports use UTC and include definition version, filters, observation time, units, and missing sources. Provider invoices and live vendor quotas are not inferred from application usage.

## Management API and MCP

Operator REST lives at `/admin/v1`; Streamable HTTP MCP lives at `/admin/mcp`. Customer API keys are not accepted. Provision a separate operator client and obtain tokens for the exact resource audience.

Default scopes are `metrics:read`, `operations:read`, and `accounts:read`. Contact information additionally requires `accounts:pii:read` and an explicit request. The [MCP tool catalog](../../api/admin-mcp.json) defines available tools and REST mappings.

Tools report on growth, usage, infrastructure, accounts, requests, run diagnostics, and operating reports. They do not expose customer files, prompts, secrets, arbitrary SQL, refunds, or infrastructure mutation. Operators review recommendations and carry out changes separately.

## Reporting limits

Queries default to 30 days and support at most 366 days, with bounded dimensions and explicit truncation. Metadata and detailed run content have distinct retention policies. Missing historical observations remain missing; reports do not invent downtime data. Request-derived metrics retain their names and observed values but use `status: "insufficient_data"` and `missing_sources: ["request_observations"]` because they are not complete traffic totals. Current collection settings do not establish the policy used throughout a historical interval.

Native reporting needs no analytics vendor. An optional PostHog export sends a bounded metadata projection when explicitly configured. There is no browser session-replay dependency.

See [reporting implementation](implementation.md), [self-hosting](../../operations/README.md), and [scaling](../../operations/scaling.md).

## Optional request observations

Self-hosted operators can set `REQUEST_ANALYTICS_ENABLED=false` to skip HTTP request observations and `API_PRODUCT_EVENTS_ENABLED=false` to skip successful API-operation product events. Both default to true. Restart the web application and workers after changing startup settings. Retained observations remain readable after disabling collection. These controls do not disable authentication, rate limits, operator audits, human actor activity, durable registration/organization/run milestones, billing or Run replay. PostHog export remains a separate choice.
