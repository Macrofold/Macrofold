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

The direct native fixture binds `/worktree` and `/agent-home` inside an owned container and disables external networking. The API wrapper instead uses its own internal Docker network, disposable PostgreSQL database, isolated API/worker, encrypted local objects and a fixed-destination relay. Model responses remain scripted, pass through real accounting, and cannot reach a provider. Its worker-crash assertion reconnects to an existing native execution; continuation must use a different container and leave no financial reservation behind.

## Hosted Claude acceptance

The isolated staging deployment passes a real Claude Code / Haiku 4.5 file-creation run and continuation on Linux AMD64 Vercel Sandbox, deployed source `15df120`. Both runs used the same immutable runtime digest, a $0.50 run ceiling and a 120-second execution timeout. The continuation used a different sandbox while retaining the same native conversation identity, quoted the original request from history, and appended a second line. The dashboard verified both lines after navigating back to the persisted worktree.

Both final results report successful execution and verified checkpoints. All four model requests reported complete usage. The application settled $0.107226 for creation and $0.090929 for continuation, including its accepted compute rate; the organization and model reservations returned to zero. Read-only provider lookups returned HTTP 404 for both completed sandbox names, confirming cleanup. These are application ledger charges, not a reconciliation against vendor invoices. Private deployment records retain run/checkpoint identities and raw acceptance evidence without secret values.

Two setup failures preceded this pass: unsupported IPv6 firewall CIDRs were corrected with fail-closed VM IPv6 setup, and a $0.20 run ceiling was too small for Claude's conservative first-request reservation. A synthetic local SDK probe required approximately $0.30 at the accepted Haiku rates; the existing launch guide's $0.50 test ceiling passed. No spending check was weakened.

The same staging worktree also passed a 5 MiB dashboard upload and authenticated download with byte-identical SHA-256 verification. Restoring the verified continuation checkpoint preserved both greeting lines, removed the later transfer file from the active tree, and retained the pre-restore state as a recovery checkpoint. This is application-level restoration, not independent database/object/key disaster recovery.

This accepts the short managed Claude staging journey, including native history, worktree restoration, model transport, encrypted checkpoint publication, settlement and cleanup. Other harnesses, BYOK, cancellation/recovery, sustained capacity and vendor invoice reconciliation remain separate release checks.

## Remaining acceptance

The Claude worktree-context regression is covered by `pnpm test:native claude-code`: its network-disabled model fixture inspects actual Anthropic requests for the persistent worktree and temporary-file boundary. The test fails against the previous image when a run has no custom instructions. The corrected adapter passes file creation, checkpoint capture, portable restore and continuation, including custom instructions on the resumed turn. The `--permissions` variant also passes allowed/denied file access, blocked shell bypass, broker invocation and restored file tools; strict TypeScript and documentation checks pass. These scripted responses verify context delivery and persistence mechanics. An earlier live run reported writing `/tmp/hello.txt`, outside the captured workspace worktree, despite successful execution and a verified checkpoint. After rebuilding the image, the operator confirmed that a separately approved Claude Haiku 4.5 retest created `hello.txt` containing `Hello from the agent` after a dashboard refresh, using a $0.50 run budget and a 120-second timeout. The supplied API result reports `final: true`, `execution_outcome: success`, `persistence_status: verified` and a checkpoint ID. A subsequent live continuation used a $0.20 maximum budget and a two-minute timeout; the operator confirmed the original line and the appended `Session continuation works` line after refreshing the workspace file. Dashboard evidence before that continuation showed $0.00 reserved and $0.17 in aggregate run charges over 30 days, not an exact charge for the retest. Local CLI device login and workspace listing succeeded; `pnpm cli doctor` returned `ok: true` with zero inference requests. These observations establish the local file and continuation journey, not exact per-run settlement, restored conversation recall or hosted acceptance.

- Run the release image and complete native/API matrix on Linux AMD64 and hosted CI. Local ARM64 success does not verify those binaries or Vercel image import.
- Under fresh explicit budgets, verify each reviewed OpenAI/OpenRouter route with real reasoning in local Docker and isolated cloud staging, including exact managed/BYOK key selection and provider usage settlement.
- Verify Vercel startup/egress/TLS, Workflow recovery, R2 publication, remote MCP grants/revocation, cancellation latency and cleanup. Accept the complete API/browser journey on the deployed revision.
- Exercise long conversations, Hermes compaction/skills/memory and DeepSeek/Pi session growth with representative workloads before increasing native limits. The current fixtures cover short file-edit conversations and transport failures.
- Review Hermes's Python dependencies and the image's OS advisories, retain all upstream notices, and measure image distribution/startup costs before release. The pinned Hermes core detects the base SQLite WAL-reset issue and uses DELETE journaling; this fixture does not certify SQLite or OS patch status.

DeepSeek's convenience SDK cannot reopen a persisted session in a replacement process. Its driver uses the official agent registry's resume API instead. Native tests require restored conversation context, so a fresh session over restored files cannot accidentally pass as continuation. Hermes likewise requires its stored conversation to be supplied explicitly to the embedded agent. These are native integration constraints, not a replacement scheduler or model loop.

Release work remains in the [maintainer checklist](../../maintainers/TODO.md). No additional paid execution is authorized by this record.
