# Composio configuration

Composio Platform supplies app authentication and connector tools. The application retains organization/user authorization, explicit grants, version pins and accounting. [Connector discovery](connectors.md) describes the dashboard catalog; [tool security](tools-security.md) describes runtime enforcement.

## Project credentials

Use one Platform project for this application environment. Its project key belongs in the server secret store, never browser code or customer API responses. The local configuration loader reads the repository-root `.env`.

With no existing project key, the [official CLI](https://docs.composio.dev/docs/cli) offers `composio login` and `composio dev init`. Browser login links expire after ten minutes; `composio login --poll` completes authorization and saves the CLI credential. CLI login and application project authentication are separate checks.

Initialization writes `.env.local` and ignored `.composio/project.json`. Transfer only the Composio setting into the existing root `.env`; preserve database/runtime settings. Keep credential files ignored and readable only by their owner. Do not use the generated playground test user as a shared production identity.

### Masked-key workaround

CLI initialization can copy a masked project key from session metadata into `.env.local`. The application client rejects absent, blank and visibly masked values before upstream operations. An unmasked value still needs an authenticated API check; string validation does not prove validity.

Open **Platform → selected project → Settings → API Keys** in the [Composio dashboard](https://dashboard.composio.dev/). Use the complete project key; create another only when a separate environment needs it. Store the value directly in `COMPOSIO_API_KEY` in the ignored root `.env` or matching server secret store. Keep one assignment: a later empty duplicate overrides it. Never paste keys into chat, command arguments, documentation or logs. Preserve existing keys used elsewhere.

A scoped key needs the capabilities the integration uses: toolkit/tool metadata, auth configurations, connected-account lifecycle, tool execution, and sessions if enabled. Catalog read permission does not establish execution permission; see [project key permissions](https://docs.composio.dev/kb/guide/platform-project-api-key-permissions).

## Connect an application user

The implementation uses the stable Composio identity `organizationId:userId`, an owner-bound local connection, `COMPOSIO_AUTH_CONFIGS_JSON`, and an explicit `COMPOSIO_TOOLKIT_VERSIONS_JSON` pin. The existing broker uses supported direct tool execution; unrestricted session meta-tools are not exposed to agents.

For an initial GitHub connection, use a managed auth configuration with `read:user` and pin a supported GitHub toolkit version. `GITHUB_GET_THE_AUTHENTICATED_USER` accepts an empty argument object and reads the connected profile without repository scopes. Profile authorization is separate from installing the GitHub App used for repository synchronization.

Before enabling `COMPOSIO_CALLBACK_VERIFICATION_ENABLED`, configure and verify the project's public HTTPS callback verifier. The authenticated returning user, organization, pending attempt, toolkit and provider-verified account must agree. Composio requires public HTTPS, so localhost needs a deliberately configured tunnel or deployed callback. An active account ID alone cannot bypass verification. See [callback identity verification](https://docs.composio.dev/reference/api-reference/connected-accounts).

In the application's Connections page, create the selected app connection, authorize its Connect Link, discover tools and grant the intended read action. Attach that grant to a run. The broker rechecks actor authority, current grants, cancellation, deadline and budget before execution. Local simulation disables external connector actions; do not enable paid execution globally merely to test a connection.

### Local HTTPS callback

Keep the signed-in dashboard on its normal localhost origin. For local development, a public HTTPS tunnel can expose a dedicated callback relay that redirects only `/integrations/composio/callback` and its opaque `session_uri` to the fixed local callback URL. Do not expose the dashboard, authentication APIs, or arbitrary forwarding paths. Disable tunnel inspection and query logging, and send no-store and no-referrer headers.

Set that relay's public HTTPS callback URL as the Composio project's OAuth user verification URL, then enable `COMPOSIO_CALLBACK_VERIFICATION_ENABLED` and restart the local web process. The local application still verifies its signed state cookie, current user, organization, pending attempt and Composio response before activating the account. Start authorization from the application, not the Composio dashboard. The verifier is a project-wide setting; use separate projects for development and production.

The relay and tunnel must remain running until the browser returns from consent. Restart an expired connection attempt from Connections. Stopping the tunnel prevents subsequent authorizations until it is restored; changing its public hostname requires updating the project verifier. Production should use its stable HTTPS application callback directly.

## Related guides

See [provider integrations](../../operations/launch-integrations.md) and [connection authorization](README.md).
