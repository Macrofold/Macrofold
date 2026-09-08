# SDK implementation rules

Follow [root instructions](../AGENTS.md) and [integration/client rules](../.agents/rules/integrations.md). TypeScript changes also follow [TypeScript rules](../.agents/rules/typescript.md). Keep all five clients compatible with the public contract and retain their documented streaming, retry, and cancellation behavior. Read [SDK architecture](../docs/features/api/sdks/implementation.md) before changing generation or transport code.

Generate owned artifacts from OpenAPI; do not hand-edit files listed in `.generated-files.json`. Keep maintained transports, build manifests, examples, and tests separate. Contract changes require `pnpm sdk:generate:all` and the affected language tests. Public packages/imports use `macrofold`; Python documentation uses explicit client construction and `close()`, without a context-manager example.

Exercise real loopback HTTP/SSE transports, package acceptance, and isolated application fixtures rather than live providers by default. Check idempotency headers, binary bodies, decimal-string amounts, redirect refusal, reconnect cursors, and detach behavior; generated compilation alone is insufficient.

Resource names, parameter mapping, and the hosted default originate in `scripts/sdk/`; extend that generation path instead of hand-writing language-specific endpoints. Use resource methods in public examples, leave low-level requests as an advanced escape hatch, and retain the positive/negative TypeScript and Python type checks. Update the generated method reference alongside SDK output.

Text/completion helpers must retain replay and detach semantics, distinguish execution from persistence, and never turn wait timeouts into agent cancellation. Test saved-preset journeys through the real local API; when a typed response rejects a server payload, fix the owning contract/mapping rather than weakening the model.
