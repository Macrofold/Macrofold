# SDK architecture and verification

[SDK guides](README.md) own installation and customer usage. All five clients share the checked-in OpenAPI contract; no additional hosted service runs in the request path.

## Generation and ownership

`pnpm contracts` generates TypeScript declarations and the TypeScript/Python operation maps. Their existing maintained transports own idempotency recovery, error handling, and streaming.

`pnpm sdk:generate:all` additionally generates Go, Rust, and Java models and REST operations with OpenAPI Generator 7.24.0. Install JDK 21 and set `JAVA_HOME` before running it. The generator JAR downloads from Maven Central into ignored local storage and must match the pinned SHA-256 in `scripts/sdk/config.json`. Generation uses fresh temporary output; each SDK's `.generated-files.json` identifies owned files and removes obsolete generated paths without deleting maintained helpers.

Generated clients are committed. Ordinary application builds do not need Java, Go, Rust, or network access for generation. Build manifests, tests, README files, and `Client`/stream helpers are maintained separately. CI regenerates from the contract and checks drift, then tests each client. Generated endpoint documentation and placeholder tests are deliberately omitted; the shared OpenAPI reference is authoritative.

Go uses the generator's [required-property union normalizer](https://openapi-generator.tech/docs/customization/#openapi-normalizer) for request DTOs. Without it, the generator drops constructor assignments for the run request's conditional selector schema. The published OpenAPI and server validation retain exactly-one-selector checks; the local application SDK fixture verifies that a constructed request reaches execution.

The pinned generator needs two small, assertion-checked binary request adaptations: Java's native transport otherwise JSON-serializes a file path, and Rust omits the binary content type. Rust also sends the file length. These transformations live in the generator script, fail if their expected input changes, and have real HTTP upload regression tests. Go model name mappings avoid constructor collisions for newly issued API keys and webhooks.

## Transport boundaries

Go uses `net/http`; Rust uses Reqwest/Tokio; Java uses the JDK HTTP client and Jackson. The maintained constructors pin credentials to an explicit service origin, reject redirects, and bound individual stream connections to 70 seconds. SSE parsing is incremental with a four-mebibyte frame bound, decimal cursors, duplicate suppression, and terminal-event detection. Java bounds decoded characters, so its byte allocation differs from the Go/Rust byte bound.

Transient stream connection errors retry with bounded exponential delays, up to eight consecutive failures. Authentication denial is surfaced. REST calls in generated clients are single-attempt; callers retain their own mutation idempotency identity. Generated REST stream operations buffer responses: customer examples use the incremental helper instead. Download redirects must be handled deliberately without forwarding credentials to object-storage hosts.

## Technology decision

[OpenAPI Generator](https://github.com/OpenAPITools/openapi-generator) provides maintained [Go](https://openapi-generator.tech/docs/generators/go/), [Rust](https://openapi-generator.tech/docs/generators/rust/), and [Java](https://openapi-generator.tech/docs/generators/java/) generators under Apache-2.0. It adds a contributor toolchain and generated source, but no paid account or runtime service. Keeping the existing transports avoids replacing already tested mutation recovery to obtain more languages.

[Fern](https://buildwithfern.com/learn/sdks/overview/introduction) and [Speakeasy](https://www.speakeasy.com/docs/sdks/introduction) were evaluated as centralized SDK alternatives. Their managed generation and publication workflows may reduce future maintenance; current language support, plan terms, migration effort, and transport parity would need acceptance before switching. This implementation uses the existing contract and local tooling.

## Verification and release boundaries

TypeScript/Python retain existing transport and installable-package acceptance. Go/Rust/Java fixtures use loopback HTTP servers to verify typed requests, exact JSON/binary bodies, preconditions, idempotency, monetary precision, authorization, stream rotation, replay suppression, UTF-8, and detachment. Generated compilation alone is not API acceptance.

Run Go tests with `go -C sdk/go test ./...`, Rust with `cargo test --locked --manifest-path sdk/rust/Cargo.toml`, and Java with `mvn -B -f sdk/java/pom.xml verify`. Node/Python tests follow [testing policy](../../../../TESTING.md). Non-TypeScript coverage is separate; no Go/Rust/Java coverage is folded into the application's TypeScript percentage.

`pnpm test:sdks` runs those language suites with their application cases enabled against a new disposable PostgreSQL database, real API handler on loopback, and simulator worker. It requires the local database profile and all three language toolchains on PATH. It seeds synthetic credentials only, refuses paid/cloud profiles, and removes its database/files/processes on completion. The [acceptance record](../../../engineering/testing/sdk-and-draft-acceptance.md) distinguishes those end-to-end paths from protocol fixtures and hosted checks.

Package registry publication and hosted customer acceptance remain release checks in [maintainer TODO](../../../maintainers/TODO.md). Local protocol fixtures do not establish every generated endpoint against a deployed service, expiring OAuth behavior in every language, or production provider execution.
