# Run locally

Start the dashboard, API, and worker on your own computer. The default profile uses simulated providers and makes no paid calls.

## Prerequisites

- Node.js 24; `.nvmrc` selects the repository's tested version if you use nvm.
- pnpm 10; `package.json` pins the development toolchain.
- Docker with its daemon running.
- Git and two terminal windows.

## Install and start

```sh
git clone https://github.com/Macrofold/Macrofold.git
cd Macrofold
pnpm install
pnpm setup
pnpm dev
```

From the same checkout in another terminal:

```sh
pnpm worker
```

Open **http://localhost:3210** and sign in:

| Field    | Local demo value       |
| -------- | ---------------------- |
| Email    | `demo@example.test`    |
| Password | `local-only-demo-2026` |

These credentials work only with the local seeded fixture. Never use them for a hosted installation.

## What setup creates

`pnpm setup` creates `.env` from `.env.example` if it is absent, starts PostgreSQL and Mailpit, applies migrations, registers the CLI OAuth client, and seeds demo projects and credits. An existing `.env` is preserved. The worker dispatches queued runs and performs maintenance; the web process serves the dashboard and API.

The simulator exercises runs, streaming, persistence, and accounting with deterministic outputs. It does not perform real reasoning or authenticate external accounts. Provider integration and cloud deployment are separate from this local profile.

## Configuration

Keep local settings in the repository's `.env`. Keep hosted runtime settings in your deployment's secret manager, and migration credentials in an administrative environment. Avoid additional `.env.local` overrides: Next.js and source scripts must agree about the active profile. The [environment reference](../operations/launch-environment.md) describes these boundaries.

Use `pnpm doctor` to inspect configuration and readiness. Local Mailpit captures outgoing development email; find its UI port in [the Compose file](../../infra/compose.yml).

## Stop and restart

Stop the web process and worker with Ctrl-C. To stop their local services without deleting data:

```sh
docker compose -f infra/compose.yml stop
```

Run `pnpm setup` to start services again, then start the web process and worker. The seeded credit uses an idempotent reference. Existing projects remain available.

## Develop and test

Run `pnpm check` for strict types and `pnpm test:domain` for isolated domain tests. Follow [contributing](../../CONTRIBUTING.md) before changing code and [troubleshooting](troubleshooting.md) if setup fails.
