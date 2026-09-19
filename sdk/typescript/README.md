# Macrofold TypeScript SDK

Manage persistent workspaces and run Codex, Claude Code, OpenCode, Hermes, DeepSeek Harness, or Pi through typed resource methods. Requires Node.js 24 or a modern browser runtime. Keep API keys in server-side code.

Works with [Macrofold Cloud](../../docs/cloud/README.md) and [self-hosted deployments](../../docs/operations/README.md). Use the same resource methods with the origin and API key for your deployment. For help integrating an existing application, use the [coding-agent setup prompt](../../docs/getting-started/agents.md).

## Install from source

From the repository root, run `pnpm install` and `pnpm sdk:build`. In your application, install the built package with `npm install /absolute/path/to/Macrofold/sdk/typescript`.

## Start a run

Set `MACROFOLD_API_KEY` to a scoped dashboard key and copy a workspace ID. Select a harness and model directly; no saved agent or session is required. This example uses Codex and OpenAI’s GPT-5.4 mini. The model catalog determines the provider. Managed execution uses your credits; use `fixture-model` with the local simulator for free development.

```ts
import { Macrofold } from 'macrofold';

const macrofold = new Macrofold();
const run = await macrofold.runs.create({
  workspace_id: 'YOUR_WORKSPACE_ID',
  harness: 'codex',
  model: 'gpt-5.4-mini',
  billing_mode: 'managed',
  prompt: 'Create hello.txt containing Hello world.',
});
for await (const text of macrofold.runs.streamText(run.run_id)) {
  process.stdout.write(text);
}
```

The default origin is `https://app.macrofold.ai`. Override it for self-hosting, staging, or local development; for example:

```ts
const macrofold = new Macrofold({ baseURL: 'http://localhost:3210', apiKey: 'YOUR_LOCAL_API_KEY' });
```

Missing or empty credentials fail before a request. Explicit keys take precedence over the environment. `Client` remains an alias for the same client.

## Resource methods

Methods return typed responses and accept typed options, with identifiers as positional arguments:

```ts
const workspaces = await macrofold.workspaces.list({ limit: 20, archived: false });
const state = await macrofold.runs.get(run.run_id);
await macrofold.runs.cancel(run.run_id);
```

Use `limits` to set execution and spending limits, or `billing_mode: 'byok'` with an authorized `provider_connection_id`. Pagination returns `data` and `next_cursor`; pass the latter as `cursor` for the next page. Money and event sequences remain decimal strings.

Every public operation has a [resource method](../../docs/features/api/sdks/reference.md). Exported types such as `CreateRunOptions` and `Schema['Run']` support editor completion. Server-side authorization and conditional model/connection rules remain authoritative.

## Text, structured events, or a complete result

`macrofold.runs.streamText(id, { after, signal })` yields only assistant text fragments. It reconnects after interruptions or server rotation and suppresses duplicate sequences. Tool payloads, reasoning, lifecycle events, and full-response repetitions are excluded.

To wait silently for the full response:

```ts
const result = await macrofold.runs.wait(run.run_id, { timeoutMs: 300_000 });
console.log(result.output_text, result.checkpoint_id);
```

`wait()` polls status and returns the typed result after execution and persistence finish. There is no overall timeout by default. `timeoutMs` raises `WaitTimeoutError` with `runId`; an `AbortSignal` stops local waiting. Neither cancels the agent, and optional Git sync is independent. Both helpers raise `RunFailedError` with `runId`, `status`, `failureCode`, and the typed `result` for unsuccessful execution or persistence. Partial text can precede failure; API/authentication errors retain their existing types.

For structured events and replay cursors, use `macrofold.runs.events(id, { after, signal })`. The existing `runs.stream()` remains available. Save the last event sequence for replay after restarting your process; reconnects within one stream manage cursors internally. Breaking iteration or aborting detaches; `macrofold.runs.cancel(id)` stops the remote job.

## Errors and recovery

Mutations receive an idempotency key retained across bounded retries (two retries by default). The final optional argument accepts `signal`, `headers`, and `idempotencyKey`:

```ts
await macrofold.workspaces.create({ name: 'Research' }, { idempotencyKey: 'YOUR_SAVED_REQUEST_KEY' });
```

`TransportError.idempotencyKey` preserves an uncertain action's identity, including truncated successful responses. Inspect remote state and retry the same body and key. `ApiError` exposes status, code, request ID, and details. The SDK refuses redirects and requires HTTPS except on loopback hosts.

## Read persisted files

```typescript
await macrofold.runs.wait(run.run_id);
const content = await macrofold.worktrees.readFile(run.worktree_id, { path: 'hello.txt' });
console.log(new TextDecoder().decode(content));
```

The method returns `Uint8Array`; keep it as bytes for binary files.

Direct reads return the complete file up to 4 MiB. During execution they use the last published revision. See [reading files](../../docs/features/workspaces/read-files.md) for HTTP usage, larger downloads, permissions, and errors.

## Advanced access

`request(operation, options)` remains an optional escape hatch. `raw()` exposes response headers, including file revisions. `worktrees.readFile()` returns `Uint8Array`; `worktrees.writeFile(id, { path, ifMatch, content })` accepts bytes and the observed revision. `waitOperation(id)` polls maintenance work; inspect its final status.

For OAuth, pass an async `token` supplier instead of `apiKey`. A browser using dashboard session authentication can explicitly select `sessionAuth: true` with its own `baseURL`; this sends same-origin cookies and never reads an environment key. Do not combine session mode with `apiKey` or `token`. An empty token still fails normal SDK validation, even with a custom fetch. The server validates the login session and resource permissions on each request. Use an authenticated server for other browser applications.

See [API conventions](../../docs/features/api/conventions.md) for permissions, errors, pagination, and asynchronous work.

## Choose a harness

The same run methods support `codex`, `claude-code`, `opencode`, `hermes`, `deepseek`, and `pi`. Select a compatible model from the catalog. See [harness capabilities and examples](../../docs/features/execution/harnesses.md).
