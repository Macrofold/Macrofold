# Multimedia verification

Tracking: [MAC-19](https://linear.app/macrofold/issue/MAC-19/support-multimedia-inputs-and-downloadable-agent-outputs).

## Reproduce

Use the unpaid local profile and repository toolchains. Tests use synthetic files/accounts and disposable databases; native fixtures run without external network.

```sh
docker compose -f infra/compose.yml up -d --wait
pnpm sdk:generate:all
pnpm check
pnpm test:domain tests/unit/media.test.ts tests/integration/media.test.ts tests/integration/gateway.test.ts tests/integration/deletion.test.ts tests/integration/cloud.test.ts
docker build -f infra/runtime.Dockerfile -t platform-runtime:media-review .
DOCKER_RUNTIME_IMAGE=platform-runtime:media-review pnpm test:native codex claude-code --media --image-only
COVERAGE_DIR=coverage/media-acceptance pnpm test:dashboard:isolated tests/browser/media.spec.ts tests/browser/files.spec.ts
pnpm test:sdks
pnpm docs:check
```

## Evidence

Follow-up review on 2026-09-17 covered shared contracts, authorized run/customer-message admission, document preparation and native mappings, metering, artifact publication/expiration, upload/preview/composer presentation, generated contract changes and their regression tests. Unrelated marketing, deployment and CLI-profile edits were excluded.

The review consolidated pure metadata checks between UI and API, fixed extension lookup accepting inherited properties, added pre-upload model compatibility checks for custom/preset/session configurations, added preview recovery, and avoided a worktree metadata read for runs without attachments. Storage, parser isolation, provider mappings and financial enforcement keep their existing boundaries. Official OpenAI, Claude, Gemini and OpenClaw references and the decisions drawn from them are linked in [implementation](implementation.md#research-and-acceptance).

Current follow-up evidence:

- All 38 focused domain tests in the reproduction command passed, including format-lookup regression and shared size/capability validation.
- Strict TypeScript and the optimized isolated application build passed.
- Both browser journeys passed, adding a deliberately failed preview request followed by successful retry, incompatible-image rejection before any upload, draft recovery after removal and the existing-session compatibility check. The same journeys cover actual upload/checkpoint/run/output-download behavior, byte equality and automated accessibility. The attachment screenshot was visually inspected.
- The isolated runner also passed all six packaged CLI tests, the real PTY journey and Python HTTP/SSE session continuation. Documentation generation/link checks and the final whitespace check passed. Native containers and the full five-language SDK suites were not repeated for this focused review; their earlier acceptance remains below.

Follow-up logs: `/tmp/macrofold-media-review-domain.log`, `/tmp/macrofold-media-review-check.log`, `/tmp/macrofold-media-review-browser.log`, and `/tmp/macrofold-media-review-docs-check.log`. Source/coverage artifacts are under `coverage/media-review-followup/`.

Earlier implementation acceptance on the same date (native protocols and SDK contracts are unchanged by the follow-up):

- Contract/OpenAPI and all five language SDK generations passed.
- 36 focused unit/integration tests passed: attachment scope and tenant isolation, frozen hashes and changed/missing inputs, symlink rejection, actual PDF/DOCX extraction and corrupt data, native image payload validation/reservations/settlement, cloud configuration forwarding, one-time artifact publication, immutable binary downloads and history expiration.
- The six-harness runtime image built as `platform-runtime:media-review`, digest `sha256:c33243b6e12171cc621523e06a3f1925c4e6e9311ad4943892125a4a67c7af41`.
- Native Codex and Claude Code media acceptance passed using that image (`--image-only`), synthetic PNG/PDF/DOCX fixtures and network-disabled scripted model endpoints. Tests inspect the real native request through the shared metering validator and exercise checkpoint restore/session continuation. This verifies transport, not real-model visual comprehension.
- Strict TypeScript (`pnpm check`) and the isolated production build passed.
- All five SDK suites passed against the actual HTTP API/SSE and unpaid worker: TypeScript resource journey (including attachment upload and signed output download), 179 Python tests and Pyright, Go, 15 Rust tests, and 12 Java tests. The shared customer-agent fixture also submits an attachment. Rust emits existing generated unused-import warnings.
- An earlier Go workflow returned a failed run during substantial host memory pressure; a fresh complete SDK run passed without changes to the Go SDK or execution engine. The fixture runner now preserves content-free failed-run codes before database cleanup for subsequent diagnosis.
- Final review added rejection fixtures for both inline and URL-based native Claude document blocks: documents must use bounded extraction, not bypass it through the metered image route. All 24 media/gateway tests passed again after this adjustment.
- The final isolated production-build application run passed: two browser journeys, all six packaged CLI tests, the real PTY journey and Python HTTP/SSE session persistence. Browser checks cover existing large-file transfer integrity, image/PDF/audio/video preview, DOCX download fallback, attachment submission, zero automated accessibility violations and byte-identical PDF/output downloads. Visual inspection found and fixed an editor footer that incorrectly showed a perpetual loading state for binary previews; the final rerun includes that assertion.
- The first broader application run passed its browser and real PTY journeys but failed two CLI test deadlines and one Python session continuation. The machine was under substantial memory pressure; that observation alone does not establish the cause. A fresh complete run passed without changing application execution or CLI behavior. Python acceptance now reports the content-free event failure code if a terminal event fails.

Local ignored evidence: `/tmp/macrofold-media-tests-final.log` (36 domain tests), `/tmp/macrofold-media-gateway-final.log` (24 final media/gateway tests), `/tmp/macrofold-media-native-final.log` (native harnesses), `/tmp/macrofold-media-sdks-recheck.log` (five SDKs), and `/tmp/macrofold-media-browser-complete.log` (full final application run). Coverage/source manifests are under `coverage/media-review-complete/`. Visually reviewed browser captures are `test-results/media-pdf.png`, `test-results/media-attachments.png`, and `test-results/media-output.png`; these synthetic local artifacts are not release evidence or committed user content.

The visual check rejected a sandboxed native PDF iframe because Chromium blocked rendering. The final browser path uses on-demand PDF.js canvas rendering with plain text for assistive technology. The SDK fixture server now exposes the real signed object handler; API-only dispatch could not previously exercise downloadable outputs. The isolated dashboard test keeps its temporary TypeScript configuration outside `.next`, which Next/plugins may clear during build.

No paid model call, hosted sandbox or deployment was performed. Deploy the matching runtime image/API/worker and exercise live provider images, Vercel request-size limits and private hosted storage before release. See [maintainer TODO](../../maintainers/TODO.md). Audio/video understanding, OCR, visual PDF interpretation and media generation remain deferred by design.
