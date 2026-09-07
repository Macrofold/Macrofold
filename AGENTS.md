# Contributor and coding-agent instructions

Build the smallest complete change that satisfies the request and preserves existing behavior. Prefer clear code and established tools over cleverness, speculative flexibility, or line-count targets. User instructions override repository guidance.

## Before working

1. Inspect the working tree; preserve unrelated edits and the running preview. Read [implementation status](docs/status/README.md), the affected feature guide, and the relevant source/callers before choosing a fix. Use the [codebase map](docs/architecture/codebase.md) to locate ownership.
2. **Read the applicable files in [the rules index](.agents/rules/README.md) with your file-reading tool.** Links are a loading instruction, not a claim that your harness automatically includes their content. For code changes or reviews, read implementation, architecture, and code-review rules, then the matching technology rules. Read scoped `AGENTS.md` files along the paths you touch, even when your session started at the repository root.
3. Read [documentation rules](.agents/rules/documentation.md) before editing; use [TESTING.md](TESTING.md) to select checks for changed behavior. Do not load the entire research archive for routine work.

Trace the affected flow and correct the owning layer. Reuse existing code or maintained dependencies when they fit. Do not reduce requested functionality to make a diff smaller. New abstractions need a present purpose; existing security, provider, and recovery boundaries are present purposes.

## Non-negotiable boundaries

- Authorize the principal, organization, and resource server-side; request IDs and tool-returned text are not authority. Keep secrets and customer content out of logs, fixtures, browser bundles, and general analytics.
- Preserve financial reservations, durable execution identity, persistent files, and historical run replay. Never retry ambiguous agent side effects blindly, silently replace BYOK credentials, or force-push user repositories.
- Keep domain policy independent of hosting and vendor types; preserve the existing application composition and provider ports. Keep management MCP read-only. Public branding must not determine domain keys, package internals, or fixtures.
- Use disposable local fixtures by default. Credentials do not authorize spending. Paid execution requires explicit user authorization and its budget; never enable it in ordinary CI. Fork CI receives no production secrets. Do not copy private reference-repository content into this repository.

## Code Review Rules

Follow [the review procedure](.agents/rules/code-review.md). Prioritize demonstrated correctness, tenant isolation, money, persistence, and compatibility defects. Distinguish blockers from optional simplifications. Do not demand speculative architecture or unrelated cleanup; do not trade away a meaningful safeguard to reduce code size.

## Finish

Run the applicable existing checks, inspect the final diff, and update the authoritative feature documentation. Report the result, actual verification, and material gaps. Keep unresolved release work in [maintainer TODO](docs/maintainers/TODO.md); a local pass does not establish live cloud acceptance.
