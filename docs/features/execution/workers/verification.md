# Worker execution evidence

Evidence is commit-specific. A green build is not native recovery or paid-provider evidence, and simulated external boundaries are not actual cloud resource measurements.

## Bounded API/database workload

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

The same successful action compiled the application and native runtime, regenerated all SDKs, and validated 64 generated public pages plus local documentation targets. No unit/integration suite was run during this continuation at the user's request.

## Native and hosted boundaries

The native performance workflow runs the pinned image without external network access, loopback protocol responses, concurrent harness processes, and continuation in a new container. Its latest result must be recorded separately before making native performance/recovery claims. Live Render, Vercel, model, and hosted-storage checks require explicit configuration and spending authorization; no success is inferred from their stubs.

The current deferred regression inventory is in [maintainer TODO](../../../maintainers/TODO.md). Historical acceptance counts for the retired execution resource are not evidence for the Worker cutover.
