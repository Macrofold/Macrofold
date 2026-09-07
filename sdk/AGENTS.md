# SDK implementation rules

Follow [root instructions](../AGENTS.md) and [integration/client rules](../.agents/rules/integrations.md). TypeScript changes also follow [TypeScript rules](../.agents/rules/typescript.md). Keep all five clients compatible with the public contract and retain their documented streaming, retry, and cancellation behavior. Read [SDK architecture](../docs/features/api/sdks/implementation.md) before changing generation or transport code.

Generate owned artifacts from OpenAPI; do not hand-edit files listed in `.generated-files.json`. Keep maintained transports, build manifests, examples, and tests separate. Contract changes require `pnpm sdk:generate:all` and the affected language tests. Public packages/imports use `macrofold`; Python documentation uses explicit client construction and `close()`, without a context-manager example.

Exercise real loopback HTTP/SSE transports, package acceptance, and isolated application fixtures rather than live providers by default. Check idempotency headers, binary bodies, decimal-string amounts, redirect refusal, reconnect cursors, and detach behavior; generated compilation alone is insufficient.
