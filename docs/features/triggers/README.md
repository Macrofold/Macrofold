# Triggers and scheduled tasks

Start an agent from a Slack message, an incoming webhook, or a recurring schedule. Every trigger connects an **agent preset** to a **workspace**: the preset supplies the harness, model, tools and billing; the workspace supplies persistent files.

## Choose a starting point

| Starting point | Setup | Result |
| --- | --- | --- |
| Slack message | [Connect a Slack bot and channel](slack.md) | A run for each new human message, with a reply in its thread |
| Incoming webhook | [Create a secure webhook URL](webhooks.md) | A run from another service’s JSON payload |
| Recurring prompt | [Create a scheduled task](scheduled-tasks.md) | A run on a cron schedule, even with the dashboard closed |

First create a [workspace](../workspaces/README.md) and [agent preset](../execution/README.md). Then open **Triggers** or **Scheduled tasks** in the dashboard. Local simulation exercises the same intake and scheduling paths without model charges.

## Follow the work

Open a trigger’s **History** to see received deliveries, waiting or failed admission, linked runs, and Slack reply status. Open **View run** for output, tool calls, persisted files, and cancellation. Scheduled runs are labeled **scheduled** in the normal Runs list; Slack and webhook runs carry their respective source labels.

Delivery acceptance is separate from execution. An incoming request can return successfully while its delivery waits for a writable worktree. Receipts wait up to 24 hours. No funds are reserved until a run is admitted; accepted runs use the normal [queue deadline, concurrency and budget rules](../execution/scheduling.md).

## Control access and cost

Triggers execute with their creator’s authority. Revoking the initiating API key, removing membership, or removing execution access prevents new admission. OAuth-created triggers also stop admitting work when their access token expires; use a dashboard-created trigger or a suitably scoped API key for ongoing automation. Existing runs keep their normal cancellation and revocation behavior.

Each trigger accepts up to **100 deliveries per rolling 24 hours** by default, configurable from 1 to 1,000. There can be 100 waiting deliveries per trigger and a configurable saved-trigger quota per organization. These limits supplement preset budgets and organization spending limits. Repeated delivery of the same event does not consume another admission or reservation.

The creator can edit, pause, resume and delete a trigger. Organization owners and administrators can also pause or delete another member’s trigger. A trigger’s workspace stays fixed so its history cannot move between permission boundaries. Create a new trigger to change workspaces. Editing configuration stops receipts that have not yet become runs; already accepted runs retain their configuration. Pausing or deleting a trigger does not cancel those runs.

## API and SDK access

All management operations are available in the [API reference](../../api/openapi.json) and generated [SDK resource methods](../api/sdks/reference.md). Use `triggers` to manage the three trigger kinds, inspect deliveries and run scheduled tasks on demand; use `slack_connections` (Python) or `slackConnections` (TypeScript) for bot setup and channel discovery. Incoming URLs authenticate separately from normal Macrofold API keys.

Reading requires `triggers:read`. Creating, editing or resuming requires `triggers:write`, `runs:write`, `runs:read` and `workspaces:read`; Slack configuration requires `connections:write` with unrestricted organization access. An organization owner or administrator can pause or delete automation with a workspace-scoped `triggers:write` key, without read access or permission to assume the creator’s execution authority.

Contributor details: [architecture and operations](implementation.md), [acceptance evidence](../../engineering/testing/triggers.md).

## Connection access

Each delivery resolves [connector access](../identity-integrations/connection-access.md) using the configured workspace and verified preset. Explicit preset tool defaults narrow access; omitted defaults inherit current eligible connections. Event payloads cannot supply access exceptions or change this context.

## Capacity

The dashboard and `GET /v1/triggers` show `{quota:{limit,used,remaining}}` alongside the paginated results. Capacity counts all non-deleted definitions across the organization, including paused schedules, Slack triggers and webhooks; filters do not change that count. The initial deployment default is **100**, with an optional account override. Lowering a limit preserves existing definitions and lets you edit, pause or delete them. New creation stops until usage is below the limit. Deleting a definition frees its slot.

Operators use the configured owner database connection after migrations, without changing application source:

```sh
pnpm triggers:quota
pnpm triggers:quota --limit 500
pnpm triggers:quota --organization ORGANIZATION_UUID --limit 2000
pnpm triggers:quota --organization ORGANIZATION_UUID --reset
```

`--reset` returns an account to the current deployment default. A limit of zero blocks new definitions. Valid limits are 0–1,000,000; this is a product policy bound, not a throughput guarantee. These commands do not change daily intake, run concurrency or spending caps. On a hosted deployment, set `MIGRATION_DATABASE_URL` securely for the intended environment. Serving credentials cannot edit deployment policy tables. Account overrides serialize with definition creation so simultaneous requests cannot consume the same last slot.
