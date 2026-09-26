# Dependency and distribution review

The application source is Apache-2.0. Its license does not relicense third-party packages, model access or native vendor binaries. Node dependencies are locked; the runtime pins Codex 0.153.4, Claude Agent SDK 0.3.261 and OpenCode 1.18.29. Preserve their licenses/notices when distributing images/packages. CLI and SDK archives include the application LICENSE/NOTICE.

Python's SDK uses HTTPX with Pydantic 2 (MIT) and typing-extensions (PSF) for generated response models and keyword types. Pyright is a pinned test-only dependency. The existing Node license inventory does not cover these Python packages or the native-language SDK graphs; [SDK architecture](../features/api/sdks/implementation.md) records their generation and [acceptance](testing/sdk-resources.md) records tested versions and measurement scope.

[Dependency inventory](../dependency-licenses.csv) was refreshed September 19, 2026 with `pnpm licenses list --prod --json` from the installed macOS ARM64 graph. Linux runtime optional binaries have their own package set; retain those packages' original notice files in the built image. This inventory is a declared-license inventory, not legal clearance.

Most packages declare MIT/Apache/BSD/ISC-style licenses. Particular review items: sharp/libvips binaries declare LGPL-3.0-or-later, lightningcss MPL-2.0, and caniuse-lite CC-BY-4.0. Preserve upstream notices/source availability required by those licenses when redistributing. The official MCP filesystem package points to its included LICENSE. Some platform-specific binary packages and `@vercel/cli-auth` omit a conventional package.json license declaration; inspect their included files/upstream distribution before publishing outside your organization.

