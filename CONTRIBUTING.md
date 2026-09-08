# Contributing

Help improve the platform with focused fixes, clearer documentation, and reproducible bug reports. Contributions are licensed under [Apache 2.0](LICENSE).

## Start developing

Start with [local simulation](docs/getting-started/local-development/simulation.md); it needs no paid account. The [development overview](docs/getting-started/local-development.md) explains when to use native Docker fixtures or real cloud staging and the missing API-to-Docker path. Read [AGENTS.md](AGENTS.md) for repository boundaries and [the codebase map](docs/architecture/codebase.md) to find the module that owns your change.

```sh
pnpm check
pnpm test:domain
pnpm docs:check
```

Domain tests use a disposable database and filesystem. For browser changes, use the isolated dashboard runner described in [testing and CI](docs/engineering/testing.md); do not attach tests to a shared preview or customer database.

## Make a focused change

Preserve provider boundaries, tenant authorization, durable execution identity, file recovery, and financial invariants. Add a regression test for changed behavior. Update OpenAPI and generated clients when the customer contract changes; use a forward migration for released database schemas.

Follow [testing rules](TESTING.md) and [documentation rules](.agents/rules/documentation.md). Documentation changes should help the intended reader accomplish a task and keep technical details in their owning guide.

For AI-assisted contributions, follow [the shared agent instructions](docs/engineering/agent-guidance.md). Read the complete shared baseline before implementation or review, then the affected feature guides and scoped instructions. No additional agent service or plugin is required.

## Open a pull request

Explain the problem, resulting behavior, and checks actually run. Link related issues. Include synthetic screenshots for interface changes and describe meaningful compatibility or deployment implications. Never include credentials, customer content, or private account configuration.

CI runs strict checks, isolated acceptance, coverage gates, and targeted mutation tests. Forks receive no production secrets. Use `pnpm install --frozen-lockfile` when reproducing CI's exact dependency graph; ordinary first-time setup uses `pnpm install`.

## Report a bug

Include the affected revision, environment, minimal steps, expected behavior, and observed error or request ID. Use synthetic examples and redact sensitive information. Report security vulnerabilities using [SECURITY.md](SECURITY.md), not a public reproduction.

## Community and licensing

Follow the [code of conduct](CODE_OF_CONDUCT.md). Contribute only code and assets you have permission to share. External harnesses and services retain their own terms; see [NOTICE](NOTICE).
