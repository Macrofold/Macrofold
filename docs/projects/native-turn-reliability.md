# Native turn reliability

Implemented and locally verified, September 28, 2026. Owners: runtime adapters and checkpoint capture; provider protocol normalization; core model settlement and tracing.

## Scope and decisions

- Submit OpenCode turns once through `prompt_async`, after its event feed connects. Wait for the matching session boundary, then fetch the final assistant message. Preserve cancellation, streaming, warm identity and explicit failures; never retry an ambiguous prompt.
- Carry provider-reported USD cost separately from Macrofold charges and rate-card estimates. Langfuse native cost remains the Macrofold charge (zero for BYOK model calls). Numeric reported-cost metadata retains sub-micro-dollar precision and explicit unknowns. This is observability, not new pricing or invoice reconciliation; REST billing retains its existing estimate contract.
- Normalize only declared native SQLite databases on private copies after writers are quiescent. Checkpoint WAL into the copied database, verify it and omit empty companions only on success. Bound work and retain original bytes on failure. Never checkpoint a live harness database or alter arbitrary worktree databases.
- Derive file-tool exposure and instructions from existing layered permissions for every harness. Explicit deny-all omits file tools; read-only tools expose only read/list. Per-path authorization remains authoritative for arbitrary glob intersections. Session persistence is independent of agent file access.

## Steps and completion

1. Update shared permission descriptors and all six adapters, including root listing semantics and worker instructions.
2. Replace OpenCode's held prompt request and classify safe transport timeouts.
3. Normalize provider cost for native and direct inference paths; persist with existing usage details and export to Langfuse metadata without changing customer settlement.
4. Add bounded copied-SQLite normalization to the existing manifest capture owner.
5. Verify focused unit/integration regressions, real offline native harness execution, full runtime build, TypeScript and documentation checks. Inspect the complete affected diff. Activate locally only when execution is idle; preserve the preview.

No caller instructions, model selection/effort, accounting reservations or public permission parameters change. Hosted image rollout and the caller's real draft/approval journey require separate acceptance; track remaining work in [maintainer TODO](../maintainers/TODO.md).

## Verification

- Focused final unit run: 52 cases pass across six files, exercising the real OpenCode SDK against loopback HTTP/SSE, explicit failure/cancellation, permission visibility, copied SQLite restore/fallback, and provider/Langfuse cost separation. Additional existing permission/persistence tests passed during implementation.
- Disposable PostgreSQL gateway/billing acceptance: 39 cases pass. BYOK charges remain zero and normalized costs survive settlement in usage details.
- `pnpm check` passes, including the TypeScript SDK build. Public API schemas did not change; unrelated SDK generation/builds are skipped.
- A private copy of the affected run's real SQLite state fell from 4,939,352 to 872,448 bytes (82% smaller), with equal logical contents and byte-for-byte unchanged source files; normalization took about 146 ms locally. This measures capture preparation, not end-to-end cloud latency.
- Real Langfuse ingestion/readback passes for separately labeled known/unknown cost metadata and zero native BYOK cost; see [tracing evidence](../features/observability/verification.md#provider-reported-cost-separation). No paid model calls were made.
- The complete Dockerfile image passes actual native acceptance for all six harnesses: no-file and read-only model interfaces, independent session capture, existing writable file checks, denied reads/writes, traversal/symlink rejection, native bypass denial and restored continuation. Hermes' deferred discovery is exercised before checking its read-only schema. OpenCode also passes concurrent execution, independent cancellation, warm reuse, cold reload, export/import on a fresh container, stale-assignment fencing and interactive questions.
- Docker bind mounts stalled before container creation. The temporary acceptance runner used `docker create`, copied the same fixtures with `docker cp`, then ran `docker start -a`; external networking stayed disabled. No assertions or runtime behavior were weakened. Both normal and deferred model instruction/tool formats are checked.
- `pnpm docs:check` and `git diff --check` pass. The pre-existing native guidance-loader warning is unrelated. Full affected changes were reviewed; the review corrected Hermes' distinction between guarded execution and the presence of a file service.
- The verified image was promoted to the local default after confirming no active Runs or unfinished Run dispatch jobs. The previous image is retained for rollback. Both existing idle Docker pollers were gracefully restarted with unchanged configuration; the web preview and Docker daemon stayed running. Exact image identities, commands and process evidence are in the private operator record.

Hosted deployment and the original live caller draft/approval journey remain unverified. These fixes do not change the caller's prompt, model or reasoning effort, or establish its end-to-end completion time.
