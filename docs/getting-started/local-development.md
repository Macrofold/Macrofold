# Run locally

Run the dashboard, API, and simulated agents without paid provider calls. You need Node 24, pnpm 10, Git, and Docker running.

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

Open **http://localhost:3210**. Local demo login: `demo@example.test` / `local-only-demo-2026`.

Setup handles PostgreSQL, migrations, demo data, and the [local email inbox](http://localhost:58025). It preserves your existing `.env`; keep that file configured for local simulation. The worker must stay running for jobs to execute. Simulated agents test the workflow, not actual model reasoning.

## Test

For everyday changes:

```sh
pnpm check
pnpm test:domain
```

For **customer journeys** through the browser, CLI, and Python SDK, install these extras once (Python 3.11+ required):

```sh
pnpm exec playwright install chromium
python3 -m venv .venv
source .venv/bin/activate
python -m pip install ./sdk/python
```

Then run:

```sh
source .venv/bin/activate
COVERAGE_DIR="$PWD/coverage/customer-$(uuidgen)" pnpm test:dashboard:isolated
```

Keep PostgreSQL running. This test starts its own app, worker, and temporary database/files, then cleans them up without stopping your preview. Reports remain in the new coverage directory. Avoid editing source during the test build.

`pnpm test:packages` separately checks CLI/TypeScript SDK installation into a temporary customer project; it is an installation smoke test.

## Try the API

Create a key in the dashboard's **API keys** page, then use the [interactive API reference](http://localhost:3210/reference). Choose `fixture-model` for local runs. [The API quickstart](../features/api/quickstart.md) walks through a complete request.

Postman is optional: import [the OpenAPI file](../api/openapi.json), set the base URL to `http://localhost:3210`, and use your key as a Bearer token.

## Stop

Press Ctrl-C in both app terminals, then stop the database and email service without deleting data:

```sh
docker compose -f infra/compose.yml stop
```

To restart, run `pnpm run setup`, `pnpm dev`, and `pnpm worker` again.

Need more? [Troubleshooting](troubleshooting.md) · [All tests](../engineering/testing.md) · [Environment configuration](../operations/launch-environment.md).
