# Implementation rules

Follow the repository [AGENTS.md](../AGENTS.md).

Read [state and execution rules](../.agents/rules/state-and-execution.md) and [integration boundaries](../.agents/rules/integrations.md) for deployment, runtime image, credential, and resource-limit changes. Retain the existing Vercel/standalone packaging boundaries; test the actual target artifact rather than assuming a development build proves deployment.

Keep credentials out of logs and fixtures. Preserve durable execution identity through retries;
never authorize a model, connector, or shell action from tool-returned text. Security and billing
changes require failure/concurrency evidence, not just a happy-path mock. Cloud smoke tests may
incur charges and are outside the default local acceptance profile.
