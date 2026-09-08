# Connect a Slack bot

Connect your own Slack app to a project. New human messages in the selected channel start the saved agent; its response appears in the message’s Slack thread.

## Set up once

1. In Slack’s [app dashboard](https://api.slack.com/apps), create an app **From scratch** and choose your Slack workspace.
2. In **OAuth & Permissions → Bot Token Scopes**, add `chat:write`, `channels:read`, `groups:read`, `channels:history`, and `groups:history`. Install the app to your workspace. Copy its **Bot User OAuth Token** (`xoxb-…`). Workspace administrators may need to approve installation.
3. In **Basic Information → App Credentials**, copy the **Signing Secret**.
4. In Macrofold, open **Triggers → Slack connections → Connect a bot**. Enter a name, the bot token and signing secret, then choose **Connect Slack bot**. Copy the connection’s **Events request URL**.
5. Back in Slack, enable **Event Subscriptions**, paste that exact URL as the **Request URL**, and wait for verification. Subscribe to the bot events `message.channels` and `message.groups`, then save. Reinstall the app if Slack requests it after changing scopes.
6. Invite the bot to the channel, for example with Slack’s `/invite` command. Private channels require an explicit invitation too.
7. In Macrofold, choose **Create trigger → Slack**. Select the connection and channel, choose your project and agent preset, and write the instructions that should precede each message. Save, then send a human message in that channel.

The channel dropdown shows channels the bot has joined and offers **More channels** for additional pages. You can also paste a channel ID from Slack’s channel details. Channel IDs remain stable when a channel is renamed. One channel can have one trigger per bot connection.

Your request URL uses the configured Macrofold deployment origin. For local development, Slack needs a public HTTPS tunnel to your local application; copy the externally reachable URL into Slack while keeping the `/events/slack/{connection_id}` path. The app and worker must both be running. Do not tunnel a production database or put credentials in the URL.

## What messages do

The saved instructions and incoming message become a new run using the project’s default workspace. Existing project files persist between messages. Every message starts a fresh session; the trigger does not automatically fetch the entire Slack conversation.

Standard human text messages and mentions start runs. Bot messages, message subtype events (including edits, deletions and file shares), hidden events, and empty messages are ignored. Duplicate Slack deliveries are suppressed, including the same message received as both a message and mention event. Replies use the originating thread, remain in the same channel, and cannot trigger a bot loop. Text is rendered as plain text so generated mentions do not ping a channel.

**Anyone who can send a human message in the selected channel can request work under the trigger creator’s preset and budget.** Choose a channel whose members you trust with those capabilities. Limit deliveries and configure the preset’s model, connector grants and spending limit accordingly.

## Results and troubleshooting

Open **History** on the trigger to inspect delivery and reply status. A successful reply includes the assistant’s text, truncated for Slack when necessary, and a link to the full run. Failed or cancelled agent runs receive a status reply. Admission failures such as a missing budget appear in delivery history before a run exists.

- **No channels:** invite the bot, check channel scopes, and reinstall the Slack app after adding scopes.
- **URL verification fails:** check the public HTTPS URL, signing secret, app/worker deployment configuration, and server clock.
- **No run:** check that the trigger is enabled, its channel ID matches, the sender is human, the intake limit has room, and the creator still has execution access.
- **Waiting delivery:** another run may own the project’s workspace. History shows the reason and deadline.
- **Failed reply:** inspect the delivery error, channel membership and `chat:write` scope.
- **Uncertain reply:** Slack may have received the message before the connection or worker stopped. Check the Slack thread before choosing **Retry reply**. Retrying a reply never restarts the agent.

Disconnecting a bot removes its stored credentials and pauses its triggers. To replace bot credentials, disconnect, reconnect and update the trigger’s connection; configure the new Events request URL in Slack.

Slack tokens and signing secrets are encrypted with the deployment’s vault key. This inbound integration uses your customer-owned Slack app; it does not require Composio. Agent tool access to Slack through a separate connector remains independently configured.

See Slack’s official [request verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/), [Events API](https://docs.slack.dev/apis/events-api/), and [message posting](https://docs.slack.dev/reference/methods/chat.postMessage/) documentation for app configuration details.
