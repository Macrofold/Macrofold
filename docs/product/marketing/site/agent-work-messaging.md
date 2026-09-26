# Agent-work messaging

This is a research and editorial reference for the [marketing site](README.md), not a product feature guide. Public copy should explain Macrofold on its own terms. [Design Language](../../design-language.md) remains authoritative for the selected visual direction and exact hero copy.

## Editorial direction

Lead with the work a developer can delegate, inspect, and continue. Macrofold is an easy-to-use control plane for cloud agents, not a new model or a replacement agent framework. Start with a workspace, an agent, and one run; introduce schedules, connections, parallel worktrees, and hosting choices as the need arises.

The central distinction is **lasting work, temporary execution**. This is existing Macrofold behavior, not a capability introduced by AX. Files persist independently of compute; compatible native conversation continuation is a separate, qualified capability. Do not claim that every live process, installed system package, or in-memory object survives a stopped environment.

## What the public discussion actually shows

The research snapshot below was collected on September 26, 2026. It establishes visible announcement and amplification channels, not a causal explanation of GitHub star growth or evidence of production adoption. Post counts change; repeated reporting is not an independent customer testimonial. X and LinkedIn visibility was partial, so no claim is made to have reconstructed every influential share.

| Channel | Observed contribution | Editorial lesson |
| --- | --- | --- |
| [Google Cloud launch, May 20](https://cloud.google.com/blog/products/ai-machine-learning/agent-executor-googles-distributed-agent-runtime), by Jaana Dogan and Ethan Bao | Positioned the runtime around moving beyond fragile long-running agents, keeping execution consistent, and retaining choice of agent, model, and compute. The launch was part of the I/O-period announcement cycle. | Explain the operational work the product removes, then show the ordinary developer workflow. Google's distribution and credibility cannot be reproduced by copying its terminology. |
| [Jaana Dogan's launch post](https://x.com/rakyll/status/2057129537553785093) | An indexed announcement snippet introduced scheduling, resumption, recovery, auditing, and trajectories. The full X thread and reliable engagement data were unavailable. | A compact problem-and-capability summary travels well; do not infer reach from a search snippet. |
| [InfoWorld, May 25](https://www.infoworld.com/article/4176801/google-adds-open-source-agent-executor-to-support-ai-agents-in-production.html), by Anirban Ghoshal | Extended the launch into enterprise coverage, emphasizing production operations while distinguishing runtime improvements from broader governance obligations. | Visibility and control are useful benefits; they are not a claim that infrastructure solves every governance problem. |
| [Hacker News September discussion](https://news.ycombinator.com/item?id=49780797), submitted by blazarquasar | The retrieved thread showed 664 points and 299 comments. Co-creator rakyll described customer-compute requirements and repetitive environment/session/tool setup. Readers also challenged setup burden and enormous scale claims. | Borrow the practical problem, not the Kubernetes analogy. Demonstrate one useful result before advanced configuration. Attention included skepticism, not unanimous endorsement. |
| [daily.dev September share](https://daily.dev/posts/sbvsn4lbs), Agentic Engineering / @idoshamun | The retrieved page showed 99 upvotes and 11 comments and highlighted prepared repositories/tools, isolation, and provider configuration. | Saved configuration and connected tools deserve concrete examples. These counts indicate circulation on that page, not adoption. |
| [InfoQ, September 22](https://www.infoq.com/news/2026/09/google-ax-orchestrator/), by Olimpiu Pop | Framed AX as Kubernetes-style orchestration and emphasized stateful, intermittent workloads. It linked the HN discussion and a Reddit repost. | Explain why work should outlive a run. Treat articles as evidence of messaging, not verification of every performance or roadmap claim they repeat. |
| [Samuel Lawrentz's firsthand write-up](https://samuellawrentz.com/blog/google-ax-kubectl-for-agents/) | Described installing the CLI but not running a task because the infrastructure prerequisites did not fit his setup. Found the named configuration responsibilities useful as a checklist. | Repeatable setup resonates even when the platform is too heavy. Keep Macrofold's first-success path small and its permission controls understandable. |

## Translate the interest into truthful Macrofold benefits

| Audience need | Public explanation | Existing owner and boundary |
| --- | --- | --- |
| Stop repeating environment and tool setup | Set up an agent once; reuse its instructions, harness, model, and selected connections. | [Runs and agents](../../../features/execution/README.md), [connections](../../../features/identity-integrations/README.md). Saving a preset does not authorize tools or automatically discover/configure an environment. |
| Work that does not disappear after a task | Keep files between runs; another run can build on or review them. | [Workspaces](../../../features/workspaces/README.md). Verified file persistence is distinct from live RAM and native conversation compatibility. |
| Work beyond a laptop or open browser tab | Submit a background agent run and reconnect to its progress and result. | [Streaming](../../../features/api/streaming.md). Direct inference has different connection semantics; deadlines, cancellation, and retention still apply. |
| Use familiar agents in an application | Run supported native harnesses through the same API, terminal, and dashboard. | [Harnesses](../../../features/execution/harnesses.md). Do not imply arbitrary harness compatibility or interchangeable native conversation formats. |
| Delegate without losing visibility or authority | Review output and tool activity; choose permissions and spending limits. | [Permissions](../../../features/execution/permissions.md), [billing](../../../features/billing/README.md). Do not promise perfect isolation, certification, or reversal of external actions. |
| Reuse work across agents or tasks | Hand off saved files sequentially, or use separate worktrees for parallel work. | [Shared-agent guide](../../../features/workspaces/shared-agents.md). A shared worktree has one active writer; parallel work is bounded by plan and capacity. |
| Keep deployment choices open | Use a configured Cloud deployment or operate Macrofold yourself. | [Cloud](../../../cloud/README.md), [self-hosting](../../../operations/README.md). No automatic cluster onboarding, instant provider migration, or complete data residency claim. |

## What not to import

Do not add AX terminology, comparisons, or competitor references to the first-run journey. Do not imply an AX/Substrate backend exists. Do not publish unmerged Worker architecture as current behavior. Avoid billions-of-agents claims, borrowed density/latency numbers, zero-cost idle promises, universal automatic recovery, arbitrary process hibernation, automatic tool discovery, or claims of production adoption.

The selected hero, visual identity, interaction model, and real API examples do not need a redesign. Improve the explanations around them. A linked overview should answer how useful work continues and what the developer still controls, not create another infrastructure glossary.

## Public-content map

The README introduces the outcome and first task. The documentation overview helps readers choose a starting path. Core concepts explains persistence separately from execution and conversation. Feature guides own saved agents, handoffs, budgets, and streaming details. The homepage's existing benefit and story copy connects those behaviors to visible results. Deeper claims and limitations stay linked, rather than being repeated as long caveat blocks in every surface.

Keep this research outside the public navigation manifest. Future copy changes should follow the same outcome → working path → observable result → relevant limit sequence, with source evidence for new capability claims.
