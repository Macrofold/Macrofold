# Tool and account security verification

Account/security and signed OAuth browser journeys pass, including second-factor gating and single-use recovery codes. A browser uploads and downloads a byte-identical 6 MiB file; an independent S3 fixture verifies signed direct uploads, checksum rejection, atomic publication and staging cleanup. Four broker integration tests pass with all paid outbound calls intercepted: exact managed search fees, no BYOK fallback, budget and grant rejection, invocation deduplication, unknown-result fencing, real MCP SDK discovery and stdio sandbox routing. The actual official filesystem server passes write/read, root-control denial and duplicate-invocation tests inside a network-disabled Docker container. All three pinned native harnesses pass their model-fixture, file operation, checkpoint/restore and same-session continuation tests again with the rebuilt image. Live provider configuration and paid cloud smoke tests remain operator steps.

## Tool schema compatibility

The default draft-7 validator reproduced the missing-meta-schema error for a declared 2020-12 bounded-string input. [Schema unit tests](../../../tests/unit/tool-arguments.test.ts) cover both dialects, undeclared draft-7 behavior, optional fields, string bounds, extra-property/type rejection, dialect-specific tuples, local references, malformed/async schemas, and isolation of repeated schema IDs.

The [broker integration](../../../tests/integration/tool-broker.test.ts) exercises official MCP clients/transports on both sides of the broker: discover a 2020-12 schema, reject bad arguments and unsupported schemas without invocation or charges, then successfully forward unchanged valid arguments. The focused schema, broker and [local MCP](../../../tests/integration/local-mcp.test.ts) suites pass 34 checks through the disposable database wrapper. Upstream broker traffic uses deterministic protocol fixtures; this does not establish a complete live caller/harness journey or hosted acceptance.

## Execution-efficiency verification

The final selected-connection/projection change passes all 21 broker integration cases. These cover current actor/grant revocation, account identity, budget denial, repeat/unknown effects, schema dialects and actual official MCP clients/transports. Catalog unit cases cover raw schema-object reuse, current grant projection, revision changes, same-key discovery sharing, bounded entries, expiry, failed discovery and admission saturation. Discovery and schema caching grant no authority.

Run the reusable unpaid profile with Node 24 and the local PostgreSQL/object-store setup:

```sh
PLATFORM_MODE=local EXECUTION_PROVIDER=simulator ALLOW_PAID_EXECUTION=false \
  pnpm exec tsx scripts/profile-tool-admission.ts
```

It creates and deletes a disposable restricted-role database, creates nine native Runs with a synthetic 70,000-byte prompt (first admission discarded as warm-up), and invokes one selected synthetic loopback MCP tool once cold and ten times warm. A second granted connection rejects any attempted discovery. No agent compute or paid provider is called. The current version-2 report uses submission-correlated profiles, counts statements including transaction/context commands, and distinguishes foreground/background work. It counts only known short-string/Buffer parameter bytes; object parameters and result/wire bytes remain unknown instead of being serialized for measurement. The earlier serialized-byte experiment below remains historical evidence under its original boundary. Instrumentation adds CPU work; this is local path evidence, not hosted capacity acceptance.

On October 17, the profile confirmed one cold discovery, zero warm or unrelated discoveries, and all eleven real protocol calls succeeded. Each tool invocation used 33 SQL statements and about 2.4 KB of parameters. Explicit tool-Run projection reduced returned SQL data from 75.7 KB to 5.2 KB despite the same 70 KB native prompt; the profile asserts that prompt-sized reads do not return. Native admission used 32 statements, 74.3 KB of parameters (including its one durable prompt write) and 17.3 KB of returned rows. Native insertion returns fresh control state instead of rereading the saved prompt.

An initial local run measured native admission mean 47.9 ms/p95 78.8 ms and warm tool calls mean 49.3 ms/p95 67.8 ms. The final projection run overlapped full verification and had substantial scheduling noise (native mean 171 ms; warm tool mean 635 ms/p95 4.2 s), so those timings are not a controlled before/after latency comparison. The byte and discovery counts above are deterministic path measurements. Immediate-inference acceptance and its separate under-100-ms overhead target are recorded in the [execution-efficiency project](../../projects/execution-efficiency-tech-design.md).

The shared-profiler follow-up preserves all eleven real MCP calls, exactly one cold discovery and zero warm/unrelated discoveries. Unknown result bytes are now reported as null; the old 5.2-KB projection measurement is not presented as a fresh wire-byte or latency measurement.
