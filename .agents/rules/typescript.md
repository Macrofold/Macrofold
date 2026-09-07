# TypeScript and Node

Use the pinned toolchain, strict compiler settings, package scripts, and local formatting. Check installed declarations or source before using a dependency API; online examples may target another release.

## Types and contracts

- Prefer ordinary objects, functions, inference for locals, and clear exported contracts. Use discriminated unions when they express real alternatives or lifecycle states; avoid collections of contradictory boolean flags.
- Treat external JSON and caught errors as `unknown` until narrowed or validated. Reuse the existing Zod/Ajv/OpenAPI boundary. TypeScript types do not validate runtime input.
- Do not silence problems with `any`, double casts, non-null assertions, `@ts-ignore`, or relaxed compiler settings. A narrow interop assertion needs a verified invariant and boundary test where behavior is uncertain.
- Reuse domain types and generated contracts instead of handwritten copies. Add a generic only when it preserves a real relation between inputs and outputs. Do not hand-edit generated clients, lockfiles, build output, or `node_modules`.
- Distinguish absent, empty, zero, and false according to the contract; use nullish defaults when zero/false are valid. Make numeric units and bounds explicit. Money stays exact using the established integer/BigInt representation and decimal strings over JSON.

## Async and resource ownership

Await work whose result matters. Deliberate background work needs an existing durable owner or a bounded lifecycle and error path; `void promise` is not failure handling. Catch errors to translate a boundary, add useful context, recover specifically, or clean up, not to manufacture success.

Run independent I/O concurrently when appropriate, with bounded fan-out. Keep dependent operations and transaction mutations ordered. Do not block request handlers with synchronous filesystem work, expensive CPU loops, or unbounded buffers. Reuse streaming and batching helpers when size matters.

Propagate cancellation/deadlines through the owning API. Release database clients, timers, streams, listeners, file handles, and child processes in cleanup paths. Retries need a transient-error classification, bounded attempts/deadline, and safe side-effect semantics.

Construct subprocess calls with an executable and argument array. Treat paths and shell text as untrusted inputs; JSON serialization is not shell escaping. Respect ESM/package boundaries and the Node versions actually supported by each artifact.
