# Custom model deployments

Host a native Kev decision model or a Hugging Face chat model, or use an existing OpenAI-compatible chat server or a native SystemOne decision server through Macrofold’s direct inference API. A deployment has a stable ID, immutable model revisions, current application grants and an explicit running or stopped service policy. The dashboard’s **Model deployments** page and `macrofold model-deployment` commands use the same API.

Managed hosting uses your RunPod account, a pinned native Kev or vLLM recipe and warm capacity. Native Kev scoring loads its base model, adapter, scoring head and calibration once; subsequent calls reuse that loaded model. Your provider bills startup, idle workers, inference and storage. Macrofold’s separate custom-model request fee is initially zero. External hosts remain your responsibility; stopping Macrofold access does not stop their machines or bills. Unknown infrastructure costs remain unknown.

## Set up a service

1. Sign in as the deployment owner. Management needs unrestricted owner or administrator membership and `model-deployments:write`. Every private Hugging Face, RunPod and endpoint connection must have that same owner.
2. Add your hosting credential under **Connections → Add connection → Model hosting → RunPod account**, or use the same form during deployment setup. Enter a name and your RunPod API key, then **Save connection**; no app OAuth or connector enablement is required. In **Model deployments**, choose **Create deployment**. For managed hosting, select **Native decisions** (for example `jaredpalmer/kev-4b`) or **Chat generation**, paste the model’s Hugging Face repository or URL, inspect compatibility and select your RunPod connection. Inspection buys no compute. Complete any gated access in Hugging Face and acknowledge the pinned model’s license where required.
3. Select a supported runtime, compatible GPU pool, GPU count and model limits. For latency-sensitive workloads, select inspected regions near the Macrofold API and its callers; an empty `region_ids` list lets the provider choose globally. Inspection distinguishes unsupported architecture/format, missing templates, remote code and inaccessible sources. Chat hosting uses safetensors. Native hosting accepts official Kev-compatible adapter/full checkpoints with a scoring head and pinned base provenance. Remote repository code remains disabled; native head tensors use the publisher’s safe weights-only loader. Inspection accepts supported canonical chat-template files and nested selected safetensors. An explicit `weight_files` selection must contain at least one file. The reported memory requirement includes estimated weights, conversion/loading overhead and context/concurrency cache; hardware checks account for configured GPU memory utilization and parallelism. Successful inspection does not establish successful GPU loading.
4. Save the deployment, initially stopped. Choose its revision, warm minimum and maximum replicas, request concurrency and maximum hourly infrastructure rate. One warm replica is the default starting point; additional replicas remain subject to compatible capacity and your rate ceiling. Optionally choose a stop time. Start explicitly, then wait for **Ready**.
5. Grant your backend’s API key or current organization subject read/use access to selected workspaces, or deliberately all workspaces. Copy the deployment ID. Granting access does not restart the service or give the application any provider credentials.

For an existing server, choose **Use an existing model endpoint**, select **OpenAI-compatible chat** or **SystemOne decisions (Kev / Jev)**, and choose a connection with the exact API base URL, usually ending in `/v1`. Declare the served model, context/output/concurrency limits and hosting responsibility. Chat endpoints additionally declare native parameters and schema/tool/streaming capabilities. Plain-text-only servers are valid. Source commit, engine version and hosting cost may be unknown; declarations are operator claims. Metered commercial APIs require their accounted provider adapter rather than this separately hosted, zero-request-fee route.

Managed `kev-systemone-v1` hosting runs the publisher’s native Kev implementation. Managed `vllm-0.32.0-text` hosting retains chat generation. Importing an external SystemOne endpoint remains available; serving base chat weights never tests a decision head. The endpoint must implement authenticated `GET /models` (OpenAI `data[].id` or native Kev `models[].name`) and `POST /systemone` relative to its configured base URL. Macrofold does not install or launch that external server.

