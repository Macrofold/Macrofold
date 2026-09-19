# Detailed billing usage

Retrieve model tokens and itemized usage charges for any explicit time interval. Use this to show costs in your application, attribute usage to a customer or workspace, or reconcile a run's charges. It works independently of Langfuse.

## Make your first request

Use an API key with `usage:read` and **no workspace restriction**. This is the same organization-level authorization required by the balance and aggregate usage endpoints. Keep the key on your server. Set `MACROFOLD_BASE_URL` to your deployment origin and `MACROFOLD_API_KEY` to a key from that deployment.

```sh
curl --get "$MACROFOLD_BASE_URL/v1/billing/usage" \
  --header "Authorization: Bearer $MACROFOLD_API_KEY" \
  --data-urlencode 'from=2026-09-01T00:00:00Z' \
  --data-urlencode 'to=2026-10-01T00:00:00Z' \
  --data-urlencode 'limit=100'
```

The response has `from`, `to`, `currency: "USD"`, `data`, and `next_cursor`. Each entry has a stable `id`, `kind`, `occurred_at`, `charged_micro_usd`, and applicable run/workspace/worktree/session/customer identifiers. All money and token counts are decimal strings. `1000000` micro-USD equals $1; use integer/decimal arithmetic rather than floating-point accumulation.

The TypeScript SDK exposes `client.billing.listUsage({ from, to, ...filters })`; Python exposes `client.billing.list_usage(from_=..., to=..., ...)`. All five generated SDKs and the customer MCP share the same contract. See the [method reference](../api/sdks/reference.md) or your deployment's `/openapi.json` for complete typed fields.

## Filter and paginate

Both `from` and `to` are required RFC 3339 timestamps with a time zone. The start is inclusive and the end exclusive. There is no fixed maximum interval length. Invalid or reversed intervals return HTTP 400.

| Optional filter                                      | Selects                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| `workspace_id`, `worktree_id`, `run_id`, `session_id` | Exact resource ID; `worktree_id` is the API name for a worktree     |
| `customer_id`, `agent_key`                           | Customer-agent integration binding, when present                     |
| `provider`, `model`                                  | Exact provider/model; sandbox compute also has a provider               |
| `billing_mode`                                       | `managed` or `byok` funding for the associated run                   |
| `kind`                                               | `model`, `tool`, `compute`, or `storage`                             |
| `limit`, `cursor`                                    | Page size (default 25, maximum 100) and returned continuation cursor |

Filters combine with AND. A customer label alone can match multiple bindings in your organization; add a workspace or run ID when you need one binding. Unknown/foreign resource IDs return an empty list, not another tenant's records. Storage is organization-level and is excluded when a resource, customer, agent, or billing-mode filter is supplied.

Follow `next_cursor` with the **same interval and filters** until it is null. Records sort by descending opaque record ID, not chronological `occurred_at`; do not construct cursors or infer dates from IDs. Pages are live reads, not a frozen export. Late settlement can add records to a previously queried interval, so reconciliation should reread that interval and upsert/deduplicate by entry `id`.

## Interpret charges and tokens

| Entry kind | Time used for filtering      | Detail                                                                                                                                                                                                     |
| ---------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`    | Model usage settlement       | `model_usage`: request ID, input/output tokens, cached-input/cache-write subsets, completeness, provisional status, reserved ceiling, budget consumption, reported retail cost and known provider estimate |
| `tool`     | Tool admission               | Fixed fee and `tool`: name, connection ID and current outcome status; fees can apply to ambiguous or failed actions                                                                                        |
| `compute`  | Run or sandbox journal settlement | Run compute remainder, or a separate sandbox allocation charge with `sandbox_id`; emitted only when positive                                                                                                                   |
| `storage`  | Storage meter observation    | `storage`: physical bytes and object count, including zero-charge observations                                                                                                                             |

Sum **`charged_micro_usd` only**, across all pages, to obtain Macrofold usage charges in the interval. Model/tool usage can appear before the run's prepaid reservation settles. Compute appears at final settlement. [Reusable sandbox](../execution/sandboxes.md) compute settles on pause/destroy and carries `sandbox_id`, workspace and worktree identifiers, with a null run ID. Session/run/customer/agent/billing-mode filters exclude shared sandbox compute; workspace/worktree filters include it. Runs borrowing a sandbox do not charge its compute again. There is no duplicated whole-run total among these line items. These are usage accruals, not payment history, subscription invoices, current reservations or provider invoices; `GET /v1/billing` returns balances/reservations and `GET /v1/usage` supplies aggregate operational metrics with its own time semantics.

`model_usage.input_tokens` includes cached reads and writes once. The cache fields are subsets: do not add them to input again. Output includes reported reasoning-token subsets. Unknown token counts are null; do not turn them into zero. `provisional: true` means the existing conservative settlement used the reserved ceiling because final usage was unavailable. `bound_breached` identifies reported usage beyond the authorized ceiling.

A BYOK model's `charged_micro_usd` is `"0"`; `budget_cost_micro_usd` still measures its run-budget consumption. `provider_cost_micro_usd` is a separate estimate when rates are known, with `provider_cost_status: "estimated_from_usage"`; otherwise it is null/`"unavailable"`. Neither is an extra Macrofold charge. Missing per-call detail remains null, including simulator records without a gateway reservation.

Full prompts, responses, file contents and credentials are excluded. Use authorized run history or your operator's [tracing backend](../observability/README.md) for content. Financial records survive detailed-history expiry; customer labels depend on the retained integration binding.

## Brief for a coding agent

> Integrate `GET /v1/billing/usage` using a server-held Bearer key with `usage:read` and no workspace restrictions. Supply `from` inclusive and `to` exclusive as RFC 3339 timestamps. Optional AND filters: `workspace_id`, `worktree_id`, `run_id`, `session_id`, `customer_id`, `agent_key`, `provider`, `model`, `billing_mode`, `kind`. Page with `limit` (1–100) and `next_cursor`, preserving the filters. Entries itemize model/tool/compute/storage charges and model input/output/cache token counts. Sum decimal-string `charged_micro_usd` using integer arithmetic; divide by 1,000,000 for USD. Preserve null/unknown usage, distinguish provisional settlements, and never add BYOK provider estimates or budget consumption to Macrofold charges. Reread completed windows for late settlement, deduplicating by entry ID. Read the deployment's `/openapi.json` for the exact schema.
