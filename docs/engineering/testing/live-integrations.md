# Live integration acceptance

These checks exercise real provider accounts through the application adapters. Model checks use synthetic inputs and disposable local PostgreSQL records; the GitHub callback check uses an explicitly authorized local dashboard account. They are separate from default CI and deployed Vercel/native-agent acceptance. The budgeted model/storage pass had a **$1 per platform** cap; the GitHub profile check used the verified free Composio plan. Provider invoices remain authoritative.

## Verified scope

| Integration | Live evidence                                                                                                                                                                                                     | Remaining acceptance                                                                                                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI      | Authenticated model lookup; `gpt-4.1-nano` Responses SSE function call and tool-result continuation; Chat Completions structured JSON; encrypted BYOK request.                                                    | Actual deployed Codex/OpenCode sessions, every enabled production model, caching, quota behavior and provider-side key revocation.                                                                                                           |
| Anthropic   | Authenticated model list; `claude-haiku-4-5-20251001` Messages SSE tool use and tool-result continuation; token counting; encrypted BYOK request.                                                                 | Deployed Claude Code/OpenCode sessions, production model matrix, caching and provider-side revocation.                                                                                                                                       |
| OpenRouter  | Authenticated key metadata and current model pricing; `openai/gpt-4.1-nano` Chat SSE tool call, tool-result JSON and encrypted BYOK request.                                                                      | Deployed OpenCode sessions, production routing/model matrix and provider-side revocation.                                                                                                                                                    |
| Composio    | Authenticated toolkit/auth-config/account discovery; application tool-catalog adapter; pinned public-tool execution; completed local GitHub consent and verified callback; one authenticated profile read returned the expected identity and a nonempty log ID through SDK 0.18.1. | Deployed callback acceptance, a narrowly granted action through the run broker, and live revocation rejection remain required.                                  |
| Resend      | The production `sendMail` branch and real SDK received HTTP 200 plus an email ID for `delivered@resend.dev`, using the provider's `onboarding@resend.dev` test sender.                                            | Set a verified production `EMAIL_FROM`; test real verification/reset links and delivery on the deployed origin. The send-only key correctly rejects domain listing with HTTP 401. Accepted email is not independent proof of inbox delivery. |
| R2          | The actual S3 adapter authenticated against the configured bucket and received `NoSuchKey` for a random nonexistent key. No customer object was read.                                                             | Write/list/signed upload/cleanup await confirmation of free Class A allowance. Browser CORS, checkpoint restore, retention and deployed end-to-end storage remain open.                                                                      |

For all three model providers, real gateway responses produced complete usage rows, zero remaining model reservations and an intact run-level reservation. Managed inference updated the run budget. BYOK used an encrypted owner-bound connection with the managed key unavailable, recorded token usage and budget consumption, and added **zero managed inference charges**. Locally revoking that connection caused HTTP 403 without another upstream request. These fixtures are dropped after the check; no customer ledger or deployed database is modified.

Public Composio tools do not require a connected account. The provider explicitly rejects creating an auth configuration for Hacker News; no resource was created by that rejected request. The separate GitHub check below exercises the application's private-account identity requirements.

## GitHub callback acceptance

The GitHub managed auth configuration requests only `read:user`, with toolkit version `20260902_00`. Auth-config retrieval and discovery identified `GITHUB_GET_THE_AUTHENTICATED_USER` with empty arguments. The signed-in local dashboard created an owner-bound connection, the user approved read-only GitHub profile access, and the real `complete_auth` return activated the connection. The dashboard shows Healthy; PostgreSQL confirms the expected owner and `identity_verified=true`. One guarded execution through the application's Composio client returned the expected GitHub login/profile URL and a nonempty log ID. It used the stored connected-account ID and the same `organizationId:userId`, version and argument mapping as the broker. Sanitized evidence and the single-attempt marker are retained in ignored `.data/composio-callback/`; no credentials or full private profile payload were recorded.

The development project has a saved public HTTPS verifier pointing to a callback-only relay. Six synthetic local checks verified rejected dashboard/API paths, rejected POST/duplicate session parameters, fixed-origin redirects and correct parameter encoding; an external HTTPS request also returned the expected local redirect. The public tunnel does not expose the dashboard. Tunnel inspection is disabled. The application still verifies its signed browser state and current identity after the redirect. The tunnel and relay are temporary local processes and must remain running for new authorizations.

Live HTTP inspection revealed that cloning Next.js's proxied request throws before authentication. Both Composio handlers now construct the authentication request from public URL, method and header fields. The existing identity/replay test now uses proxied requests: it failed against the original implementation and passes after the fix, including wrong-user denial, one-time callback use and verified account activation against deterministic fixtures. All 10 focused Composio/connection tests pass with disposable PostgreSQL; strict TypeScript and an isolated production build also pass. The rebuilt server returns 200 for health, 401 for unauthenticated install and 400 for a callback without signed state. The local preview was reloaded with callback verification enabled; paid agent execution remains disabled.

The Composio dashboard confirmed the free Hobby plan before execution. A request guard allowed only tool metadata and one execution of the selected profile tool, disabled retries, and recorded the attempt before sending. The check did not launch an agent, enable paid execution, change grants, or mutate customer financial records. Deployed callback behavior, a granted action through the run broker, and live revocation rejection remain separate acceptance steps.

## Spending and request limits

