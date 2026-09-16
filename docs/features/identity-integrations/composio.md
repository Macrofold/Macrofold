# Composio configuration

Composio Platform supplies app authentication and connector tools. The application retains organization/user authorization, connector access rules, approved tool ceilings, version pins and accounting. [Connector discovery](connectors.md) describes the dashboard catalog; [tool security](tools-security.md) describes runtime enforcement.

## Project credentials

Use one Platform project for this application environment. Its project key belongs in the server secret store, never browser code or customer API responses. The local configuration loader reads the repository-root `.env`.

With no existing project key, the [official CLI](https://docs.composio.dev/docs/cli) offers `composio login` and `composio dev init`. Browser login links expire after ten minutes; `composio login --poll` completes authorization and saves the CLI credential. CLI login and application project authentication are separate checks.

Initialization writes `.env.local` and ignored `.composio/project.json`. Transfer only the Composio setting into the existing root `.env`; preserve database/runtime settings. Keep credential files ignored and readable only by their owner. Do not use the generated playground test user as a shared production identity.

### Masked-key workaround

CLI initialization can copy a masked project key from session metadata into `.env.local`. The application client rejects absent, blank and visibly masked values before upstream operations. An unmasked value still needs an authenticated API check; string validation does not prove validity.

Open **Platform → selected project → Settings → API Keys** in the [Composio dashboard](https://dashboard.composio.dev/). Use the complete project key; create another only when a separate environment needs it. Store the value directly in `COMPOSIO_API_KEY` in the ignored root `.env` or matching server secret store. Keep one assignment: a later empty duplicate overrides it. Never paste keys into chat, command arguments, documentation or logs. Preserve existing keys used elsewhere.

A scoped key needs the capabilities the integration uses: toolkit/tool metadata, auth configurations, connected-account lifecycle, tool execution, and sessions if enabled. Catalog read permission does not establish execution permission; see [project key permissions](https://docs.composio.dev/kb/guide/platform-project-api-key-permissions).

## Customer-facing consent

The optional [Customer agents integration path](../customer-agents/connections.md) lets an app authenticate its own customers and offer hosted consent without Macrofold accounts. It reuses this deployment setup and verified callback, but uses an opaque customer-specific provider subject and an authenticated app completion step. Dashboard consent remains for platform members; reconnect customer accounts through the app that created them.

## Enable an app toolkit

A toolkit appearing in the catalog does not mean it is ready to connect in this deployment. Macrofold has generic Composio discovery and execution, but its current connection flow requires an auth configuration and toolkit version for each enabled app. Adding a supported toolkit normally needs configuration rather than a new app-specific adapter.

For Macrofold Cloud, the deployment operator manages this setup; customers then authorize their own accounts. For self-hosting, use the repository's configured shell after applying migrations. The command requires the **owner/migration database connection**, not the serving role; set `MIGRATION_DATABASE_URL` through the deployment's secret store.

### 1. Inspect available authentication

```sh
pnpm connectors:setup
pnpm connectors:setup --toolkit gmail --inspect
```

The first command lists saved setup. The second reads provider metadata and enabled Auth Configs for that toolkit, showing their IDs/names, an exact tool version and whether managed authentication is available. It does not connect a customer or create an Auth Config. The project key needs metadata/Auth Config read access.

### 2. Enable the toolkit

For a toolkit with managed authentication, reuse its existing configuration or create one explicitly:

```sh
pnpm connectors:setup --toolkit gmail --enable --managed
```

If multiple configurations exist, choose the one you reviewed:

```sh
pnpm connectors:setup --toolkit gmail --enable --auth-config ac_REPLACE_WITH_REVIEWED_ID
```

For custom OAuth, first create the configuration in the provider dashboard using that toolkit's required client credentials and scopes, then select its ID. Secrets stay in the provider configuration; the application saves the ID and version, not the OAuth client secret. See [programmatic auth configuration](https://docs.composio.dev/docs/authentication/programmatic-auth-configs).

Setup persists in the deployment database and takes effect without redeploying. Repeating a completed enable command does not create another configuration. It reuses a unique existing config, prefers its own named managed config, and refuses ambiguous choices. It never changes the scopes of an existing config implicitly.

### 3. Verify the callback and connect

Configure the public HTTPS callback verifier described below, then enable `COMPOSIO_CALLBACK_VERIFICATION_ENABLED` in server configuration. Changing that environment flag still needs a process restart/redeploy. Each user then opens **Connections**, connects their account and configures **Tools → Access**. The toolkit is only connectable when its setup, project key and callback gate are ready.

### Version upgrades, disabling and recovery

Catalog refreshes do not upgrade a pinned toolkit. Review the replacement's definitions and grants before changing it:

```sh
pnpm connectors:setup --toolkit gmail --inspect --version EXACT_REVIEWED_VERSION
pnpm connectors:setup --toolkit gmail --enable --version EXACT_REVIEWED_VERSION --replace
pnpm connectors:setup --toolkit gmail --disable
```

Disabling blocks new connections and subsequent tool dispatch. It does not revoke upstream customer consent or interrupt an already-dispatched side effect. Existing access rules remain stored. Enabling again uses the same reviewed pin/configuration unless you explicitly replace them.

Managed Auth Config creation has no upstream idempotency guarantee. The application records a pending creation **before** sending it and does not retry an uncertain POST. If setup stops after creation, run `--inspect`: the next enable can adopt its discovered named config, or you can explicitly select the resulting ID. If no config can be confirmed, investigate provider logs before manually resolving the pending setup; repeatedly pressing enable cannot create duplicates. Setup serializes operations for one toolkit without holding a database transaction through provider calls.

An enabled toolkit is deployment configuration shared by users, not a shared connected customer account. Tool definitions and executions both use its exact stored version. Authentication, tool ceilings and current project/preset grants remain independent requirements; no unrestricted provider meta-tools are exposed.

## Connect an application user

The dashboard flow uses the stable Composio identity `organizationId:userId`, an owner-bound local connection, a persisted auth-config ID, and an exact persisted toolkit-version pin. The existing broker uses supported direct tool execution; unrestricted session meta-tools are not exposed to agents.

Multiple accounts use Connect Link's `allowMultiple` option and the local connection UUID as a stable unique alias. Rename changes only the display name; each run resolves current access and selects exact connection IDs. Reconnect uses Composio's account refresh operation, preserving the provider account ID. A new attempt invalidates earlier pending attempts, and verified completion also checks active provider status. See [named connections](named-connections.md) and [Composio's multiple-account guidance](https://docs.composio.dev/docs/authentication/managing-multiple-connected-accounts).

For an initial GitHub connection, use a managed auth configuration with `read:user` and pin a supported GitHub toolkit version. `GITHUB_GET_THE_AUTHENTICATED_USER` accepts an empty argument object and reads the connected profile without repository scopes. Profile authorization is separate from installing the GitHub App used for repository synchronization.

Before enabling `COMPOSIO_CALLBACK_VERIFICATION_ENABLED`, configure and verify the project's public HTTPS callback verifier. The authenticated returning user, organization, pending attempt, toolkit and provider-verified account must agree. Composio requires public HTTPS, so localhost needs a deliberately configured tunnel or deployed callback. An active account ID alone cannot bypass verification. See [callback identity verification](https://docs.composio.dev/reference/api-reference/connected-accounts).

In the application's Connections page, create the selected app connection, authorize its Connect Link, approve the intended read action in Tools, then add an eligible project, preset, exact pair, or organization permission in Access. Authentication alone grants no execution access. Run selections can narrow that policy; an owning principal may explicitly authorize a one-run exception. The broker rechecks actor authority, current access, cancellation, deadline and budget before execution. Local simulation disables external connector actions; do not enable paid execution globally merely to test a connection.

### Local HTTPS callback

Keep the signed-in dashboard on its normal localhost origin. For local development, a public HTTPS tunnel can expose a dedicated callback relay that redirects only `/integrations/composio/callback` and its opaque `session_uri` to the fixed local callback URL. Do not expose the dashboard, authentication APIs, or arbitrary forwarding paths. Disable tunnel inspection and query logging, and send no-store and no-referrer headers.

Set that relay's public HTTPS callback URL as the Composio project's OAuth user verification URL, then enable `COMPOSIO_CALLBACK_VERIFICATION_ENABLED` and restart the local web process. The local application still verifies its signed state cookie, current user, organization, pending attempt and Composio response before activating the account. Start authorization from the application, not the Composio dashboard. The verifier is a project-wide setting; use separate projects for development and production.

The relay and tunnel must remain running until the browser returns from consent. Restart an expired connection attempt from Connections. Stopping the tunnel prevents subsequent authorizations until it is restored; changing its public hostname requires updating the project verifier. Production should use its stable HTTPS application callback directly.

## Related guides

See [connector access rules](connection-access.md), [provider integrations](../../operations/launch-integrations.md) and [connection authorization](README.md).
