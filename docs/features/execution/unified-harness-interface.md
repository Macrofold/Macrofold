# Unified Harness Interface

The **Unified Harness Interface (UHI)** connects native agent harnesses to Macrofold's shared execution system. Applications use the same run, streaming, cancellation, and file APIs while each adapter preserves its harness's native tools and conversation state. It applies to both Macrofold Cloud and self-hosted deployments.

**Anyone can contribute a harness that follows the UHI.** Implement its adapter, add the integration and tests described below, and submit a pull request. Harnesses are reviewed and shipped with the application and runtime image. See [available harnesses](harnesses.md) to use an existing integration.

## How it works

The API authorizes and admits a run. The shared scheduler and phase engine prepare a sandbox and restore its worktree. The native worker selects the harness adapter, which starts the upstream runtime and translates its events and result. Macrofold then verifies and publishes the checkpoint.

The adapter owns native startup, model/tool configuration, event translation, conversation continuation, and native cancellation. Macrofold owns authorization, scheduling, financial reservations, execution identity, process supervision, checkpoint publication, and historical replay. A new adapter reuses those systems.

UHI names the existing adapter contract; its TypeScript interface remains `HarnessAdapter`. It is a repository extension point, not a separate HTTP protocol or dynamically installed plugin. Customers continue using the [public API](../api/README.md).

## Adapter contract

The authoritative types are in [runtime types](../../../packages/runtime/src/types.ts). An adapter implements `run(context): Promise<NativeResult>`.

| Contract | Responsibility |
| --- | --- |
| `configuration` | Use the accepted prompt, instructions, model, worktree, native state directory, gateway URLs, run capability, deadline, and optional resume ID. |
| `signal` | Honor cancellation during startup and execution; release listeners, SDK resources, and child processes. The supervisor also enforces process shutdown and deadlines. |
| `emit(event)` | Publish normalized assistant text, tool activity, and native session identity. Await or drain pending events before returning; propagate delivery failures. |
| `ask(id, question, details)` | Request user input through the existing control channel when the harness needs it. Handle cancellation while waiting. |
| `NativeResult` | Return complete assistant output, a native `resumeId` where applicable, and `success`, `failure`, `cancelled`, or `timed_out`. Preserve failure semantics and a safe failure code. |

Emit `runtime.started` with `harness` and `native_session_id`, `output.delta` with new assistant text, and `tool.started` / `tool.completed` with stable tool-call identities. Keep tool failures distinct from successful results. Do not publish secrets or private reasoning. Follow the existing adapters and [event contract](../api/events.md); the supervisor and database assign replay sequences.

A requested continuation must restore its native conversation. Missing or invalid state must fail clearly instead of running the prompt as a new session. Keep workspace files in the provided worktree and native conversation state in the provided state directory. Native execution success does not establish checkpoint success.

## Contribute a harness

Start with [contributor setup](../../../CONTRIBUTING.md), the mandatory [agent instructions](../../../AGENTS.md), and [runtime architecture](runtime.md).

1. **Implement native integration.** Add an adapter under [packages/runtime/src](../../../packages/runtime/src). Prefer an official SDK, headless protocol, or supported embedding API. [Pi](../../../packages/runtime/src/pi.ts) demonstrates SDK integration; [Hermes](../../../packages/runtime/src/hermes.ts) demonstrates a process bridge. Preserve the upstream agent loop and document supported capabilities and limitations.
2. **Connect authorized models and tools.** Route inference, including auxiliary model calls, through the supplied model gateway using the run capability. Route granted external tools through the supplied broker. Keep vendor keys in the control plane; never silently change BYOK funding. Review model combinations in [model policy](../../../packages/core/src/model-policy.ts). Adding a harness does not automatically enable every upstream model or service.
3. **Register and package it.** Add its ID and capability metadata to the [harness registry](../../../packages/contracts/harnesses.ts), wire the [native worker](../../../packages/runtime/src/native-worker.ts), and update harness enums in [OpenAPI](../../api/openapi.json). Run `pnpm sdk:generate:all`. Pin dependencies in the [runtime package](../../../packages/runtime/package.json) and update the [build script](../../../scripts/build-runtime.ts) or [image](../../../infra/runtime.Dockerfile) where needed. Follow [dependency and distribution review](../../engineering/dependencies.md).
4. **Preserve recovery and credentials.** Identify persistent session files and temporary authentication/configuration files. Extend [native authentication exclusions](../../../packages/runtime/src/auth-paths.ts) as needed and test capture and restore. File permissions do not hide credentials from tools running under the same OS user. Keep the supervisor's launch fencing and checkpoint ownership intact; never replay an ambiguous execution to recover a lost acknowledgment.
5. **Submit evidence and documentation.** Extend the existing fixtures, customer journeys, and CI matrix for the new harness. Update the [public comparison](harnesses.md), model compatibility, and runtime details. State exactly which local and cloud checks passed, with remaining acceptance recorded separately. Follow the [pull request guide](../../../CONTRIBUTING.md#open-a-pull-request).

## Verify the contribution

Use the [native and API acceptance runners](../../engineering/testing/harnesses.md) with the new registered ID. Extend their scripted model/tool fixtures to exercise the actual harness protocol; adding an enum alone is not integration evidence.

| Boundary | Required evidence |
| --- | --- |
| Adapter | Correct text/tool normalization, explicit errors, input where supported, cancellation, timeout, and missing continuation rejection. |
| Native image | Actual file edits and granted tools; checkpoint restore into a replacement container retains both files and conversation. Credentials stay outside captured state. |
| Complete API journey | Admission, managed/BYOK gateway use, streaming/replay, worker recovery without duplicate execution, checkpoint publication, and reservation settlement/release. |
| Public clients | Dashboard, CLI, and all five generated SDKs accept the registered harness and preserve existing run operations. |

Run `pnpm check` and `pnpm docs:check`, plus the applicable suites from [TESTING.md](../../../TESTING.md). Use disposable databases/filesystems and deterministic responses with no paid calls in default or fork CI. Native fixture success does not establish live provider or cloud acceptance; those checks require isolated staging and a separately approved budget.

Permission capability is explicit rather than inferred from the harness name. Register supported policy translations in `packages/contracts/permission-adapters.ts`; unsupported translations must fail at admission before funds or a runtime are allocated. The [agent-permission guide](permissions.md) describes the native controls and checked-file transports for all six adapters. Native permission changes must pass the network-disabled permission matrix; a native wildcard or approval mode is not equivalent to the universal policy merely because it uses similar names.