Cloud requires reachable public HTTPS. A self-hosted local installation can explicitly allow exact private origins with `LOCAL_MODEL_ENDPOINT_ALLOWED_ORIGINS`; this is independent of MCP/webhook network policy. A Cloud server cannot reach your laptop through `localhost`.

## Call from Open Legend or another backend

Use matching server and generated-client builds. For an unpublished TypeScript build, run `pnpm sdk:build` and `npm pack ./sdk/typescript --pack-destination .data/releases` in Macrofold, then install the resulting `macrofold-0.1.0.tgz` in the consumer application. The [SDK guide](../api/sdks/implementation.md) covers all five client builds. Configure `MACROFOLD_BASE_URL`, `MACROFOLD_API_KEY`, `MACROFOLD_WORKSPACE_ID` and `MACROFOLD_DEPLOYMENT_ID` in the backend environment.

Keep the API key in your backend environment. It needs `runs:write`, `runs:read`, `model-deployments:read` and `model-deployments:use`, plus an active deployment grant. Supply the authorized `workspace_id` when using workspace-scoped credentials or grants. Applications own their users’ authorization, prompt/context privacy and final output validation.

```ts
import { Client } from 'macrofold';

const client = new Client({
  baseURL: process.env.MACROFOLD_BASE_URL,
  apiKey: process.env.MACROFOLD_API_KEY,
});
const request = {
  workspace_id: process.env.MACROFOLD_WORKSPACE_ID,
  model_binding: { deployment_id: process.env.MACROFOLD_DEPLOYMENT_ID! },
  input: {
    messages: [{ role: 'user', content: 'Return a short greeting.' }],
    temperature: 0.2,
  },
  limits: { max_cost_micro_usd: '0', max_output_tokens: 128, timeout_seconds: 30 },
};
// Persist this key and exact body before submission for recovery after process loss.
const receipt = await client.inferences.create(request, { idempotencyKey: crypto.randomUUID() });
if (receipt.status === 'running') {
  console.log(receipt.run_id, receipt.recovery_reason, receipt.urls.result);
} else if (receipt.result.inference?.outcome === 'value') {
  console.log(receipt.result.inference.value); // Complete provider-native chat response.
  console.log(receipt.result.inference.deployment);
}
```

REST uses `POST /v1/inferences` with Bearer authentication and `Idempotency-Key`. Do not send a provider, endpoint, billing mode, connection ID or native `input.model` in a deployment binding. Macrofold injects the admitted model alias. An optional `model_binding.deployment_revision_id` requires that exact serving revision for a new request. Typed decision definitions and bounded-agent protocols remain separate from custom deployments.

### Native Kev / Jev decisions

To host the model yourself through Macrofold, inspect `jaredpalmer/kev-4b` with `task: "decision"`, choose the returned `kev-systemone-v1` runtime and compatible GPU, save the ordinary managed deployment, then start it with a bounded service policy. No customer container build or image publication is needed. The operator configures one reusable native image for all compatible model revisions. Official Kev and community “uncensored” models are distinct artifacts: inspection rejects incompatible heads and missing immutable base provenance instead of silently loading chat weights.

For a SystemOne deployment, replace the chat `input` with native `state` and named `questions`. The same REST endpoint, SDK method, grants, idempotency and receipts apply:

```ts
const receipt = await client.inferences.create(
  {
    workspace_id: process.env.MACROFOLD_WORKSPACE_ID,
    model_binding: { deployment_id: process.env.MACROFOLD_DEPLOYMENT_ID! },
    input: {
      state: { weather: 'rain', shelter: 'nearby' },
      questions: {
        needs_shelter: { type: 'noul', instructions: 'Is shelter useful in these conditions?' },
        urgency: {
          type: 'score',
          instructions: 'How urgent is finding shelter?',
          criteria: ['Very low', 'Low', 'Moderate', 'High', 'Very high', 'Critical'],
        },
        shelter: {
          type: 'choice',
          instructions: 'Choose the sensible next action.',
          criteria: { enter: 'Enter the nearby shelter.', wait: 'Wait outside in the rain.' },
        },
      },
    },
    limits: { max_cost_micro_usd: '0', max_output_tokens: 1024, timeout_seconds: 30 },
  },
  { idempotencyKey: crypto.randomUUID() },
);
// Check receipt.status/outcome first, then read result.inference.value.answers.
```

