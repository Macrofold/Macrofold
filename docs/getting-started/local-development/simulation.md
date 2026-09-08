# Local simulation

Run the real dashboard, API, database, and worker on your computer. The worker produces scripted agent activity without calling a model. Use this mode for everyday application development and a free first API request.

You need **Node 24, pnpm 10, Git, and Docker running**. No Vercel, model, email, or payment account is required.

## Start

From the repository root, in terminal 1:

```sh
pnpm install
pnpm run setup
pnpm dev
```

In terminal 2, from the same directory:

```sh
pnpm worker
```

Open **http://localhost:3210** and sign in with `demo@example.test` / `local-only-demo-2026`.

Setup starts PostgreSQL and Mailpit, applies migrations, and creates demo data. The worker must stay running for queued jobs to execute. Registration and password emails appear in the [local inbox](http://localhost:58025).

## Invoke an agent through the API

1. Create a key in the dashboard's **API keys** page with project and run read/write scopes.
2. Follow the [API quickstart](../../features/api/quickstart.md), keeping the origin `http://localhost:3210` and model `fixture-model`.
3. Submit the request, follow its stream, and open the run in the dashboard to inspect its status and saved results.

The request really goes through authentication, admission, database state, dispatch, event streaming, and persistence. Its agent activity is scripted: changing the prompt does not make a model reason about a new task. Selecting another harness here does not validate that harness's actual implementation.

## Test your changes

With the local database running, start with:

```sh
pnpm check
pnpm test:domain
```

The domain test wrapper creates disposable databases and files. It leaves the development preview intact. For actual harness behavior, use [native Docker fixtures](docker.md#run-the-existing-native-tests); for live inference and complete cloud execution, use [cloud staging](cloud.md).

## Stop and resume

Press Ctrl-C in the dashboard/API and worker terminals, then stop PostgreSQL and Mailpit without deleting their data:

```sh
docker compose -f infra/compose.yml stop
```

To resume, run `pnpm run setup`, `pnpm dev`, and `pnpm worker` in the same two-terminal arrangement.

## Further details

### Configuration

Setup creates the repository `.env` from `.env.example` if absent and preserves an existing file. The local profile requires `PLATFORM_MODE=local`, `EXECUTION_PROVIDER=simulator`, and `ALLOW_PAID_EXECUTION=false`, with a loopback `APP_ORIGIN`. Use the separate [Docker overlay](docker.md#start) for real local execution; keep this profile free.

Use **`pnpm run setup`**, including `run`: plain `pnpm setup` is pnpm's own shell-configuration command. [Environment configuration](../../operations/launch-environment.md) explains the separation from hosted runtime and migration settings.

### Browser, terminal, and SDK customer journeys

Install these extras once; Python 3.11+ is required:

```sh
pnpm exec playwright install chromium
python3 -m venv .venv
source .venv/bin/activate
python -m pip install ./sdk/python
```

Then, with PostgreSQL running:

```sh
source .venv/bin/activate
COVERAGE_DIR="$PWD/coverage/customer-$(uuidgen)" pnpm test:dashboard:isolated
```

This runner owns a separate app, worker, database, files, and loopback port. It cleans up its fixtures and leaves reports in the new coverage directory. Avoid changing source during its build. These journeys still use simulated agents.

`pnpm test:packages` separately installs the CLI and TypeScript SDK into temporary customer projects. The [testing reference](../../engineering/testing.md) covers other languages, coverage, and the full CI suite.

### Troubleshooting

For jobs that remain queued, first keep `pnpm worker` running in terminal 2. For database, port, or configuration problems, use [troubleshooting](../troubleshooting.md). Return to [development modes](../local-development.md) to choose another execution environment.
