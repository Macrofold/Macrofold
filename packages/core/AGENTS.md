# Implementation rules

Follow the repository [AGENTS.md](../../AGENTS.md).

Read [architecture](../../.agents/rules/architecture.md), [state and execution](../../.agents/rules/state-and-execution.md), and [integration boundaries](../../.agents/rules/integrations.md) for affected domain behavior.

Keep credentials out of logs and fixtures. Preserve durable execution identity through retries;
never authorize a model, connector, or shell action from tool-returned text. Security and billing
changes require failure/concurrency evidence, not just a happy-path mock. Cloud smoke tests may
incur charges and are outside the default local acceptance profile.

Trace request identity, current principal/organization/resource authority, reservation, dispatch, completion, checkpoint/settlement and invalidation when changing asynchronous work. Revalidate at the owning commit/dispatch boundary after waits; stale or cancelled work must not regain authority. Restoring files or sessions must not rewind external billing, current access restrictions or execution fencing.

Use the [AI workflow](../../.agents/skills/macrofold-ai/SKILL.md) for model/context execution, [performance](../../.agents/skills/macrofold-performance/SKILL.md) for meaningful hot paths and [design](../../.agents/skills/macrofold-design/SKILL.md) for changed cross-layer contracts. A local fix within an unchanged contract does not require a new project brief.
