# Additional harness acceptance

The [public harness guide](../../features/execution/harnesses.md) owns user-facing capabilities and examples. [Runtime architecture](../../features/execution/runtime.md#harness-adapters) owns integration and persistence decisions. This record separates deterministic local execution from live provider and cloud acceptance.

## Deterministic coverage

The Linux ARM64 runtime image builds with pinned, unmodified Hermes, DeepSeek Harness and Pi. Network-disabled Docker fixtures execute their actual coding tools, an HTTP MCP broker, checkpoint capture, restoration into fresh directories and a second turn that must contain the original conversation. Separate fixtures reject the model credential after a file edit or cancel during a model response; each must stop with the correct terminal status and retain the edited file. No inference, subscription, search or cloud provider was called.

The SDK contract, dashboard and CLI share the six harness identifiers. Unit tests cover contract alignment, private-reasoning filtering, tool identity/error normalization, absent/invalid continuation, broker pagination/authentication/cancellation, and the private subprocess bridge's framing, input, interruption and cleanup. SQL integration tests exercise managed and BYOK admission, scoped gateway credentials, revocation, cancellation, fencing and reservation release for the new model routes.

```sh
pnpm test:native hermes deepseek pi --tools
pnpm test:native hermes deepseek pi --failure
pnpm test:native hermes deepseek pi --cancel
pnpm test:journey:docker
pnpm test:domain tests/unit tests/integration tests/git.test.ts tests/git-sync.test.ts
pnpm test:dashboard:isolated tests/browser/harnesses.spec.ts
```

Build the image first as described in [local Docker](../../getting-started/local-development/docker.md). `DOCKER_RUNTIME_IMAGE` can select a separately tagged fixture image without replacing a running developer image. The complete journey runner accepts optional harness IDs to narrow diagnosis; no IDs runs all six. Native tests mount fresh runtime code unless `--image-only` is specified. CI builds its own image and exercises the new MCP/failure/cancellation cases without production secrets.

## Measured results

- Native Hermes, DeepSeek and Pi: file edits, exact MCP invocation, checkpoint restoration, native session identity and prior-conversation replay pass.
- All three: confirmed authentication failure and cancellation preserve files and explicit terminal outcomes.
- Complete customer API → PostgreSQL worker → Docker → gateway → verified checkpoint journeys pass for all six harnesses, including a killed/replaced worker and a second turn in a new container. The matrix passed across targeted invocations after fixing Codex's client-executed tool-search validation and the fixture relay's handling of Anthropic beta query parameters.
- Full TypeScript unit/integration/Git suite: **695 tests across 87 files** pass. Six focused subprocess/relay tests pass after the final fixture and test-type fixes. Strict TypeScript passes.
- Isolated optimized dashboard build: **four browser journeys** pass, covering each new harness, persisted event/tool replay after refresh, and the public comparison/quickstart. **Five CLI subprocess cases**, the real PTY journey and Python HTTP/SSE continuation pass.
- All five SDK suites pass against the local simulator. Python passes **151 tests** and Pyright; Rust passes **12 tests**; TypeScript, Go and Java pass their transport and customer API journeys. Generated harness values remain aligned with OpenAPI.
- The production Node advisory scan reports zero known vulnerabilities and the declared-license inventory contains **1,215 entries**. Python/OS advisories and combined coverage/mutation scores were not recomputed.

Verified September 8, 2026, with Node 24.13, local PostgreSQL 17 and Docker Desktop Linux ARM64. The built image is `sha256:c09b48a91626beb77bfa79f1983fbdc991bec179c3bcd2f82cc17980a2fc4663`, tagged separately as `platform-runtime:harness-acceptance`; the preview image was preserved. Docker reports 1,937,502,453 bytes (about 1.8 GiB) locally; compressed distribution size and hosted startup latency remain unmeasured. Browser observations are under `coverage/harnesses-browser-final-20260908`. These observations were not merged into a fresh aggregate coverage score.

The direct native fixture binds `/workspace` and `/agent-home` inside an owned container and disables external networking. The API wrapper instead uses its own internal Docker network, disposable PostgreSQL database, isolated API/worker, encrypted local objects and a fixed-destination relay. Model responses remain scripted, pass through real accounting, and cannot reach a provider. Its worker-crash assertion reconnects to an existing native execution; continuation must use a different container and leave no financial reservation behind.

## Remaining acceptance

- Run the release image and complete native/API matrix on Linux AMD64 and hosted CI. Local ARM64 success does not verify those binaries or Vercel image import.
- Under fresh explicit budgets, verify each reviewed OpenAI/OpenRouter route with real reasoning in local Docker and isolated cloud staging, including exact managed/BYOK key selection and provider usage settlement.
- Verify Vercel startup/egress/TLS, Workflow recovery, R2 publication, remote MCP grants/revocation, cancellation latency and cleanup. Accept the complete API/browser journey on the deployed revision.
- Exercise long conversations, Hermes compaction/skills/memory and DeepSeek/Pi session growth with representative workloads before increasing native limits. The current fixtures cover short file-edit conversations and transport failures.
- Review Hermes's Python dependencies and the image's OS advisories, retain all upstream notices, and measure image distribution/startup costs before release. The pinned Hermes core detects the base SQLite WAL-reset issue and uses DELETE journaling; this fixture does not certify SQLite or OS patch status.

DeepSeek's convenience SDK cannot reopen a persisted session in a replacement process. Its driver uses the official agent registry's resume API instead. Native tests require restored conversation context, so a fresh session over restored files cannot accidentally pass as continuation. Hermes likewise requires its stored conversation to be supplied explicitly to the embedded agent. These are native integration constraints, not a replacement scheduler or model loop.

Release work remains in the [maintainer checklist](../../maintainers/TODO.md). No additional paid execution is authorized by this record.
