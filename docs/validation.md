# Contract and design validation

Revision: September 6, 2026. The application is implemented; [16-implementation-status.md](16-implementation-status.md) records execution evidence. This file covers document/contract checks.

OpenAPI 3.1 version 0.9.0 contains **104 operations and 97 component schemas**. The official MCP SDK serves **10 read-only operator tools** mapped to REST operations/scopes. The CLI registry contains 40 documented commands. `pnpm contracts` regenerates TypeScript definitions and both SDK operation maps; AJV validates requests and response projection excludes private fields. Tests cover schema examples, generated routes, SSE, authentication and runtime scope boundaries.

The 51-requirement matrix now distinguishes implemented/local acceptance, operator configuration and deliberate launch-scope revisions. Current architecture replaces the original restic/Connect/AI Gateway/ORM/PG-Workflow-World proposals with tested chunked persistence, optional Composio/direct MCP, a metered native-protocol gateway, explicit SQL and the standalone SQL poller. The decision log retains the reasons; old research alternatives are not extra launch dependencies.

`python3 scripts/estimate-costs.py --csv` regenerates the low/base/high cost examples; `python3 tests/test_costs.py` checks decimal arithmetic, BYOK, volume, credit caps and memory billing increments. These are editable workload assumptions, not a provider invoice or profit guarantee.

Relative documentation/source links, generated artifacts, package manifests and release instructions are checked before handoff. Schema/document validation does not replace tenant, payment, persistence, native harness or production-account acceptance. Free local fixtures are not described as live paid execution.
