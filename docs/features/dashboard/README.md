# Dashboard

Use the dashboard to manage workspaces, follow agents, and control your organization's access and spending.

## Find your way around

| View               | Use it to                                                          |
| ------------------ | ------------------------------------------------------------------ |
| Home               | Get started, copy an integration prompt, and return to recent work |
| Templates          | Explore five starters and search the examples library              |
| Workspaces           | Browse worktrees, files, checkpoints, and Git state               |
| Runs               | Filter current and historical runs and inspect their output        |
| Agent presets      | Save reusable execution configuration                              |
| Connections        | Add model keys, search providers, applications, and MCP servers    |
| Triggers           | Connect Slack channels and incoming webhooks to workspaces           |
| Scheduled tasks    | Save recurring prompts, inspect history, pause or run now          |
| API keys           | Create and revoke scoped credentials                               |
| Webhooks           | Configure event destinations and inspect deliveries                |
| Usage              | Inspect activity charts, token use, requests, and costs            |
| Billing            | Manage credits, plan, and storage allowance                        |
| Account & security | Manage profile, MFA, sessions, and connected OAuth applications    |
| Team               | Manage organization membership and invitations                     |

Open your account menu at the bottom of the sidebar, then open the current organization to switch context. Each view rechecks your permissions; a viewer cannot obtain write access by opening a direct URL. Operators have an additional **Operations** view.

On desktop, collapse navigation to an icon rail or drag its right edge to resize it. Icon tooltips and the bottom account menu remain available. Your browser remembers the layout; mobile uses a full navigation drawer. See [navigation layout](sidebar.md) for keyboard resizing and preference behavior.

Workspaces opens as a compact list. Use **List view** or **Grid view** to change its layout; your browser remembers the choice across navigation and refresh. Search, status filters, pagination, and workspace actions work in either layout.

## Get started

Home brings your first steps, workspaces, recent runs, and developer resources together. The setup checklist reflects your organization's current workspaces, available funding, and successful runs. Open **Setup guide** to follow those steps. Funding, permissions, and enabled models still determine whether a run can start.

On a dedicated application deployment with `LOGIN_HOMEPAGE=true`, opening `/` while signed out takes you to login. After signing in, `/` opens Home. Other deployments retain the public marketing homepage for signed-out visitors.

Describe a task in the welcome input and choose **Review run**. This opens the existing run configuration so you can select the workspace, harness, model, authorized connections, and budget before starting. Choosing a suggestion never starts work automatically.

Choose **Copy setup prompt** to give your coding agent a brief for integrating Macrofold into your own application. The prompt includes this deployment's documentation links, secure credential setup, and a verifiable first result. It contains no account secrets. You can inspect and copy it manually if clipboard access is unavailable. An agent on another machine needs a documentation origin it can reach; localhost links work only where that local server is reachable. See [Build with AI](../../getting-started/agents.md) for the full guide.

## Start from an example

The examples library features **Research brief**, **Code review**, **Data analyst**, **Support triage**, and **Personal assistant**. Preview the instructions and illustrative result, copy an implementation prompt, or choose **Use template** to prefill an agent preset. Select the harness, model, funding, and authorized connections, then save. Select a workspace when you invoke the preset.

Previewing a template or saving a preset does not connect accounts, grant tools, enable schedules, or start runs. The Personal assistant helps plan a week from supplied priorities and constraints. The ready Weekly workspace digest remains searchable. Search also includes clearly marked planned examples; those entries cannot be installed. Choose **Use and schedule** to save the preset and continue directly into a schedule review. Weekly digest starts with Monday at 09:00; choose its workspace, confirm timezone/cadence, per-run budget and funding, and expand the current connection/tool review before enabling. Existing presets offer **Schedule this preset**. The schedule list also shows the effective account-wide saved-trigger quota, including paused definitions.

## Create an API key

Open **API keys → Create API key**, name the integration, and choose its workspace access and expiration. **Permissions** starts with **Read & write**:

| Preset | Access |
| --- | --- |
| Read-only | View data without modifying resources or running agents. |
| Read & write | Read data and manage workspaces, worktrees, files, runs, connections, webhooks, triggers, and schedules. |
| Full access | Also manage billing, API keys, teams and invitations, and schedule or cancel permanent workspace deletion. |
| Custom | Choose individual permissions. |

