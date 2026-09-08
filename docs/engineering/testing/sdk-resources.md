# Resource SDK acceptance

The five SDKs expose generated resource methods over the existing transports. [SDK architecture](../../features/api/sdks/implementation.md) owns generation and error semantics; [language guides](../../features/api/sdks/README.md) own customer usage.

## File-read acceptance

The focused file-read follow-up passes **49 TypeScript tests**: 15 direct file-read API cases, 18 existing platform integration cases, and 16 SDK unit cases. A disposable PostgreSQL database and encrypted local objects verify exact content and headers, empty files, Unicode/reserved-character paths, tenant/project/scope/revocation denial, symlink refusal, the 4 MiB boundary, metadata-first rejection of larger direct reads, complete larger downloads, and published revisions during an actual API-admitted run. The run test checks writer exclusion before returning new fixture bytes through checkpoint publication; each mutable workspace belongs to its test. Missing/corrupt object reads return sanitized errors, and unit tests reject interrupted response bodies without returning partial file contents.

`pnpm test:sdks` passes all five actual API/simulator journeys, Python's 150 tests and Pyright check, Go's transport suite, Rust's 12 tests, and Java's 10 tests. Each language reads the simulator's saved output and common binary/empty fixtures through its generated workspace method, and reports a missing file as an error. The Go HTTP regression failed before the fix because an empty successful response returned a nil file; the assertion-checked generator adaptation now returns an open empty temporary file.

Review covered the file-read handler and storage/authorization boundaries, the Go generator adaptation, five SDK read methods and consumer fixtures, and the public guides. OpenAPI documents the existing endpoint; no new file endpoint, migration, dependency, or provider boundary is introduced. Regeneration preserves all 683 inventoried generated artifacts. Strict TypeScript and documentation checks pass; `pnpm test:packages` installs and exercises fresh CLI/TypeScript npm tarballs in a disposable consumer directory. These checks make no paid calls and do not measure aggregate coverage, registry installation, browser rendering, native agents, or deployed R2 downloads. The following earlier measurements retain their original scope.

## Local evidence

`pnpm test:sdks` passes against a disposable PostgreSQL 17.11 database, the real loopback API handler, and a simulator worker. All five languages create a project and saved agent preset, submit a run using only their IDs and a prompt, stream assistant text, wait for a typed final result, inspect checkpoints, and read the saved file. Concatenated streamed text matches the stored output; persistence is verified. TypeScript additionally verifies queued cancellation and cleanup; TypeScript and Python replay historical terminal events. No cloud provider, paid model, or production account is involved.

Native HTTP/SSE fixtures cover default/custom origins, environment/explicit/missing credentials, generated query/body/precondition serialization, raw file uploads, decimal-string precision, redirect refusal, reconnect cursors, duplicate suppression, authorization failures, detachment, and mutation identity. Go/Rust/Java verify that a failed REST mutation is attempted once and preserves its automatically generated identity. Stream organization selection survives reconnects and terminal-history requests without leaking into other requests. TypeScript/Python retain bounded retries; Python additionally checks invalid typed responses and generator closure.

`pnpm check` compiles positive and negative TypeScript resource examples. Python's pinned Pyright check validates keyword arguments, nested inputs, response attributes, required fields, and rejected enums; unused negative assertions fail. The method metadata join requires one facade for every one of the 117 public contract operations in each language.

`pnpm test:packages` installs the CLI and TypeScript SDK from npm tarballs. A fresh Python wheel includes the generated models, keyword types, resources, and `py.typed`. Runtime validation was exercised with Pydantic 2.13.5 and HTTPX 0.28.1; Pydantic's current-release PyPI advisory list was empty when checked. This is dependency-specific evidence, not a full repository vulnerability audit.

## Earlier completion-helper measurement

| Check                            | Result                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Application domain suite         | 530 tests in 74 files passed; existing global/module coverage floors passed                                                               |
| SDK application acceptance       | Five language journeys passed; Python 137, Go 12, Rust 12, and Java 10 tests passed                                                       |
| Python without a running fixture | 141 SDK/cost tests passed; one application journey skipped and separately enabled above                                                   |
| Python coverage                  | 99.04% statements, 90.38% branches; combined coverage.py score 98.17%, above the unchanged 90% floor                                      |
| Type checking                    | Strict repository TypeScript and Python positive/negative Pyright fixtures passed                                                         |
| Dashboard/CLI boundary           | Existing stream tests and executable marketing examples passed; browser/PTY acceptance was not repeated for these SDK convenience helpers |
| Package acceptance               | CLI/TypeScript npm tarballs and a Python wheel installed in isolated consumer environments                                                |
| Contract generation              | All 104 operations mapped in each SDK; 621 generated artifacts/manifests remained identical on regeneration                               |
| Documentation                    | Public pages, method index, Markdown/agent navigation, and links passed validation                                                        |

