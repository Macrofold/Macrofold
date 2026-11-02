# Optional agent library

Add **Editable memory**, **Hindsight** or **Claude-mem** to one Worktree. An installation is optional configuration around existing Runs, Sessions, files and Connections. It is not a new agent, customer identity or permission system. A shared preset never merges different Worktrees’ memory.

The dashboard is **Agent library** (`/library`). Start with editable memory unless you already operate a supported memory service. Plain LLM/decision inference does not automatically use these native-agent packs.

## Editable memory: simplest setup

1. Open **Agent library → Editable memory → Add memory**.
2. Choose a Workspace and an idle Worktree, then confirm.
3. Start a fresh conversation with file access to the notes.
4. Ask the agent to remember a confirmed preference. Use **View memory** or the Worktree file browser to inspect and edit the result.

The installer creates missing `profile.md`, `memory/README.md` and `tasks.json` without replacing existing content. It publishes one ordinary verified checkpoint. Instructions guide the native agent to read and maintain notes; there is no background extraction, semantic index or guaranteed recall. Read-only file permissions produce reading guidance only; denied files are not suggested to the agent.

```sh
macrofold integration catalog
macrofold integration add file-memory --workspace WORKSPACE_ID --worktree WORKTREE_ID
macrofold integration list --workspace WORKSPACE_ID
macrofold integration get INSTALLATION_ID
macrofold integration export INSTALLATION_ID --json > agent-memory.json
```

CLI context flags follow the normal Workspace/Worktree selection. Run `macrofold integration --help` or use the REST operations below when integrating from an application.

## Service memory: bring your own account

Hindsight and Claude-mem implement automatic bounded recall before a native turn and durable background capture. Hindsight learns successful conversation notes; Claude-mem also retains labeled failed/cancelled engineering attempts and bounded committed tool-outcome metadata. Macrofold performs the integration lifecycle; you supply and fund the external service. **Macrofold-managed provisioning is not included.** No service is activated just because its catalog card exists.

Supported protocol versions:

| Pack       | Required service                                                                                                 | Namespace                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Hindsight  | Reviewed Hindsight REST API, revision `bc5ea195a0fed1346ff171a5780bbb72a38c89c8`                                 | Dedicated bank, initialized during setup                        |
| Claude-mem | Hosted PostgreSQL REST API, revision `c239a048a8a07607148f4c1f26b258ccfb28b80d` / 15.8.1, with generation worker | Existing dedicated project ID, supplied by the service operator |

Claude-mem’s SQLite worker has different response shapes and is not supported by this adapter. Its pinned hosted server does not expose the project-creation route described in some upstream docs. On a fresh dedicated hosted server, the operator can bootstrap the first project and scoped key with the official server CLI:

```sh
docker compose exec -T claude-mem-server \
  bun /opt/claude-mem/scripts/server-service.cjs server api-key create \
  --name macrofold-memory --scope memories:read,memories:write
```

The returned `projectId` identifies its default project. Save the returned key directly in Connections; never paste it into an agent prompt, logs or this guide. This default is dedicated only when the server/project has not already been used by another customer. For an existing shared service, ask the operator for a separately provisioned dedicated project and scoped key; Macrofold verifies project visibility with `GET /v1/projects/PROJECT_ID/jobs?limit=1`. Do not invent a project ID or add `/v1` or `/mcp` to the service base URL.

1. Open the desired pack’s **Add memory** flow.
2. Select the Workspace and an idle Worktree.
3. Choose an owned **Memory service connection**, or **Add service connection** with the server base URL and bearer key. Keys stay encrypted in Connections.
4. Provide a fresh, dedicated namespace. A service collection must never be shared between customers, Worktrees or independent installations.
5. Confirm that the namespace is dedicated and that your external account funds service queries, extraction, embeddings and background processing. Those charges are outside Macrofold Run budgets.
6. Keep **Optional** recall unless the application must refuse a turn when memory is unavailable. Required denied recall is rejected before compute starts.
7. Confirm setup, then start a fresh conversation. Inspect **View memory → Capture and cleanup activity** after a successful turn.

Changing the service URL, account, key or authentication blocks further use until explicitly configured again; Macrofold never silently sends old memory to a replacement account. Keep the same credentials available for cleanup, or ask the service operator to erase the retired collection.

For a local service, configure an exact origin in Macrofold’s local operator environment and restart the local app/worker:

```ini
LOCAL_MEMORY_SERVICE_ALLOWED_ORIGINS=http://127.0.0.1:PORT
```

This local-only exception retains authentication, DNS checks, redirect rejection and body/deadline limits. Production requires public HTTPS. It is independent of the local MCP policy.

### REST setup

Use a backend Macrofold key. Common installation scope is `runs:write`; editable files also require `files:write`, while remote setup requires `connections:write` and ownership of the service Connection. Read/control endpoints advertise their scopes in the REST reference. A Workspace-bound key must match the installation Workspace.

