# CLI implementation rules

Follow [root instructions](../../AGENTS.md), [TypeScript rules](../../.agents/rules/typescript.md), and [integration/client rules](../../.agents/rules/integrations.md). Read the [CLI contract](../../docs/features/cli/implementation.md) for changed commands, output, cancellation, credentials, or transfers. Use built subprocess and real-terminal checks when those boundaries change; do not access the domain database from the CLI.
