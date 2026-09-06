# Contributing

Read [AGENTS.md](AGENTS.md), [implementation status](docs/16-implementation-status.md) and [delivery plan](docs/10-delivery.md) first. The local setup uses only deterministic provider fixtures and does not call paid models or sandboxes.

Use Node 24 and the pinned pnpm version. Run `pnpm install --frozen-lockfile`, `pnpm run setup`, `pnpm dev`, and `pnpm worker`. The domain test wrapper creates a disposable database and does not require stopping the preview worker. Browser/CLI journeys require a configured local app and worker with synthetic test data. Follow [the testing rules](TESTING.md) to choose and write tests for your change. CI supplies a combined free-provider acceptance sequence.

Keep provider SDKs at adapter boundaries, authorize the tenant before accessing resources, preserve ambiguous execution outcomes and maintain balanced immutable financial records. Update OpenAPI and regenerate clients when contracts change. Add a forward SQL migration instead of modifying a released migration. Explain changes and evidence in the pull request. Screenshots must use synthetic accounts and contain no secrets, prompts or customer files.

Contributions are made under Apache-2.0. Do not submit code, assets or data you lack permission to contribute. Third-party native harnesses and services have separate terms; do not imply they are covered by this repository's license.

Run `pnpm test:coverage` for the isolated TypeScript suite with global and critical-module floors. Run `pnpm test:mutation` for runtime capability fault detection in a temporary source copy. See [testing and CI](docs/24-testing-ci.md) for scope, fork safety, required checks, badges, and releases. Preserve meaningful boundary assertions when changing security, budgets, or persistence.
