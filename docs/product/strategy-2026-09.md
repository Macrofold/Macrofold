# Macrofold positioning and development strategy

Research cutoff: **September 18, 2026**. This is a proposal for discussion, not accepted product scope or evidence of shipped capabilities. The [improvements tracker](improvements.md) remains authoritative for accepted rank and status; [release acceptance](../maintainers/TODO.md) remains separate. The resulting build order, new proposals and routine-implementation classifications are maintained in that tracker; this report supplies their research and rationale.

## Recommendation

**Continue Macrofold, with a focused six-to-eight-week commercial validation period. Center the product on helping SaaS developers ship agents that carry customer work through to an observable result.** Keep native harness hosting as the execution foundation and an acquisition entry point. Put the product emphasis on continuing work, customer context, bounded authority, understandable costs, and evidence that the job was completed.

Suggested direction:

> Give every customer an agent that follows through.

The first buyer should be a technical founder or small engineering team at a B2B SaaS company adding recurring, customer-specific work to its existing product. The first job should be **investigating and following up on operational exceptions**: a failed customer data sync, an incomplete onboarding, an unresolved integration issue, or another recurring problem with evidence spread across systems. Start with one of these, chosen with design partners. This is a proposed segment, not established Macrofold demand.

This segment offers a plausible expansion mechanism: one developer integrates once, proves one workflow, and enables it for more of their customers. It also fits resources Macrofold already has: customer bindings, separate worktrees, connected-account consent, tool grants, schedules, native harnesses, and usage accounting. The integrating company brings its distribution and domain knowledge; Macrofold makes the ongoing work operable.

Within that segment, prioritize developers who **already have a useful manual routine working in Claude Code, Codex, or another supported harness** and now want to run it repeatedly for customers. They have demonstrated the task's usefulness and can compare setup effort. A guided “publish this routine” path can package reviewed instructions, files, tool requirements, schedule, and budget into the existing API. Start by extending onboarding and examples; preserve explicit credential setup and deployment review rather than uploading arbitrary local configuration.

The largest uncertainty is willingness to pay for this combination instead of assembling existing tools. There is strong evidence that agents are being deployed and that reliable operation remains difficult. There is **not yet evidence that this exact Macrofold packaging will sell**. Launch a narrow working product to resolve that uncertainty before adding another broad platform layer.

Do not base the company on being faster than Cloudflare across its roadmap. Cloudflare is shipping quickly and partnering with frontier agent vendors. A small team can win through a shorter feedback loop around a specific customer job, fewer integration steps, better defaults, and accountable support. Feature count and infrastructure breadth favor larger competitors.

## What changed relative to the supplied conversation

The conversation correctly identifies customer-owned continuity, native harness choice, and packaged operations as useful foundations. Several suggested differentiators now require qualification.

