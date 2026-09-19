# Named connection implementation and acceptance

Start with the [feature guide](../../features/identity-integrations/named-connections.md). This record separates working named-account management from the proposed Claude authentication arrangement. No paid or subscription executions are authorized for this work.

## Implemented boundaries

- Composio Connect Link uses `allowMultiple: true` and the immutable local connection UUID as its unique alias. The editable display name stays local. Existing direct tool execution always supplies `connectedAccountId`; no session's most-recent-account default selects credentials.
- Reconnect uses the installed SDK's connected-account refresh operation. It preserves the provider account ID and invalidates older pending local attempts. Callback completion verifies the returning user, organization, latest attempt, toolkit, account ID, active status and disabled state. Connection row locks serialize rename, authorization completion and disconnect.
- Credentialless edits preserve connection health. Account responses expose only the verified account identifier, never the Composio response's credential state.
- Claude configuration records use the existing owner-bound connections resource. Presets use the existing provider connection field and Claude Code harness. Typed contracts are generated for all five SDKs; CLI `run --agent` preserves preset authentication and untouched limits.
- Claude authentication and execution fail closed. Neither the authorize endpoint nor the native worker can start subscription work. A recovered queued subscription fixture fails through ordinary settlement, retaining history and releasing its reservation. The model gateway cannot interpret a subscription funding mode as authorization to use a managed key.
- Backup policy requires an owned, healthy Anthropic API-key connection, an explicit enable decision, and a positive per-run ceiling. Disabling it clears its selection. The deterministic decision function includes spent and in-flight reserved amounts. **No automatic fallback executes today.**
- Native checkpoint capture excludes known Claude, Codex, and OpenCode authentication paths, native configuration, and Claude configuration backups. Restore rejects authentication entries before writing anything. The cloud phase engine filters them before restore hydration and before output chunk transfer. Native conversation history still persists separately from workspace files.

No new service, queue, database table, or recurring provider request is introduced. Composio authorization/health operations use bounded metadata calls; the toolkit's existing commercial terms still govern connector execution.

## Claude arrangement requiring approval and implementation

The isolated PoC proved native subscription inference, a file write, same-session continuation in a replacement container, and overlapping execution sharing one authentication volume. It did not prove the complete Macrofold journey, independent-account isolation, refresh rotation, upstream revocation, fallback, or permission to offer hosted subscription access. Its four-task authorization is exhausted.

