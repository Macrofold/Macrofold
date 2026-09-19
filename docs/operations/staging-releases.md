# Automated staging releases

The [staging release workflow](../../.github/workflows/release-staging.yml) releases an immutable main-branch commit after all jobs in **Verify without paid providers** succeed for that push. Production promotion remains separate.

## Configure once

Create a GitHub environment named `staging`. Use the existing dedicated staging Vercel project, synthetic database, private bucket and independent credentials. Production secrets must not be available to this environment or pull-request jobs.

Set environment variables:

| Variable                                   | Value                                                        |
| ------------------------------------------ | ------------------------------------------------------------ |
| `VERCEL_ORG_ID`                            | Staging team's ID                                            |
| `VERCEL_TEAM_SLUG`                         | Team URL slug                                                |
| `VERCEL_PROJECT_ID`, `VERCEL_PROJECT_NAME` | Dedicated staging project identity                           |
| `PRODUCTION_PROJECT_ID`                    | Production project ID, used only to reject a mistaken target |
| `STAGING_ORIGIN`                           | Canonical HTTPS staging origin                               |

Set environment secrets: `VERCEL_TOKEN` (automation token scoped to the intended team), `VERCEL_AUTOMATION_BYPASS_SECRET` when deployment protection is enabled, `STAGING_API_KEY` with `identity:read`, direct owner `MIGRATION_DATABASE_URL`, restricted `DATABASE_URL` and `AUTH_DATABASE_URL`, `AUTH_SECRET`, and `VAULT_KEY`. Keep the staging runtime's full configuration in its Vercel project, as described in [environment configuration](launch-environment.md).

After reviewing those identities and credentials, set repository variable `STAGING_RELEASE_ENABLED=true`. Leave it unset/false while staging is paused for cost control. An optional GitHub environment approval can require a human before a release starts. Disable independent Vercel Git auto-promotion so it cannot bypass these gates.

## What runs

1. Check out the exact verified SHA. Build a Linux AMD64 runtime, run network-disabled native text and supported image/document journeys, and scan the actual image's OS, Python and JavaScript dependencies.
2. Refuse a stale SHA if main has advanced. Publish the image to the selected staging project's registry and wait for a Ready immutable digest.
3. Apply SQL/auth migrations and OAuth provisioning with administrative credentials held only in the release process. The remote app build does not receive owner credentials.
4. Prepare a staging Production-target deployment with `--skip-domain`, the same SHA and image digest. A dedicated staging project's Production target still uses staging resources.
5. Verify health, schema, MCP documentation and a scoped authenticated API request against the candidate. Recheck main, promote that exact deployment, then verify the canonical staging origin.
6. Retain a sanitized receipt with source SHA, project, image digest, candidate URL and promotion/acceptance status.

Releases are serialized and never cancelled mid-migration. Stale releases do not promote over a newer source. A failed check stops promotion; failure after promotion leaves an honest incomplete receipt and needs operator investigation. Do not automatically roll back data or rerun ambiguous external actions.

## Current limits

The workflow performs free readiness/authentication checks. It does not automatically spend on model providers, send emails, invoke connectors, or complete a paid cloud task. Existing local browser coverage remains in the upstream verification workflow; hosted browser and budgeted native acceptance remain explicit release checks. Production preparation/promotion and automatic rollback are deferred.

Unit tests cover target separation, immutable revision/image readiness and failed readiness responses. Hosted workflow activation requires the environment configuration above and a pushed verified revision; local tests alone do not establish deployment acceptance. See [release TODO](../maintainers/TODO.md) and [release walkthrough](launch-guide.md).