Python's 103 non-streaming contract cases exercise every resource through HTTPX with OpenAPI-shaped fixtures and assert wire locations, headers, bodies, and typed return values. These do not repeat server business-policy tests or prove all deployed endpoints. Streaming has separate recovery tests.

The TypeScript domain report measures **50.02% lines, 48.75% statements, 40.33% branches, and 38.22% functions** across the working tree, including unrelated development-mode changes. Python reports top-level SDK modules and the cost estimator under the existing coverage configuration; generated Pydantic model internals are outside that report. Python, Go, Rust, and Java are not added to TypeScript coverage. Full combined coverage and mutation scores were not recomputed for this SDK change. Rust retains the pinned generator's existing unused-import warnings; compilation and tests pass.

## Completion-specific regression evidence

Text tests cover transport reconnection and duplicate sequences, tool/reasoning/status exclusion, a cursor beyond terminal history, all unsuccessful outcomes including successful execution with failed persistence, and early detachment without completion reads or cancellation. Wait tests retain full result/checkpoint metadata, keep waiting through pending persistence, propagate revoked authorization, and distinguish local timeouts from remote run cancellation. TypeScript and Python use deterministic clocks for timeout/retry cases; native clients also exercise actual loopback request cancellation, including Java's stalled response body. Python's run-helper module has 100% measured statement/branch coverage.

A real API regression verifies the preset's required `version` on create/get/list/update and foreign-tenant denial. Strict Python models exposed the omitted field during the saved-preset journey; the fix maps the existing persisted revision rather than adding another counter or relaxing response types. Marketing snippets execute through the TypeScript SDK, and typed fixtures compile the branded `Macrofold` entrypoint, text iterator, events, wait result, and preset parameters.

No Docker/native-harness, paid provider, or deployed cloud journey was run for this SDK follow-up. Earlier optimized dashboard/browser/PTY evidence belongs to the resource-generation acceptance, not a fresh browser pass for these helpers. The independently reported development-mode gateway blocker remains outside this change.

## Dashboard session authentication

The focused cookie-authentication acceptance passes 27 TypeScript tests across `dashboard-stream`, `sdk`, and `sdk-run-helpers`, plus three browser journeys on a fresh Node 24 standalone build with disposable PostgreSQL, files, and a simulator worker. The browser creates a run, displays tool calls and lifecycle events, then reloads and replays history using its actual login cookie without a bearer header. An independent request without the cookie receives HTTP 401. A browser transport fixture injects revoked access (403) and verifies that reconnection stops; the scheduling journey retains queued cancellation.

Unit fixtures cover absent/present environment keys in explicit session mode, normal SDK missing-credential rejection, conflicting credential options, 401/403 propagation, reconnect cursors, duplicate suppression, and aborting a stream without cancelling execution. The same runner also passes four CLI subprocess tests, the real terminal journey, and Python HTTP/SSE persistence and continuation. Strict TypeScript and documentation checks pass. Server authorization is unchanged. Previously built web bundles must be rebuilt to pick up SDK authentication changes; rebuilding only the SDK does not update an already bundled dashboard. The running preview is independent of this isolated acceptance. No paid calls or cloud authentication acceptance are involved.

## Reproduce

Start the local database with [local setup](../../getting-started/local-development.md). Install Node, Go, Rust, JDK 21/Maven, and a Python virtual environment, then run:

```sh
python -m pip install './sdk/python[test]'
pnpm sdk:generate:all
pnpm check
pnpm test:sdks
pnpm test:packages
pnpm docs:check
```

Generation uses a checksummed OpenAPI Generator JAR. Tests use synthetic API keys and isolated databases/files, and clean up their own worker/server processes. Fork CI needs no production secrets.

## Hosted origin and remaining acceptance

Production configuration consistently identifies `https://app.macrofold.ai` as the canonical hosted origin. DNS still resolved to domain parking during this work; this verifies the intended name, not a functioning hosted API. No API key was sent to that parked host. SDK default-origin tests intercept requests locally or inspect constructor configuration.

Before publication, activate DNS/TLS/application routing and run the same five language journeys with a synthetic hosted account. Verify deployed SSE flushing, connection rotation/reconnection, historical replay, revocation, custom staging origins, and package registry installs. Real agent/model acceptance requires its separately approved budget. See [release TODO](../../maintainers/TODO.md).

The fixtures test representative complete workflows and adapter behavior, not every operation against a deployed service. Generated compilation is not full endpoint acceptance. Go/Rust/Java remain single-attempt for REST; Python remains synchronous. Native-container and live provider execution are outside this SDK change.