The recorded pass made four OpenAI inference calls, five Anthropic inference calls plus two free token-count calls, three OpenRouter inference calls, one Composio public-tool execution, one Resend test send and one R2 read. The later GitHub callback check added exactly one free authenticated profile execution. Metadata requests are additional. Anthropic's first pass reached both inference endpoints successfully but a test assertion incorrectly counted token counting as billable; the corrected three-request sequence passed. No provider account was upgraded, funded or deployed.

Observed successful gateway records estimate OpenAI at $0.000033 and OpenRouter at $0.000020. The retained Anthropic successful pass and BYOK records total $0.001586; the earlier completed inference pair is additionally covered by the conservative ceiling. The persistent request ceilings for the complete pass are **$0.08 OpenAI, $0.10 Anthropic, $0.06 OpenRouter, $0.01 Composio, $0.01 Resend and $0.36 R2**, all below the authorized cap. These ceilings are test safeguards, not reported vendor charges. The early Composio SDK calls were explicitly reconciled into the journal after discovering that its client captures `fetch` at construction; the reusable harness now installs its guard before constructing the SDK, including its execution client.

The small models were selected using current [OpenAI pricing](https://developers.openai.com/api/docs/models/gpt-4.1-nano), [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) and the authenticated/public [OpenRouter catalog](https://openrouter.ai/api/v1/models). They are acceptance fixtures, not automatic additions to the production model catalog. The Composio action uses a public, non-premium toolkit; [Composio pricing](https://composio.dev/pricing) separates ordinary calls, direct-execution add-ons and premium tools. Resend's [documented test recipient](https://resend.com/docs/dashboard/emails/send-test-emails) avoids sending a message to a person.

R2 rounds usage up in billing units. After the free allowance, a new Class A unit costs **$4.50**, while a Class B unit costs **$0.36**. A tiny write cannot be assumed to fit a $1 cap. Confirm at least 25 free Class A requests remain before enabling the write suite. [R2 pricing and rounding](https://developers.cloudflare.com/r2/pricing/).

## Run the checks deliberately

Use the root local simulation profile and existing provider keys. Start the normal local PostgreSQL/SMTP infrastructure first. Do not change `.env` to production or globally enable paid execution. Each command below is opt-in and can incur provider usage; review prices, credentials and the remaining journal budget before running it.

```sh
LIVE_API_TESTS=1 pnpm test:live metadata
LIVE_API_TESTS=1 pnpm test:live models
LIVE_API_TESTS=1 LIVE_BILLING_MODE=byok pnpm test:live models
LIVE_API_TESTS=1 pnpm test:live composio
LIVE_API_TESTS=1 pnpm test:live resend
# Only after confirming the stated free R2 allowance:
LIVE_API_TESTS=1 LIVE_R2_FREE_CLASS_A=1 pnpm test:live r2
```

Set `LIVE_PLATFORMS=anthropic` (or a comma-separated subset) to repeat only selected model checks. `EMAIL_FROM` chooses Resend's verified sender; its absence uses the explicit provider test sender and cannot qualify production email readiness. A send-only key need not be replaced with an administrative key merely to make domain listing pass.

[The runner](../../../scripts/test-live.ts) creates a fresh local database and object directory for model checks, runs migrations there, enables production adapter branches only inside the child process, and drops fixtures afterward. It never launches a paid sandbox. [The spending guard](../../../scripts/live/guard.ts) reserves conservative request ceilings before sending, retains uncertain attempts, bounds metadata attempts and fails closed on a corrupted or locked journal. The ceiling is cumulative across invocations in `.data/live-checks/budget.json`; do not delete/reset it to bypass the authorized budget. A lock left by an interrupted process needs inspection before removal. Test ceilings do not enforce pricing for arbitrary newly substituted models or tools: review the fixed fixture and its bound together.

Sanitized reports and any owned object keys are kept under ignored `.data/live-checks/`, with owner-only permissions. Secrets, authorization headers, signed upload URLs and private account payloads are not report data. SDK metadata retries are disabled where supported; execution requests use the SDK's no-retry client and the guard covers its captured transport. The R2 suite writes only two random synthetic keys, exercises exact-size validation, and removes only those keys in `finally`. A killed process can require cleanup of the recorded owned keys.

## Regression evidence and release gates

Offline regressions cover the observed Anthropic/OpenRouter usage envelopes across fragmented transport chunks, unmetered token counting, encrypted BYOK and revocation, the real Resend SDK's success/rejection/interruption mapping, the real Composio SDK's request/response transformation, and spending/redaction guards. They use fake credentials and intercepted transports; CI never opts into live calls. **48 tests across seven focused suites pass**, including existing auth recovery, tool broker and direct-upload checks. Strict TypeScript, scoped formatting, whitespace and documentation checks pass.

The focused verification command is:

```sh
pnpm test:domain tests/unit/live-budget.test.ts tests/unit/email-provider.test.ts tests/integration/gateway.test.ts tests/unit/composio-config.test.ts
pnpm check
python3 scripts/check-docs.py
```

These results supplement the [coverage report](coverage.md), without replacing it or claiming a new aggregate percentage. Finish the [pre-deployment checklist](../../operations/pre-deployment.md) for HTTPS callbacks, native harnesses, bucket policy/CORS, real email journeys, quotas and reconciliation. A successful provider adapter check alone does not establish a deployable release.
