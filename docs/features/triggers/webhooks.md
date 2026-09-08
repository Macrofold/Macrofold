# Start an agent with a webhook

Give another service a secure URL that starts work in a particular project. The trigger’s saved agent preset determines execution and billing; the caller cannot override those settings.

## Create and call a trigger

1. Open **Triggers → Create trigger → Incoming webhook**.
2. Choose a project and agent preset, add a name and instructions, and set an intake limit.
3. Create the trigger. Copy its URL and one-time secret to the sending service.
4. Configure the service to send JSON with an `Authorization: Bearer` header and a unique `Idempotency-Key` for each event.

```bash
curl "$TRIGGER_URL" \
  -H "Authorization: Bearer $TRIGGER_SECRET" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: source-event-123' \
  -d '{"prompt":"Create a summary of today’s research."}'
```

The URL ends in `/events/webhook/{trigger_id}`. The secret is separate from the URL and from a Macrofold API key. Keep it in the sending service’s secret configuration. Services that cannot set authentication and event-identity headers need a small adapter that can; an unauthenticated URL alone is insufficient.

## Payload and retry behavior

Send a JSON object up to 64 KiB. If it has a string `prompt`, that text is appended to the saved instructions. Otherwise, the whole JSON object is appended as context. Combined instructions and incoming text are limited to 60,000 characters. Treat external payloads as data; configure agent tool grants for the work the service is allowed to request.

A successful request returns **202** with a delivery `id`, `trigger_id`, `status`, `expires_at`, and initially empty `run_id`. Use the authenticated trigger delivery history to find the admitted run, then the normal run APIs or SDK `wait`/`events` helpers to follow it. The HTTP request does not remain open until execution finishes.

Reuse the same `Idempotency-Key` when retrying an event. Concurrent retries return the same delivery; changing its effective input under that key returns **409**. A new event needs a new key, even if its text is identical. Use stable event IDs from the originating service whenever possible.

**401** means the secret is missing or incorrect. **429** means the trigger’s rolling intake or waiting-delivery limit has been reached. **409** can indicate a paused trigger or a reused event ID with different input. Correct the condition before retrying. Retry transient failures with backoff and the original event identity.

## Manage the endpoint

The trigger card lets you copy its URL, rotate its secret, inspect history, pause, edit and delete. Rotation immediately invalidates the old secret. Deletion removes incoming routing while retaining accepted runs.

Incoming triggers start agents. [Outbound webhooks](../api/events.md) notify your application about completion and other changes; configure those separately when you need a callback after the run finishes.
