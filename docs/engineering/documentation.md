# Documentation architecture

Documentation has one Markdown source, a curated public site, and a separate maintainer record. The architecture uses the existing Next.js, React Markdown, Radix Dialog, and Lucide dependencies; it adds no documentation subscription, hosted search service, or provider account.

## Audience and hierarchy

The root README explains the product and local quickstart. [docs/README.md](../README.md) organizes tasks and links into feature overviews. Each feature retains implementation depth beneath its overview. Self-hosting belongs in operations; architecture and engineering guide contributors. Release work lives in [maintainer TODO](../maintainers/TODO.md), with measured evidence linked separately.

Public pages explain actual product limitations, such as retained checkpoint boundaries and source installation. They omit temporary launch notes, private environment worksheets, test-run narration, and unpublished-package claims.

## Publishing pipeline

[docs/navigation.json](../navigation.json) explicitly lists published files, stable slugs, titles, descriptions, and sections. `pnpm docs:generate` converts only those files into a generated static content module and repository `llms.txt`. Both development and production build scripts regenerate it. `pnpm docs:check` rejects drift.

The generator rewrites relative repository links to local documentation routes when published and to GitHub source links otherwise. OpenAPI resolves to the deployed `/openapi.json`. No request reads arbitrary checkout paths. Raw Markdown, search, full-text exports, navigation, and sitemap derive from the same publication set.

The HTML renderer keeps raw HTML disabled and uses React Markdown's safe URL handling. Guides render on the server and can be read without JavaScript. JavaScript adds search, mobile navigation, and copy actions. Search downloads the public index on demand and filters locally; it sends no queries to an external service.

## Agent discovery and search engines

Each page has a canonical HTML URL, unique title/description, heading anchors, and a Markdown alternative. `/llms.txt` links to individual Markdown guides; `/llms-full.txt` offers the full published set. Raw Markdown uses absolute links so it remains navigable outside the browser. OpenAPI remains the customer operation contract.

The sitemap lists public HTML pages, not tenant resources. Robots discourages crawling private application paths but is not an authorization boundary. Raw/combined/index representations use noindex where appropriate to avoid competing with canonical guide pages. No fabricated freshness dates, review scores, FAQ markup, or keyword stuffing are emitted.

Google's guidance applies ordinary crawlability and useful-content practices to its AI search features. `llms.txt` is an additional retrieval convenience, not an indexing or ranking guarantee. [Research and sources](documentation/research.md) explain the references and platform choices.

## Hosting and maintenance

Documentation is bundled with the application release. It uses no database, model, or sandbox calls. Costs are the existing build, static asset, and hosting traffic costs. Canonical URLs and product display settings are evaluated at build time; changing them requires a rebuild. Search is appropriate for the current guide set; measure its size before adding a separate search engine.

Keep GitHub source links aligned with repository ownership and the default branch. A fork should update `docs/site.json` before publishing; it owns the source repository and branch links. Domain/project business logic remains independent of the public brand.

## Validation

The documentation checker validates local links, headings, reachability, public-manifest content, and requirement mappings. Deterministic tests cover route selection, Markdown links, heading anchors, and agent exports. Browser acceptance covers public navigation, search/error recovery, mobile layout, copy controls, accessibility, and unknown-page behavior.

See [documentation verification](documentation/verification.md) for checks actually run and [release TODO](../maintainers/TODO.md) for hosted publication acceptance.
