# Macrofold Cloud

Use Macrofold without running its API, workers, database, or sandbox infrastructure yourself. Your application calls the same API used by the dashboard and CLI.

## Connect to Cloud

1. Open the Cloud dashboard supplied with your account access. The SDK's default hosted origin is `https://app.macrofold.ai`; if your access uses another origin, configure it explicitly.
2. Sign in, verify your email, and select your organization.
3. Create a scoped key in **API keys** and store it as `MACROFOLD_API_KEY` in your application's server environment.
4. Follow the [API quickstart](../features/api/quickstart.md), use the [dashboard](../getting-started/quickstart.md), or copy the [coding-agent setup prompt](../getting-started/agents.md).

Cloud access is required to use the hosted endpoint. If you do not have access, you can [try local simulation](../getting-started/local-development/simulation.md) or [deploy Macrofold yourself](../operations/README.md).

## Run your agents

Choose an enabled harness and model. Managed model usage draws on your organization's credits. For BYOK, connect your model account and explicitly select that connection. Infrastructure and authorized tools may still use credits; see [billing and limits](../features/billing/README.md).

Your project identifies persistent files. Reuse it across runs, or select a workspace for a particular working folder. Different agents can [take turns over the same workspace](../features/workspaces/shared-agents.md).

## What you manage

You control projects, members, API keys, agent presets, tool grants, budgets, and cancellation. Review runs and persisted files in the dashboard. Cloud operates the underlying service; you do not need your own Vercel, Neon, or R2 account to call it.

Available models, integrations, and effective limits come from your deployment and organization. The [shared feature guides](../features/README.md) describe product behavior for Cloud and self-hosting; [self-hosting](../operations/README.md) explains operating your own installation.