Question types are native `noul`, `choice` and `score`. State, instructions and criterion values can contain JSON. The complete native response preserves probabilities, confidence, latency and other provider fields. Reported output tokens describe the server's answer accounting; a pointer-head model need not generate text tokens. `stream: true` rejects with HTTP 422 before a Run or provider call; these decision responses do not stream.

### Configure managed native hosting by API

The dashboard is the shortest setup path. Coding agents can use these same public operations; inspect first and review both checkpoint and base licenses before acknowledging them:

```ts
const inspection = await client.request('inspectModelDeployment', {
  body: {
    source: { kind: 'hugging_face', repository: 'jaredpalmer/kev-4b' },
    task: 'decision',
    compute_connection_id: process.env.MACROFOLD_RUNPOD_CONNECTION_ID!,
  },
});
if (!inspection.supported || !inspection.source) throw new Error(JSON.stringify(inspection.findings));
const runtime = inspection.runtime_profiles.find((item) => item.profile_id === 'kev-systemone-v1');
if (!runtime) throw new Error('Native serving runtime is not configured.');
console.log(inspection.license, inspection.hosting_options); // Review license and choose an offer.
const deployment = await client.request('createModelDeployment', {
  body: {
    name: 'Native decisions',
    source: { ...inspection.source, license_acknowledged: true },
    runtime: { profile_id: 'kev-systemone-v1', parameters: runtime.parameters },
    hosting: {
      kind: 'runpod_serverless',
      compute_connection_id: process.env.MACROFOLD_RUNPOD_CONNECTION_ID!,
      placement: {
        gpu_pool_ids: [process.env.MACROFOLD_GPU_POOL_ID!],
        region_ids: [process.env.MACROFOLD_MODEL_REGION_ID!], // Choose from the inspected offer's regions.
        gpu_count: 1,
      },
    },
    access: { grants: [] },
  },
});
await client.request('setModelDeploymentService', {
  params: { path: { deployment_id: deployment.deployment_id } },
  body: {
    deployment_revision_id: deployment.desired_revision_id!,
    desired_state: 'running',
    policy: {
      min_replicas: 1,
      max_replicas: 1,
      max_concurrent_requests: 4,
      max_hourly_cost_micro_usd: '1000000', // $1/hour ceiling; choose a fitting inspected offer.
      stop_at: new Date(Date.now() + 30 * 60_000).toISOString(), // Optional bounded trial.
    },
  },
});
```

Poll `getModelDeployment` until `state` is `ready`; inspect its `failure_code` if startup fails. Create the application grant through `createModelDeploymentGrant` before calling inference with that application's key. Stop with `setModelDeploymentService` using the same revision/policy and `desired_state: "stopped"`, then verify cleanup through `getModelDeployment`. `deleteModelDeployment` retires the metadata and reconciles owned capacity; completed Run receipts remain available. Keep explicit idempotency keys for management mutations as well as inference. See [grants and lifecycle contract](../../projects/hugging-face-model-deployments-contract.md) for exact grant bodies and recovery behavior.

Managed `ready_replicas` counts workers whose loaded model identity was verified, rather than containers merely marked running. During startup or scaling it can be a conservative lower bound while background checks finish. A proof lasts at most 60 seconds and is discarded when the worker stops, restarts or explicitly fails readiness. A busy worker's transport timeout does not extend that proof. These checks do not make model calls and never run on each inference request.

For imported endpoints, use `hosting.kind: "external_systemone"` and `source.capabilities.protocol: "systemone"`. Set all chat, JSON-schema, tool and streaming flags to false, `accepted_parameters: ["state", "questions"]`, `schema_keywords: []` and `schema_dialect: null`; keep the positive context/output/concurrency limits. Existing chat hosting retains `external_openai` and `openai_chat`.