| Earlier positioning idea | Evidence as of September 18 | Strategic consequence |
| --- | --- | --- |
| Cloud execution and schedules create a strong gap | Anthropic documents scheduled Managed Agent deployments, including cron, timezones, and memory-store configuration. [Scheduled deployments](https://platform.claude.com/docs/en/managed-agents/scheduled-deployments). | Scheduling is necessary functionality, with little independent differentiation. |
| A unified native-harness API is unusual | Rivet shipped a normalized API for Claude Code, Codex, OpenCode, and Amp in January; AgentOS expanded its runtime approach in June. [Sandbox Agent SDK](https://rivet.dev/changelog/2026-01-28-sandbox-agent-sdk/), [AgentOS v0.2](https://rivet.dev/changelog/2026-06-25-introducing-agentos-v0-2/). | UHI is useful implementation and distribution material, but a weak exclusive claim. |
| HarnessRouter is primarily basic execution | Its current site offers native harness hosting; its pricing page advertises active-step billing and excludes model waiting time. [HarnessRouter](https://www.harnessrouter.ai/), [pricing](https://www.harnessrouter.ai/pricing). | Benchmark the full customer journey and bill. API breadth and a low posted per-minute number are insufficient comparisons. |
| Persistent, versioned files distinguish Macrofold from Cloudflare | Cloudflare announced Artifacts, a Git-based storage service for agents, in April. Its announcement was a beta announcement, not proof of universal production maturity. [Artifacts](https://blog.cloudflare.com/artifacts-git-for-agents-beta/). | Position around the customer workflow and the guarantees Macrofold verifies; avoid saying Cloudflare lacks persistent or versioned agent storage. |
| Cloudflare requires adopting only its own agent loop | Cloudflare announced Cursor Cloud Agents on Sandboxes on September 2, alongside existing agent partnerships. [Cloudflare announcement](https://www.cloudflare.net/news/news-details/2026/Cloudflare-Expands-Support-for-AI-Coding-Agents-with-Cursor-Cloud-Agents-on-Cloudflare-Sandboxes/default.aspx). | Do not claim native external harnesses are impossible on Cloudflare. |
| Frontier labs mostly expose model calls | OpenAI's Agents API now documents managed harness execution, tools, files, continuing sessions, and orchestration. [Agents API overview](https://developers.openai.com/api/docs/guides/agents-api/overview). | Every layer built only to make a model execute tools is exposed to bundling. |
| Waiting for approval without paying for idle compute is a new category | Trigger.dev documents durable chat agents that suspend for approval, with no compute charge while suspended. [Chat agent](https://trigger.dev/changelog/chat-agent). | Durable waiting improves Macrofold, but cannot be marketed as unique. |
| Persistent identity and Git-backed memory are an open field | Letta offers context repositories and an August SDK for stateful agents across machines and backends. [Context repositories](https://www.letta.com/blog/context-repositories/), [Agents SDK](https://www.letta.com/blog/introducing-the-letta-agent-sdk/). | Competing as another general memory system would require a much sharper advantage. |
| Personal agents need basic recurrence and task tracking | OpenClaw documents schedules, heartbeats, background task records, and durable task flows. [Automation](https://docs.openclaw.ai/automation). | A hosted personal assistant requires more differentiation than persistence plus cron. |

Other relevant substitutes include n8n's reviewed tool execution, Mastra's agent/workflow schedules, and LangGraph's checkpoint inspection and branching. These products approach the job through different interfaces; they still reduce what a developer must build independently. [n8n approval support](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.gmail/message-operations/), [Mastra schedules](https://mastra.ai/blog/introducing-schedules-for-agents-and-workflows), [LangGraph time travel](https://docs.langchain.com/oss/javascript/langchain/frontend/time-travel).

**The remaining opportunity is integration quality around a buyer's recurring job.** It is not an empty market. Macrofold must demonstrate that its packaged path removes enough code, debugging, and operating work to justify adopting another platform.

## Current demand, sentiment, and capital

### Demand evidence and its limits

LangChain's report says quality was the largest deployment barrier for its respondents; observability adoption exceeded evaluation adoption. However, the underlying survey ran November 18–December 2, **2025**, despite the page's June 2026 date. It is a self-selected, technology-heavy sample of 1,340 respondents, useful background rather than a measurement of September demand. [Report and methodology](https://www.langchain.com/state-of-agent-engineering).

Recent Reddit discussions provide more immediate, lower-confidence evidence. Participants describe uncertain completion, repeated manual corrections, recovery after partial failure, inconsistent decisions, and difficulty explaining which context caused a result. Another thread describes agents acting through human credentials without an understandable approval trail. These are examples of reported pain, not verified incident statistics or a representative survey. Some contributors promote their own products. [Reliability discussion](https://www.reddit.com/r/AI_Agents/comments/1vl89wt/whats_still_hard_to_do_reliably_with_ai_agents_in/), [agent authority discussion](https://www.reddit.com/r/AskNetsec/comments/1w726kx/best_practices_for_ai_agent_security_in_2026/).

The resulting demand hypotheses, in descending confidence:

1. **Help me complete a recurring job without watching every run.** Clear pain across product launches, practitioner discussions, and existing automation markets.
2. **Help me know what happened, what needs me, and what it cost.** Strong operational need; many competitors already address portions of it.
3. **Help me deploy the same useful behavior to many customers with distinct context and access.** Strong fit with Macrofold; direct buyer validation remains necessary.
4. **Let me switch harnesses.** Useful escape hatch and procurement consideration, but weaker evidence that it is the primary buying reason.
5. **Give me a general personal agent or more agent memory.** Considerable attention and many offerings; attention does not establish retention or an available distribution advantage.

### X and builder sentiment this week

Direct X search redirected to login, and several direct posts were inaccessible. Research therefore used publicly indexed X reproductions and primary articles from the same ecosystem. This is a limitation: it does not support claims about platform-wide sentiment, engagement totals, or which idea is winning X.

The most concrete current builder excitement is around TypeSafe's Jev: using inexpensive semantic judgments inside existing software rather than making every operation a conversation. A September 18 reproduction of Nader Dabit's X demo shows a spreadsheet interpreting an “Urgency” column and rating rows. The speed is the author's claim, not a replicated result. [Indexed X demo](https://madewithjev.com/builds/predictive-spreadsheets).

Every's head of evals, Mike Taylor, reports testing Jev on writing checks and other bounded decisions, while explicitly calling for stronger accuracy validation before production use. The article was published September 15 and updated September 18. This is useful early experimentation, not established production reliability. [Every's tests](https://every.to/also-true-for-humans/mini-vibe-check-typesafe-s-jev-judged-everything-i-ve-written-in-0-7-seconds).

My interpretation: the appealing new behavior is **continuous, inexpensive interpretation**—classifying changes, selecting context, checking outputs, and escalating exceptions. The commercial opportunity comes from attaching those judgments to an existing workflow with a real owner and an observable outcome.

### Technology enabling new behavior

| Enabling capability | Behavior it makes practical | Macrofold opportunity |
| --- | --- | --- |
| Native harness SDKs and managed execution | A useful interactive routine becomes a programmatically invoked worker. | A short path from a proven manual routine to a customer feature. |
| Durable execution and suspended waits | Work can cross a weekend, a restart, or a human decision. | Preserve the business task and resolve its next step with current authority. |
| Customer-specific tool consent and MCP/API access | The same recipe operates against different customers' accounts. | Make ownership and operating controls easy for the integrating application. |
| Versioned files and curated context | Later runs can use evidence and corrections from earlier work. | Make freshness, provenance, and correction visible and testable. |
| Fast bounded decision models | Software can interpret many changes before allocating expensive agent execution. | Selective wakeups and inexpensive checks, with measured error tradeoffs. |

These are an interpretation of the capabilities documented in the landscape above and Macrofold's [customer connection path](../features/customer-agents/connections.md). The novelty is in the combinations and resulting user behavior; none establishes a proprietary technical advantage by itself.

### Financing and strategic moves

These are announcement dates and company/investor statements. Funding demonstrates investor conviction and competitive pressure, not customer demand by itself.

| Date | Company or event | Announced development | Implication for Macrofold |
| --- | --- | --- | --- |
| September 16 | Resolve AI | $125M Series A for AI used in production engineering. [Company announcement](https://resolve.ai/blog/series-a-funding). | Operational work has budget and strong competition. Do not casually expand a monitoring template into an enterprise AI SRE company. |
| September 15 | TypeSafe | DCVC leads a $40M seed round. [Investor announcement](https://www.dcvc.com/news-insights/typesafe-emerges-from-stealth-with-a-new-way-of-doing-ai/). | Machine-consumable decisions are attracting serious investment; evaluate the interface and economics. |
| September 1 | Empirik | Emerged from stealth with $21M, focused on infrastructure change and an operational graph. [Sequoia](https://sequoiacap.com/article/partnering-with-empirik-building-the-autonomous-infrastructure-engineer). | Domain context and responsibility for a specific job are central to the thesis. |
| September 1 | Orchestra | Announced $3.3M seed, $4.6M total, around enterprise data and agent orchestration. [Company announcement](https://www.getorchestra.io/blog/orchestra-raises-3-3m-to-bring-the-agentic-control-plane). | “Agent control plane” is already crowded positioning; a domain and buyer make it legible. |
| August 17 | xpander | $7.5M seed and general availability of governed, model-independent agent infrastructure. [Company announcement](https://xpander.ai/blog/xpander-funding-seed). | Governance plus portability is another competitive category, not uncontested whitespace. |
| September 10 | Blaxel / Baseten | Blaxel announced its acquisition by Baseten. [Founder announcement](https://blaxel.ai/blog/blaxel-is-joining-baseten-to-build-the-future-of-agentic-infrastructure). | Compute, inference, storage, and networking are consolidating. Buying these capabilities is more attractive than recreating them. |
| September 10 | Supermemory | Discontinued its company-brain and Nova products to focus on its memory API. [Founder explanation](https://supermemory.ai/blog/an-update-to-supermemory/). | Focus and avoiding competition with customers can matter more than launching every adjacent interface. |

Current VC narratives contain both enthusiasm and pressure. Sequoia's September Cymphony announcement frames security as an adoption enabler. a16z's September 3 essay argues that incumbents and general agents force startups to become excellent at a specific cross-system job, with feedback about the actual result. These are investment theses, not neutral forecasts. [Sequoia](https://sequoiacap.com/article/partnering-with-cymphony-security-unlocks-adoption), [a16z](https://a16z.com/the-incumbents-are-coming/).

The strategic inference is that the value is moving toward **operating and improving useful work**, while execution primitives become easier to obtain. Macrofold can participate in that shift, but should earn the right to expand through a repeatable customer job.

## Choose a market and a layer

| Direction | Recommendation | Reason and condition that would change it |
| --- | --- | --- |
| Developer platform for recurring customer work | **Primary direction** | Best fit with the existing product and a plausible one-builder-to-many-customers expansion path. Must prove repeatable integration and payment. |
| Narrow vertical application | **Keep as the main pivot option** | Stronger outcome ownership and clearer pricing. Choose it if several buyers demand the same finished application and do not want an API. |
| Internal operational assistant | **Initial dogfood and demo** | The supplied Mezmo/database/Linear/Slack workflow is concrete and accessible. It does not by itself validate the embedded SaaS segment. |
| Generic harness hosting | **Keep as an entry point** | Useful search intent and developer utility. Harder to defend against native vendors, Rivet, and HarnessRouter. |
| General enterprise agent control plane | **Avoid broad positioning now** | Too many agent architectures and organizational requirements. Operate Macrofold's own customer workflows well first; consider external runtimes only with paid demand. |
| Sandbox infrastructure | **Buy and integrate** | Existing providers have deep infrastructure advantages. Add a Cloudflare or other execution adapter only when a measured customer need justifies it. |
| General memory API | **Integrate where appropriate** | Letta, Supermemory, and other specialists already pursue this directly. Own task context, corrections, and provenance relevant to Macrofold's job. |
| Consumer personal assistant | **Reference app, not a second business** | Different acquisition, support, trust, and retention problems; no demonstrated consumer distribution advantage here. |
| Additional harnesses and autonomous swarms | **Demand-led only** | More adapters and coordination modes do not automatically produce a more useful result. |

The control plane versus infrastructure decision is not binary. Macrofold must continue to own its execution identity, authorization, persistence publication, and financial accounting because the customer promise depends on them. It should buy commodity compute and storage. It should avoid becoming a universal wrapper around every other orchestration platform before a customer needs that interoperability.

Memory should be opinionated about **what deserves to persist, where it came from, and how it is corrected**. It should remain flexible about retrieval engines and native harness behavior. A portable worktree is valuable; transparent migration of every harness's hidden conversation state is a different claim and is not currently supported.

## What to deploy first

### First release: a complete recurring investigation

Use the workflow from the supplied conversation as the first demonstrable recipe:

> Check new operational events every four hours, investigate meaningful changes against a read-only data source, maintain a single issue for the same problem, and notify the owner when something needs attention.

Ship one versioned, runnable example with a local fixture mode and a hosted setup path. It should establish its cursor, retain evidence and issue identifiers in the worktree, enforce a budget, and link every claimed external result to the actual resource. Begin with reads and draft recommendations; explicitly configure any permitted issue or notification writes. Existing schedules, files, and connections support much of this path already.

The product should show four successive occurrences, including an uneventful check, a changed condition, and a follow-up. A single impressive chat answer does not demonstrate continuity. Quiet behavior must be tested: no new useful evidence should not produce a fresh issue or an unnecessary notification.

This is the fastest useful launch surface once hosted acceptance passes. It should not wait for a new task engine, universal memory, or a perfect simplified API. The existing named-agent reference app and memory template are already implemented; extend and package them rather than announcing their basic capabilities as new work.

### Next release: follow an exception through resolution

With design partners, add the missing lifecycle: an investigation pauses for a person's decision, resumes days later on fresh compute with current permissions, executes an approved action, and checks the resulting state. The same business task spans several runs.

For an embedded SaaS example, use a failed customer data sync: discover the failure, collect evidence, propose the supported repair or escalation, wait for the responsible person, and verify that subsequent data arrives. The SaaS vendor supplies its domain tools and acceptance rule. Macrofold supplies the continuing task, bounded execution, review experience, and history.

That is a more specific promise than “run agents in the cloud.” Its value must be measured against the same team's best alternative, such as a managed-agent API or Trigger.dev plus their own application code.

## Features that most strengthen the proposition

### 1. Durable customer tasks

Promote **PRD-04**. Represent the customer's job independently from any individual run: objective, owner, status, evidence references, next action, wake condition, and cumulative spending limit. Distinguish waiting, blocked, completed, cancelled, and failed work in the customer experience.

Start with a small task lifecycle above the existing engine. A wait ends the current execution and releases its slot. Resumption must recheck identity, tool access, resource state, and spending eligibility. Do not promise restoration at an arbitrary line inside every native harness or transparent continuation after an uncertain external write.

The acceptance demonstration is a task that survives a process replacement and a multi-day human wait, then continues once with current permissions. Task instructions in a file are not sufficient evidence that this behavior exists.

Why it matters: the buyer can build a feature that remains useful after the user closes the page. The differentiation is how easily this composes with customer ownership and real tools, not the existence of durable execution in the industry.

### 2. Reviewable actions and an embeddable attention queue

Expand **UX-03** into a useful action surface, paired with PRD-04. A person should see what is proposed, the exact target, material parameters, supporting evidence, cost or impact where known, and what will happen after approval. Supply API access and a small embeddable component for the integrating product.

A new action record should bind the approval to the specific operation and relevant resource version, with expiry and the approving principal. Changed parameters require a new decision. Execution rechecks current authorization. The resulting receipt records whether the effect is confirmed, failed, or uncertain. Provider idempotency or reconciliation handles uncertain outcomes; arbitrary tool calls must not be blindly replayed.

Begin with one or two connectors and clearly supported action types. A universal transaction layer for every MCP server would be a much larger and less credible promise. Existing connection grants remain the authority foundation; a model's confidence or an approval button cannot silently expand them.

This can become reusable product infrastructure: customers keep their own UI while Macrofold handles the work awaiting a decision. It is also a stronger demonstration than another chat interface.

### 3. Evidence and correction as first-class task context

Narrow **PRD-06** initially. Persist a small evidence record containing source, observation time, relevant customer/task, revision, and expiration where meaningful. Keep observed facts, model inferences, user corrections, and authorized instructions distinguishable.

The customer should be able to answer: “Why does the agent believe this?”, “Is this still current?”, and “How do I correct it?” Corrections should affect future work predictably, without pretending that editing a current memory file deletes every old checkpoint or transcript.

Use the existing file convention and versioned storage where sufficient. Add structured metadata only where it enables a concrete operation or test. Do not start by creating another vector database or promising universal semantic recall.

Measure repeated correction rate, use of stale evidence, unsupported conclusions, and retrieval cost. Letta's July memory evaluation distinguishes using existing memory from generating and maintaining it; that supports testing these behaviors separately rather than treating persistence as learning. [Letta evaluation](https://www.letta.com/blog/evaluating-memory-in-production-agents/).

### 4. Incremental checks and inexpensive decision steps

Add an optional path that detects whether a full harness should wake. Use source cursors, event IDs, hashes, thresholds, and ordinary code first. For ambiguous judgments, evaluate a small model or a TypeSafe-style decision model. Escalate uncertain or consequential cases to a full agent or a person.

Useful decisions include whether a new event belongs to an existing issue, whether an update merits interruption, and which evidence is relevant to the current task. Avoid making a classifier the final authorization authority or the sole judge of a high-impact outcome.

This is a promising new feature because recurrence multiplies both cost and annoyance. Start as a recipe-level experiment, with a shadow mode that records proposed suppression without suppressing real checks. Measure missed important changes as well as savings. Only promote it into a shared service after repeated use.

### 5. Outcome checks and safe comparison of changes

Promote **EX-04** and add a small outcome record. A successful process, a saved checkpoint, and a completed customer job are separate facts. An issue-created workflow can check the returned issue ID; a repair workflow can read fresh state; a research workflow can require cited evidence and human acceptance where quality is subjective.

Compare a changed prompt, harness, memory policy, or model against representative fixture tasks and captured, appropriately handled inputs. Show success rate, review burden, latency, and cost per accepted result. Run replayed write operations against fixtures or explicitly isolated environments, not live third-party systems.

Macrofold need not build a general observability suite. Its useful product advantage is connecting the intended job, the work attempted, the artifacts, the external receipts, and the eventual result. Checkpoint rollback restores files; it does not undo a message, payment, or remote API mutation.

### 6. Fleet controls once there is a fleet

Promote **PRD-07**, then a narrow **PRD-08**. Developers need one operation to pause a customer's ongoing work, identify blocked connections, inspect spending, export relevant state, and handle deletion correctly. Active runs and future triggers must remain distinguishable.

After pilot expansion, add versioned recipes and configuration cohorts: test a change, apply it to a small customer cohort, inspect outcome and cost changes, and stop further rollout. Bulk pause and cost visibility are useful earlier than sophisticated automatic routing.

The potential retention mechanism is accumulated customer workflow configuration, corrections, and operating history. Treat this as earned utility, with exportability, rather than deliberate data lock-in. There is no defensible network effect merely because the platform stores more private data.

## TypeSafe: important experiment, not the company thesis

TypeSafe's launch blog is dated September 14; its funding announcement is September 15. Jev is an early-access decision model that returns constrained values and probability distributions rather than open-ended text. Its documented primitives are Choice, Score, and Noul. [Launch](https://typesafe.ai/blog/introducing-system-one-models-and-jev), [API concepts](https://docs.typesafe.ai/introduction).

This makes it relevant to Macrofold as a component before and after expensive agent execution. It is not another interchangeable native coding-harness model. OpenRouter's September 18 Jev listing describes a 32K context window and $0.042 per million input tokens with no output-token charge. Macrofold's current harness catalog expects different capabilities, including a larger context floor. Add a separate bounded decision integration if warranted; do not weaken unrelated catalog requirements to fit it. [OpenRouter listing](https://openrouter.ai/typesafe/jev-1.13/), [current model policy](../../packages/core/src/model-policy.ts).

Do not repeat “cannot hallucinate” as a correctness claim. A type-valid choice can be false. TypeSafe's own documentation explains that calibration describes groups of predictions, not a guarantee for an individual answer; its confidence field summarizes the output probability distribution. Those facts support measuring thresholds on real tasks. [Calibration](https://docs.typesafe.ai/introduction/machine-learning-primer), [confidence](https://docs.typesafe.ai/confidence).

Recommended experiment:

1. Select one real decision, such as whether new evidence warrants reopening an existing investigation.
2. Build a labeled set containing ordinary, ambiguous, adversarial, and important rare cases. Separate tuning examples from the held-out evaluation set.
3. Compare deterministic rules, a small conventional model, Jev, and the existing full-agent path.
4. Measure false negatives, false positives, calibration, tail latency, service failures, and total cost including evidence retrieval.
5. Run in shadow mode. Adopt only if it improves the chosen tradeoff on real traffic. Keep an explicit fallback and periodically inspect cases it would suppress.

At launch, a useful example using Jev may earn attention. A generic “Jev integration” is easy for every platform to copy. The durable product value is the reliable workflow around it.

### Why this matters economically

Illustrative arithmetic, **not a measured workload or margin forecast**: one check every four hours is about 180 checks per 30-day month. At two execution minutes per check and Macrofold's current $0.008/minute customer price, that is $2.88 in execution charges per customer, or $2,880 for 1,000 customers, before inference and other charges.

A hypothetical 5,000-input-token decision at Jev's listed rate is $0.00021; 180,000 such decisions would be $37.80 in model input charges. That does not include fetching evidence, hosting the decision step, or the full runs that remain necessary. It also does not establish equivalent accuracy. It explains why testing selective wakeups is valuable.

HarnessRouter's active-step billing and Macrofold's elapsed-execution billing use different denominators. Compare identical tasks, waiting behavior, and complete invoices. Do not advertise a cost advantage until measured. [Macrofold pricing behavior](marketing/site/pricing.md), [HarnessRouter pricing](https://www.harnessrouter.ai/pricing).

## Prioritization and routine implementation

The [improvements tracker](improvements.md#recommended-build-order) incorporates the reranking and adds the new action, outcome, selective-execution, recovery-fixture, marketing and commercial-validation proposals. It preserves completed work and the useful broader scope of each existing proposal. Use that single table for current ranks and statuses.

The main priority change is moving ongoing work and observable results ahead of media breadth and speculative performance work. Internal cost and contribution-margin analysis is now BIZ-02; BIZ-01 retains customer-facing pricing and communication. PRD-11 owns reviewable action records, PRD-12 owns meaningful-change detection, and PRD-13 owns live task-outcome verification. EX-04 remains the evaluation runner, rather than implicitly becoming a new customer-facing outcome product.

For work requiring little owner involvement, start with EX-04's baseline runner, BIZ-02's internal analysis and EX-03's existing-example versioning/validation portion. The tracker distinguishes fully routine work from partial technical groundwork and proposals needing product, experience, communication, policy or architecture definition. These labels do not authorize additional deployment, outreach or spending.

The chosen buyer remains a hypothesis. A paying workflow with a demonstrated need can legitimately change this order; full hosted release acceptance stays separate.

## Release TODOs that outrank feature development

The customer launch remains gated. Main now records successful hosted Claude Code / Haiku file creation and continuation in separate sandboxes, verified checkpoints, settled charges, and staged upload/restore checks. The production application is deployed, while customer admission and inference remain disabled pending production model and billing acceptance. Other advertised harness, customer-account, recovery and billing checks remain governed by [implementation status](../status/README.md) and [maintainer TODO](../maintainers/TODO.md); these newer acceptance records take precedence over the earlier worktree snapshot.

Prioritize the release work in four groups:

1. **A truthful hosted pilot:** retain the verified Claude staging journey and source-matched runtime; complete remaining native execution, persistence, continuation, cost settlement, and recovery checks for the advertised pilot harnesses. Preserve admission and authorization boundaries. A reduced pilot can advertise a smaller tested surface, but broad six-harness launch claims require their applicable acceptance.
2. **Actual customer separation and connected accounts:** exercise two customers and distinct accounts through the real HTTPS consent/callback, tool use, revocation, and reconnection path. Verify secrets and customer data remain in their intended boundaries.
3. **Operating and charging for the service:** resolve applicable public-origin, production configuration, billing/refund/dispute, backup/restore, retention, support, and dependency-security release items. Before live monetization, complete the money-related acceptance. Establish a reproducible release and recovery procedure.
4. **Broader rollout and convenience:** automate promotion further, validate additional advertised SDK/platform combinations, and improve device/CDN presentation. Do not hold an intentionally narrow pilot for unrelated polish; do not omit required checks for anything the pilot actually exposes.

Do not promote the proposed four-field first-run API rewrite into a launch blocker. A working, documented path can validate demand now. Likewise, a broad Temporal migration, new compute provider, or additional harness is not a prerequisite for observing whether customers want the product.

## Marketing, documentation, and customer experience

### Proposed positioning and copy

The selected current hero, “Run Agent Harnesses in the Cloud,” describes a mechanism. Retain it on a developer execution page and in search-oriented material. Test a customer-outcome message on the main page.

**Near-term candidate, using existing product concepts:**

> Give every customer an agent that keeps working.
>
> Run Claude Code, Codex, and other supported harnesses against each customer's files and connected tools. Schedule work, preserve context between runs, and inspect results and costs through one API.

Primary CTA: **Build your first customer agent**. Secondary CTA: **Run the investigation example**. Availability language must reflect actual hosted acceptance at publication time.

**After durable tasks and action review ship:**

> Give every customer an agent that follows through.
>
> Turn product events into ongoing work. Let agents investigate, ask for the right decision, and continue until the result is verified—with customer context, access, and spending under your control.

These are proposed changes to the selected copy, not edits to the existing design decision. Preserve the established visual identity. The change is information hierarchy and proof, not another visual redesign.

### Page structure

1. Show the customer job and the first action to try it.
2. Demonstrate a timeline: event, evidence, useful result, later follow-up. Add approval and verification steps only as they become real.
3. Show what the developer avoids implementing: customer resource mapping, account consent, durable execution, persisted files, run history, and accounting. Link to exact contracts and limits.
4. Show one tested integration path, including prerequisites and the observable result. Keep advanced primitives accessible below it.
5. Offer a fair “Macrofold versus assembling the pieces” comparison: implementation work, native harness choices, current constraints, operating responsibility, and measured cost.
6. Explain price with a concrete recurring workload and the treatment of idle time, model waiting, failed runs, inference, storage, and spending caps.

Avoid “unlimited memory,” “never forgets,” “exactly once across all tools,” “any harness with seamless session switching,” and “Cloudflare cannot do this.” These claims would exceed the evidence or current guarantees. Publish tested capabilities separately from roadmap items.

### Documentation and product changes

- Add an outcome-led starting path: **Build one recurring customer workflow**. Keep API concepts and full references available; introduce workspace/worktree/session distinctions when needed by the task.
- Make the AI-assisted integration brief produce a verifiable result, not merely a scaffold. Pin its runnable example and documentation version. Never embed operator credentials or imply the brief itself authorizes paid execution.
- Explain files, native conversation state, optional memory, and business-task state separately. A new conversation can reuse files without inheriting another harness's hidden history.
- Put current waiting, overlap, catch-up, budget, retention, export, and deletion behavior beside setup. Per-run budgets are not recurring monthly budgets.
- Show clear outcomes in the UI: execution finished, files saved, external effect confirmed, or user decision required. Never collapse these into an unqualified green “success.”
- Add a task-focused “Needs attention” surface before more dashboard navigation. Make an expired connection repairable from the relevant task.
- Preserve the read-only management MCP boundary. A future customer action API or deployment integration must have its own explicit authorization model.

## Open source and growth

Macrofold is **already Apache-2.0**. The decision is how to make its open source distribution useful, not whether to add a license. Its standalone build also does not mean every production infrastructure provider can be replaced without additional adapter work. [Product definition](README.md), [portability](../architecture/portability.md).

The first distribution asset should be a complete, reusable recurring-investigation recipe. Include safe local fixtures, screenshots of actual results, installation steps, explicit tool scopes, expected costs, and evidence that repeated runs behave correctly. Offer the managed service as the convenient way to operate it.

After the workflow stabilizes, consider extracting a small **agent action and recovery test kit**: fixtures for a lost tool response, stale approval, revoked connection, duplicate trigger, stale memory, and false completion. It should be useful independently of Macrofold and reusable across at least two harnesses. This can establish credibility around behavior Macrofold operates well. Do not announce a new standard or spend weeks designing a plugin marketplace before independent users adopt the first artifact.

UHI documentation and adapters are worth publishing and accepting contributions to, but a standalone unified-harness SDK would compete directly with Rivet. Extract it only if external developers want that specific component and the maintenance burden is justified.

Prioritize growth channels in this order:

| Channel | Asset or action | Conversion to measure |
| --- | --- | --- |
| Founder-led design partners | Work with a small set of SaaS builders on the same recurring exception workflow. | Hosted deployment, second useful week, payment, expansion to another customer. |
| Runnable examples and coding-agent setup | Versioned repo, accurate integration brief, and a clear verified finish. | Time to first external result; integration abandonment and repair rate. |
| X and developer communities | Show a real repeated workflow, interruption/recovery, the cost, and the limits. A Jev comparison can attract timely attention. | Qualified builders who deploy and return, not impressions. |
| Search and technical articles | Answer specific needs such as scheduled native harness execution with persistent customer files or approval across days. | Readers reaching a useful live workflow. |
| Tool and vertical-SaaS partnerships | Integrate where a partner's customers already need recurring work; co-publish a working recipe. | Installed workflows and active customer worktrees per partner. |
| Agencies | A secondary channel for repeated client deployments, with bounded customization. | Repeatable setups rather than one-off consulting hours. |

These are proposed channels; no outreach or posting is authorized by this research request. Do not buy attention before onboarding and the second-week experience work.

A useful growth loop is: a developer installs a recipe, ships a customer feature, enables it for more customers, contributes a correction or reusable integration, and brings another builder. The loop is a hypothesis to test. GitHub stars, launch traffic, or a surge of free compute consumption do not demonstrate it.

## Validation plan and business model

Treat the following as sequencing targets, conditional on team capacity and acceptance work, not engineering estimates.

| Period | Main work | Evidence required before expanding |
| --- | --- | --- |
| Weeks 1–2 | Complete narrow hosted acceptance; ship one recurring recipe and its onboarding; interview roughly 15 relevant builders. | Five credible candidates with an existing recurring job, a budget owner, and access to required tools; first external deployments. |
| Weeks 3–4 | Add the smallest durable task and review path required by the repeated customer job; improve cost visibility. | Several tasks resumed after real waits; users can explain the value and the required intervention. |
| Weeks 5–6 | Improve evidence/corrections and outcome evaluation; run the decision-model comparison in shadow mode. | Better measured completion or lower review burden; no dependence on an unvalidated cost-saving claim. |
| Weeks 7–8 | Test customer expansion, a small fleet surface, and a repeatable paid offer. | Continued use and payment after the initial novelty; another customer enabled without custom engineering. |

Proposed continuation criteria, to set before the pilot:

- At least **five independent organizations** deploy a real workflow.
- At least **three pay** for ongoing operation, and remain active for four consecutive weeks where onboarding timing permits.
- At least **two expand** to a second customer, account, or workflow through substantially the same integration.
- The chosen job produces a useful recurring outcome, with measured human review and correction time below its agreed baseline.
- Every externally mutating pilot path has a tested authorization and uncertain-outcome procedure. Judge quality against a workflow-specific threshold agreed with the buyer, rather than one universal agent-success percentage.
- After the first few learning deployments, setup can be repeated in approximately half a developer day and founder support trends downward. These are target constraints, not current performance claims.

If users like the demo but do not return or pay, do not respond by adding media, models, or another abstraction. Interview the inactive cohort and test a narrower job. If customers consistently buy one finished workflow and resist integration, consider a vertical application. If most value is cheap routing and the native harness seldom helps, consider a smaller decision/workflow product. If existing managed platforms already solve the job with little additional work, stop or sharply narrow the horizontal platform investment.

Price initially as a paid platform relationship plus transparent metered usage, with clear customer/workflow attribution and hard spending controls. Test packaging with actual buyers; do not promise a new exact price before cost measurement. Pure compute resale leaves little room for support and invites price competition. Pure outcome pricing is premature while completion and external dependencies remain variable.

Track contribution margin after inference, compute, storage, connector costs, and support. Also track customer cost per accepted result, suppressed noise, time spent reviewing, and retained paid organizations. Fewer compute minutes can be a better customer outcome, so a successful product should not depend only on maximizing billable runtime.

## Long-term vision and defensibility

The expansive vision is software whose records can carry **ongoing responsibilities**. A customer onboarding, broken integration, unresolved case, or recurring review can retain an owner, context, permitted actions, budget, and completion criteria. Different models and harnesses perform portions of the work as capabilities improve. The customer sees progress and results rather than having to restart the same conversation.

An initial exception workflow can expand into onboarding follow-up, data-quality repair, customer-success operations, vendor coordination, recurring research, and eventually more autonomous execution. These are future markets with distinct validation and integration needs, not a roadmap to build simultaneously.

The defensible asset would be the combination of a deeply useful integration path, task-specific evaluation and correction loops, reliable operational behavior, distribution through developers, and accumulated customer configuration that is worth keeping. Private customer data should not be pooled or treated as a training entitlement; cross-customer improvements can come from generic failure cases, consented feedback, and reusable engineering.

The immediate bet is smaller and falsifiable: **can Macrofold let a SaaS builder ship a recurring customer job faster, operate it with less intervention, and expand it economically?** If that works, there is a credible route to a much larger platform for continuing work. If it does not, additional infrastructure breadth will not repair the positioning.
