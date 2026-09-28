# Account controls, transfers and runtime tools

## Account security

Account & security provides profile edits, password changes that revoke other browser sessions, TOTP enrollment with a QR/manual setup key, single-use recovery codes, recovery-code regeneration, disable with password confirmation, and signed-in device revocation. Better Auth stores the authentication records and verifies the second factor; ten unsuccessful second-factor attempts lock verification for fifteen minutes. Save recovery codes before completing enrollment. Email/password registration requires email verification. Production requires a working Resend sender; local mail goes to Mailpit.

OAuth authorization-code consent displays only permissions from a signed, unexpired authorization request verified by the authorization server. PKCE, exact registered callbacks, short access-token lifetimes and rotating refresh tokens are provided by the OAuth plugin. Device authorization supports the terminal flow. Account & security lists consenting applications and terminals, with access and refresh token revocation. Deleting the library's consent record alone is insufficient: our account action marks both token tables revoked and removes the consent. Delegated runs check revocation before subsequent model/tool actions. Already-dispatched external actions cannot be recalled.

## Large transfers

Direct file reads/writes are limited to 4 MiB. Transfer plans support 1,000 files, 25 MiB per file and 250 MiB total, with ten pending upload plans per organization. The public plan contains temporary object URLs, expected hashes and required headers. `GET /v1/worktrees/{id}/file?path=...&download=true` issues a private streaming download redirect, including large files.

