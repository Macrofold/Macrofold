# Self-hosting

Run your own Macrofold deployment on infrastructure you control. The deployment guide uses Vercel, Neon PostgreSQL, private Cloudflare R2 storage, and Vercel Sandbox.

If you want to use the managed service, follow [Macrofold Cloud setup](../cloud/README.md). Calling Cloud does not require deploying these services yourself.

## Connect your application

After deployment, create a scoped API key in your dashboard and set your SDK's base URL to your HTTPS origin, without `/v1`. The [API quickstart](../features/api/quickstart.md), [SDKs](../features/api/sdks/README.md), [CLI](../features/cli/README.md), and product guides apply unchanged. Keys and resource IDs belong to the deployment that issued them; changing a URL does not move data between deployments.

## Choose a starting point

| Goal                                         | Guide                                                        |
| -------------------------------------------- | ------------------------------------------------------------ |
| Try the product without provider accounts    | [Local development](../getting-started/local-development.md) |
| Deploy your own service                      | [Deployment walkthrough](launch-guide.md)                    |
| Configure runtime settings                   | [Environment reference](launch-environment.md)               |
| Set up the database                          | [Neon and PostgreSQL](neon.md)                               |
| Register models, apps, GitHub, and billing   | [Provider integrations](launch-integrations.md)              |
| Understand deployment artifacts and rollback | [Deployment architecture](deployment.md)                     |
| Plan capacity and recovery                   | [Hosting](hosting.md) and [scaling](scaling.md)              |

## Hosting responsibilities

The web application serves customer requests and dashboard streams. PostgreSQL owns state, leases, queues, and accounting. Workflow schedules bounded execution steps. Sandbox isolates native agents. R2 retains encrypted checkpoint content. Resend delivers identity email; Stripe manages paid subscriptions and top-ups when configured.

Keep the database, application, and storage in compatible regions. Set provider spending controls and a conservative execution ceiling before accepting work. The software's concurrency setting does not reserve vendor capacity.

The [local Docker profile](../getting-started/local-development/docker.md) also runs real harnesses through the API without Vercel. It is a trusted development environment, not a production multi-tenant deployment recipe. Vercel is the production integration path described here; see [portability](../architecture/portability.md) for its boundaries.

Use the [acceptance checklist](pre-deployment.md) to verify your deployment before opening access.

[Paired backup and recovery](recovery.md) · [Automated staging releases](staging-releases.md)
