# Triggers and scheduled tasks

Start an agent from a Slack message, an incoming webhook, or a recurring schedule. Every trigger connects an **agent preset** to a **project**: the preset supplies the harness, model, tools and billing; the project supplies persistent files.

## Choose a starting point

| Starting point | Setup | Result |
| --- | --- | --- |
| Slack message | [Connect a Slack bot and channel](slack.md) | A run for each new human message, with a reply in its thread |
| Incoming webhook | [Create a secure webhook URL](webhooks.md) | A run from another service’s JSON payload |
| Recurring prompt | [Create a scheduled task](scheduled-tasks.md) | A run on a cron schedule, even with the dashboard closed |

First create a [project](../workspaces/README.md) and [agent preset](../execution/README.md). Then open **Triggers** or **Scheduled tasks** in the dashboard. Local simulation exercises the same intake and scheduling paths without model charges.

## Follow the work

Open a trigger’s **History** to see received deliveries, waiting or failed admission, linked runs, and Slack reply status. Open **View run** for output, tool calls, persisted files, and cancellation. Scheduled runs are labeled **scheduled** in the normal Runs list; Slack and webhook runs carry their respective source labels.

Delivery acceptance is separate from execution. An incoming request can return successfully while its delivery waits for a writable workspace. Receipts wait up to 24 hours. No funds are reserved until a run is admitted; accepted runs use the normal [queue deadline, concurrency and budget rules](../execution/scheduling.md).

## Control access and cost

Triggers execute with their creator’s authority. Revoking the initiating API key, removing membership, or removing execution access prevents new admission. OAuth-created triggers also stop admitting work when their access token expires; use a dashboard-created trigger or a suitably scoped API key for ongoing automation. Existing runs keep their normal cancellation and revocation behavior.

Each trigger accepts up to **100 deliveries per rolling 24 hours** by default, configurable from 1 to 1,000. There can be 100 waiting deliveries per trigger and 100 triggers per organization. These limits supplement preset budgets and organization spending limits. Repeated delivery of the same event does not consume another admission or reservation.

The creator can edit, pause, resume and delete a trigger. Organization owners and administrators can also pause or delete another member’s trigger. A trigger’s project stays fixed so its history cannot move between permission boundaries. Create a new trigger to change projects. Editing configuration stops receipts that have not yet become runs; already accepted runs retain their configuration. Pausing or deleting a trigger does not cancel those runs.

## API and SDK access

All management operations are available in the [API reference](../../api/openapi.json) and generated [SDK resource methods](../api/sdks/reference.md). Use `triggers` to manage the three trigger kinds, inspect deliveries and run scheduled tasks on demand; use `slack_connections` (Python) or `slackConnections` (TypeScript) for bot setup and channel discovery. Incoming URLs authenticate separately from normal Macrofold API keys.

Reading requires `triggers:read`. Creating, editing or resuming requires `triggers:write`, `runs:write`, `runs:read` and `projects:read`; Slack configuration requires `connections:write` with unrestricted organization access. An organization owner or administrator can pause or delete automation with a project-scoped `triggers:write` key, without read access or permission to assume the creator’s execution authority.

Contributor details: [architecture and operations](implementation.md), [acceptance evidence](../../engineering/testing/triggers.md).
