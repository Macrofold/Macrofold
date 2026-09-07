# SDK, autosave, and failure-path acceptance

This record covers the focused SDK, draft-saving, diff-memory, and test-gap changes. See [testing and CI](../testing.md) for broader application and coverage policy.

## Verified locally

| Surface             | Evidence                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain              | 499 tests in 67 files pass, including all unit, integration, and Git cases, on disposable PostgreSQL 17.11 databases.                                                                                                                                                                                                                        |
| Memory boundary     | Diff fixtures cover combined sizes just below, at, and above 512,000 bytes, plus one-gibibyte additions/deletions whose content objects do not exist. No oversized object is read.                                                                                                                                                           |
| Authentication      | Tampered verification, expired password reset, untrusted reset redirects, MCP callback expiry/browser/user/ownership binding, rejected or interrupted token exchange, callback replay, and revoked upstream refresh are asserted.                                                                                                            |
| CLI                 | Refresh boundary timing, rejected refresh recovery, stale/dead/live/incomplete credential locks, permissions, symlinks, corrupt JSON, expired credentials, invalid device responses, and expiry during a stalled token exchange are covered.                                                                                                 |
| Filesystem          | Real child processes are killed before/after file publication and before index publication. Recovery preserves the verified files and can finish an interrupted restore/capture.                                                                                                                                                             |
| Dashboard           | Eight focused Chromium journeys pass: exact two-second trailing debounce, newer typing during a pending save, confirmed Saved status, stale-revision rejection and discard, interrupted autosave with explicit retry using the same recovery key, delayed refresh, external/API changes, navigation, reconnects, and organization isolation. |
| Installed clients   | The CLI and TypeScript SDK install from npm tarballs. A fresh Python wheel imports `macrofold` and passes all 21 Python/client/cost tests.                                                                                                                                                                                                   |
| Application clients | Four CLI subprocess cases, the real PTY journey, and Python project/file/SSE/session-continuation acceptance pass against the optimized local server and simulator.                                                                                                                                                                          |
| New SDKs            | Seven Go, six Rust, and four Java tests pass, including real loopback protocol fixtures and each language's project → run → stream → persisted result journey against the actual API handler and simulator worker.                                                                                                                           |
| Build               | Strict TypeScript and documentation checks pass. Regenerating all 475 Go/Rust/Java sources produces identical hashes. A production Next build passes for the dashboard change; the focused browser rerun reused it after confirming all non-marketing application source hashes still matched.                                               |

No paid provider calls were made. Docker became unresponsive during this session; a separate native PostgreSQL 17.11 fixture replaced it for testing. The existing preview and Docker containers were not restarted. Missing local SMTP produced seed-delivery warnings; account verification/reset transport behavior was tested through deterministic email fixtures, not that unavailable SMTP service.

## Coverage scope

The complete domain report includes 200 application TypeScript files: **51.01% lines, 49.74% statements, 40.50% branches, and 40.66% functions**. Existing domain/module floors pass without exclusions or lower thresholds. MCP OAuth has 68.05% branch coverage and CLI profiles 73.75%; these are improvements in evidence, not claims of complete branch coverage.

Child-process crash tests assert recovery but do not flush child counters into the domain report. Python, Go, Rust, and Java results are separate from TypeScript. Combined browser/server/worker/CLI/native coverage and mutation scores were not recomputed for this change; earlier full-suite measurements remain in the [repository review](repository-review.md).

Concurrent marketing changes landed after the accepted dashboard build. The focused rerun checked the unchanged dashboard/API/runtime sources and did not validate the newer marketing implementation. It is not a full-browser acceptance claim for those other changes.

## Remaining acceptance

Whole-directory transactional restore and power-loss guarantees are not established by per-file process-kill tests. Browser Back/Forward before autosave fires still needs draft recovery. Broader identity/provider combinations and hosted OAuth consent remain in the [gap audit](gaps.md).

SDK registry publication, clean registry consumer installs, all generated endpoints on the deployed service, cloud SSE behavior, and native provider execution remain [release checks](../../maintainers/TODO.md). Native-container tests were not rerun while Docker was unavailable. The new SDK CI job is implemented; a local pass is not a hosted Actions result.
