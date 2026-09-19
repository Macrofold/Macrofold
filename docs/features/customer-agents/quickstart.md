# Customer-agent integration quickstart

Provision an assistant once, send messages, and retrieve its saved work. This is an **optional integration path**, not a requirement for using Macrofold. It composes the [core resources](../../getting-started/concepts.md) using one workspace, worktree and preset per customer/agent key.

## 1. Prepare your backend

Choose [Cloud](../../cloud/README.md), [self-hosting](../../operations/README.md), or [free simulation](../../getting-started/local-development/simulation.md). Follow the [TypeScript source installation](../../../sdk/typescript/README.md) or [another SDK guide](../api/sdks/README.md); registry publication is a separate release step.

Set `MACROFOLD_API_KEY` on your server. For a custom deployment, pass its origin as `baseURL` without `/v1`. Select a supported model from `models.list`; the local simulator uses `fixture-model`. For real execution, configure funding and a deliberate budget first.

Start from **API keys → Read & write → View permissions**. The complete journey needs `workspaces:read`, `workspaces:write`, `runs:read`, `runs:write` and `files:read`; account connection steps also need `connections:read` and `connections:write`. Keep `identity:read` if using catalog/account lookups. Creation needs an unrestricted-workspace credential because it creates a new workspace. Connection authorization requires the owning member to remain an organization owner or administrator. A workspace-restricted key can operate already-created bindings within its workspace scope.

The examples below run in an authenticated server handler. `customerId` means your verified session subject, and `actionKey` means a durable ID your app assigns to one intended action. They are application values, not SDK globals. Reject unauthenticated requests before invoking the SDK.

## 2. Ensure the assistant exists

```ts
import { Macrofold } from 'macrofold';

const client = new Macrofold({ baseURL: process.env.MACROFOLD_BASE_URL });
const assistant = await client.customerAgents.ensure(
  customerId,
  {
    key: 'personal-assistant',
    name: 'Milo',
    configuration: {
      harness: 'codex',
      model: process.env.MACROFOLD_MODEL!,
      billing_mode: 'managed',
      instructions: 'Help this customer organize their work. Ask before making external changes.',
      limits: { max_cost_micro_usd: '2000000', timeout_seconds: 300 },
    },
  },
  { idempotencyKey: actionKey },
);
```

The result contains `id`, `customer_id`, `key`, `name`, `workspace_id`, `worktree_id`, `agent_id` and `integration_path: 'customer-agents'`. Store the binding ID in your app. A repeated `ensure` with the same customer/key returns that binding without changing its configuration. Core IDs are deliberately exposed for advanced operations.

`2000000` micro-USD is a $2 per-run ceiling, not a monthly allowance or a price quote. Normal plan, credit, storage and concurrency controls still apply. BYOK is supported by the configuration schema; select a provider connection explicitly and follow the [named account guide](../identity-integrations/named-connections.md).

## 3. Send and observe a message

```ts
const accepted = await client.customerAgents.sendMessage(
  customerId,
  assistant.id,
  {
    prompt: 'Help plan my week and save the plan to weekly-plan.md.',
  },
  { idempotencyKey: messageActionKey },
);
// Save accepted.run_id and accepted.session_id before returning to the browser.
for await (const text of client.customerAgents.streamText(customerId, assistant.id, accepted.run_id)) {
  sendTextToYourBrowser(text);
}
const result = await client.customerAgents.waitRun(customerId, assistant.id, accepted.run_id);
console.log(result.output_text, result.persistence_status);
```

`messageActionKey` and `sendTextToYourBrowser` are supplied by your backend. Keep the key stable for retries of this exact message; a new message gets a new key. After a disconnect, resume the known run instead of sending the prompt again. `streamRun` accepts an `after` sequence for durable replay. The event stream and all reconnect/status requests stay in the customer path.

`waitRun` includes persistence and throws on failed execution or persistence. A local timeout does not cancel the remote run. Other SDKs expose `streamRun` with idiomatic casing and `getRunResult`; inspect `final`, `status`, `persistence_status` and `output_text`. See the [method reference](../api/sdks/reference.md).

## 4. Continue and read files

```ts
const continued = await client.customerAgents.sendMessage(
  customerId,
  assistant.id,
  {
    conversation_id: accepted.session_id,
    prompt: 'Keep Friday afternoon free.',
  },
  { idempotencyKey: followUpActionKey },
);
await client.customerAgents.waitRun(customerId, assistant.id, continued.run_id);
const files = await client.customerAgents.listFiles(customerId, assistant.id);
const bytes = await client.customerAgents.readFile(customerId, assistant.id, { path: 'weekly-plan.md' });
```

Omit `conversation_id` for a fresh conversation with the same files. Simulation emits scripted output and `notes/run-<run_id>.md`; it does not actually plan a week or create the prompted filename. Use a path returned by `listFiles` to verify the simulator.

## 5. Add accounts when needed

Follow [customer connections](connections.md) for hosted consent and an optional React connection card. Keep capabilities understandable (“Read my calendar”, “Create events”), with exact tools under **View permissions**. Do not require connectors to try the assistant.

## Verify before real customers

- Alice and Bob can ensure the same agent key and receive different core resource IDs. Bob’s path rejects Alice’s conversation, run and connection IDs.
- Repeating an intended message with the same idempotency key returns the same accepted run.
- Reconnecting a stream does not create another run; final files are read after verified persistence.
- An unauthenticated callback, changed customer, expired consent, or stale permission version cannot activate access.

Use [the AI integration brief](README.md#for-coding-agents) to give a coding agent this same path. Lifecycle, retention, scheduling and alternative core composition are covered by the [parent guide](README.md).
