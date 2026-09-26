# Shared and public contracts

Follow [root instructions](../../AGENTS.md) and [integration/client rules](../../.agents/rules/integrations.md). Read the [API conventions](../../docs/features/api/conventions.md) and [SDK implementation](../../docs/features/api/sdks/implementation.md) for wire/generator changes.

Public DTOs and requested operations are not domain authority. Trace server admission, response projection, serialization, streaming and all dashboard/CLI/SDK/MCP consumers together. Never solve a missing client field by exposing raw privileged state or ungranted private data. Keep absent, unknown, unsupported and empty values semantically distinct; do not silently coerce incompatible payloads.

Keep one authored source for generated contracts; inspect the generator before editing output. Regenerate OpenAPI-owned clients through `pnpm sdk:generate:all` when their contract changes. Maintained runtime/control contracts and the harness registry have their own consumers and are not automatically generated from OpenAPI. A changed type does not update its validators or consumers automatically.

Preserve Macrofold's pre-launch policy and existing public contract guarantees without inventing parallel legacy protocols. Exercise the real transport and package boundaries required by [TESTING.md](../../TESTING.md).
