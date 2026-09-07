# Self-hosting

Deploy the dashboard, API, and durable scheduler on Vercel, with Neon PostgreSQL, private Cloudflare R2 storage, and Vercel Sandbox for agent execution.

## Choose a starting point

| Goal                                         | Guide                                                        |
| -------------------------------------------- | ------------------------------------------------------------ |
| Try the product without provider accounts    | [Local development](../getting-started/local-development.md) |
| Deploy a hosted service                      | [Deployment walkthrough](launch-guide.md)                    |
| Configure runtime settings                   | [Environment reference](launch-environment.md)               |
| Set up the database                          | [Neon and PostgreSQL](neon.md)                               |
| Register models, apps, GitHub, and billing   | [Provider integrations](launch-integrations.md)              |
| Understand deployment artifacts and rollback | [Deployment architecture](deployment.md)                     |
| Plan capacity and recovery                   | [Hosting](hosting.md) and [scaling](scaling.md)              |

## Hosting responsibilities

The web application serves customer requests and dashboard streams. PostgreSQL owns state, leases, queues, and accounting. Workflow schedules bounded execution steps. Sandbox isolates native agents. R2 retains encrypted checkpoint content. Resend delivers identity email; Stripe manages paid subscriptions and top-ups when configured.

Keep the database, application, and storage in compatible regions. Set provider spending controls and a conservative execution ceiling before accepting work. The software's concurrency setting does not reserve vendor capacity.

The standalone Node/Docker control plane supports local simulation. Real non-Vercel execution currently requires an additional Sandbox credential adapter; see [portability](../architecture/portability.md). Vercel is the supported production integration path described here.

Use the [acceptance checklist](pre-deployment.md) to verify your deployment before opening access.
