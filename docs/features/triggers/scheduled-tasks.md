# Scheduled tasks

Save a prompt and let an agent run it repeatedly against persistent project files. Tasks run on the server with the dashboard closed.

## Create a task

1. Open **Scheduled tasks → New task**.
2. Give the task a name and choose its project and agent preset.
3. Write the prompt, such as “Prepare a morning briefing and save it in reports/.”
4. Choose hourly, daily, weekday, weekly, or custom cron timing. Confirm the timezone and delivery limit.
5. Choose **Create scheduled task**. The card shows its next occurrence.

Use **Run now** to test the saved instructions. **History** links each delivery to its run; output, tool calls and files use the usual run page. The main Runs list labels these runs **scheduled**.

## Cadence and timing

Cron uses five fields: minute, hour, day of month, month, and day of week. Timezone names use IANA identifiers such as `America/New_York`, `Europe/London`, or `UTC`.

| Expression | Cadence |
| --- | --- |
| `0 * * * *` | Every hour |
| `0 9 * * *` | Daily at 09:00 |
| `0 9 * * 1-5` | Weekdays at 09:00 |
| `0 9 * * 1` | Mondays at 09:00 |
| `*/30 * * * *` | Every half hour |

The minimum interval is one minute. Delivery limits still apply: increase the default 100-per-day cap for frequent schedules, up to 1,000. The cron parser uses the selected timezone, including daylight-saving transitions. Prefer UTC when fixed UTC times matter.

A scheduled time makes work **eligible**; it does not reserve immediate capacity. The local worker checks maintenance approximately every 15 seconds. Vercel’s configured maintenance cron runs once per minute. Under normal light load, allow roughly one to two maintenance ticks for admission and dispatch, plus existing workspace/capacity waiting. Provider slowness or backlog can increase that delay.

If the service misses several occurrences, it coalesces them into **at most one** delivery and advances to the next future time. If the task’s previous occurrence is still waiting or running, the new occurrence is skipped. The card reports the last skip reason. Runs are never interrupted to make room for a newer occurrence.

## Change or stop a task

Edit its prompt, preset, cadence, timezone or intake limit. The creator can pause and resume it; organization administrators can pause it too. **Run now** requires an enabled task and uses the same limits and admission checks.

Saving configuration invalidates deliveries that have not yet become runs. Already accepted runs preserve their configuration. Pausing or deleting a task stops future work; cancel a particular accepted run from its run page if needed. Undoing project deletion does not automatically resume its paused triggers.

Each occurrence uses a new session and the same project workspace. The preset’s configuration is resolved when the run is admitted. Keep connector permissions and BYOK credentials current; failures appear in task history.