On R2, a plan signs a PUT for one random `staging/{organization}/{transfer}/{object}` key, with content type and exact content length bound to its signature. Fetch, browsers and curl calculate Content-Length from the uploaded body. Do not manually add this header when using Node's bundled fetch: importing Undici 8 currently exposes a dispatcher compatibility issue with duplicated lengths. The integration fixture independently validates real SigV4 PUT signatures and exercises the AWS SDK's HTTP reads/deletes. This is local protocol evidence, not a live R2 account test. [Undici issue](https://github.com/nodejs/undici/issues/5500), [R2 presigning](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [Vercel body limit](https://vercel.com/docs/functions/limitations).

Applying a transfer reads staging with a strict byte bound, verifies its SHA-256, encrypts verified content under the platform vault key, checks the expected worktree revision and atomically publishes a checkpoint. Failed or stale applies preserve the existing files. Reusing a staging URL cannot modify a published encrypted object. Local uploads use the same plan/apply semantics through the local object endpoint.

Staging is protected by TLS and R2's encryption at rest, but is **not** application-encrypted until verification. Its PUT capabilities expire after thirty minutes; maintenance then deletes raw staging and clears temporary manifest references. Configure an R2 lifecycle rule to expire `staging/` objects after one day as independent cleanup if the control plane is down. R2 CORS must allow the exact application origin, PUT, Content-Type, and expose ETag if desired. Do not enable a public bucket or use wildcard credentialed origins. [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/).

## Web search

[Web search](web-search.md) supports Brave Search, Exa, Tavily, Parallel AI and Firecrawl through the shared broker tool. Every provider accepts encrypted customer API keys; Brave also retains managed funding and per-call budget admission. The feature reference owns setup, supported API modes, response limits, billing boundaries and verification. Native Codex search and Claude WebSearch/WebFetch remain disabled; the sandbox's ordinary network policy independently governs shell/network access.

## Local MCP servers

You can connect Macrofold to a tool server running on your computer without a tunnel. This applies to **outbound MCP connections**; another local app can already call Macrofold at `http://localhost:3210`.

1. Start your MCP server with a Streamable HTTP endpoint, for example `http://127.0.0.1:59620/mcp`.
2. Add its **origin**, without `/mcp`, to Macrofold's `.env`:

   ```dotenv
   LOCAL_MCP_ALLOWED_ORIGINS=http://127.0.0.1:59620
   ```

3. Restart both the Macrofold API and worker so they use the same configuration.
4. In **Connections → Add connection → Remote MCP**, enter the full endpoint URL. Choose the server's authentication method and supply its credential if required.
5. Test the connection, approve its tools, and configure **Access** for your workspace or preset. An allowed network destination does not grant an agent permission to call its tools.

Existing API/SDK callers use the same `mcp_remote` connection fields (`url`, `auth_method`, and write-only `secret` for bearer authentication). There is no new request flag and no change to Worker selection or API-key scopes.

The setting is a comma-separated list of exact HTTP or HTTPS origins. Ports and hostnames must match: `localhost` and `127.0.0.1` are separate origins. Paths, credentials, wildcards, query strings and fragments are not accepted. If OAuth uses another local origin for authorization, discovery, registration, tokens or revocation, list that origin too. OAuth still requires its normal client registration, callback and PKCE flow.

Exceptions work only with `PLATFORM_MODE=local`, a loopback `APP_ORIGIN`, and no Vercel deployment environment. Each allowed local origin must resolve exclusively to loopback, private IPv4 or unique-local IPv6 addresses. Metadata/link-local and other reserved addresses remain blocked. DNS results are checked and pinned on each connection; redirects, timeouts and response limits retain their existing enforcement. Removing an origin and restarting blocks subsequent requests to it, including saved connections.

The MCP broker makes these requests from the Macrofold control-plane process, not directly from an agent container. If the API/worker itself runs inside a container, use an explicitly listed hostname reachable from that container, such as `host.docker.internal` when it resolves to a permitted private address. Do not use `0.0.0.0` as the destination. For the usual host-based local API/worker with Docker agent execution, use the tool server's host loopback URL.

Hosted deployments, webhooks, OAuth client-metadata fetching and other unrelated outbound requests still require public HTTPS. Only list local services you trust; HTTP does not encrypt traffic. Missing/unlisted origins return `unsafe_url`; malformed allowlist configuration returns `invalid_local_mcp_origins` and must be corrected by the operator. An unreachable allowed server is a separate URL/listener/firewall issue.

## Tool input schemas

The tool broker validates arguments before charging or invoking a connector. Input schemas may declare JSON Schema draft-7 or draft 2020-12 with `$schema`; schemas without a declaration retain draft-7 behavior. A 2020-12 declaration uses that dialect's validation rules, including `prefixItems` and `unevaluatedProperties`.

Provide self-contained schemas: local `$ref` references within the schema are supported, but Macrofold does not download external schema references or resolve them against another connection's catalog. Asynchronous AJV schema extensions are unsupported.

An argument mismatch returns `invalid_tool_arguments`. An invalid schema, unsupported dialect or unresolved reference returns `invalid_tool_schema`; ask the connector maintainer to correct the schema. Runtime MCP returns these as tool errors (`isError: true`) containing the standard error object. Neither rejection invokes the tool or incurs its connector fee.

## Approved stdio MCP packages

`GET /v1/stdio-packages` lists the operator-reviewed catalog. The default runtime image includes `@modelcontextprotocol/server-filesystem@2026.8.31`, exposing the reviewed read_text_file, write_file, list_directory and get_file_info tools. A user creates an `mcp_stdio` connection with package and package_version, approves tools and access rules, then inherits or selects them for a run. Discovery uses the reviewed schema catalog without launching a billable sandbox. The Test action clearly reports that live startup occurs during the first run.

The broker executes stdio requests inside the **existing Run assignment**, through the `MachineTools` port. A trusted root entrypoint verifies the run deadline and creates a permanent invocation marker before dropping all supplemental groups and switching to that native handle's unprivileged process identity. It removes the temporary credentials file, launches an exact executable/argv through the official MCP SDK, bounds the result and timeout, and closes the subprocess. Duplicate dispatch with the same invocation ID cannot execute again; a lost result is reported as unknown. The Run deadline terminates only that handle's remaining processes before checkpointing, not other assignments sharing its Host.

Packages share the assigned Worktree and native handle's OS identity. User-provided package environment credentials are therefore exposed to that native process, as stated in the UI; these are not isolated secrets from the customer's own code. Infrastructure account credentials are never passed into native processes. Remote MCP OAuth is preferable when credentials should remain at the central broker.

To approve another package, install its **exact** version in packages/runtime/package.json, inspect its license/source/tool schemas, and rebuild/publish the immutable runtime image. Configure MCP_STDIO_CATALOG_JSON as an array of `{package, version, label, command, args, environment_keys, tools}`. Command must be an absolute `/opt/platform/` path; args are operator-fixed, not interpolated shell strings. Tools contain `{name, description, input_schema}`. Only approved environment_keys may be supplied through write-only secret_env; executable-loader and platform environment names are rejected. Publish the matching catalog and image together. Removing a catalog entry revokes subsequent broker dispatch. [Official filesystem server](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem).

## Related guides

See [connections and access](README.md), [provider setup](../../operations/launch-integrations.md), and the [API guide](../api/README.md).

## Agent policy layers

[Agent permissions](../execution/permissions.md) adds workspace, worktree and run restrictions above [connector access](connection-access.md). Tool discovery and dispatch intersect the accepted pattern policy, frozen run selection, current approved ceiling, and a currently matching rule or valid one-run exception. Local stdio connectors are unavailable to guarded-file runs because a process with worktree access could bypass a file-tool restriction. Human file browsing and edits continue to use their existing tenant, workspace and API scopes.
