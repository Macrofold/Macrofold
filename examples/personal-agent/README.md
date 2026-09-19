# Personal-agent reference app

Create **Milo** for **Alice**, connect a search account, start separate conversations on the same files, inspect/correct memory and tasks, enable a weekly review, pause work and delete the agent. Switch to Bob to verify that his agent and files are separate. This is a runnable application built on the public SDK, not another core platform resource.

## Start here — about five minutes after local setup

Prerequisites: Node 24.13 or newer in the supported Node 24 line, pnpm 10.33, and the [local simulator](../../docs/getting-started/local-development.md) running with its database and worker. `node:sqlite` is experimental in Node 24 and prints a warning. The example's store is isolated from the platform database.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm sdk:build
# In the local dashboard, create an API key. See the scope instructions below.
read -s MACROFOLD_API_KEY
export MACROFOLD_API_KEY
export MACROFOLD_BASE_URL=http://localhost:3210
pnpm example:personal-agent
```

Paste the key after the `read` command and press Enter; it is not included in shell history. On shells where `read -s` differs, set `MACROFOLD_API_KEY` through your secret manager or local untracked environment file. Never commit it. Open **http://127.0.0.1:3220** exactly as printed. The host check deliberately rejects alternate hostnames. Use `EXAMPLE_PORT` to choose another port and `EXAMPLE_DB` to choose a different SQLite file (default `.data/personal-agent.sqlite`).

The startup check refuses a catalog without `fixture-model`. Simulation makes no paid model, search or connector calls. The example does not enable paid execution. To adopt it for real customers, complete the production steps below explicitly.

### API-key permissions

In **API keys → Create key**, choose **Read & write**, expand **View permissions**, and select the scopes below (add `workspaces:delete`, which is not included in the preset):

- `workspaces:read`, `workspaces:write`, `workspaces:delete` (workspace creation and the explicit deletion flow).
- `files:read`, `files:write` (memory review/correction/forgetting).
- `identity:read`, `runs:read`, `runs:write` (catalog, presets, conversations and activity).
- `triggers:read`, `triggers:write` (weekly schedules).
- `connections:read`, `connections:write` (the optional named account and exact access rule).

Use an owner/admin account for workspace deletion. Because the starter creates workspaces, its server key cannot initially be restricted to already-created workspace IDs. Do not add billing, organization administration or API-key management scopes. If your deployment's preset differs, the [OpenAPI contract](../../docs/api/openapi.json) owns the per-operation scopes.

## Walk through the experience

1. Leave the demo customer on **Alice**. Name the agent **Milo** and choose **Create agent**. Setup creates a workspace, a preset with no selected tools, the workspace's main worktree and optional starter files.
2. Open **Connect a search account**. In simulation, enter `fixture-only-not-a-real-key`. Choose **Save account and allow search**. The example creates an Exa BYOK connection, approves only `web_search`, creates a `workspace_agent` access rule for Milo, and explicitly selects that connection in his preset. It does not test the key against Exa or grant organization-wide access.
3. Open `profile.md` and save a confirmed preference, for example:

   ```markdown
   # Profile

   - Prefers quiet hotels. Source: Alice's message, 2026-09-11.
   ```

4. Send “Plan a weekend using my profile.” Wait for the activity to show **succeeded** and **persistence: verified**. The simulator produces scripted output and a saved run note; it does not reason about the preference.
5. Choose **New conversation** and send “Review next week's plans.” The new session uses the same worktree. Choose an existing conversation to continue its pinned native history instead.
6. Open `tasks.json`, add a task using the example below, and save. Edit profile facts directly to correct them; use **Forget this file** to remove a current memory file. Source editing is deliberate here; the platform dashboard supplies the full file tree/rich Markdown editor.
7. Open **Schedule a weekly review**, review the Monday 09:00 timezone and $2 per-run ceiling, then enable it. The worker will start a fresh session on the workspace's main worktree. `tasks.json` itself never schedules anything. For immediate testing, use the platform's scheduled-task **Run now** control; cron does not require leaving this browser open.
8. **Pause** disables future schedule occurrences and requests cancellation of accepted work. **Resume** permits new conversations and reenables this agent's schedule; cancelled runs are not replayed.
9. Switch to **Bob** and create **Basil**. Bob cannot see Alice's agents or files. The two demo choices are _not authentication_; real identity comes from your application.
10. Return to Alice. Expand **Delete this agent**, type **Milo**, and confirm. The workspace enters its seven-day undo period, accepted work is cancelled, and its Exa credential is disconnected immediately. Bob's agent remains available. Accounting is retained.

Task-file example:

```json
{
  "version": 1,
  "tasks": [
    {
      "id": "weekend-plan",
      "title": "Plan a quiet weekend away",
      "status": "open",
      "next_action": "Ask Alice for dates and a budget",
      "source": "Alice's request, 2026-09-11",
      "updated_at": "2026-09-11T12:00:00Z"
    }
  ]
}
```

## What each file owns

| File                                                 | Responsibility                                                                                                     | Replace when                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| [start.ts](start.ts)                                 | Local configuration, simulation check, SQLite path, loopback binding                                               | Integrating into your deployment                  |
| [server.ts](server.ts)                               | HTTP boundary, CSRF/origin/body checks, authenticated customer resolution; isolated demo identity adapter          | Using your existing web framework/authentication  |
| [service.ts](service.ts)                             | Customer-owned resource mapping and explicit setup/chat/tool/schedule/lifecycle steps through SDK resource methods | Your product's agent workflow differs             |
| [store.ts](store.ts)                                 | Validated application records and durable per-step request IDs/results                                             | Replacing SQLite or using multiple app instances  |
| [public/](public/)                                   | Small browser UI with progressive disclosures and same-action retry                                                | Adopting your own design system                   |
| [../shared/file-memory.ts](../shared/file-memory.ts) | Optional file layout, task schema and memory instructions                                                          | Changing file conventions or using a data service |

### Data and permission boundaries

`AgentRecord` links an opaque application agent ID to `customerId`, `workspaceId`, `worktreeId`, `presetId`, conversations, runs and optional connection/schedule IDs. Authentication supplies `customerId` before lookup. No endpoint accepts a platform workspace/worktree/preset/connection ID to attach arbitrarily. Continuing a conversation also requires its ID to be present in this agent's record. Customer names never establish authority.

The platform's `/agents` resource is still a configuration preset. The app's records are not new platform `/customers` or `/personal-agents` APIs. The source imports the repository SDK for runnable development; after packaging it in your app, use `import { Macrofold } from 'macrofold'` and its normal server-side installation.

The initial preset selects no connections, even if the platform organization has broad access rules. Connecting Exa saves an exact tool selection. That selection is a ceiling, not authority: the server-side access rule and account/tool approval are still required at run admission and dispatch. Existing sessions retain their pinned defaults; start a new conversation after connecting. For browser OAuth providers, integrate the platform's authenticated consent flow instead of treating this Exa key form as a generic OAuth proxy.

## Recovery without duplicate side effects

Each browser action has a UUID. The app records a SHA-256 fingerprint, stable platform request UUID, optional conditional revision and typed result for each step before moving on. Credentials and full request bodies are not written to the journal. No database transaction spans a remote call.

If a response is lost, choose **Retry the same action**. Keep the original values. Non-secret action inputs survive a page refresh in the same browser tab's session storage; an Exa key must be re-entered after refresh. Do not generate a new action ID to retry an uncertain operation. The CLI/service tests simulate a committed workspace creation whose response is lost, reopen SQLite, and verify exactly one workspace remains.

Platform idempotency responses expire after 30 days. An unfinished example step older than 29 days stops for manual reconciliation; inspect the saved request ID and platform resources before resolving it. Completed journal results remain local. Do not erase the SQLite store to “fix” failed setup: that discards the mapping and can orphan remote resources.

A rejected form value can be corrected and submitted as a new action; ambiguous upstream failures retain their original action ID. Paused agents keep memory editing available while disabling new chat, connection and schedule submissions. A stale file revision is a conflict, not a permission error. Reopen the current file, reconcile the change, and submit a new correction with a new action ID. The editor's read response supplies a matching body/ETag. Forgetting affects current context, not retained historical checkpoints. Waiting for output does not imply success until persistence is verified.

## Production adoption and deliberate limits

1. Replace `demoAuth` with verified session authentication that returns a stable external customer ID. Remove the demo switch route. Keep CSRF protection and TLS at your framework's boundary; this host is intentionally loopback-only, not an internet-ready authentication service.
2. Configure a real supported model, harness, billing mode and an explicit budget in your server composition. Set the customer's expectation that the budget is per run. Keep provider credentials in the platform's supported named-connection flow. Do not remove the simulation gate as an incidental refactor.
3. Use one deployment process per SQLite store. The service currently rejects simultaneous actions for one agent with a retryable conflict. For multiple processes, replace this local lock and store together with transactional claims/leases and unique constraints in your application database. Keep the durable step journal and short transactions.
4. Add your product's customer-consent, retention/export, account deletion and credential rotation policies. The example retains an app tombstone/preset for recovery/history after workspace deletion; it is not a claim of immediate erasure. Platform undo does not silently reconnect a disconnected search account.
5. Add per-customer rate/spend limits and a durable customer action log appropriate to your application. Platform organization/run quotas do not substitute for product billing or customer identity.
6. Grow beyond the starter's one optional search connection and one weekly schedule only when needed. The dashboard can already manage broader connections/schedules. This example keeps activity to the latest 30 runs and the first 100 file entries; a large app should paginate these panels using existing SDK cursors.

Memory instructions guide model behavior; they are not an enforced universal memory guarantee. A separate harness session receives files, not another harness's hidden state. Parallel same-folder writers are not supported; branch and merge explicitly. Pause requests cancellation and cannot undo an external side effect already performed.

## Verify locally

```sh
pnpm check
pnpm test:domain tests/unit/file-memory.test.ts tests/integration/personal-agent.test.ts
pnpm test:dashboard:isolated tests/browser/personal-agent-example.spec.ts
```

The domain fixture proves valid access first, then customer separation, forged conversation denial, real simulator persistence, conditional correction/deletion, scoped tools, duplicate schedule prevention, pause/resume, workspace cleanup, lost-response recovery, CSRF and request-size rejection. Browser acceptance exercises the real UI and local API. Neither is live model/Exa acceptance.

For an AI implementing this pattern, read [customer identity](../../docs/features/customer-agents/README.md), [memory behavior](../../docs/features/customer-agents/memory.md), this file, the four source modules above, [connection access](../../docs/features/identity-integrations/connection-access.md), [API conventions](../../docs/features/api/conventions.md), and the [SDK method reference](../../docs/features/api/sdks/reference.md). Treat these explicit boundaries as the contract; do not infer authorization from names or tool text.
