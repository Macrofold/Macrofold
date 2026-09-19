# Customer-agent foundation verification

This record covers ranks 1–10 in the [improvements tracker](../../product/improvements.md): customer identity guidance, persisted connector setup, the landing-page story, trigger quotas, optional file memory, the runnable personal-agent app, compatible OpenRouter discovery, template-to-schedule setup, external-data recipes and application-owned identity helpers. It records local acceptance on September 11, 2026. Deployment and vendor acceptance remain separate.

## Implementation ownership

| Boundary | Owner and design decision |
| --- | --- |
| Customer identity and lifecycle | [Reference app](../../../examples/personal-agent/README.md): application-owned records and SDK composition. The platform Agent remains a preset; no customer aggregate, general workflow engine or new production ORM was introduced. |
| Memory convention | [Shared starter](../../../examples/shared/file-memory.ts) and [guide](../../features/customer-agents/memory.md): configurable ordinary files, validated task data, provenance, correction and forgetting instructions. Instructions do not guarantee model behavior or erase retained history. |
| Connector deployment policy | [Core setup](../../../packages/core/src/connector-setup.ts), [provider adapter](../../../packages/providers/src/connector-setup.ts), [operator command](../../../scripts/connector-setup.ts): persisted exact version/auth-config choice, provider port, serialized setup, no SQL transaction spanning provider I/O, and no blind retry of ambiguous creation. |
| Saved-trigger capacity | [Quota policy](../../../packages/core/src/trigger-quota.ts), [operator command](../../../scripts/trigger-quota.ts), migration 033: default plus optional organization override, serialized creation, organization-wide counts and unchanged delivery/spending/concurrency limits. |
| Model admission | [Model policy](../../../packages/core/src/model-policy.ts): compatible text/tool routes and known billing dimensions. Native protocols, discovery, prices and account entitlements remain separate. |
| Schedule experience | [Dashboard guide](../../features/triggers/scheduled-tasks.md): saved preset/budget handoff, explicit workspace, cadence/timezone, current tool-access review and advanced delivery controls. Shared form layouts avoid special-purpose styling. |
| External data | [Recipes](../../../examples/integrations/README.md): a small customer-scoped data port, Supabase RLS, actual generated Prisma client, Pinecone namespaces and the official MCP transport. Credentials and customer authority stay server-side. |
| Documentation distribution | Explicit entries in [the publication manifest](../../navigation.json) publish the guides and selected example READMEs as HTML, search results and Markdown. Example source directories are not crawled indiscriminately. |

## Verification results

All application acceptance used separate builds, disposable PostgreSQL/object fixtures, loopback servers and the simulator. Existing local preview resources were preserved. No paid inference, external connector action or cloud deployment was performed.

| Check | Observed result and scope |
| --- | --- |
| Complete domain suite and coverage | 897 tests in 110 files passed. All existing global/module gates pass: 48.31% lines, 47.31% statements, 41.33% branches and 38.80% functions. Thresholds and source inventory remain unchanged. |
| Focused domain tests | 135 tests in 13 files passed, followed by 15 documentation/example regression tests. These overlap the complete suite and are not additional unique tests. |
| Five SDKs | `pnpm test:sdks` passed actual local API/simulator journeys and language-specific checks for TypeScript, Python, Go, Rust and Java. Python: 161 tests and zero Pyright errors. All five generated clients include the typed trigger quota response. |
| Browser journeys | Initial 28-case scope: 27 passed and one documentation-search failure. The corrected follow-up passed all 11 documentation, personal-agent and trigger cases. The final form-layout follow-up passed all four trigger cases. This covers 28 distinct journeys across source-specific runs, not one clean initial invocation or the entire browser inventory. |
| Terminal and Python HTTP | Both final application follow-ups also passed all six built CLI tests, real PTY input/queue/status/detach, and Python scoped identity/files/SSE/continued-session execution. |
| Prisma | The separate package's generated Prisma 7.10.0 client passed an actual disposable SQLite two-customer query test. Its complete isolated dependency audit found no known vulnerabilities. This audit does not cover or clear the root worktree's existing advisory. |
| Types and build | Strict TypeScript passed. Isolated optimized Next.js builds passed for browser acceptance. SDK generation completed for all five languages. |
| Public documentation | All six documentation browser/API journeys passed, including every published HTML/Markdown page, sitemap, mobile accessibility, copy/error recovery and execution of the published cURL/Python examples. Generation/checks pass for 52 public pages, 179 Markdown files and 54 requirement mappings. |
| Visual review | Inspected the schedule review, scheduled-task list, reference app, and customer-story section at desktop/mobile widths. Reused the stacked form after detecting an overly narrow prompt/review layout. The reference app's axe audit passed. |

The search regression exposed a ten-result cutoff that hid relevant API guidance after adding example guides. Search now ranks matching headings as well as titles and returns all matching guides; the empty-query discovery list remains short. The complete domain run also caught a discovery unit fixture still depending on the removed environment-based version configuration; it now supplies persisted setup through the existing boundary. Integration tests separately exercise that setup against PostgreSQL.

