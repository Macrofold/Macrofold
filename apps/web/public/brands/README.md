# Provider marks

Marks identify compatible third-party services; they do not imply endorsement or confer trademark rights.

- `openai.svg`, `openrouter.svg`: Composio's public logo CDN (`https://logos.composio.dev/api/openai` and `/api/openrouter`), retrieved September 6, 2026. Marks remain the property of their respective owners.
- `anthropic.svg`, `brave.svg`, `mcp.svg`: Simple Icons (`https://github.com/simple-icons/simple-icons/tree/develop/icons`), retrieved September 6, 2026. The upstream CC0 license is included as `SIMPLE-ICONS-LICENSE.md`; brand usage guidelines remain separate.
- App logos use Composio's public logo CDN. Connector metadata and its upstream MIT license live in `packages/providers/data`.

Journey previews also bundle `opencode`, `git`, `github`, `claude`, `typescript`, `python`, `go`, `rust`, `curl`, `postgresql`, `linear`, `sentry`, `datadog`, `gmail`, `notion`, and `hubspot` from the Simple Icons repository above (September 7, 2026). `slack`, `exa`, `tavily`, `parallel`, `firecrawl`, and `composio` come from the public Composio logo CDN on the same date. The same license and trademark boundaries apply. Logos are rendered in image contexts, never injected as markup.

`openai-mark.svg` is the transparent monochrome mark from [Simple Icons 11.15.0](https://github.com/simple-icons/simple-icons/blob/11.15.0/icons/openai.svg), under the included CC0 license. `codex.svg` places that unchanged black path on a white plate. Codex always uses this presentation in the dashboard and public diagrams; the older blue `openai.svg` is not selected by the shared branding component. Claude Code and Claude subscription configurations use `claude.svg`.

Harness additions retrieved September 9, 2026:

- `hermes.png`: [official Hermes website icon](https://hermes-agent.nousresearch.com/icon.png), the Nous Research mark also present in the [Hermes repository](https://github.com/NousResearch/hermes-agent/tree/main/website/static/img). Displayed as an unmodified image.
- `pi.svg`: [Pi press kit badge](https://pi.dev/favicon.svg), linked from the [official press kit](https://pi.dev/press-kit). Displayed unchanged.
- `deepseek.svg`: whale path from the [official DeepSeek Harness favicon](https://www.deepseek.com/harness/favicon.svg). Uses its default brand blue (`#4D6BFE`) without the favicon's operating-system color overrides, so the app theme does not hide it.

These marks identify the respective products and owners; their source projects' MIT licensing does not grant trademark rights. The dashboard's provider mapping never renders the Composio mark. Composio continues to supply connector metadata, authorization, and the existing app-logo CDN; individual app marks remain visible.

The final homepage additionally uses `googlecalendar`, `googlemaps`, and `todoist` from the same Simple Icons repository and CC0 license. Each has a matching entry in the bundled public connector catalog.

## Connector animation colors

`color/` holds the final animation’s brand-color SVGs, separately from the marks used elsewhere. Gmail, Google Calendar, Brave, PostgreSQL, Sentry, and Todoist come from [SVGL’s library](https://github.com/pheralb/svgl/tree/main/static/library), with its MIT notice in `color/SVGL-LICENSE.txt`. The other marks come from Composio’s public logo CDN using their filename as the app slug, except Google Maps uses `google_maps`. GitHub and Parallel use white monochrome fills for the dark surface. Preserve the multicolor artwork and render without recoloring filters; marks remain their owners’ trademarks. All assets are local and rendered as images, with no runtime CDN requests.

## Macrofold identity

`macrofold/lockup.svg` and `macrofold/mark.svg` are the supplied solid-white Saddle logo exports, without gradients. The public header and footer use the complete outlined wordmark; the application icon uses the same white symbol. Artwork is rendered as images, without executing the supplied source scripts or injecting SVG markup. Custom product display names keep the symbol with their configured text; the default public identity is Macrofold.

Documentation displays the same monochrome artwork in black for light appearance through a scoped CSS filter. Dark documentation and the marketing site retain white artwork; the logo geometry remains unchanged.

The wordmark contains outlined Space Grotesk 400 letterforms, tracking −0.015em. The supplied font notice is preserved in `macrofold/Space-Grotesk-OFL.txt`; no font binary or runtime font service is required.
