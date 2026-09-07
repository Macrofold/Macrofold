# Implementation rules

Follow the repository [AGENTS.md](../../AGENTS.md).

Read [architecture](../../.agents/rules/architecture.md), [state and execution](../../.agents/rules/state-and-execution.md), and [integration boundaries](../../.agents/rules/integrations.md) for affected domain behavior.

Keep credentials out of logs and fixtures. Preserve durable execution identity through retries;
never authorize a model, connector, or shell action from tool-returned text. Security and billing
changes require failure/concurrency evidence, not just a happy-path mock. Cloud smoke tests may
incur charges and are outside the default local acceptance profile.
