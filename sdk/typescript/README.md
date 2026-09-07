# Hosted agents TypeScript SDK

Typed requests, recoverable mutations, and durable event streaming for the hosted agent API. Requires Node.js 24 or a modern browser runtime. Keep API keys in server-side code.

## Install from source

From the repository root, run `pnpm install` and `pnpm sdk:build`. In your application, install the built workspace package with `npm install /absolute/path/to/Macrofold/sdk/typescript`.

## Start a run

Set `AGENT_HOST` and `AGENT_API_KEY` in your server environment. Select an enabled model from the deployment catalog. Hosted execution can consume credits.

```ts
import { Client } from '@hosted-agents/sdk';
const client = new Client({
  baseURL: process.env.AGENT_HOST!,
  token: process.env.AGENT_API_KEY!,
});
const project = await client.request('createProject', { body: { name: 'Research' } });
const run = await client.request('createRun', {
  body: {
    project_id: project.id,
    harness: 'codex',
    model: 'YOUR_ENABLED_MODEL',
    billing_mode: 'managed',
    prompt: 'Read the project and write a research brief.',
    limits: { timeout_seconds: 900, max_cost_micro_usd: '2000000' },
  },
});
for await (const event of client.stream(run.run_id)) {
  if (event.type === 'output.delta') process.stdout.write(String(event.data.text));
}
const result = await client.request('getRunResult', { params: { path: { run_id: run.run_id } } });
```

## Requests and operations

Use operation IDs from the API reference with `request()`. Parameters are grouped as `params.path`, `params.query`, and `params.header`. Binary `readFile` returns `Uint8Array`; use `raw()` when you also need revision or content headers. `waitOperation()` polls a background operation. Its returned status may be failed; inspect that status before using its result.

## Streaming

`stream()` reconnects with a durable cursor after server rotation. Supply `after` to resume an already rendered sequence and an `AbortSignal` to detach the client. Detaching does not cancel the remote run; call `cancelRun` explicitly. API authentication failures are surfaced rather than silently dropping events.

## Errors and recovery

Mutations receive an idempotency key retained across bounded transport retries. For recovery across process restarts, supply your own `idempotencyKey`. A `TransportError` includes that key when the service could not confirm the mutation. Retrying with a different key could create a second action. `ApiError` includes status, code, request ID and structured details. Credentials are sent only to the configured service origin; redirects are rejected.

This recovery identity is also retained if success headers arrive but the response body is truncated. The client does not automatically repeat that action; retry the identical request with the supplied key after inspecting remote state.

## Authentication

For OAuth, supply an async `token` callback that returns a current access token. The CLI implements device login and rotated refresh-token storage on top of this mechanism. Never put an API key in a browser application; use its authenticated server or dashboard cookie session instead.

See the [API guide](https://github.com/Macrofold/Macrofold/blob/main/docs/features/api/README.md) and [OpenAPI contract](https://github.com/Macrofold/Macrofold/blob/main/docs/api/openapi.json) for all operation IDs and schemas.