Anthropic distinguishes hosting unmodified Claude Code from offering/intermediating Claude.ai login in another product. Obtain written confirmation for this exact SDK/API/scheduled-execution arrangement **before implementing credential collection or enabling hosted subscription authentication**. A native login volume is not by itself an approved hosted credential broker. [Claude Code legal guidance](https://code.claude.com/docs/en/legal-and-compliance), [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview).

The remaining design must preserve these boundaries:

1. Native Claude Code owns login and refresh. No token-paste form, custom OAuth exchange, or modified binary. Authentication remains separate from workspace paths, session checkpoints, Git, exports, forks, and ordinary sandbox snapshots.
2. Same-UID tools can read private files and process environments. Mode 0600 is insufficient. Validate a separate native controller identity and a narrowly scoped worktree-tool bridge, with built-in tools, hooks, plugins, repository startup behavior, and subprocess access explicitly constrained. Keep the existing Claude adapter; do not duplicate harness implementations per account.
3. If Anthropic permits encrypted minimal native-state persistence, bind it to organization, owner, connection and credential generation. Checkout requires exclusive account ownership through execution; an expired process lease is not proof that the old native process has stopped. Confirm termination before another writable checkout. Different accounts have separate stores and leases.
4. Reconnect and disconnect advance the credential generation. An old sandbox cannot publish refreshed state over a newer generation. Publish and release must be fenced and idempotent. Local revocation must stop further model/tool effects, separately from best-effort upstream revocation. Recovery must not release a reservation or replay a prompt merely to refresh credentials.
5. Select exactly one native authentication method before launch. Subscription mode must not also receive `ANTHROPIC_API_KEY`; API fallback uses only the selected backup through the existing model gateway. Freeze the accepted backup connection/limit and prices on the run. Enforce backup consumption plus outstanding request reservations under the existing financial lock.
6. A trusted, validated quota signal before any native prompt launch may select backup funding. Generic rate limits, invalid login, temporary outages, unknown quota, and uncertain launch acknowledgements must fail closed. Mid-run exhaustion preserves partial files and native session identity, emits a clear reason, and offers explicit continuation. Transparent mid-run switching remains unvalidated.
7. Record the actual funding selection once: subscription consumption, customer-paid Anthropic API usage, and Macrofold infrastructure ledger charges are distinct quantities. Existing API usage reporting remains unchanged until native subscription accounting is implemented.

This is remaining implementation, not merely an unchecked live test. There is deliberately no environment flag that can enable an unreviewed authentication transport.

## Deterministic verification

The targeted checks exercise the real installed Composio SDK with intercepted HTTP, the actual public API and generated TypeScript resource methods, isolated PostgreSQL, the SQL scheduler/phase engine, and local filesystem capture/restore. Browser and CLI tests use an isolated application and simulator.

Coverage includes named-account selection, ownership and tenant rejection, stale reconnect invalidation, disconnect, backup validation/disable, exact budget boundaries, ambiguous/started execution decisions, gated admission, worker recovery and reservation release, and exclusion of authentication bytes from checkpoint chunks while retaining conversation files.

Run the affected suites through `pnpm test:domain`, `pnpm test:dashboard:isolated tests/browser/named-connections.spec.ts`, `pnpm test:sdks`, `pnpm test:native`, `pnpm check`, and `pnpm docs:check`. Exact results are recorded after verification below; these commands do not authorize provider execution.

### Local results

- Final full domain run: **673 tests across 84 files passed** with the ordinary timeout settings. Earlier Git synchronization and password-reset timeouts did not recur. Coverage includes callback races, ownership, quota/budget decisions, gated recovery, reservations, authentication-path exclusion and streaming.
- The CLI fixture exposed a simulation-only provider mismatch: the `fixture` model rejected every named real-provider API-key connection. Local simulation now permits owned, healthy key selection without reading or sending the key. Deterministic checks preserve strict provider matching for native execution and rejection after ownership changes.
- All five SDK suites and their complete local simulation journeys passed. Python passed 150 tests and its type checks; Rust passed 12 tests; Java passed 10 tests. The TypeScript resource journey and Go suite passed as well.
- Native Codex and Claude Code fixtures passed execution, file tools, capture, restore and same-session continuation. OpenCode initially failed before inference because its SDK allowed only five seconds for server startup. After bounding startup at 30 seconds and the run deadline, with cancellation attached, its execution and replacement-container continuation passed too. All native fixtures used `--network none` and scripted model responses.
- Final isolated application acceptance passed: both named-account browser tests, all five packaged CLI tests, real PTY interaction and the Python HTTP/SSE journey. Browser coverage includes choosing one key over a later-connected account, preset invocation, independent names/IDs, backup save/reload/disable and accessibility. CLI coverage includes preset authentication, preserved budget and an explicit timeout override.
- Strict TypeScript and production build checks passed. The three existing connector-browser tests passed; the existing file/stream/history journey passed on a separate rerun in 23.4 seconds after a whole-test timeout. One earlier build was correctly discarded when an unrelated pricing component changed during compilation.
- Documentation generation and link validation passed: 40 public pages, 141 Markdown files and 54 requirement-evidence mappings.

These runs used disposable local PostgreSQL databases and files. No paid inference, Claude subscription execution or live connector action was performed. Coverage and mutation percentages were not remeasured in this change.

## Remaining external acceptance

- Composio: connect two real accounts of the same toolkit through the configured HTTPS callback, verify each identity, select one tool from each, rename, reconnect, revoke upstream, and confirm no implicit retargeting. Verify provider refresh behavior for each supported auth configuration.
- Claude: obtain the arrangement approval above, finish its isolated native-authentication implementation, then request a fresh explicit execution budget. Test distinct account identities, malicious file/process/tool probes, token refresh races, stale flushes, disconnect/provider revocation, quota classification, exact and concurrent backup spending, and replacement-sandbox recovery.
- Staging: verify full API/CLI/dashboard/SDK-triggered native execution, scheduler/cancellation, checkpoint publication, streaming/replay, separate funding records, and no credentials in storage/Git/exports/forks or provider recovery snapshots.

## Sources

[Composio multiple accounts](https://docs.composio.dev/docs/authentication/managing-multiple-connected-accounts) describes aliases, direct account selection and the session default to the most recent account. Installed `@composio/core` 0.18.1 verifies the actual `allowMultiple`, alias, refresh and direct-execution shapes used here. SDK 0.3.261 and unmodified Claude Code 2.1.261 are the versions exercised by the prior PoC; version compatibility does not establish hosted permission.
