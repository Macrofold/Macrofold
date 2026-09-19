# Stateless inference follow-up

## Implementation in this change

- Direct `/v1/inferences` requests may omit `workspace_id` and use an account-level API key with `runs:write`.
- No workspace, worktree, or session is created for that request. Billing and execution authority remain account-scoped.
- A supplied workspace is still authorized. Workspace-restricted keys cannot submit or inspect account-scoped runs.
- Migration `042_account_inferences.sql` permits a null inference workspace and includes those runs in scheduling. Native-agent runs still require a workspace.
- Inline definition/context remain part of the current request envelope. Saved references and bounded-agent endpoints retain their existing workspace requirements pending simplification.
- OpenAPI and TypeScript schema declarations were regenerated. No tests, builds, migration application, or user-guide updates were performed at the user's request.

## Implementation TODOs

- [ ] Remove unnecessary saved-input/context-artifact and versioned-definition APIs, persistence, reference resolution, SDK/MCP methods, and UI surfaces. Inventory callers before removal; preserve ordinary uploaded files, generated outputs, billing records, and historical run results.
- [ ] Review the decision-task coordinator for removal separately from basic inference execution. Do not remove native runs, scheduling, cancellation, or accounting safeguards.
- [ ] Simplify the inline request envelope around caller-supplied model, input, instructions/schema, and limits; remove application-namespace/audience conventions that are unnecessary for stateless calls.
- [ ] Regenerate remaining language clients and rebuild distributed TypeScript packages from the updated contract.
- [ ] Apply migration 042 through the normal migration workflow after the parent task's terminology migration 041. Coordinate deployment; do not run new admission code against the old NOT NULL constraint.

## Testing TODOs — not run

- [ ] Unrestricted API key + inline inference without workspace: submit, schedule, execute, retrieve/stream/cancel, and inspect itemized billing and tracing.
- [ ] Explicit authorized workspace still works with an unrestricted key.
- [ ] Wrong scopes, revoked/expired keys, foreign accounts, and workspace-restricted keys attempting account-level runs are denied at admission and subsequent reads/dispatch.
- [ ] Confirm budgets, reservations, settlement, idempotency, and uncertain-provider handling remain unchanged.
- [ ] Rehearse migration with existing native/inference records; ensure native workspace constraints and reporting views remain correct.
- [ ] Check types, API response validation, SDKs, MCP, and dashboard handling of null workspace IDs. Test saved-reference rejection when no workspace is provided until that feature is removed.

## Documentation TODOs

- [ ] Update inference quickstart and examples to use the account API key without a workspace.
- [ ] Remove mandatory single-workspace-key instructions from public guides, MCP instructions, and agent onboarding prompts.
- [ ] Explain optional workspace attribution and account-scoped billing; update migration/deployment guidance and generated documentation after removal scope is settled.
