# Integration and security boundaries

Reuse domain authorization and provider adapters. Authentication, validation, authorization, and accounting have different responsibilities; a successful provider call does not establish all four.

## Identity and tools

Use Better Auth and existing OAuth/jose/MCP libraries for protocol mechanics. Preserve origin/redirect validation, issuer/audience/expiry checks, PKCE/state, refresh rotation, and revocation behavior. Do not replace the libraries with handwritten authentication or disable safeguards to fix a callback. Revalidate delegated authority before queued work and according to existing long-lived stream policy.

Authorize each organization/resource/connection/tool combination. An MCP description, prompt, repository file, model response, or tool result is untrusted data and cannot grant permissions. Keep customer API keys separate from operator access; management MCP remains read-only. Do not pass platform or unrelated upstream tokens through to arbitrary MCP servers.

Use the existing SSRF-safe network layer for user-supplied URLs, including redirects and DNS handling. Keep credentials encrypted and out of logs, URLs, browser bundles, child environments not entitled to them, and general analytics. BYOK failures never fall back to platform funding.

## Provider contracts

Read pinned SDK behavior for request/response shape, streaming frames, error types, pagination, cancellation, timeout, and retries. Reuse its supported mechanics; do not multiply SDK retries with an unbounded wrapper. A lookup error is not proof of absence, and a dropped response does not prove an operation failed.

For Stripe/GitHub/other webhooks, verify signatures against the required raw payload before trusting events. Durably accept/deduplicate through existing handlers, process safely across retries and ordering changes, and acknowledge according to the provider contract. Do not credit an account from a browser success redirect.

Test the actual serialization and transport boundary with deterministic fixtures. Live acceptance is opt-in, bounded, synthetic, and separately documented; an API key in `.env` is not permission to spend or send messages. Retain the existing provider test safeguards and record unsupported endpoints honestly.

## Public API, SDKs, and CLI

Keep OpenAPI and generated clients aligned using `pnpm contracts`. Preserve operation IDs, selectors, scopes, stable error codes, pagination, idempotency, and SSE recovery. Errors should state what failed and offer a valid next action when one is known; do not invent remediations.

The CLI and TypeScript/Python SDKs use the public API. Keep machine-readable stdout separate from progress, preserve exit/cancellation/detach semantics, and do not leak keys in argv. Python uses existing HTTPX/resource management and Decimal for money. Project linking does not imply upload or sync; explicit transfer and Git conflict handling remain user-visible.
