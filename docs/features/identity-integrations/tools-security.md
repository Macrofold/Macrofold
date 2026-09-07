# Account controls, transfers and sandbox tools

## Account security

Account & security provides profile edits, password changes that revoke other browser sessions, TOTP enrollment with a QR/manual setup key, single-use recovery codes, recovery-code regeneration, disable with password confirmation, and signed-in device revocation. Better Auth stores the authentication records and verifies the second factor; ten unsuccessful second-factor attempts lock verification for fifteen minutes. Save recovery codes before completing enrollment. Email/password registration requires email verification. Production requires a working Resend sender; local mail goes to Mailpit.

OAuth authorization-code consent displays only permissions from a signed, unexpired authorization request verified by the authorization server. PKCE, exact registered callbacks, short access-token lifetimes and rotating refresh tokens are provided by the OAuth plugin. Device authorization supports the terminal flow. Account & security lists consenting applications and terminals, with access and refresh token revocation. Deleting the library's consent record alone is insufficient: our account action marks both token tables revoked and removes the consent. Delegated runs check revocation before subsequent model/tool actions. Already-dispatched external actions cannot be recalled.

## Large transfers

Direct file reads/writes are limited to 4 MiB. Transfer plans support 1,000 files, 25 MiB per file and 250 MiB total, with ten pending upload plans per organization. The public plan contains temporary object URLs, expected hashes and required headers. `GET /v1/workspaces/{id}/file?path=...&download=true` issues a private streaming download redirect, including large files.

On R2, a plan signs a PUT for one random `staging/{organization}/{transfer}/{object}` key, with content type and exact content length bound to its signature. Fetch, browsers and curl calculate Content-Length from the uploaded body. Do not manually add this header when using Node's bundled fetch: importing Undici 8 currently exposes a dispatcher compatibility issue with duplicated lengths. The integration fixture independently validates real SigV4 PUT signatures and exercises the AWS SDK's HTTP reads/deletes. This is local protocol evidence, not a live R2 account test. [Undici issue](https://github.com/nodejs/undici/issues/5500), [R2 presigning](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [Vercel body limit](https://vercel.com/docs/functions/limitations).

Applying a transfer reads staging with a strict byte bound, verifies its SHA-256, encrypts verified content under the platform vault key, checks the expected workspace revision and atomically publishes a checkpoint. Failed or stale applies preserve the existing files. Reusing a staging URL cannot modify a published encrypted object. Local uploads use the same plan/apply semantics through the local object endpoint.

Staging is protected by TLS and R2's encryption at rest, but is **not** application-encrypted until verification. Its PUT capabilities expire after thirty minutes; maintenance then deletes raw staging and clears temporary manifest references. Configure an R2 lifecycle rule to expire `staging/` objects after one day as independent cleanup if the control plane is down. R2 CORS must allow the exact application origin, PUT, Content-Type, and expose ETag if desired. Do not enable a public bucket or use wildcard credentialed origins. [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/).

## Web search

[Web search](web-search.md) supports Brave Search, Exa, Tavily, Parallel AI and Firecrawl through the shared broker tool. Every provider accepts encrypted customer API keys; Brave also retains managed funding and per-call budget admission. The feature reference owns setup, supported API modes, response limits, billing boundaries and verification. Native Codex search and Claude WebSearch/WebFetch remain disabled; the sandbox's ordinary network policy independently governs shell/network access.

## Approved stdio MCP packages

`GET /v1/stdio-packages` lists the operator-reviewed catalog. The default runtime image includes `@modelcontextprotocol/server-filesystem@2026.8.31`, exposing the reviewed read_text_file, write_file, list_directory and get_file_info tools. A user creates an `mcp_stdio` connection with package and package_version, selects grants, then attaches them to a run. Discovery uses the reviewed schema catalog without launching a billable sandbox. The Test action clearly reports that live startup occurs during the first run.

The broker executes stdio requests inside the **existing run sandbox**, through the SandboxTools port. A trusted root entrypoint verifies the run deadline and creates a permanent invocation marker before dropping all supplemental groups and switching to the untrusted agent UID. It removes the temporary credentials file, launches an exact executable/argv through the official MCP SDK, bounds the result and timeout, and closes the subprocess. Duplicate dispatch with the same invocation ID cannot execute again; a lost result is reported as unknown. The normal run deadline also kills the agent UID's remaining processes before checkpointing.

Packages share the customer's workspace and agent UID. User-provided package environment credentials are therefore exposed to that sandbox process, as stated in the UI; these are not isolated secrets from the customer's own code. Infrastructure account credentials are never passed into the sandbox. Remote MCP OAuth is preferable when credentials should remain at the central broker.

To approve another package, install its **exact** version in packages/runtime/package.json, inspect its license/source/tool schemas, and rebuild/publish the immutable runtime image. Configure MCP_STDIO_CATALOG_JSON as an array of `{package, version, label, command, args, environment_keys, tools}`. Command must be an absolute `/opt/platform/` path; args are operator-fixed, not interpolated shell strings. Tools contain `{name, description, input_schema}`. Only approved environment_keys may be supplied through write-only secret_env; executable-loader and platform environment names are rejected. Publish the matching catalog and image together. Removing a catalog entry revokes subsequent broker dispatch. [Official filesystem server](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem).

## Related guides

See [connections and access](README.md), [provider setup](../../operations/launch-integrations.md), and the [API guide](../api/README.md).
