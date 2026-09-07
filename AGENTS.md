# Contributor and coding-agent instructions

Build the smallest complete change that satisfies the request and preserves existing behavior. Prefer clear code and established tools over cleverness, speculative flexibility, or line-count targets. User instructions override repository guidance.

## Temporary notes: pre-launch

The product has never been deployed and has no real users or production runs. Existing local accounts and runs are development/test fixtures, not a deployed customer population.

Do not add compatibility layers, legacy-data handling, warnings, or TODOs solely to accommodate hypothetical existing customers or production runs. Prefer the simplest correct pre-launch implementation. Continue to preserve local developer work and the running preview.

Remove this section once the product is deployed and has real users; reassess compatibility and migration requirements then.

## Before working

1. Inspect the working tree; preserve unrelated edits and the running preview. Read [implementation status](docs/status/README.md) before choosing a change.
2. **Before planning or making implementation changes, or reviewing code, read the full mandatory baseline with your file-reading tool:** the [implemented architecture](docs/architecture/README.md), [architecture decisions](docs/architecture/decisions.md), [codebase map](docs/architecture/codebase.md), [rules index](.agents/rules/README.md), **every rule file under `.agents/rules/` (including subdirectories)**, and [testing policy](TESTING.md). Enumerate the rules directory so newly added rules are included. This applies to application code, tests, scripts, migrations, and configuration. Do not select only the rules whose titles appear relevant.
3. Read the affected feature guides and implementation details, relevant source/callers/tests, and scoped `AGENTS.md` files along every affected path, even when your session started at the repository root. Follow any additional reading requirements in those instructions, including installed framework documentation where required. Revisit scope-specific reading when the task expands to another layer.
4. For documentation-only work, read [documentation rules](.agents/rules/documentation.md), the rules index, and any rules or guides whose instructions you are changing. Apply the rules to the requested work; reading the complete baseline is not permission to refactor unrelated code.

Links are explicit reading instructions, not automatic imports. Read required files in full; a filename, search excerpt, or summary does not replace their contents. Read once per task unless a file changes or its instructions are no longer available in context. Background research and unrelated feature references remain optional unless a rule explicitly requires them.

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