Expand **View permissions** to inspect or edit the selected permissions. Editing any checkbox switches to Custom; selecting Custom preserves the current selection and opens the panel. At least one permission is required. A new key dialog starts fresh rather than reusing the previous key's access choices.

Presets select only permissions available to your credential. They do not change your organization role, bypass workspace restrictions, or automatically grant future permissions to an existing key. Full access is an API-key preset, not an administrator role. Copy the secret after creation; it is shown only once.

## Appearance and help

Choose **Light**, **Dark**, or **System** in the appearance switcher inside your account menu at the bottom of the sidebar. The choice is remembered in this browser and applies to menus, dialogs, editors, and charts. System follows your device setting; appearance controls also appear on sign-in screens.

**Ask Macrofold** in the lower-right corner opens the account assistant preview and help resources. The preview offers sample guidance and copyable setup instructions. It does not read account content, execute an agent, contact support, or make account changes. Its conversation is temporary and resets when the organization changes. Use the linked documentation and workspace issue tracker for current help options.

Successful copy actions animate the copy icon into a checkmark without changing the button label. The green check returns to the copy icon after three seconds; clicking again copies again and restarts the timer after success. Changed content or a failed copy clears the check. If clipboard access fails, the interface keeps a manual-copy path. Hover colors and text-field focus highlights fade smoothly. Sidebar icons make a small gesture on hover or keyboard focus; waiting labels show a subtle sheen. Your device’s reduced-motion setting suppresses gestures and decorative loops while retaining gentle color and opacity fades. No application setting is needed for these fades. Scrollbars stay hidden, while wheel, touch, and keyboard scrolling remain available.

## Follow a run

Open a run to see its status, output, tool calls, available reasoning summaries, and artifacts. The page preserves detailed historical events and reconnects to live output. Respond to supported input requests or cancel work from the same view.

Model and harness choices show their company marks in both the dropdown and selected value. Claude subscription configuration uses the Claude mark; the Codex subscription entry explains that it is not yet available and links to API-key setup. It does not collect subscription credentials.

Waiting runs show why they are waiting, how long they have waited, their expiry deadline, and held credits. Execution, checkpoint persistence, and Git sync are displayed separately.

## Work with files

Choose a workspace and worktree, then browse folders or filter files in the explorer. Use breadcrumbs to return to a parent folder. Create files and folders, upload files, or rename a selected file from its toolbar. On desktop, drag the divider to resize the explorer beside the viewer; the file view uses the available page height. On mobile, the explorer sits above the viewer.

Markdown opens in **Rich** view, with formatted text, tables, code blocks, document metadata, and a heading outline for longer documents. Choose **Source** to edit. Worktree links open through the file browser; external images appear as links you can choose to open. The preview does not execute customer HTML or scripts. Supported images, PDFs, video and audio have original-file previews; other binary and large files offer downloads. Use **Attach files** when starting a run to send supported images or document text, and **Files from this run** to download verified deliverables. See [files and media](../media/README.md) for formats, model compatibility and limits.

Edits save automatically after you stop typing for two seconds. The status changes from **Unsaved changes** to **Saving…** to **Saved** after the save and refresh finish. A failed save keeps your draft and offers **Retry save**. If another writer changes it, compare the latest version before retrying. Save or discard a draft before changing files or worktrees. Files remain read-only while an agent is working. Checkpoint restore is an explicit action; selecting history does not restore it. See [persistent worktrees](../workspaces/README.md) for file operations and checkpoint behavior.

## Changes from other clients

Runs started through the API, CLI, or another browser refresh relevant dashboard views. A shared signal stream updates active views and marks inactive views stale. It reconnects and periodically reconciles through the API.

Refresh signals are best-effort hints. The API remains authoritative, and detailed run events retain their separate replay history. See [live refresh](live-refresh.md) for deployment behavior and [interface implementation](implementation.md) for contributor details.

## Automate recurring and incoming work

Use [Triggers and scheduled tasks](../triggers/README.md) to start agents from Slack, webhooks or a saved cadence. The same run pages display output, files and cancellation controls.

## Connector access

**Connections → Tools** approves the maximum tool set; **Access** manages organization, workspace, preset and exact-pair permissions. Filter connections by workspace and preset independently. Run settings offer inherited, specific or empty selections and explicit owner-authorized exceptions for one run. Stale edits keep their draft for review and retry. See [connector access rules](../identity-integrations/connection-access.md).
