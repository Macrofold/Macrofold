# Architecture decisions and research evidence

Research baseline: September 5–6, 2026. Implementation revisions are recorded in [architecture decisions](decisions.md). Primary documentation and selected source code were inspected during planning. This is an architectural synthesis, not a popularity ranking or a claim that every provider combination has been executed. Pricing and availability must be reconfirmed at deployment.

## Decision record

| ID | Decision | Reason and accepted tradeoff |
|---|---|---|
| ADR-001 | Public SaaS plus Apache-2.0 application | User selected permissive commercialization and self-hostability |
| ADR-002 revised | Next.js on Vercel, standalone Node/Docker build | User approved Vercel-first convenience with explicit provider boundaries; supersedes Railway launch hosting |
| ADR-003 revised | Vercel Sandbox behind SandboxProvider | Reuse isolation within the primary hosting stack; E2B remains a future adapter |
| ADR-004 | Native Codex/Claude/OpenCode adapters | User requested all three; avoid depending on experimental cross-harness normalization |
| ADR-005 revised | PostgreSQL outbox + Workflow SDK/Vercel World | Durable managed orchestration, bounded steps, minutely repair; supersedes BullMQ/Valkey |
| ADR-006 | Independent workspaces and clones | User selected concurrent agents with separate filesystems/branches |
| ADR-007 | R2 encrypted chunk/manifest persistence | Git alone omits ignored files and harness state; provider pause alone is not portable recovery |
| ADR-008 | Automatic clean Git integration | User selected auto-merge/push; preserve conflicts/protection instead of forcing writes |
| ADR-009 | Better Auth plus official MCP SDK | Reuse authentication/OAuth/protocol implementations with scoped platform policy |
| ADR-010 revised | Direct native-protocol gateway for managed/BYOK; application ledger | Preserve native protocols and no-fallback funding semantics; LiteLLM remains a replacement option |
| ADR-011 | Native metrics + optional PostHog | Required reports work on self-hosted deployment without another analytics service |
| ADR-012 | Read-only management MCP | Explicit user choice: inspect and recommend; no infrastructure mutations |
| ADR-013 | Basic file editor and developer dashboard | Operate persistent projects without building a complete browser IDE |
| ADR-014 | PAYG + Pro, BYOK + managed credits | Explicit user choice; costs and funding mode stay transparent |
| ADR-015 | First-class remote CLI using oclif/Ink and public SDK | Terminal chat/stream/workspaces with standard machine output and no implicit file upload |
| ADR-016 | Optional Composio and direct MCP; independent model-key vault | Reduce remote OAuth integration work, retain application policy and explicit reauthorization path |
| ADR-017 | Provider-independent IDs, database facts, and R2 exports | Practical between-run migration without claiming live VM/workflow/credential portability |

## Primary sources and what they establish