```sh
curl "$MACROFOLD_URL/v1/connections" \
  -H "Authorization: Bearer $MACROFOLD_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" -H 'Content-Type: application/json' \
  -d '{"name":"My Hindsight account","kind":"memory_service","provider":"hindsight","url":"https://memory.example.com","auth_method":"bearer","secret":"SERVICE_KEY"}'

curl "$MACROFOLD_URL/v1/agent-integrations" \
  -H "Authorization: Bearer $MACROFOLD_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" -H 'Content-Type: application/json' \
  -d '{"workspace_id":"WORKSPACE_ID","worktree_id":"WORKTREE_ID","pack_id":"hindsight","service":{"connection_id":"CONNECTION_ID","namespace":"dedicated-customer-bank","namespace_is_dedicated":true,"external_cost_acknowledged":true,"required":false}}'
```

For CLI service setup, save only the `service` object to a protected JSON file (`chmod 600 memory-service.json`), then:

```sh
macrofold integration add hindsight --config-file memory-service.json --workspace WORKSPACE_ID --worktree WORKTREE_ID
macrofold integration activity INSTALLATION_ID
macrofold integration search INSTALLATION_ID 'Which preference was confirmed?'
```

The CLI does not accept customer service keys through a global environment variable. It uses the ordinary Connection and installation APIs. Generated SDKs expose the same operations; TypeScript `client.request('searchAgentIntegrationMemory', {idempotencyKey, params:{path:{integration_id}}, body:{query}})` retains the key across a caller retry.

## What is read and captured

Stable pack policy and its binding generation are frozen at Run admission. Bounded service recall is prepared once per Run before compute; returned evidence is marked untrusted and cannot grant tools or override instructions. Learning is asynchronous: a healthy empty result may still have pending capture or indexing. Inspect capture activity before treating it as proof that no memory exists. A recovered preparation reuses its encrypted confirmed receipt. An uncertain lookup is not automatically sent again.

The shared provider boundary limits recall query text to 4,096 characters, keeping the beginning and end with an omission marker. Returned evidence is limited to 10 items and 16 KiB. These are explicit memory-projection bounds, not limits on the original Run request.

**Hindsight** captures successful final user/assistant conversation notes. **Claude-mem engineering history** captures terminal successful, failed, cancelled and timed-out attempts, available final assistant narrative, and up to 32 committed tool-outcome metadata records (event/call IDs, name, reported status, safe code and time). It never transfers raw tool arguments/results or reasoning. Reported completion is explicitly unverified evidence, not proof a tool effect succeeded. Failed attempts are labeled partial. Sources include original Run/Session/Workspace/Worktree IDs, the Run’s accepted verified checkpoint and known ready Git commit (otherwise null), plus the accepted repository/branch when configured. A newer Worktree checkpoint cannot replace that history.

Both recipes require combined source text to fit 256 KiB and bound the final encoded captured source to 256 KiB with explicit text/metadata omissions. They exclude raw tool effects, reasoning, transport deltas, arbitrary files and historical backfill. Oversize or unavailable sources are reported in capture activity; they do not fail an already successful Run. The accepted bounded captured source is encrypted locally; it is not a guarantee of a full original conversation archive. Claude-mem receives a separately bounded UTF-8 projection (at most 14 KiB including its envelope), retaining both roles, final outcome, provenance and the latest eight tool metadata records within its upstream 16 KiB generation-payload limit. Omitted records are labeled; the encrypted captured source can contain up to 32.

Private-marked content and recognized credentials are excluded by the existing content sanitizer. Independent Run history and tracing have their own retention. Do not put secrets into memory prompts.

Remote reads/writes obey effective `tools` permissions for `CONNECTION_ID/memory_recall` and `CONNECTION_ID/memory_capture`. Explicit **No tools** (`connection_grants: []`, including the Session default) disables both. Required denied recall rejects admission; optional omissions produce `memory.omitted` or `memory.capture_omitted` Run events and safe trace metadata. Positive MCP tool selections remain separate from the explicit installed-memory authority: this service is not a generic MCP tool connection.

## Controls, correction and forgetting

| Control                   | Effect                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Pause learning            | Read existing memory; stop automatic new capture. Editable memory asks the agent not to change notes.                   |
| Disable                   | Stop future pack recall/guidance/capture. Retained data remains.                                                        |
| Remove editable memory    | Detach installation; preserve ordinary files and checkpoints.                                                           |
| Detach service memory     | Stop use; retain an owner-only record for inspection, export and explicit cleanup.                                      |
| Forget service collection | Disable recall immediately, retire the namespace and queue whole-collection deletion. Inspect activity until confirmed. |

**Start a fresh Session after installation/state/generation changes.** Continuing an older Session returns `409 session_memory_changed`; already-loaded context cannot be erased from a warm model. Restoring a Worktree checkpoint does not rewind external memory.

