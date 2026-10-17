# Explicit-context decisions

Make a decision without creating a worktree, conversation, or sandbox. Supply an exact model binding, its native request in `input`, and finite `limits`. For application-validated answers, optionally add a typed definition and explicit context. The [Decision 1 example](#use-microsoft-decision-1-through-openrouter) below uses the simpler native request.

Your application remains responsible for its users, evidence relevance, current business rules, and permission to apply a proposed action. Schema validation proves shape, not truth or authority.

## Choose the execution mode

| Mode          | Use it for                                                     | Execution boundary                                      |
| ------------- | -------------------------------------------------------------- | ------------------------------------------------------- |
| Inference     | One classification, score, or JSON proposal                    | One provider request; no tools or implicit conversation |
| Bounded agent | Inspect explicitly granted evidence before proposing an answer | Finite model/read-tool loop in trusted platform code    |
| Native agent  | Coding, shell commands, filesystem authoring, native sessions  | Existing isolated harness and persistent worktree       |

Use [bounded agents and tasks](tasks.md) only when one decision is insufficient. Native [run and session APIs](../api/README.md) retain their behavior. These execution modes are general capabilities, separate from the optional [Customer agents integration path](../customer-agents/README.md).

## Before submitting

1. Decision execution is supported by default. Your deployment needs provider credentials and paid-execution authorization. An explicit admission pause (`RUN_ADMISSION_ENABLED=false`) returns `inference_disabled`.
2. Create a backend API key with `runs:write` and `runs:read`. If the key is workspace-restricted, include an authorized `workspace_id`; stateless native calls may omit it with an unrestricted key. Saved context/definitions and bounded agents require a workspace. Add `files:write`/`files:read` to publish/read context artifacts. Keep the key in your application's backend.
3. Choose a supported, configured model and managed or exact BYOK credentials. Request limits may lower a definition's ceilings, never raise them.
4. Authenticate your own end user or actor. The workspace-bound key establishes the application namespace; the backend asserts the audience. An actor ID is not independent authorization.

Dashboard sessions and OAuth credentials can inspect runs within their grants, but cannot submit direct decisions or task wakes in this first version. Separate applications into separate workspace-bound namespaces. There is no mandatory customer or actor directory.

## First decision

Use the [API quickstart](../api/quickstart.md) to obtain a workspace ID and scoped key, and install a [language SDK](../api/sdks/README.md). This TypeScript example uses the shared asynchronous run methods:

```ts
import { Client } from 'macrofold';

const client = new Client({
  baseURL: process.env.MACROFOLD_BASE_URL,
  apiKey: process.env.MACROFOLD_API_KEY,
});
const now = new Date().toISOString();
const accepted = await client.inferences.create(
  {
    workspace_id: process.env.MACROFOLD_WORKSPACE_ID!,
    definition: {
      revision: 'exception-triage/1',
      prompt:
        'Classify this customer exception using supplied evidence only. Choose unknown if evidence is insufficient.',
      input_schema: {
        type: 'object',
        properties: { case_id: { type: 'string' } },
        required: ['case_id'],
        additionalProperties: false,
      },
      output_schema: { type: 'string', enum: ['wait', 'investigate', 'unknown'] },
      question: {
        kind: 'choice',
        criteria: {
          wait: 'No relevant change',
          investigate: 'Needs inspection',
          unknown: 'Insufficient evidence',
        },
      },
      unknown_values: ['unknown'],
      required_records: ['case'],
      require_complete: true,
      require_snapshot: true,
      allowed_models: [{ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }],
      limits: { max_cost_micro_usd: '20000', max_output_tokens: 256, timeout_seconds: 20 },
    },
    input: { case_id: 'case-42' },
    context: {
      schema_version: 1,
      template_revision: 'case-context/1',
      audience: { kind: 'application_actor', id: 'customer-42' },
      observed_at: now,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      consistency: 'snapshot',
      complete: true,
      truncated: false,
      dependency_tokens: { case: '7', customer_cases_query: '12' },
      items: [
        {
          id: 'case',
          kind: 'observation',
          status: 'known',
          source: 'app:customer-case',
          source_revision: '7',
          observed_at: now,
          value: { overdue: true },
        },
      ],
    },
    model_binding: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', billing_mode: 'managed' },
    queue_timeout_seconds: 5,
  },
  { idempotencyKey: crypto.randomUUID() },
);

const result = await client.runs.wait(accepted.run_id);
const receipt = result.inference;
if (receipt?.outcome === 'value') {
  // Compare dependency_tokens with current application state before authorizing an action.
  console.log(receipt.value, receipt.dependency_tokens);
} else {
  // Unknown, stale or refused answers are explicit outcomes, not default values.
  console.log(receipt?.outcome, receipt?.reason_code);
}
```

An accepted response contains `run_id`, `kind`, status/result/events/stream/cancel URLs, and null worktree/session IDs. Keep the same idempotency key and body after an uncertain submission response; a changed body conflicts. A deliberate new inference uses a new identity. `runs.wait` throws a typed run error for failed/cancelled/timed-out execution; its result and `runs.getResult` retain the receipt. Waiting or disconnecting does not cancel work.

Python, Go, Rust, and Java expose the same operations through their generated resources; use the [method reference](../api/sdks/reference.md). REST uses `POST /v1/inferences` with `Idempotency-Key`. The customer MCP exposes `createInference` with the same server-side requirements. The CLI can inspect, attach to, and cancel the returned run; plain attachment prints the decision receipt.

### Build this with your coding agent

Copy this brief alongside the example above. Supply the deployment origin and workspace ID; enter credentials through your secret manager or local environment, never in the conversation.

```text
Add one backend-only typed decision using Macrofold. Read this deployment's
/docs/decisions, /docs/decisions/context, and /docs/sdk first.
Use its OpenAPI contract for the selected SDK's current types.
Authenticate our user, construct only the evidence they may see, and submit
with a stable idempotency key, exact model, output schema, and finite budget.
Wait for the run, handle unknown/refused/stale/uncertain outcomes explicitly,
and recheck application dependencies before applying any proposed action.
Keep credentials server-side. Verify one synthetic end-to-end case and show
the validated receipt; do not enable paid execution or apply external effects
without the application's authorization.
```

## Interpret the result

| Receipt outcome  | Meaning                                                                   | Application response                                            |
| ---------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `value`          | Provider output passed local schema and choice/range checks               | Recheck relevant dependencies and authorize any effect          |
| `unknown`        | A schema-valid value matched the definition's explicit `unknown_values`   | Abstain, request evidence, or apply a deterministic policy      |
| `refused`        | The provider explicitly refused                                           | Handle refusal; no fabricated value                             |
| `invalid_output` | The response did not satisfy the contract                                 | Inspect the receipt; no coercion or automatic second model call |
| `stale_input`    | Admitted evidence expired before dispatch or publication                  | Submit a fresh explicitly authorized snapshot                   |
| `failed`         | A known local preparation/tool/authorization failure                      | Fix the reported cause before creating new work                 |
| `uncertain`      | A provider request may have completed without a usable committed response | Inspect evidence and provisional cost; no automatic repetition  |

Canonical run status separately records cancellation, timeout, success, or failure. `succeeded` can carry an abstention, refusal, or stale-input outcome; inspect the receipt before using a value. Cancellation cannot guarantee remote termination. Late evidence cannot revive a terminal run or authorize an application effect.

Receipts preserve definition/schema/context digests, the actual credential-free provider-request digest, transformation version, dependency tokens, exact model binding, provider-reported revision when available, usage identity, and validation status. A dated model ID is not a guarantee of immutable provider weights; absent provider version evidence is `unavailable`. Provider confidence/probabilities remain evidence, never correctness or permission.

## Models and limits

| Provider binding | Model | Supported decisions |
| --- | --- | --- |
| `anthropic` | Exact reviewed Anthropic routes in [model policy](../../../packages/core/src/model-policy.ts) | JSON, choice, score; bounded agents |
| `openrouter` | Enabled generative routes in the [model catalog](../execution/models.md) | Native chat requests, JSON, choice, score; bounded agents |
| `openrouter` | `typesafe/jev-1.13` | Choice and score through OpenRouter Decisions |
| `openrouter` | `microsoft/microsoft-decision-1` | Native noul/choice/score requests; optional typed choice and score |
| `typesafe` | `jev-1.13.0` | Choice and score directly through TypeSafe |

Decision-model scores are finite numbers from zero through the last criterion index. Neither Jev nor Decision 1 runs bounded agents or generates arbitrary JSON. Native mode preserves all named questions and complete provider answers, including probabilities; optional typed definitions extract and validate one choice/score. Unknown models and incompatible capabilities are rejected before dispatch. `listModels` exposes cached generative routes; decision-only routes are selected by the exact bindings above. A successful decision request does not establish availability of a separate generative model used afterward.

OpenRouter generative inference requires fresh discovered prices. Admission preparation attempts a bounded metadata refresh if prices are missing or expired, without requiring a worker for a direct call. If discovery fails or is already in progress, stale models remain rejected; see [refresh and recovery](../execution/models.md#refresh-and-caching). No model or credential fallback is performed.

### Use Jev with an OpenRouter key

You do not need a TypeSafe key. For managed billing, the deployment operator configures `OPENROUTER_API_KEY`; to use your own account, follow [Bring a decision-provider key](context.md#bring-a-decision-provider-key). With the definition, input and context from the first-decision example, select the OpenRouter binding in **both** the definition's allowed models and the request:

```ts
definition.allowed_models = [{ provider: 'openrouter', model: 'typesafe/jev-1.13' }];
const accepted = await client.inferences.create({
  workspace_id: workspaceId,
  definition,
  input,
  context,
  model_binding: { provider: 'openrouter', model: 'typesafe/jev-1.13', billing_mode: 'managed' },
});
const result = await client.runs.wait(accepted.run_id);
```

Macrofold uses OpenRouter's [Decisions endpoint](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request), rather than its chat endpoint. The response follows the same decision receipt contract, including OpenRouter's request ID and reported model revision. Requests carry frozen price ceilings and disable provider fallback. An unavailable route or rejected key is surfaced without silently switching to direct TypeSafe or another model. OpenRouter currently labels this endpoint alpha; its account availability and protocol can change.

### Use Microsoft Decision 1 through OpenRouter

Configure an OpenRouter managed key on the deployment or reuse an existing [OpenRouter BYOK connection](context.md#bring-a-decision-provider-key). No Microsoft/Azure credential is needed. This example uses the existing SDK's native-request interface; `definition`, `context` and a provider-mode flag are unnecessary:

```ts
import { Client } from 'macrofold';

const client = new Client({
  baseURL: process.env.MACROFOLD_BASE_URL,
  apiKey: process.env.MACROFOLD_API_KEY,
});
const accepted = await client.inferences.create(
  {
    workspace_id: process.env.MACROFOLD_WORKSPACE_ID,
    model_binding: {
      provider: 'openrouter',
      model: 'microsoft/microsoft-decision-1',
      billing_mode: 'managed',
    },
    input: {
      state: 'Checkout returns a server error. Customers cannot complete a purchase.',
      questions: {
        is_bug: { type: 'noul', instructions: 'Does this describe broken software?' },
        team: {
          type: 'choice',
          instructions: 'Which team should investigate?',
          criteria: { engineering: 'Errors and outages', billing: 'Invoice questions' },
        },
        urgency: {
          type: 'score',
          instructions: 'How urgent is this?',
          criteria: ['Low', 'Medium', 'High'],
        },
      },
    },
    limits: { max_cost_micro_usd: '2000', max_output_tokens: 256, timeout_seconds: 30 },
  },
  { idempotencyKey: crypto.randomUUID() },
);
const result = accepted.result ?? (await client.runs.wait(accepted.run_id));
if (result.inference?.outcome === 'value') console.log(result.inference.value);
else console.log(result.inference?.outcome, result.inference?.reason_code);
```

Native single-call inference normally completes in the HTTP request. REST uses the same JSON at `POST /v1/inferences`; send `Prefer: respond-async` to request an accepted Run without waiting. In either case the Run remains available through its result/events/cancel URLs. `result.inference.value` retains the complete provider response: `answers.is_bug.noul`, the selected `answers.team.choice` and probabilities, the weighted `answers.urgency.score`, model identity and token usage. A `noul` value is a probability, not a boolean; your application chooses and validates its threshold. A score ranges from zero through the last criterion index.

For BYOK, change `billing_mode` to `byok` and set `provider_connection_id` to your OpenRouter model connection. Macrofold's model charge is zero; reported usage still consumes the request budget and provider cost remains separately visible. For a typed definition, put the Decision 1 binding in both `allowed_models` and `model_binding` and choose `question.kind: "choice"` or `"score"`.

Decision 1 uses the same alpha Decisions endpoint and price/fallback controls as Jev. Its reviewed rate is $0.042 per million input tokens, with no output-token charge; the provider enforces its 32,768-token context window. It does not support incremental output: `stream: true` is rejected before admission. Use the native `input.provider` preferences for supported decision routing; chat reasoning parameters and native harness selection do not apply. See [Microsoft's guide](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision) and [OpenRouter's model page](https://openrouter.ai/microsoft/microsoft-decision-1) for provider behavior. Probabilities are model evidence; validate calibration on your workload before automating effects.

### Request bounds and billing

Maximum defaults: 256 KiB inline input, 2 MiB context, 64 evidence items. Operators can lower these bounds. Schemas are limited to 32 KiB, 128 nodes and eight levels, using a finite JSON Schema subset: ordinary types/properties/items, required/additionalProperties, enums/constants, scalar and collection bounds, title/description. Remote references, regexes, and combinatorial alternatives are rejected. Inputs and outputs are never coerced, defaulted, or silently truncated.

The provider enforces its actual model context window. Macrofold does not treat serialized UTF-8 bytes as tokens or reject requests against a fixed token window. It still uses a conservative input bound to authorize spending before each call; an insufficient spending ceiling can therefore stop a request even when its context fits. Actual reported tokens determine settled usage. Responses are bounded to 512 KiB. See the API schemas for numeric call/time/token maxima.

Jev has two documented limits: 64K tokens for state plus all questions, and 32K for state plus the longest individual question ([TypeSafe model limits](https://docs.typesafe.ai/models)). OpenRouter advertises 32K, but a live synthetic request with two questions accepted 60,369 input tokens; a roughly 60K single-state request was rejected. A large total budget does not permit a 60K state. Macrofold delegates these tokenizer-specific checks to the provider and never silently truncates evidence.

Managed requests reserve the run ceiling in the existing wallet. BYOK uses the exact selected healthy connection and never substitutes a platform key. Missing usage consumes the request's authorized bound provisionally, not zero. Late usage is retained for operator reconciliation; this version does not automatically refund a terminal provisional charge. Recorded provider cost is an estimate under frozen cost terms, distinct from the customer charge, not an upstream invoice.

## Next steps

Anthropic Messages and OpenRouter chat support [direct output deltas](../api/streaming.md) with top-level `stream: true`. Bounded generative calls use the same adapters and retain durable run events. Jev and Decision 1 return completed responses and reject explicit streaming before admission.

- [Context and reusable definitions](context.md): evidence semantics, immutable references, audience checks and retention.
- [Bounded agents and tasks](tasks.md): read-only investigations, task ceilings, wakes and application receipts.
- [Contract examples](../../../examples/decisions/README.md): customer exceptions and actor decisions without application-specific platform logic.
- Maintainers: [implementation](implementation.md) and [verification](verification.md).
