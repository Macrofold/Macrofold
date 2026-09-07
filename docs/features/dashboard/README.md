# Dashboard

Use the dashboard to manage projects, follow agents, and control your organization's access and spending.

## Find your way around

| View               | Use it to                                                       |
| ------------------ | --------------------------------------------------------------- |
| Overview           | Review recent work and navigate to active projects              |
| Projects           | Browse workspaces, files, checkpoints, and Git state            |
| Runs               | Filter current and historical runs and inspect their output     |
| Agent presets      | Save reusable execution configuration                           |
| Connections        | Add model keys, search providers, applications, and MCP servers |
| API keys           | Create and revoke scoped credentials                            |
| Webhooks           | Configure event destinations and inspect deliveries             |
| Usage              | Inspect activity charts, token use, requests, and costs         |
| Billing            | Manage credits, plan, and storage allowance                     |
| Account & security | Manage profile, MFA, sessions, and connected OAuth applications |
| Team               | Manage organization membership and invitations                  |

The organization selector changes your active context. Each view rechecks your permissions; a viewer cannot obtain write access by opening a direct URL. Operators have an additional **Operations** view.

## Follow a run

Open a run to see its status, output, tool calls, available reasoning summaries, and artifacts. The page preserves detailed historical events and reconnects to live output. Respond to supported input requests or cancel work from the same view.

Waiting runs show why they are waiting, how long they have waited, their expiry deadline, and held credits. Execution, checkpoint persistence, and Git sync are displayed separately.

## Work with files

Choose a project and workspace, search its files, and open a file in the editor. Save against the current revision. If another writer changes it, compare the latest version before retrying. Checkpoint restore is an explicit action; selecting history does not restore it.

## Changes from other clients

Runs started through the API, CLI, or another browser refresh relevant dashboard views. A shared signal stream updates active views and marks inactive views stale. It reconnects and periodically reconciles through the API.

Refresh signals are best-effort hints. The API remains authoritative, and detailed run events retain their separate replay history. See [live refresh](live-refresh.md) for deployment behavior and [interface implementation](implementation.md) for contributor details.
