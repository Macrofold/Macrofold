# Neon database verification

Return to [Neon setup](../neon.md) for current configuration, credential locations and deployment steps. These checks used actual Neon PostgreSQL 18.6 on the existing Free-plan project, with synthetic transactional fixtures and no model/sandbox/email/object-storage calls.

## Applied and tested

| Check | Evidence |
|---|---|
| Initial inventory | Production `neondb` had no application tables; the only initial login was `neondb_owner` |
| Migration rehearsal | A temporary branch from production accepted all 26 numbered migrations and Better Auth migration; repeating the migration commands succeeded |
| Production schema | The rehearsed sources through `026_workflow_ownership.sql` were applied, followed by `027_queue_deadline_default.sql`; source hashes were retained. Migration 027 reasserted the already-configured 24-hour default, and its before/after default expressions matched |
| Login separation | `platform_app` has no privileged role attributes, memberships or owned application objects; `platform_reporting` cannot log in |
| Domain pooler | Real `pg` clients connected through both direct and pooled TLS endpoints; transaction-local tenant selection returned only the selected tenant's fixtures |
| Tenant denial | Cross-tenant writes failed with PostgreSQL insufficient-privilege status; unscoped reads returned no fixture projects; all fixtures were rolled back |
| Protected data | Six representative tenant tables have enabled and forced RLS; runtime UPDATE/DELETE/TRUNCATE privileges are absent on ledger, financial events, billing events and admin audit |
| Reporting | Runtime queries through `reporting.scheduling_runs` succeeded without reporting-role membership |
| Auth persistence | The direct connection resolved the `auth` schema and read/wrote the shared BIGINT rate-limit counter inside a rolled-back transaction |
| OAuth | Three production-origin resources and two intended clients exist; the public client requires PKCE and has no embedded secret; stored verifier credentials decrypt with the generated production keys and authenticate an introspection request |
| Empty launch state | No customer or demo accounts were created; no credits or persistent project fixtures were seeded |
| SQL recovery | PostgreSQL 18 `pg_dump` archives from rehearsal and production restored into separate disposable local PostgreSQL 18 databases; migration counts, OAuth records, empty account state, RLS, journal privileges and reporting access were checked |
| Credential packaging | Private files have owner-only access and are Git-ignored. An actual Docker build could not copy the ignored local MCP credential file into its image |

The auth pooler negative test returned `unsupported startup parameter in options: search_path`. `AUTH_DATABASE_URL` therefore uses the direct endpoint; changing it to the pooled endpoint is not supported by the current connection configuration. Domain pools use the verified pooled endpoint. Their transaction-scoped settings and locks do not require session state between transactions.

The independent restore required PostgreSQL 18 tools, a configured system trust store for verified TLS, and NOLOGIN stand-ins for Neon's vendor roles referenced by exported default privileges. The existing public schema was removed only in the newly created disposable local restore database before importing the archive. No production schema was dropped or reset.

## Remaining acceptance

- Import the private runtime values into the intended Vercel Production environment and verify the actual deployed database/auth paths. No Vercel environment or deployment was changed by database setup.
- Complete browser signup, verification/reset email, session/MFA and CLI device-flow journeys through `https://app.macrofold.ai`. Internal introspection verifies the stored credential path, not those external journeys.
- Exercise deployed SSE flushing/reconnect, cross-instance updates, workflow dispatch and transaction-pooler behavior under representative concurrency. Small SQL probes establish correctness for the tested cases, not connection/throughput capacity.
- Run the complete release suite against PostgreSQL 18 in an isolated environment. The local default remains PostgreSQL 17; this targeted setup did not replace or rerun unrelated application suites.
- Rehearse Neon point-in-time recovery and paired SQL/R2/key restoration before customer data. The local SQL archive restore does not prove object recovery, hosted recovery time, or the sufficiency of the Free plan's six-hour history.

Private setup scripts, migration hashes and SQL archives are under ignored `.data/neon-provision/`. They are setup evidence, not the release migration entry point; use the existing numbered migrations and scripts documented in the parent guide. Temporary cloud branches and local restore containers are removed after successful verification.
