# Documentation architecture

Documentation has one Markdown source, a curated public site, and a separate maintainer record. The architecture uses the existing Next.js, React Markdown, Radix Dialog, and Lucide dependencies; it adds no documentation subscription, hosted search service, or provider account.

## Audience and hierarchy

The root README explains the product and offers Cloud, self-hosting, AI-assisted integration, and a free local quickstart. [docs/README.md](../README.md) organizes tasks and links into feature overviews. Each feature retains implementation depth beneath its overview. Cloud account setup belongs in `docs/cloud/`; self-hosting belongs in operations. Shared API, SDK, CLI, and feature guides explain both deployments. Development modes are a separate contributor path; architecture and engineering guide contributors. Release work lives in [maintainer TODO](../maintainers/TODO.md), with measured evidence linked separately.

Public pages explain actual product limitations, such as retained checkpoint boundaries and source installation. They omit temporary launch notes, private environment worksheets, test-run narration, and unpublished-package claims.

## Publishing pipeline

[docs/navigation.json](../navigation.json) explicitly lists published files, stable slugs, titles, descriptions, and sections. `pnpm docs:generate` converts only those files into a generated static content module and repository `llms.txt`. Both development and production build scripts regenerate it. `pnpm docs:check` rejects drift.

The generator rewrites relative repository links to local documentation routes when published and to GitHub source links otherwise. OpenAPI resolves to the deployed `/openapi.json`. No request reads arbitrary checkout paths. Raw Markdown, search, full-text exports, navigation, and sitemap derive from the same publication set.

The HTML renderer keeps raw HTML disabled and uses React Markdown's safe URL handling. Guides render on the server and can be read without JavaScript. JavaScript adds search, mobile navigation, and copy actions. Search downloads the public index on demand and filters locally; it sends no queries to an external service.

## Branded reading experience

The shared [docs shell](../../apps/web/components/docs-shell.tsx) and [stylesheet](../../apps/web/app/docs/docs.css) apply the [design language](../product/design-language.md) to every guide, including search, connector discovery and mobile navigation. The header uses the original Saddle lockup through the same [brand component](../../apps/web/components/brand-lockup.tsx) as the marketing site, displayed white in dark mode and black in light mode without changing its geometry. Default public headings and metadata say Macrofold; configured deployment display names remain supported without changing domain identifiers.

Navigation, content, links, code examples, tables and portaled dialogs use semantic docs tokens based on the product palette. Light mode uses a white reading canvas and header, with pale cyan code blocks, inline code, selected navigation and supporting accents. Links and code-block labels use a darker cyan for readable contrast. The shared appearance control offers light, dark and system modes in the desktop header and mobile menu, retaining the existing stored preference and initial-theme bootstrap. The entire docs surface follows the selected appearance, including the header, logo, navigation controls and hover states; dark mode retains graphite surfaces. Typography stays plain and readable. The landing cards expose AI setup, the human quickstart, Cloud and self-hosting equally.

Global interaction styles continue to own focus, hover transitions, hidden scrollbars and reduced motion. Documentation dialogs use the existing fade keyframes and return keyboard focus to their opening controls. Code and page actions reuse the shared green copy check, which returns to the copy icon after three seconds. No new theme state, animation library, font download or documentation framework is added.

## AI-assisted onboarding

The public [Build with AI guide](../getting-started/agents.md) owns a single `prompt` code block. The docs landing page and quickstart copy it through the existing clipboard component. Its links are resolved to the build's deployment origin and raw Markdown guides; no model call, documentation assistant service, or copied endpoint implementation is involved. Code blocks offer individual copy controls with clipboard failure feedback. The prompt remains visible without JavaScript.

The brief teaches integration into the customer's existing application, including secure key setup, current SDK installation, authorization, durable request identity, completion, and free testing. It is distinct from this repository's contributor AGENTS.md. Remote agents need accessible docs or attached source files; localhost URLs are useful only to agents that can reach that host.

## Agent discovery and search engines

Each page has a canonical HTML URL, unique title/description, heading anchors, and a Markdown alternative. `/llms.txt` links to individual Markdown guides; `/llms-full.txt` offers the full published set. Raw Markdown uses absolute links so it remains navigable outside the browser. OpenAPI remains the customer operation contract.

The sitemap lists public HTML pages, not tenant resources. Robots discourages crawling private application paths but is not an authorization boundary. Raw/combined/index representations use noindex where appropriate to avoid competing with canonical guide pages. No fabricated freshness dates, review scores, FAQ markup, or keyword stuffing are emitted.

Google's guidance applies ordinary crawlability and useful-content practices to its AI search features. `llms.txt` is an additional retrieval convenience, not an indexing or ranking guarantee. [Research and sources](documentation/research.md), including the [Cloud and AI onboarding comparison](documentation/cloud-and-agent-onboarding.md) and [API documentation principles](documentation/api-documentation-principles.md), explain the references and platform choices.

## Hosting and maintenance

Documentation is bundled with the application release. It uses no database, model, or sandbox calls. Costs are the existing build, static asset, and hosting traffic costs. Canonical URLs and product display settings are evaluated at build time; changing them requires a rebuild. The public connector directory adds a searchable release snapshot and a static JSON export at `/docs/connectors/catalog.json`. It derives from the same bundled metadata as dashboard discovery, includes native integrations, and never imports the credential-aware provider source. Only the directory fetches the full app list; rendering expands in bounded batches. No-JavaScript readers can use the complete export.

Search is appropriate for the current guide set; measure its size before adding a separate search engine.

Keep GitHub source links aligned with repository ownership and the default branch. A fork should update `docs/site.json` before publishing; it owns the source repository and branch links. Domain/workspace business logic remains independent of the public brand.

## Validation

The documentation checker validates local links, headings, reachability, public-manifest content, and requirement mappings. Deterministic tests cover route selection, Markdown links, heading anchors, and agent exports. Browser acceptance covers public navigation, search/error recovery, mobile layout, copy controls, accessibility, and unknown-page behavior.

See [documentation verification](documentation/verification.md) for checks actually run and [release TODO](../maintainers/TODO.md) for hosted publication acceptance.

Runnable customer application and data-recipe guides are published directly from their explicitly listed `examples/` Markdown sources. The generator accepts only manifest-selected `docs/`, `sdk/`, or `examples/` Markdown paths and rejects parent traversal; it never crawls local files or publishes `.data`. The same complete guides appear in the site, raw Markdown and AI exports.

Search ranks title and section-heading matches above incidental body mentions. A query exposes every matching published guide in the scrollable results panel; only the empty-query discovery list is capped. This keeps canonical API guidance reachable as examples are added.