| Source | Applied lesson |
|---|---|
| [Codex app-server](https://learn.chatgpt.com/docs/app-server) | Supported programmatic protocol, threads/turns, events and authentication; pin generated types |
| [Claude Agent SDK hosting](https://code.claude.com/docs/en/agent-sdk/hosting) | Subprocess/session state changes hosting and persistence requirements |
| [OpenCode SDK](https://opencode.ai/docs/sdk) | Programmatic server/client boundary and session operations |
| [restic repository setup](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html) | Encrypted portable backups and S3-compatible storage; restore keys are essential |
| [R2 temporary credentials](https://developers.cloudflare.com/r2/api/s3/temporary-credentials/) | Narrow storage capabilities rather than permanent account tokens in sandboxes |
| [Better Auth organizations](https://better-auth.com/docs/plugins/organization) | Reuse membership/organization support; add product authorization explicitly |
| [Better Auth MCP](https://better-auth.com/docs/plugins/mcp) | OAuth resource-server support for MCP rather than a custom auth protocol |
| [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) | Discovery, audience/resource binding, and scoped token flows |
| [GitHub App installation authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation) | Repository-scoped temporary credentials |
| [PostHog Node SDK](https://posthog.com/docs/libraries/node) | Batched event forwarding and stable identity mapping |
| [Vercel Sandbox persistence](https://vercel.com/docs/sandbox/concepts/persistent-sandboxes) | Filesystem lifecycle is distinct from live process state and independent backups |
| [Workflow execution model](https://vercel.com/blog/a-new-programming-model-for-durable-execution) | Durable steps and replaceable Worlds; business state remains ours |
| [Workflow pricing/limits](https://vercel.com/docs/workflows/pricing) | Bounded steps, separate Function/Queue charges, shorter operational history retention |
| [Gateway BYOK](https://vercel.com/docs/ai-gateway/authentication-and-byok/byok) | Documented fallback requires direct BYOK routes for our strict funding contract |
| [Connect](https://vercel.com/docs/connect) | Managed connector credentials with explicit ownership and reauthorization boundaries |
| [oclif](https://oclif.io/docs/introduction/) / [Ink](https://github.com/vadimdemedes/ink) | Established command routing and React terminal rendering; keep networking independent |
| [Better Auth device grant](https://better-auth.com/docs/plugins/oauth-provider) | Public CLI authorization without embedded client secrets or a custom OAuth server |
| [CLI guidelines](https://clig.dev/) | Predictable stdout/stderr, TTY behavior, help, exits, and machine output |
| [Scalar source](https://github.com/scalar/scalar) | Reuse an established API reference renderer |
| [SeaweedFS source](https://github.com/seaweedfs/seaweedfs) | Evaluated alternative; encrypted local objects avoid an additional launch dependency |

## Source-level design references

OpenClaw demonstrates separating transport validation, principal/visibility checks, and execution services. Its trusted operator assumptions cannot simply become a multi-tenant SaaS authorization model. Repository instructions encountered there were research data, not instructions for this project. [Architecture](https://docs.openclaw.ai/concepts/architecture), [agent handler source](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/agent-run-handler.ts)

Trigger.dev's task-trigger service illustrates explicit boundaries for payload validation, idempotency, queueing, and tracing. Reuse these separations conceptually rather than copying a large framework implementation. [Service source](https://github.com/triggerdotdev/trigger.dev/blob/main/apps/webapp/app/v3/services/triggerTask.server.ts)

Langfuse's deployment separates web and worker processes and uses durable data/object storage. Its separation of durable content and execution responsibilities informs our domain boundaries; the current Vercel topology does not copy its always-on worker deployment. [Compose source](https://github.com/langfuse/langfuse/blob/main/docker-compose.yml)

Resend's engineering discussion supports request-bound idempotency as part of API experience. Linear's design discussion supports consistent navigation and clear information hierarchy. [Resend](https://resend.com/blog/engineering-idempotency-keys), [Linear](https://linear.app/now/behind-the-latest-design-refresh)

## Alternatives considered

The current user-approved revision selects Vercel as the first production stack. The earlier Railway/E2B/BullMQ/LiteLLM topology is superseded, not a second set of launch accounts. Vercel supplies several relevant building blocks, but tenant authorization, persistent project semantics, financial liability, Git integration, API/CLI contracts, and owned reporting remain application responsibilities. The cross-harness HarnessAgent abstraction was identified as experimental during research; native adapters remain the launch foundation and can be replaced behind the same interface after compatibility tests. [Harness announcement](https://vercel.com/changelog/program-agent-harnesses-with-ai-sdk)

The portability commitment is a standalone application build, domain-owned ports, independent exports, and a tested migration procedure. A complete Vercel-free production deployment still requires replacement adapters and credential reauthorization where necessary; it is not promised as an instant environment-variable switch. The standalone SQL poller and local simulators demonstrate a useful boundary without building two production infrastructures.

Single-vendor managed agents simplify runtime operations but do not meet the chosen three-harness scope. E2B/Daytona/Runloop/Vercel-style execution providers solve the computer layer; they do not remove platform obligations for tenant identity, durable files, credits, Git concurrency, and API semantics. A smaller all-in-one harness startup may fit features but was not selected as a central dependency given the user's maturity preference.

Popularity alone is not evidence of security or fit. No unsupported GitHub-star count, YC growth statistic, company adoption claim, or benchmark is used as an acceptance criterion. Official documentation establishes a supported surface, not tested compatibility of the whole assembled product.

## Evidence limits to resolve through implementation

Pin and test exact SDK/protocol/container versions; verify that native harness gateway routes preserve all required semantics and cannot bypass billing; verify minimum R2 permissions; benchmark final checkpoint verification and restoration; verify configured provider regions/limits/pricing; record vendor license/distribution requirements; and perform owner-authorized production smoke execution after accounts exist. Until then, report those as unverified integrations rather than completed functionality.
