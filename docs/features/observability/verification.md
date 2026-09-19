# Tracing verification

This record covers the execution-tracing change and its limits. No production deployment or customer data was used.

## Live API acceptance

On September 19, 2026, the opt-in fixture sent two real OpenRouter Jev requests through the public SDK, loopback API, durable inference executor and Langfuse OTLP exporter. A third customer-agent run used the simulator with real Langfuse export. Every fixture owned a disposable database and files; no preview account was modified.

The modern Langfuse observations API returned all three traces. The audit verified exactly one logical agent root per trace; generation/tool parent IDs; environment `verification`; common organization/workspace/run metadata on every observation; and meaningful root/generation inputs and outputs. The customer trace additionally verified customer/binding/worktree metadata and shared session identity on all nine observations, including two tool calls.

Managed Jev used 731 input and 41 output tokens, with a 31 microUSD Macrofold charge and separately labeled provider estimate. BYOK used 698 input and 17 output tokens, with zero Macrofold model charge and a 30 microUSD provider estimate/budget cost. Trace cost aggregation matched the run charge without parent/event double counting. Neither Langfuse nor model credentials appeared in the returned observations. These are tiny synthetic requests, not invoice reconciliation or scale testing.

Ignored local evidence lives in `.data/live-checks/` and `.data/tracing/`. API readback used the official Langfuse CLI's `observations list` command scoped to fixture trace IDs; all returned pages were checked. The trace-quality review used current Langfuse guidance on observation types, nesting, usage/cost, metadata, tags, user/session identity and environment separation. The final readback also verified the explicit service name on every observation and one transient raw provider response per Jev call. That response is exported without extending SQL recovery storage.

## Repeat the opt-in fixture

Configure the three Langfuse variables and `OPENROUTER_API_KEY` privately in `.env`. Use the unpaid local simulator profile and a disposable-test-capable PostgreSQL owner/runtime pair.

```sh
LIVE_API_TESTS=1 pnpm test:live tracing
```

This command permits exactly two fixed Jev requests with a $0.002 ceiling each, plus a free simulator customer run. The existing live-test journal reserves the ceiling before each model request. Do not reset the budget journal to bypass its limit. Ordinary `pnpm test:live decisions` and default test suites do not export traces.

Use the trace IDs in the reports to verify export through Langfuse's observations API; a successful model fixture alone does not prove backend ingestion. With credentials loaded into your shell's environment, a bounded CLI read is:

```sh
npx langfuse-cli api observations list \
  --trace-id YOUR_FIXTURE_TRACE_ID \
  --fields core,basic,time,io,metadata,model,usage,trace_context \
  --limit 100 --json
```

## Automated checks

The focused tests cover the official SDK's actual exported attributes and root relationships, tenant-separated deterministic IDs, cache-token accounting, content opt-out/redaction/truncation, bounded exporter failure, application-log privacy, after-commit/rollback semantics, customer attribution, streamed gateway output and charge, rejected/interrupted provider requests, and decision input/output/settlement. Fixture export is disabled unless the specific live tracing group opts in.

Final verification passes 1,092 tests across 129 files with all existing coverage gates: 50.68% statements, 44.62% branches, 42.83% functions and 51.89% lines across the repository-wide domain denominator. Strict TypeScript/SDK checking, the optimized standalone build, generated public documentation checks and the production dependency audit also pass (zero known advisories). A scan of the final 92 browser assets found no configured Langfuse keys.

The isolated optimized application journey passes the browser decision/receipt/task-lineage flow and accessibility scan, six CLI subprocess cases, real terminal submission/continuation/detach, and Python SDK session continuation. The preview's port and data were preserved. The final transient response hook additionally passed the full domain suite, provider-protocol tests, live API audit and a fresh optimized build. No new UI behavior was introduced.

Coverage measures exercised source, not live provider guarantees.

## Background export and itemized billing follow-up

The Workflow regression keeps export unresolved while two execution phases finish, checks that tracing lifecycle failures do not replace execution errors, and verifies request exports are registered after the complete response. A synthetic observation also passed through the actual `flushTracesInBackground` helper and Langfuse exporter with a local host-task collector. The helper returned while export was pending. Official CLI readback confirmed the [background verification trace](https://us.cloud.langfuse.com/project/cmu8jfl7i0eriad0ckm2dy8hk/traces/730b0be7e8c8bf2669835f4cfaf46f5d), one agent root, workspace/worktree/customer/session metadata, meaningful input/output and no credentials. This probe used no model calls; it verifies real ingestion, not hosted lifecycle retention.

The [billing usage endpoint](../billing/usage.md) is tested through the actual loopback HTTP API and typed SDK against disposable PostgreSQL. Tests reconcile disjoint charges, distinguish BYOK estimates from charges, preserve unknown tokens, enforce tenant/scope/revocation restrictions, combine filters, paginate without duplicates and verify inclusive/exclusive boundaries down to database timestamp precision. Synthetic financial runs are settled and removed from the scheduler before other suites use the shared fixture database.

The final domain regression passes 1,109 tests across 131 files and all coverage gates (50.82% statements, 44.74% branches, 42.95% functions and 52.01% lines). All five generated SDK acceptance suites pass, including 194 Python tests and Pyright, Go transport tests, 15 Rust tests, and 12 Java tests. The optimized standalone application builds and passes the browser decision/receipt/accessibility journey, six CLI subprocess tests, real-terminal continuation/detach and Python session continuation. Documentation checks pass for 62 public pages; the production advisory scan reports zero known findings and the declared-license graph remains at 1,296 entries. No running preview or hosted application database was modified.

## Remaining deployment acceptance

Configure the same region/workspace keys in the deployed web application and every worker. Verify hosted request/stream `after()` flushing, Workflow step flushing, shutdown behavior, customer filtering, and one native run plus continuation. Exercise a tracing outage while checking that normal completion and billing remain intact. Confirm access/retention and the separate deletion policy. The [release TODO](../../maintainers/TODO.md) tracks these unverified gates.
