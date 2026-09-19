# Operate reusable sandboxes

The [sandbox guide](../sandboxes.md) owns the public lifecycle and billing contract. This guide is for deployment operators; enabling reusable compute does not require changing the model gateway or native harness implementations.

## Local Docker

The [local Docker profile](../../../getting-started/local-development/docker.md) runs both ordinary sandboxes and long-running workers without cloud compute credentials. `long_running: true` removes the container lifetime cutoff and defaults to no idle expiry. Ordinary containers retain their bounded lifetime. Both modes use the existing resource limits, control protocol, checkpoints and billing gates. Pause removes the container; resume creates a fresh generation and restores checkpointed work on the next run. Destroy retires the sandbox ID. Keep Docker and the SQL worker running; stopping Docker or sleeping the host is not an always-on hosting guarantee.

## Configure Render

Publish the current `infra/runtime.Dockerfile` image to a registry Render can pull, using an immutable digest. It must include `sandbox-control.mjs` and the matching runtime dependencies. Vercel and Render can use different registry references to the same reviewed image. Keep the application, worker, database migration and runtime versions aligned.

Configure these values on the application and every maintenance/execution worker:

```dotenv
RENDER_SANDBOX_ENABLED=true
RENDER_API_KEY=your-private-operator-key
RENDER_OWNER_ID=your-render-worktree-id
RENDER_RUNTIME_IMAGE=your-registry/runtime@sha256:your-reviewed-digest
RENDER_REGION=virginia
RENDER_COMPUTE_PLAN=2c-4g
RENDER_COMPUTE_MICRO_USD_PER_MINUTE=your-reviewed-positive-integer-rate
# Only when pulling a private registry image:
RENDER_REGISTRY_CREDENTIAL_ID=your-render-registry-credential-id
```

Set the retail rate deliberately from your provider plan and margin policy. These illustrative values are not runnable credentials or an asserted invoice rate. The existing `ALLOW_PAID_EXECUTION` gate also applies. Do not expose these variables to browsers or native agent processes. Without enablement, credentials, image or pricing, creation fails closed. Ordinary cloud sandboxes continue using `RUNTIME_IMAGE`, `COMPUTE_MICRO_USD_PER_MINUTE` and the existing Vercel configuration. The ordinary reusable lifetime currently requires a Vercel plan supporting 24-hour sandboxes.

The Render adapter creates one image-backed web-service instance, overrides its command to start the root control service, uses `/health`, and attaches **no persistent disk**. The HTTP surface accepts only authenticated, validated runtime operations. Render's management key stays in the control plane; each service receives an encrypted-at-rest, dedicated control secret. Unprivileged native children receive neither that secret nor platform/provider credentials. Render services do not inherit Vercel's egress firewall and microVM guarantees. Use them for worktrees whose successive agents can share trusted compute.

## Maintenance and budgets

Apply migration `040_sandboxes.sql`. Keep `/internal/maintenance` scheduled in cloud deployments or the standalone worker running for local/poller deployments. The existing dispatcher advances at most three sandbox lifecycles concurrently; provider calls happen outside SQL transactions. Paused/destroyed resources and active ready servers do not occupy idle-maintenance slots.

A three-minute SQL lease fences lifecycle commits. Provisioning has a ten-minute deadline; unresolved creation then enters cleanup rather than leaving a potentially billable service indefinitely. Create uses a provider-unique name; an unknown lookup outcome does not authorize another server. Render suspension is asynchronous: its initial 202 does not release funds; a later provider lookup must confirm suspension. Failed cleanup retains its reservation and schedules retry. Monitor stale lifecycle failures and provider resources: maintenance failure can leave infrastructure billable after a customer's allocation is exhausted. Budgeted customer charges are capped; excess provider expense is an operator risk.

Each create/resume reserves a separate compute allocation. Accounting uses the configured ready/idle wall-clock rate and settles under a unique sandbox-generation ledger reference; it is not provider invoice ingestion. The allocation is refunded in part when stopped. Run compute is zero-rated when borrowing a sandbox, while model/tool settlement is unchanged. The financial reconciler includes both reservations.

Do not deploy an image change into an actively running Render service. A control-process boot ID fences all run calls. Only before run preparation may confirmed lost compute be replaced and rehydrated. A restart after preparation is a recovery condition, never permission to replay the prompt. Destroy intentionally uses only the last verified Macrofold checkpoint.

## Provider references

- [Render service creation](https://api-docs.render.com/reference/create-service), [suspension](https://api-docs.render.com/reference/suspend-service-1) and [resume](https://api-docs.render.com/reference/resume-service-1).
- [Render filesystem persistence](https://render.com/docs/disks): disposable disk is not preserved by service restarts.
- [Vercel Sandbox SDK](https://vercel.com/docs/sandbox/sdk-reference): inspect sessions without implicitly resuming them.

## Verification

[Local acceptance](verification.md) records fixture coverage and repeatable commands. Live Render provisioning, image pull, root process behavior, suspension convergence, network controls, provider invoice reconciliation and deployed Vercel reuse remain release acceptance checks. Do not enable the feature on the strength of unit tests alone.
