# Worker execution evidence

Evidence is commit-specific. A green build is not native recovery or paid-provider evidence, and simulated external boundaries are not actual cloud resource measurements.

## Demand-aware idle retirement — September 25, 2026

GitHub Actions run **36102148430**, source **dd44fb56fab02365eead0d216cd346663e1fa768**, completed successfully with Node **24.13.0**, pnpm **10.33.0**, and the repository's frozen dependency lockfile. Implementation semantics and safety boundaries are documented in [implementation](implementation.md#demand-aware-idle-scale-down).

| Check | Executed result |
| --- | --- |
| `pnpm check` | Passed documentation generation, TypeScript SDK build, and application type checking |
| `pnpm build:runtime` | Passed |
| Worker policy and queued-capacity unit suites | 78 / 78 passed: 47 policy and 31 scaling cases |
| `pnpm test:domain tests/integration/workers.test.ts` | 18 / 18 passed against disposable PostgreSQL |
| `pnpm exec tsx scripts/workers/stress.ts` | Passed the bounded loopback HTTP/SDK workload |
| `pnpm docs:check` | 64 generated public pages, 209 Markdown files, and 54 requirement mappings verified |
| Paid API calls | 0 |

The regression-only source **745a2ed0d6d14312427374f7f2e09df3425f2523**, Actions run **36101800606**, first reproduced both idle-capacity failures against the prior implementation. Its 15 existing database cases passed, while the two new cases failed: an idle spare stayed `ready` instead of `draining` behind a Worker concurrency limit, and two idle Hosts remained when only one was selected for queued work. Source **5b4fd457408138e613c0d7c473846d494991ce8e** changed reconciliation to use the existing per-Host demand plan; the successful source above also extends unpublished-state coverage.

The database suite verifies that the selected Host remains usable, excess idle capacity can retire despite a nonempty queue, active assignment identity and queued Runs are preserved, and provider-unconfirmed release does not become a stopped allocation. The complete-generation recovery fixture places one older `recovery_required` entry outside the 256-entry placement cache window. Both idle replacement and ordinary idle scale-down preserve that Host; ordinary retirement proceeds after the fixture explicitly marks recovery/publication complete. Provider control is a test implementation, not proof of real hosted shutdown or native process isolation.

The successful run retained the following stress measurements in the `worker-runtime-evidence` artifact:

| Measurement | Observed |
| --- | ---: |
| Accepted/completed Runs | 128 / 128 |
| Peak concurrent synthetic executions | 32 |
| Peak backing Host records | 3 |
| Resource ownership violations | 0 |
| Scheduling deferrals | 0 |
| Admission p95 | 183.92 ms |
| Worker listing p95 | 53.60 ms |
| Event-loop p99 | 21.43 ms |
| Elapsed workload | 16,057 ms |
| Paid API calls | 0 |

These are bounded-fixture observations, not production throughput or a causal performance comparison with earlier workloads. HTTP, the generated TypeScript SDK, admission, scheduling, PostgreSQL, persistence, and the ledger are real; external compute provisioning and model execution are explicit simulator boundaries. The full monorepo regression suite, native Docker recovery, browser/CLI journeys, and paid-provider acceptance were not run in this verification slice. No production migration, deployment, or merge was performed.

## Earlier bounded API/database workload

GitHub Actions run **35963569941**, source **6532654b65d0a681185a19026577c098abcc545c**, Node **24.13.0** completed the loopback HTTP/SDK workload with the repository's pinned dependencies:

| Measurement | Observed |
| --- | ---: |
| Accepted/completed Runs | 128 / 128 |
| Peak concurrent synthetic executions | 8 |
| Peak backing Host records | 3 |
| Resource ownership violations | 0 |
| Admission p95 | 196.41 ms |
| Listing p95 across 21 Workers | 45.79 ms |
| Event-loop p99 | 21.04 ms |
| Elapsed workload | 144,556 ms |
| Paid API calls | 0 |

The workload exercised real admission, fair scheduling, PostgreSQL claims, filesystem publication, ledger, listing, pause, and destroy. Native model execution and external compute provisioning were explicit simulator boundaries. It deliberately offered many competing claims; 34,147 deferrals show that this is not a throughput benchmark for a production dispatcher using candidate hints.

The preceding run at `77aa30f0a271861af0644be85a6a94785e1d1c66` exposed database connection starvation. Nonblocking background advisory claims removed that observed failure without increasing the five-connection domain pool. Further contention and I/O work should preserve this result rather than enlarge the pool to conceal it.

That earlier successful action compiled the application and native runtime, regenerated all SDKs, and validated 64 generated public pages plus local documentation targets. No unit/integration suite was run during that earlier continuation at the user's request; the later focused suites above have their own source-specific evidence.

## Native and hosted boundaries

The native performance workflow runs the pinned image without external network access, loopback protocol responses, concurrent harness processes, and continuation in a new container. Its latest result must be recorded separately before making native performance/recovery claims. Live Render, Vercel, model, and hosted-storage checks require explicit configuration and spending authorization; no success is inferred from their stubs.

The current deferred regression inventory is in [maintainer TODO](../../../maintainers/TODO.md). Historical acceptance counts for the retired execution resource are not evidence for the Worker cutover.
