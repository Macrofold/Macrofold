# Shared dashboard live refresh

The dashboard follows changes made through the API, CLI, other users, workers, and other tabs using one shared SSE subscription per browser tab. The subscription lives in the persistent shell, including the overview route. It carries refresh hints for run lifecycle, persisted workspace/checkpoint changes, and Git status. Detailed output and historical run replay continue through the existing per-run SSE system.

## Delivery and user experience

Signals are **best effort**. They contain only a category and the authorized organization ID. A category invalidates its relevant query families; active views refetch through existing APIs and inactive views become stale for their next visit. Category-wide invalidation deliberately covers a burst involving several resources without sending lists of resource IDs or omitting all but the last changed resource. No prompt, output, tool payload, filename, file contents, error diagnostic, or secret enters this stream.

The client combines signals in a fixed one-second window and serializes refresh batches. Signals arriving during a fetch schedule another bounded batch. Existing cached data stays visible during refetches; navigation, scroll, selected workspace/file, and dirty editor drafts are not reset. Detailed run streams remain independently mounted only on run pages.

Initial mount, each successful stream connection, and return to a visible tab trigger reconciliation. Reconciliation also runs before an organization is resolved, so an initially failed identity request can recover. Visible tabs also reconcile every 60–70 seconds, independently of streaming availability. Streams rotate after 50 seconds and reconnect with jittered exponential backoff, capped at 30 seconds before jitter. A 65-second client watchdog breaks stalled streams. Intermediate signals can be lost. An active dashboard with a reachable API eventually refreshes even if the streaming route is unavailable; a suspended/offline browser refreshes when usable again. This is not a latency or notification-delivery SLA.

## How it connects

1. PostgreSQL triggers assign a new revision stamp to an existing resource row when relevant state changes. Reads see it only after that transaction commits. Run heartbeats, transcript events and incremental token accounting do not generate these signals.
2. Each application instance owns a small hub that groups connected tabs by organization. Every two seconds after the previous pass, it uses short tenant transactions to read indexed current revisions and check the group's sessions, memberships and roles. At most two reads run concurrently.
3. The hub sends `ready`, category changes, or an access-change control frame to authorized subscribers. These are private dashboard controls, not public API/CLI events. The client reuses the SDK's bounded SSE frame parser while keeping the protocols separate.
4. TanStack Query invalidation retrieves authoritative API data. Disconnect removes subscriptions/timers; the hub stops when it has no subscribers. A slow reader is closed after a bounded frame buffer and reconnects normally.

[Migration 025](../../../packages/db/025_dashboard_freshness.sql) adds revision columns/indexes and one sequence to existing runs, workspaces and checkpoints. It adds no change-record table, replay cursor, retention job or event archive. Indexed maximum revisions avoid scanning old transcripts or holding a listener connection. Sequence allocation order can differ from transaction commit order, so a late commit with a smaller stamp can be missed; reconciliation is intentional. Hard deletion and changes outside the initial categories are also reconciled periodically. Historical run events retain their existing storage and retention policies.

## Authorization and boundaries

`/account/events` is private, cookie-authenticated, same-origin and non-cacheable. Bearer credentials are rejected. Its organization selector must equal the authenticated active organization. Current dashboard sessions have organization-wide read access; project-restricted principals are explicitly rejected. If browser project permissions are introduced later, this reader must enforce that policy before enabling those subscriptions.

Every hub pass checks the actual session expiry/revocation, verified user, membership and unchanged role in the same SQL snapshot as revisions. A changed binding closes with `access.changed`; a database failure closes without sending changes. Permission enforcement has the polling/read latency, not instantaneous revocation at commit. No previously buffered frame can be recalled. Subsequent resource reads still enforce their own current authorization.

Logout and organization switching close the stream and clear the cache before full navigation. BroadcastChannel tells other tabs to do the same because they share the organization cookie. Missed broadcasts are repaired by `/v1/me` reconciliation or rejection of the old organization at reconnect. Normal dashboard navigation reuses the same shell and connection.

## Operational implications

There is no new package, external service, credential, or paid API dependency. The database keeps four indexes and four bigint revision columns across three resource tables plus a sequence. Updates incur index/WAL work; unrelated workspaces do not contend on one organization counter row. Provision indexes before serving the new route and include their size/write load in database monitoring.

Each instance admits at most 256 subscriptions across 64 organizations, with two concurrent tenant reads and the existing pool ceilings unchanged. Additional connections get 503 and retry; ordinary API reconciliation continues. Tabs for the same organization share a snapshot query on that instance. Different instances independently observe PostgreSQL, so this works with separate API/worker processes without a local-emitter delivery assumption. With O distinct subscribed organizations on each of I instances, healthy polling is approximately I × O / 2 short transactions per second, plus authentication at reconnect. Each transaction includes the usual BEGIN/context/lock/COMMIT statements; it is not a single wire round trip. Read time adds to the two-second interval.

No database connection is checked out for the lifetime of a stream. This supports transaction-pooled Neon/PgBouncer connections, unlike session-level LISTEN subscriptions. Open tabs consume Function invocations, active CPU while executing callbacks/queries, and provisioned memory during open streams; streaming is not free hosting. Multiple instances multiply hub reads and existing pool limits. Slow database reads close streams and can temporarily increase reconnect/API traffic; client backoff, batching and occasional reconciliation bound the recovery behavior. These limits are launch safeguards, not a measured internet-scale capacity claim.

## Release and verification

Apply migration 025 before deploying the new web build. Existing rows start at zero; initial reconciliation fetches their current state without a backfill. The migration is additive and runs transactionally. On deployment rollback, keep the columns, sequence and triggers while serving the prior app; no customer data requires reversal. A later removal must first deploy code that no longer reads stamps, then drop triggers/functions, indexes, columns and sequence together in a forward migration. Rebuild the web artifact; workers publish through triggers without new worker-side messaging code.

See [verification and deployment checks](live-refresh/verification.md) for executed tests and remaining cloud acceptance. The private route must stream without proxy buffering and permit the configured 60-second Function duration. These deployment properties require actual Vercel/Neon staging validation.

## Changelog

- Added a best-effort dashboard refresh channel separate from durable per-run history. Indexed resource revisions were chosen to reuse transaction-pooled PostgreSQL without a persistent listener, new broker, shared counter lock, or organization event log. [Neon pooling restrictions](https://neon.com/docs/connect/connection-pooling), [Vercel streaming](https://vercel.com/docs/functions/streaming-functions), [TanStack invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation).