### Evidence locations

Local logs and coverage are ignored artifacts, not files to publish:

- `/tmp/agentcloud-top10-coverage-final.log`; `coverage/top10-domain/`.
- `/tmp/agentcloud-top10-sdks.log` and `/tmp/agentcloud-top10-sdk-generate.log`.
- `/tmp/agentcloud-top10-browser-final.log`; `coverage/top10-followup/`.
- `/tmp/agentcloud-top10-layout-final.log`; `coverage/top10-layout/`.
- `/tmp/agentcloud-top10-prisma-test.log`, `/tmp/agentcloud-top10-prisma-audit.log`.
- `/tmp/agentcloud-top10-check-final.log`.
- `test-results/template-schedule-review.png`, `test-results/personal-agent-example.png`, `test-results/scheduled-tasks.png`.

Connector enablement, trigger quota and model policy have 100% branch coverage; core connector setup has 93.10%, and its provider adapter 93.33%. These are in-process measurements, not live-provider guarantees. The separate example source is tested behaviorally but is not part of the existing application coverage inventory.

Each isolated application directory retains `build-sources.json` and separate browser/server/worker/CLI observations. These runs were not merged into a new aggregate application/native coverage score. Native images, live vendor behavior, mutation scores and hosted CI were not reaccepted for this change.

Source-manifest SHA-256 values for the passing application follow-ups:

- `coverage/top10-followup/build-sources.json`: `7231a8e1ddac557720a558c26250d5a43a9baff5be27310f851946ae77ce958d`.
- `coverage/top10-layout/build-sources.json`: `bc3604c83955f402ec2ee4f8a6a45b88c00050c5c47550369e4b2711bfc59751`.

## Reproduce

Use Node 24 and the [test prerequisites](../../../TESTING.md), with the SDK toolchains installed. Choose a fresh application evidence directory:

```sh
pnpm check
pnpm test:coverage
pnpm test:sdks
COVERAGE_DIR=coverage/customer-agents-review pnpm test:dashboard:isolated \
  tests/browser/dashboard.spec.ts tests/browser/landing.spec.ts \
  tests/browser/docs.spec.ts tests/browser/triggers.spec.ts \
  tests/browser/personal-agent-example.spec.ts
pnpm --dir examples/integrations/prisma --ignore-worktree install --frozen-lockfile
pnpm --dir examples/integrations/prisma --ignore-worktree test
pnpm --dir examples/integrations/prisma --ignore-worktree audit --audit-level high
pnpm docs:generate
pnpm docs:check
```

The Prisma recipe has its own package and lockfile so adopting the platform does not install an unused ORM. Preserve `--ignore-worktree` for its audit; otherwise pnpm audits the parent worktree. Full domain tests include local Supabase-style RLS and the actual MCP HTTP transport. Scripted upstream responses verify request/response shapes, not vendor availability.

## Migration and local preview

Migration **033_product_setup.sql** creates deployment connector setup and trigger policy, plus the nullable organization quota override. Fresh fixture installation and restricted-role tests verify the tables and permissions. Runtime credentials can read deployment policy but cannot administer it. Apply migrations with the owner identity, then run the documented [connector setup](../../features/identity-integrations/composio.md) and [quota commands](../../features/triggers/README.md#capacity). Setup is a deployment concern; customer account authorization and tool grants remain separate.

The existing local preview was explicitly verified to use the loopback development database before applying the migration. Its one reviewed GitHub configuration was inserted into the new table without overwriting an existing row or calling the provider. The application no longer reads the old per-toolkit environment maps; no runtime compatibility layer was added. Other deployments must configure their own intended toolkit pins/auth configurations. This is local activation evidence, not a staging or production migration rehearsal.

## Deliberate limits and next acceptance

- The reference app is a single-process, loopback-only simulator with an explicit demo identity adapter. Real customers require application authentication/TLS, customer rate/spend policy, retention/export decisions, and replacing the store and local lock together when adding multiple instances. The app documents these seams instead of introducing a speculative distributed framework.
- Optional memory remains ordinary files. Semantic memory guarantees, universal task scheduling, multi-agent orchestration, fleet controls and cross-harness native-history migration are later product decisions.
- OpenRouter admission currently requires known text/tool capabilities, compatible billing, at least 128,000 context tokens and 8,192 output tokens, matching existing runtime settings. Supporting smaller/unknown limits requires per-model runtime configuration. Discovery does not establish account entitlement or successful native execution on every harness.
- Persisted connector setup needs live HTTPS consent, exact pinned tool execution and revocation acceptance. An ambiguous managed-auth creation remains pending until provider discovery or explicit operator selection confirms the existing result.
- Supabase and Pinecone recipes require separately configured hosted credentials, two-customer isolation checks and explicit external usage allowance. Local RLS/protocol fixtures and Prisma's actual local query are the evidence established here.

The [maintainer checklist](../../maintainers/TODO.md) owns these release checks. They are not hidden feature claims or an authorization to deploy or spend.
