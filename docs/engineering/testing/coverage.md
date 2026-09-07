# Coverage collection

[Testing and CI](../testing.md) owns commands and current results. Coverage is evidence of execution, not proof that an assertion detects an incorrect result. Mutation tests address part of that distinction.

## Measurement boundary

The TypeScript denominator is the existing Vitest application inventory: core, database, providers, runtime, CLI, TypeScript SDK, and web routes/components/helpers/Workflows. Untouched files remain visible. Generated declarations and generated SDK route metadata remain excluded; build tools, dependencies, and test code are outside the application denominator.

Vitest supplies the canonical source statements, functions, and branches, including unimported files. Additional execution observations use the same pinned AST-aware V8 converter used by Vitest. Each observation must map back to the current source content before it can contribute. Source names from browser bundles, standalone server builds, CLI bundles, and Linux runtime paths normalize to repository-relative application paths.

The combined report overlays exact source locations onto that canonical inventory. Repeated observations form a boolean union; they never add statements or branches to the denominator. Different compiler transforms can produce unmatched locations. Those locations receive no extra credit, and per-surface mapping evidence is retained in `merged/surfaces.json`. This is deliberately conservative: a partially mapped bundle is not evidence of full source coverage. Invocation counts in the merged report are not request metrics.

The pinned Workflow compiler sometimes labels intermediate JavaScript as original TypeScript in server maps. Those mappings receive no supplemental credit, even when build provenance proves the revision. They are listed under `unmappedSources`; their canonical files and domain coverage remain in the report. Indexed Turbopack maps are flattened before conversion. The TypeScript SDK emits maps with embedded source so browser/CLI execution can be attributed through its compiled package.

Build-time static rendering is outside this runtime coverage collection. Static marketing routes and SVG artwork therefore remain uncredited in the application denominator even though browser tests verify their rendered output. Do not exclude them or substitute artificial direct calls to inflate the aggregate.

## Test surfaces

| Surface              | Collection                                                                                          | Important limit                                                                                                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit/integration/Git | Vitest V8 and Istanbul JSON                                                                         | Disposable PostgreSQL and object directories; canonical gates apply independently.                                                                                                                                                                                                             |
| Application server   | Node V8 with periodic and shutdown flushes                                                          | Isolated optimized standalone build with test-only server source maps.                                                                                                                                                                                                                         |
| Dashboard            | Playwright Chromium precise coverage, started before navigation                                     | Includes explicit additional tabs; captures before close. Chromium only; browser coverage measures exercised client code, not server rendering.                                                                                                                                                |
| Simulator worker     | Source-mapped test bundle and Node V8                                                               | Separate process against the same disposable acceptance database.                                                                                                                                                                                                                              |
| CLI                  | Built CLI subprocess V8 observations, including POSIX terminal commands                             | Abrupt SIGKILL and native subprocess internals cannot flush final counters.                                                                                                                                                                                                                    |
| Native runtime       | Network-disabled Docker fixtures and V8 in the supervisor, restore, native worker and stdio adapter | Node propagates V8 collection into child processes, including workers with a restricted environment. The worker strips the periodic-flush preload, so abrupt termination can lose counters. Vendor SDK/binary internals are outside the application inventory; runtime isolation is unchanged. |
| Python               | coverage.py branch collection over the Python SDK and cost estimator                                | Separate XML/JSON and Codecov flag. Python is never added to the TypeScript percentage. HTTP and installed-package smoke checks remain separate acceptance evidence.                                                                                                                           |

V8 can over-credit statements after a throwing call and cannot reliably distinguish every default-argument branch. Keep explicit rejection/recovery assertions and mutation testing. See [Vitest coverage](https://vitest.dev/guide/coverage), [the converter's compatibility and limitations](https://github.com/AriPerkkio/ast-v8-to-istanbul), [Playwright coverage](https://playwright.dev/docs/api/class-coverage), and [Node coverage controls](https://nodejs.org/api/v8.html#v8takecoverage).

## Isolation and report ownership

`test:coverage:all` requires a new report directory. It refuses to reuse an earlier collection. The dashboard runner also refuses existing surface directories. Each invocation creates a random disposable database, temporary object store, independent loopback port, and separate Next build. Only processes created by that runner are stopped; the preview database, worker, port, and build remain untouched.

Source hashes, including hidden OAuth discovery routes, are saved before domain execution and checked again during merging. Acceptance builds capture the same inventory before and after compilation. Browser/native/worker/CLI source-map contents must agree with those hashes. Server intermediate mappings may be left uncredited only when the entire build provenance agrees with the canonical revision. Unknown dependency paths are never promoted into application source files. Missing required measurement surfaces fail the combined CI job.

Packed Node observations contain the executed script and maps so another CI runner can merge them without depending on a vanished temporary build. Native fixtures capture these artifacts from the actual running image. Repeated V8 flushes are merged per immutable bundle before packing; each bundle has a separate file to avoid duplicating large server maps or exceeding JavaScript serialization limits. Raw inputs are removed only after portable outputs are saved. Deterministic tests exercise real V8 conversion, indexed maps, duplicate overlays, missing modules, hidden paths and portable native packing.

The added development dependencies are the V8 range merger, trace-mapping library, AST converter and Istanbul report libraries already used by the Vitest ecosystem. They run only during testing/reporting and add no hosted service or production operating cost. Builds, acceptance runs and retained artifacts do consume the repository’s existing CI minutes/storage allowances; measure the hosted workflow before changing retention or schedules.

The default domain report lives in `coverage/domain`; complete reports live in a fresh `COVERAGE_DIR` (default `coverage/full`). Choose a new directory for a subsequent complete run, or explicitly remove only your own completed generated report. Never mix reports from different revisions. CI uploads raw observations and final reports from the same workflow run and keeps evidence for seven days.

## Commands

The local README setup provides PostgreSQL and SMTP. Browser/CLI acceptance additionally needs Chromium and Python with the local SDK's dependencies installed.

```sh
pnpm test:coverage
COVERAGE_DIR=coverage/my-current-run pnpm test:coverage:all
# Add native observations from an already built current runtime image:
NATIVE_COVERAGE_DIR=coverage/my-current-run/native pnpm test:native --image-only
NATIVE_COVERAGE_DIR=coverage/my-current-run/native pnpm test:native --stdio --image-only
COVERAGE_DIR=coverage/my-current-run pnpm coverage:merge
```

`pnpm test:dashboard:isolated` can run browser/CLI acceptance independently; it does not produce an aggregate percentage without a matching canonical domain report. Native acceptance keeps external networking disabled. Image builds may download public packages but never call a paid model or sandbox.

Global and file-specific floors share one policy. A complete domain run must pass its original gates; merging cannot hide a domain regression. Application acceptance has higher global floors before native artifacts arrive, and final CI raises those floors again while requiring mapped browser, server, worker, CLI, and native observations. A cached image whose embedded source differs from the checkout is rejected; rebuild it instead of substituting host maps. Codecov connection and badge activation remain manual and optional; local gates do not depend on uploads.
