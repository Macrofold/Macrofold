# SDK implementation rules

Follow [root instructions](../AGENTS.md) and [integration/client rules](../.agents/rules/integrations.md). TypeScript changes also follow [TypeScript rules](../.agents/rules/typescript.md). Keep both clients compatible with the public contract, retain streaming/retry/cancellation behavior, and generate owned artifacts from their source schema. Use each SDK's existing transport fixtures and package acceptance rather than live providers by default.