Supported native text, structured output, tool-call data and multiple completions remain under `result.inference.value`. Macrofold does not parse game-specific JSON or execute returned tools. Supported streams use `client.inferences.stream` and the existing final receipt protocol; partial output never authorizes an application effect. Malformed native object fields return a nonretryable HTTP 400 before admission; unsupported declared capabilities return HTTP 422 before generation without a hidden downgrade or model substitution.

Complete native JSON responses currently have a 512 KiB application limit, including probabilities and provider metadata. Larger responses fail visibly; a response limit does not establish that upstream work was free or unexecuted.

Ordinary responses are finalized HTTP 200, including terminal failures; inspect `status` and `result.inference.outcome`. Exceptional HTTP 202 identifies an already accepted Run still executing or recovering. Recover that same Run through its receipt URLs. Reusing the same key/body after an update or stop returns the original invocation and revision. Neither a changed revision nor an uncertain response authorizes a second provider call. Execution windows are at most 240 seconds and must fit before any scheduled stop.

The terminal deployment and cost-attribution fields identify the admitted revision. Token usage may be missing independently of the zero request fee. Infrastructure estimates/provider-reported costs belong to the deployment’s time window, are not included in the request charge and must not be added to overlapping cost diagnostics. Switching to an external host preserves historical managed amounts while marking current external expense unknown; unresolved managed cleanup remains uncertain. A worker restart, credential rotation or later rollout does not independently invalidate a usable completed response. Current cancellation, grant revocation and application-state checks still apply.

## Operate from the CLI

Normal CLI login includes deployment read/use permission. Request management and connection consent explicitly:

```sh
macrofold login --scope model-deployments:write --scope connections:write
```

```sh
macrofold model-deployment inspect jaredpalmer/kev-4b --task decision --compute-connection RUNPOD_CONNECTION_ID --json
macrofold model-deployment create --config-file deployment.json --json
macrofold model-deployment start DEPLOYMENT_ID --revision REVISION_ID --policy-file policy.json --json
macrofold model-deployment show DEPLOYMENT_ID --json
macrofold model-deployment grant DEPLOYMENT_ID --config-file grant.json --json
macrofold model-deployment revisions DEPLOYMENT_ID --json
macrofold model-deployment revise DEPLOYMENT_ID --config-file revision.json --json
macrofold model-deployment update DEPLOYMENT_ID --revision NEW_REVISION_ID --policy-file policy.json --json
macrofold model-deployment rollback DEPLOYMENT_ID --revision PRIOR_REVISION_ID --policy-file policy.json --json
macrofold model-deployment stop DEPLOYMENT_ID --json
```

Configuration JSON follows the [OpenAPI reference](../api/README.md). Use `--config-file -` or `--policy-file -` for standard input. Create connections through `macrofold connection add --config-file private-connection.json`; protect secret-bearing files with owner-only permissions, and never put secrets in arguments or source control. Explicit `--idempotency-key` preserves a saved mutation identity; generated SDK resource methods also support all management operations in five languages.

Rotate a token through **Connections → Edit connection** or `macrofold connection update CONNECTION_ID --config-file private-connection-update.json`, using a protected JSON object such as `{"secret":"REPLACEMENT_TOKEN"}`. The replacement must retain authority over the same provider account and its resources. Use a new connection for a different account.

Managed policy specifies positive `min_replicas`, `max_replicas`, `max_concurrent_requests`, decimal-string `max_hourly_cost_micro_usd` and optional `stop_at`. External policy contains only request concurrency and optional stop time. An hourly ceiling limits planned rate/capacity, not lifetime spending or a provider-guaranteed final invoice. Ongoing warm hosting continues while idle. Use provider-account spending controls and a stop time for additional limits.

## Updates, stopping and failures

Creating a revision changes no running model. Selecting it closes new admission, drains accepted requests, tears down owned old capacity and loads the selected revision. Expect an availability interruption. Rollback selects an older immutable revision through the same operation. Unpinned new calls follow the newly ready revision; stale explicit pins fail visibly.