The installed Claude Agent SDK license says use is subject to Anthropic's legal agreements; it is not covered by this repository's Apache grant. Review [Anthropic legal/compliance](https://code.claude.com/docs/en/legal-and-compliance) for the intended hosted commercial deployment and image distribution. Do not market all included binaries as your own open-source code or pool consumer subscriptions. A privately built runtime image and a public redistribution have different operational contexts.

The September 6 production npm audit initially found Workflow transitive dependencies affected by nanoid and undici advisories. `pnpm-workspace.yaml` now applies narrow 5.1.16/7.29.0 overrides; the repeated audit reports zero known vulnerabilities. Rerun on every dependency/image release. [Nanoid advisory](https://github.com/advisories/GHSA-28wg-ghj8-5hjv), [Undici advisory](https://github.com/advisories/GHSA-4cwx-7wf7-3272).

No audit can establish absence of vulnerabilities. Keep provider/sandbox patching, origin restrictions, privilege boundaries and billing/persistence tests as release requirements. Fork CI receives no production secrets. Configure the real repository owner, private security reporting, branch protection and publishing provenance before public release.

The UI review adds Radix Select 2.3.7 and Recharts 3.10.1, both declared MIT, using the existing React/Tailwind design stack. The refreshed inventory covers 1,215 declared-license entries, and the production audit still reports zero known vulnerabilities. The installed Composio/OpenAI graph emits an exact undici peer-version warning (requested 7.29.0, resolved 7.29.1); it is not an audit finding, and protocol fixtures pass. Authenticated Composio execution remains an operator acceptance gate. The dashboard uses the built TypeScript SDK as an internal worktree dependency, with explicit build ordering for clean checkouts.

The coverage follow-up pins Vitest and `@vitest/coverage-v8` together at 4.1.11 (MIT), and adds Stryker core/Vitest runner 10.0.0 (Apache-2.0) as development dependencies. The Stryker runner is explicitly loaded for pnpm compatibility. Its `typed-rest-client` dependency pinned qs 6.15.1 with three moderate denial-of-service findings; a narrow `typed-rest-client>qs` override selects 6.16.0. The complete dependency audit, including development dependencies, then reports zero known findings. Strict TypeScript, the 216-case coverage suite, and the 44-mutant focused run verify the test-tool integration. CI now audits development dependencies as well as production dependencies. These tools and their reports do not belong in the shipped runtime package; generated reports and temporary mutation copies are excluded from Docker contexts and formatting.

Trigger scheduling uses pinned cron-parser 5.10.0 and Luxon 3.7.2 (MIT), recorded in the dependency inventory. The production audit on September 7, 2026 reports zero known vulnerabilities. These add in-process cron/timezone parsing, with no new hosted service. [Trigger architecture](../features/triggers/implementation.md) documents why scheduling reuses the existing SQL outbox and maintenance worker.

## Additional native harness dependencies

Hermes uses upstream commit `b2aa855b626ff8688eb34b95c60ee8b6a4af3679` (0.21.1), its frozen `uv.lock`, Python 3.11 and uv 0.9.28. The upstream checkout and licenses remain in `/opt/hermes`; no private source, login or API key is copied into the image. Pi's coding-agent/AI packages are pinned at 0.85.1. DeepSeek's runtime and official embedding packages are pinned at 0.1.5-alpha.1 (Cordis 4.0.2). Those workspaces declare MIT; preserve their bundled transitive notices. DeepSeek is a developer-preview dependency, so upgrades require replay/restore and protocol acceptance before changing the pin.

The Node production advisory check on September 8 reports zero known vulnerabilities. That scan does not cover Hermes's separate Python graph or OS packages. The Linux native fixtures verify the packaged shell/binary dependencies despite pnpm's disabled optional build scripts; unused web/UI plugins remain outside the selected DeepSeek profile. The larger image increases build, distribution and startup costs; no additional hosted service or recurring subscription is required. Record deployment image size/startup and run the Python/OS scans before publishing; [harness acceptance](testing/harnesses.md) tracks this separate scope.

## Rich Markdown editor

The September 10 UI update adds Tiptap 3.31.3 (MIT), with its React/ProseMirror, Markdown, table, task-list, image, and details extensions pinned together. Orca uses Tiptap; the dashboard adapts its toolbar grouping while retaining the upstream MIT notice in the file components directory. The Markdown extension is still beta: source editing remains available and unsupported HTML/footnotes are protected from rich-editor rewriting. This is a local editor dependency, with no paid service or account requirement.

The refreshed declared-license inventory contains 1267 entries. The production audit found one high-severity advisory in the existing DeepSeek/Cordis transitive `js-yaml` 4.3.1 dependency (fixed in 4.3.2), outside the new Tiptap graph. The current narrow 4.3.2 override resolves this finding; it was not a Tiptap finding.

## Isolated customer-data example

The [Prisma recipe](../../examples/integrations/README.md#prisma) pins Prisma/client/LibSQL adapter 7.10.0 in a separate package and lockfile. It is not an application or runtime-image dependency. The package uses its actual generated client against disposable SQLite in CI. Scoped development-tool overrides select `deepmerge-ts` 8.0.0 and `mysql2` 3.23.1 after advisory review; the repeated query fixture passes and its complete isolated audit reports no known vulnerabilities. Use `pnpm --dir examples/integrations/prisma --ignore-worktree audit --audit-level high` so pnpm audits this package rather than the enclosing worktree.

The [declared-license inventory](../../examples/integrations/prisma/dependency-licenses.csv) covers 149 installed package names (154 version entries) on macOS ARM64: Apache/MIT/ISC/BSD/Unlicense and EPL-2.0 (`elkjs`). Preserve the original package notices, including EPL obligations, when distributing this standalone example. This is not legal clearance and does not replace Linux binary review. Existing platform advisory findings above remain separate. No new database service, production ORM, or model dependency was introduced.

## Multimedia processing

PDF.js (`pdfjs-dist` 6.3.289, Apache-2.0) and Mammoth 1.12.3 (BSD-2-Clause) are pinned dependencies for text extraction. PDF.js also provides an on-demand browser preview worker at the same version. image-size 2.0.4 (MIT) validates image headers and dimensions in both admission and runtime code. Preserve their bundled notices in runtime distributions. The refreshed production inventory contains 1,291 package entries. Processing uses a bounded subprocess with no external extraction service; [media decisions](../features/media/implementation.md) document limits and replacement boundaries.

The current production pnpm audit reports no known findings. Narrow overrides select js-yaml 4.3.2 and devalue 5.9.2. The official Better Auth CIMD plugin 1.7.2 adds public-address-pinned OAuth client metadata retrieval and shares the existing auth version.

The complete runtime image is scanned with pinned Trivy 0.74.0 in CI and weekly verification. The gate fails on fixable high/critical OS, Python or JavaScript findings and retains its report; unfixed and lower-severity findings still require review. The accepted local image has no fixable high/critical findings. The runtime updates Debian security packages, pins global npm 11.19.1, and applies the hash-pinned `infra/runtime-python-security.txt` overlay for Hermes httpx2/httpcore2 2.12.0 and AnyIO 4.14.2 (CVE-2026-63374) after its frozen upstream install. `uv pip check` and native continuation fixtures pass. Remove that narrow overlay when the upstream lock includes the fixes. This local scan does not establish that a hosted image was replaced.

## Execution tracing

Langfuse core/tracing/OTel 5.11.1 (MIT) and OpenTelemetry API 1.9.1, trace/resources SDK 2.11.0 and HTTP OTLP exporter 0.222.0 (Apache-2.0) are pinned server dependencies. The API pin matches Next's installed OTel peer to avoid duplicate incompatible module types. The integration uses official SDK attribute/export handling and a private tracer provider; it adds no browser SDK, global instrumentation or SQL service. Langfuse hosting/storage is an optional separately operated service with its own costs and retention.

The September 19 production audit reports zero known advisories; the refreshed declared-license inventory covers 1,296 package entries. This is not a security guarantee or review of the separate runtime OS/Python graph. [Tracing implementation](../features/observability/implementation.md) documents content bounds, process flushing and the replacement port.

Background step export uses `@vercel/functions` 3.9.5 (Apache-2.0), promoted from the existing Workflow dependency graph to an explicit server dependency. Its `waitUntil` lifecycle primitive keeps exports alive without delaying step completion; request/stream routes retain Next `after`. No new hosted service or browser dependency is added.

## Inference SSE framing

Direct inference promotes `eventsource-parser` 3.1.1 (MIT), already present transitively, to a pinned server dependency. It handles incremental SSE framing; provider-specific assembly and completion checks remain in Macrofold’s provider adapter. No new hosted service, partial-JSON parser or tracing SDK upgrade is introduced. Preserve its existing bundled license when distributing the application.

## Contributor guidance validation

The guidance checker promotes the already locked `yaml` 2.9.0 (ISC) to an exact development dependency for standard YAML skill metadata, including quoted/block strings and duplicate-key rejection. It is tooling-only, requires no hosted service and does not affect runtime providers or images. The checker extends the existing documentation gate instead of importing OpenLegend's checker implementation or changing application validation.
