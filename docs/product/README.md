# Product definition

Read the [Design Language](design-language.md) for visual, interaction, copy, and documentation preferences. Explore the [marketing concepts](marketing/README.md) for ten visual directions, or read the product model below.

## Outcome and audience

Provide an inference-like API whose unit of work is a full agent harness. A developer submits a task, the harness uses a cloud computer and authorized tools for multiple turns, and the developer polls, streams, or receives a completion webhook. A filesystem and conversation can survive between invocations.

The initial audience is developers and small teams automating work in repositories of code, Markdown, documents, scripts, and reusable instructions. The platform itself is a public SaaS with organizations and paid usage, while its application code is licensed under Apache-2.0. Vercel is the initial hosting stack. The same application has a standalone Node/Docker build; a Vercel-free deployment additionally needs replacement infrastructure adapters, as defined in [portability](../architecture/portability.md).

Keep four concepts distinct: the sandbox supplies execution isolation; the harness owns the agent loop; the model performs inference; the platform owns identity, jobs, persistence, tools, billing, and user experience. Do not substitute a home-grown tool loop for a requested harness.

## Required user journeys

1. Sign up, verify email, create an organization, configure BYOK or buy credits, create a project, generate an API key, copy an example, and inspect the first successful run.
2. Run a task against an existing project; let it edit files; come back later with a follow-up that reads those changes and continues the conversation.
3. Import an authorized GitHub repository; create two independent agents; inspect their isolated changes; automatically integrate clean changes into the selected branch; inspect and resolve conflicts without data loss.
4. Add a remote MCP endpoint through the dashboard; authenticate through OAuth or a credential; select permitted tools; attach the connection to an agent or run. Reauthorize expired or revoked connections.
5. Browse project files, preview and edit text, upload/download files, inspect diffs, and restore a checkpoint without needing a desktop IDE.
6. View current agents and historical runs, including messages, provider-exposed reasoning summaries, tools, logs, artifacts, files, usage, and synchronization results.
7. Use the operator dashboard/API/MCP to understand growth, accounts, usage, costs, infrastructure, and reliability, then decide whether to scale or improve the product.
8. Log in from a terminal, link a local folder to a hosted project, create/select remote workspaces, chat with a remote harness, stream tools/results, detach, and resume from another machine.
9. Explicitly push local edits or pull remote edits with a preview and conflict checks; optionally check out a remote branch as a true local Git worktree. Working only in the cloud requires no local clone.

## Launch scope and boundaries

Launch includes all three harnesses, native tools, Brave web search, arbitrary compatible remote MCPs, pinned stdio MCPs, organization authentication, API keys, subscriptions, prepaid credits, signed webhooks, TypeScript, Python, Go, Rust, and Java SDKs, a streaming interactive CLI, public API docs, persistent files, GitHub integration, analytics, and operator reporting.

The initial dashboard has a useful file editor, not a full IDE or unrestricted browser terminal. The initial deployment is single-region. The application does not build its own VM scheduler, merge conflict AI, OAuth library, payment processor, analytics warehouse, or a general multi-provider fallback router. Enterprise SSO/SCIM, multi-region writes, other Git hosts, arbitrary custom machine images, and autonomous infrastructure mutations are subsequent additions rather than hidden launch requirements.

Operators can read and recommend through the management MCP. Tenant agents can act autonomously within their pre-granted tools; this is separate from operator authority. No implicit access to infrastructure accounts is granted to customer sandboxes.

## Defaults visible to users

| Setting                   | Default                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| Project mode              | Persistent                                                                                                |
| Agent filesystem          | Independent workspace and branch                                                                          |
| Workspace concurrency     | One active writer                                                                                         |
| Terminal execution        | Remote; local linking and selection have no file side effects                                             |
| Chat while a run is busy  | Explicit queued follow-up, up to 10 pending per session, 24-hour default queue deadline, user-shortenable |
| Run timeout               | 15 minutes, maximum 2 hours                                                                               |
| Run budget                | $2, bounded by organization/platform caps                                                                 |
| Git integration           | Optional automatic merge/push after explicit project enablement                                           |
| Conflict                  | Keep work; surface conflict; require a new resolution action                                              |
| BYOK failure              | Surface error; no managed-credit fallback                                                                 |
| Public signup             | Email verification required before execution                                                              |
| Tool authority            | Explicit grants, then autonomous execution within grants                                                  |
| Product/operator timezone | UTC metrics; timestamps localized for display                                                             |

Persist latest project files until explicit deletion. Keep terminal run/accounting identities separately from detailed content; final response and tool history follow their 30/90-day retention. Default detailed trace/artifact retention is 30 days for Starter and 90 for Pro and Scale; show the expiration before users start work and allow exports. Older traces may be archived to R2 during their retention period. Historical filesystem checkpoints keep all for 24 hours, daily for 30 days, weekly for 12 weeks; always protect the latest verified checkpoint and explicit user-pinned checkpoints. User-pinned checkpoints count toward storage.

## Success criteria

An external developer can perform the complete journey with documented API calls or the CLI; closing a browser or detaching a terminal does not stop an accepted run; retries do not duplicate runs; lost orchestration processes do not erase files; an operator can derive truthful DAU/WAU/request/token reports; and deployment can be reproduced from documented inputs. CLI interruption has explicit cancel versus detach behavior, and local edits are never silently overwritten by remote output.

Acceptance has three levels: passing deterministic local tests; passing free live provider checks; passing an explicitly authorized production smoke run. The first two cannot stand in for billable execution validation. The final handoff lists which level each integration reached.