Stopping closes new admission immediately. Accepted calls drain within their deadlines and the bounded drain allowance; remaining calls are cancelled before cleanup. Inference never starts a stopped service. Normal healthy-worker replacement follows the standing service policy automatically. Repeated startup failures exhaust bounded recovery rather than purchasing larger hardware or looping indefinitely.

Read `failure_code` when a service cannot start:

| Code                                             | What to do                                                                                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider_create_rejected_400`, `_413` or `_422` | The provider rejected the submitted configuration before creation. Correct it, then start explicitly. No second purchase is attempted automatically.  |
| `provider_create_rejected_401` or `_403`         | Check the owner’s RunPod credential and account permissions; rotate it for the same account if needed, then start explicitly.                         |
| `model_authentication_failed`                    | Check the configured wrapper image and protected ingress headers. Provider worker status alone cannot open access.                                    |
| `model_identity_mismatch`                        | The discovered alias does not match the selected immutable revision. Correct the runtime configuration.                                               |
| `model_readiness_unavailable`                    | The authenticated readiness request could not finish; the existing controller retries bounded observations without replaying inference.               |
| `service_recovery_exhausted`                     | Startup/recovery exhausted its bounds. Inspect provider startup logs and the selected model/hardware, correct the cause, then explicitly start again. |

Provider network/timeout/5xx failures after create may be ambiguous. They retain the original attempt and cleanup authority; do not create a replacement service manually while that attempt is unresolved.

`cleanup_pending` means shutdown or ownership remains unresolved. Macrofold retains resource identities and narrow cleanup credentials while reconciling; a lost create/delete acknowledgment or empty inventory is not proof that billing stopped. A new RunPod credential must still reach its existing exact resources. Ambiguous creation must be resolved before rotating that account key. Upstream credential revocation may require manual recovery in the provider account. Completed answers remain independent of later cost reconciliation. Managed billing observations refresh on a separate five-minute attempt cadence, including empty responses or provider failures; confirmed teardown makes a final attempt. Provider reporting can be delayed, so this cadence does not promise complete or final billing.

## Self-hosted serving prerequisites

Run the current forward migrations and matching API/maintenance code together. The qualified native image is already published; configure it on both processes:

```sh
MODEL_DECISION_SERVING_IMAGE=ghcr.io/macrofold/model-serving-kev@sha256:f64e30cc0f40085bf15fa7c65a6886b5953edf3dbc8b8783f820ecd770780d5a
```

Start or restart matching API and maintenance processes with that setting. Each accepted revision freezes the selected image; changing the setting does not rewrite existing revisions. For a replacement runtime, build the native image from `infra/model-serving/Dockerfile.kev` or the chat image from `infra/model-serving/Dockerfile` for Linux AMD64. Audit complete replacement artifacts and configure `MODEL_DECISION_SERVING_IMAGE` (native) and `MODEL_SERVING_IMAGE` (chat) with immutable registry digests before creating managed revisions. Build/publish only when runtime code or dependencies change; model repositories and exact revisions are deployment configuration, not image contents. Its source/runtime recipe freezes that digest. The upstream vLLM digest alone is insufficient: the Macrofold wrapper provides protected ingress, loopback-only engine access and bounded forwarding. Set paid execution authorization only after account/runtime/provider acceptance. Keep maintenance running for scheduled stops and resource cleanup even when new execution is disabled.

The runtime uses exact Hugging Face commits and checksum-verified snapshots, serves only protected model discovery and the selected chat or SystemOne route plus minimal health, and strips download/account credentials from the engine environment. Provider bearer forwarding, actual GPU fit, replacement, cancellation and confirmed teardown require live qualification of the built image; CPU protocol fixtures do not establish those properties. See the [implementation and acceptance record](../../projects/hugging-face-model-deployments-tech-design.md#12-verification-rollout-and-rollback) and [remaining acceptance](../../maintainers/TODO.md#hugging-face-model-deployments).
