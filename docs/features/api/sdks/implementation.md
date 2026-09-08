# SDK architecture and verification

[SDK guides](README.md) own installation and customer usage. All five clients share the checked-in OpenAPI contract; no additional hosted service runs in the request path.

## Generation and ownership

`pnpm contracts` generates TypeScript declarations, resource methods, the TypeScript/Python operation maps, and the public method index. Existing maintained transports own authentication, idempotency recovery, errors, and streaming.

`pnpm sdk:generate:all` additionally generates Python response models and Go, Rust, and Java models/REST operations with OpenAPI Generator 7.24.0. Install JDK 21 and set `JAVA_HOME` before running it. The generator JAR downloads from Maven Central into ignored local storage and must match the pinned SHA-256 in `scripts/sdk/config.json`. Generation uses fresh temporary output; each SDK's `.generated-files.json` identifies owned files and removes obsolete generated paths without deleting maintained helpers.

Generated clients are committed. Ordinary application builds do not need Java, Go, Rust, or network access for generation. Build manifests, tests, README files, and `Client`/stream helpers are maintained separately. CI regenerates from the contract and checks drift, then tests each client. Generated endpoint documentation and placeholder tests are deliberately omitted; the shared OpenAPI reference is authoritative.

Go and Python use the generator's [required-property union normalizer](https://openapi-generator.tech/docs/customization/#openapi-normalizer) for request DTOs. Without it, the generator drops constructor assignments for the run request's conditional selector schema. The published OpenAPI and server validation retain exactly-one-selector checks. TypeScript resource options also derive selector unions from those required/not branches; Python keyword signatures and other generated DTOs leave conditional selection to the API; the local application SDK fixture verifies that a constructed request reaches execution.

The pinned generator needs small, assertion-checked binary transport adaptations: Java's native transport otherwise JSON-serializes a file path, and Rust omits the binary content type. Rust also sends the file length. Go preserves a usable temporary file for successful zero-byte downloads; the generator otherwise returns a nil file. These transformations live in the generator script, fail if their expected input changes, and have real HTTP upload and download regression tests. Go model name mappings avoid constructor collisions for newly issued API keys, webhooks and triggers.

## Resource generation

The shared generation implementation lives under `scripts/sdk/`. A shared descriptor derives resource names from OpenAPI tags and operation IDs; only keyword collisions such as session continuation and checkpoint export need shared naming exceptions. All 117 contract operations must map exactly once in each language. `scripts/sdk/config.json` owns the common origin.

A small OpenAPI Generator API template exports parameter and return-type metadata using the vendor's resolved model names, nullability, and parameter locations. Language facade templates delegate to the generated transport rather than reproduce endpoints. TypeScript options derive directly from generated operation declarations. Python flattens body/query/header fields into keyword arguments, emits nested TypedDict inputs, and uses generated Pydantic response models. Omitted fields remain distinct from JSON null; UUIDs and datetimes serialize through Pydantic's JSON encoder. Empty action bodies are supplied by the facade instead of requiring empty dictionaries from callers.

Resource streaming calls the maintained incremental helper. Organization selection is retained on reconnects and terminal-history checks without changing other requests: TypeScript/Python use client configuration; Go uses stream request options; Rust/Java use resource options. Python closes the underlying generator on detachment. Detailed run replay and CLI token-supplier authentication remain unchanged.

The dashboard explicitly selects TypeScript's `sessionAuth: true` for same-origin login cookies. This bypasses environment-key lookup and bearer-token validation in both construction and requests; normal SDK clients still reject absent or empty credentials. Session mode cannot be combined with an explicit API key or token. A custom fetch alone does not select session authentication, and an empty token is not a substitute. The server continues to authorize every stream and history request; 401/403 errors stop automatic reconnection.

## Text and completion helpers

Maintained run helpers compose generated resource/transport calls; they introduce no HTTP endpoint, queue, or backend streaming system. `events` exposes the existing typed stream, while `stream_text`/`streamText` filters only nonempty string values from normalized `output.delta` events. It never emits tool payloads, reasoning, status data, or completed-message copies. Underlying sequence cursors provide reconnect/replay deduplication; identical text at different sequences is still legitimate output.

Normal stream exhaustion invokes the same completion check as `wait`, including when a cursor is already past the terminal event. Detachment skips that check and does not cancel execution. A failed/cancelled/timed-out run or unsuccessful persistence produces a typed run error with its ID, status, failure code, and result metadata. API/authorization failures retain the transport's existing error types.

`wait` polls status once per second by default and fetches the full result only after terminal execution. It requires `final` and finished persistence before returning; success requires a succeeded run, successful execution outcome, and verified/not-required persistence. It does not wait for Git sync. No overall wait timeout is imposed by default; callers choose one in the language's normal duration/context options. Local timeout/detachment never calls the cancellation endpoint.