A confirmed note is additive evidence, **not an authoritative replacement** for earlier generated memories. To correct safely: export any sources you need, forget the entire collection, verify cleanup, install a fresh dedicated namespace with explicit consent, start a fresh Session and add the corrected note. This deliberately loses the old collection; there is no automatic paid rebuild/backfill. Selective provider-aware correction is not yet qualified.

Forget requests are idempotent at the collection owner and return the existing cleanup receipt. Unknown/in-flight captures keep cleanup unconfirmed instead of falsely claiming erasure. **Check existing job** polls an acknowledged write; **Retry cleanup** repeats only the explicit metadata-deletion operation, never paid capture generation. Each processing attempt is bounded to 24 hours/3,000 polls, with finite consecutive failure retries; a bound ends in an explicit uncertain outcome, not a claim that vendor work was cancelled.

Deleting a Worktree/Workspace immediately disables automatic outbound memory work. Permanent Workspace purge removes local encrypted source/recall/search copies. It does **not** silently delete an independently funded service; owner cleanup access and external-operator responsibility remain visible. Provider backups, existing chats and independently retained traces need their own retention policy.

## Inspect, export and integrate

| Operation                   | REST route                                                    |
| --------------------------- | ------------------------------------------------------------- |
| Catalog                     | `GET /v1/integration-packs`                                   |
| List/install                | `GET/POST /v1/agent-integrations`                             |
| Inspect/state/remove        | `GET/PATCH/DELETE /v1/agent-integrations/{id}`                |
| Current file notes          | `GET/PUT/DELETE /v1/agent-integrations/{id}/memories`         |
| Export                      | `GET /v1/agent-integrations/{id}/memory-export`               |
| Capture/cleanup receipts    | `GET /v1/agent-integrations/{id}/activity`                    |
| Captured source text        | `GET /v1/agent-integrations/{id}/activity/{source_id}`        |
| Recheck job / retry cleanup | `POST /v1/agent-integrations/{id}/activity/{source_id}/check` |
| Confirmed note              | `POST /v1/agent-integrations/{id}/notes`                      |
| Manual search               | `POST /v1/agent-integrations/{id}/search`                     |
| Whole-collection forget     | `POST /v1/agent-integrations/{id}/forget`                     |

Mutations and manual search require `Idempotency-Key`; state/forget requests require the installation revision in `If-Match`. File edits instead use the Worktree revision and return the normal Operation. Manual search durably claims a private existing Operation identity before possibly billed I/O. Concurrent/lost-response same-key retries reuse the encrypted result or refuse an uncertain query; they never resubmit it. Current authority/generation is checked before replaying cached plaintext. After forgetting, an old search key returns `410 memory_context_revoked`.

Export is bounded to 500 entries/1 MiB per response. Editable export is current files only; service export is **Macrofold-captured sources**, not the service’s full derived observation/index archive. Page activity and fetch individual captured sources for larger collections. Use the provider’s own export if a full vendor-state archive is needed. Pending sources are counted explicitly.

Recall includes bounded **provider-reported** references in each memory’s `provenance`. Hindsight can return document/chunk references, fact-source IDs and named occurrence/mention times. When `provenance.document_id` names a Macrofold capture, expand it with `GET /v1/agent-integrations/INSTALLATION_ID/activity/DOCUMENT_ID`; the API rechecks current ownership. Claude-mem preserves available observation/session references and observation creation/update times; its context response has no source-event ID, which remains null. Missing source/time fields remain unknown, and arbitrary vendor metadata is excluded. These dates are not an indexing watermark. Verify execution against the authorized captured source/Run before claiming an effect succeeded.

Langfuse’s native Macrofold charge is zero for external service processing. Metadata and receipts separately expose provider-reported cost/tokens when confirmed; missing values stay `null`/unknown. Memory reads and processing include duration and provider/binding metadata. Repeated poll updates do not repeatedly sum a provider total. Hosting, idle capacity, provider generation and eventual consolidation are funded by your external account.

## Verification boundary

Disposable checks exercise Macrofold’s authorization, lifecycle, bounded projections and uncertainty handling. The pinned Hindsight and Claude-mem servers also pass actual capture, background processing, recall, restart persistence and deletion through the production service adapter. Both pass a native Run → learning → fresh Session and different Docker Host → recalled fact journey through Macrofold’s public API, including export and confirmed cleanup. Claude-mem’s captured engineering source preserves the committed Run outcome and provenance.

Those service checks use deterministic local model responses; they establish protocol, storage and lifecycle behavior, not memory quality or real provider pricing. Claude-mem uses its supported keyword-search fallback; vector embeddings and its full production service stack remain separate qualification. No managed service or hosted Macrofold deployment is implied. See the [implementation design](../../projects/agent-integration-library-tech-design.md) for exact compatibility and acceptance limits.