TypeScript propagates an abort signal through reads, retries, and polling; Go uses context cancellation and Rust drops a timed-out future. Java uses a per-wait request configuration and deadline-owned response closure, leaving shared client settings unchanged. Python caps HTTPX phases/retry sleeps by a monotonic deadline and checks that deadline while reading response chunks; synchronous connection phases may return slightly after the overall deadline. These helpers need no new dependency.

Saved preset responses expose the persisted resource revision as their contractual numeric `version` on create/get/list/update. This fixes typed-model rejection without introducing a separate preset version counter. `runs.create` retains its generated parameters and `RunAccepted` response; presets resolve configuration on the server.

## Transport boundaries

Go uses `net/http`; Rust uses Reqwest/Tokio; Java uses the JDK HTTP client and Jackson. The maintained constructors use `MACROFOLD_API_KEY` unless a key is explicitly supplied, default to the configured hosted origin `https://app.macrofold.ai`, reject redirects, and bound individual stream connections to 70 seconds. SSE parsing is incremental with a four-mebibyte frame bound, decimal cursors, duplicate suppression, and terminal-event detection. Java bounds decoded characters, so its byte allocation differs from the Go/Rust byte bound.

Transient stream connection errors retry with bounded exponential delays, up to eight consecutive failures. Authentication denial is surfaced. Go/Rust/Java REST calls remain single-attempt. Resource methods generate mutation identities automatically and wrap errors with the identity while preserving the generated cause/status/body; callers can supply a saved identity. Low-level calls retain their explicit-key behavior. TypeScript/Python retain bounded REST retries. Python response validation also preserves mutation identity on invalid successful responses. Generated REST stream operations buffer responses: customer examples use the incremental helper instead. Download redirects must be handled deliberately without forwarding credentials to object-storage hosts.

## Technology decision

[OpenAPI Generator](https://github.com/OpenAPITools/openapi-generator) provides maintained [Go](https://openapi-generator.tech/docs/generators/go/), [Rust](https://openapi-generator.tech/docs/generators/rust/), and [Java](https://openapi-generator.tech/docs/generators/java/) generators under Apache-2.0. It adds a contributor toolchain and generated source, but no paid account or runtime service. Keeping the existing transports avoids replacing already tested mutation recovery to obtain more languages.

[Fern](https://buildwithfern.com/learn/sdks/overview/introduction) and [Speakeasy](https://www.speakeasy.com/docs/sdks/introduction) were evaluated as centralized SDK alternatives. Their managed generation and publication workflows may reduce future maintenance; current language support, plan terms, migration effort, and transport parity would need acceptance before switching. This implementation uses the existing contract and local tooling.

Python adds [Pydantic](https://docs.pydantic.dev/latest/) 2 and typing-extensions for generated response types, retaining HTTPX for transport. Pydantic uses the [MIT license](https://github.com/pydantic/pydantic/blob/main/LICENSE); typing-extensions uses the Python Software Foundation license. These add local package dependencies and validation cost, not a hosted service or paid generation account. The test extra pins Pyright for positive/negative keyword and response-type checks. Dependency versions and the measured acceptance scope are recorded in [resource SDK acceptance](../../../engineering/testing/sdk-resources.md).

## Verification and release boundaries

TypeScript/Python retain existing transport and installable-package acceptance. Go/Rust/Java fixtures use loopback HTTP servers to verify typed requests, exact JSON/binary bodies, preconditions, idempotency, monetary precision, authorization, stream rotation, replay suppression, UTF-8, and detachment. Generated compilation alone is not API acceptance.

Run Go tests with `go -C sdk/go test ./...`, Rust with `cargo test --locked --manifest-path sdk/rust/Cargo.toml`, and Java with `mvn -B -f sdk/java/pom.xml verify`. Node/Python tests follow [testing policy](../../../../TESTING.md). Non-TypeScript coverage is separate; no Go/Rust/Java coverage is folded into the application's TypeScript percentage.

`pnpm test:sdks` runs all five resource journeys, the Python type checks, and the language transport suites with their application cases enabled against a new disposable PostgreSQL database, real API handler on loopback, and simulator worker. The Python journey explicitly loads the current repository SDK source; installed-wheel acceptance is tested separately by package tests. It requires the local database profile and Node, Python with `python -m pip install './sdk/python[test]'`, Go, Rust, and Maven/JDK toolchains on PATH. It seeds synthetic credentials only, refuses paid/cloud profiles, and removes its database/files/processes on completion. The [resource acceptance record](../../../engineering/testing/sdk-resources.md) distinguishes those end-to-end paths from protocol fixtures and hosted checks.

Package registry publication and hosted customer acceptance remain release checks in [maintainer TODO](../../../maintainers/TODO.md). Local protocol fixtures do not establish every generated endpoint against a deployed service, expiring OAuth behavior in every language, or production provider execution.
