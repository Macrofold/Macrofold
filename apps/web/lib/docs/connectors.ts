import snapshot from '../../../../packages/providers/data/connector-catalog.json';
import { searchProviders } from '../../../../packages/contracts/search';

/** Public build-time metadata only. Never import the credential-aware provider catalog here. */
export const nativeConnectors = [
  ...Object.entries({ anthropic: 'Anthropic', openai: 'OpenAI', openrouter: 'OpenRouter' }).map(
    ([provider, name]) => ({
      id: `native:${provider}`,
      provider,
      name,
      category: 'Model providers',
      description: 'Connect your own model API key. Choose a model compatible with your harness.',
      href: '/docs/connections',
    }),
  ),
  ...Object.entries(searchProviders).map(([provider, { name }]) => ({
    id: `native:${provider}`,
    provider,
    name,
    category: 'Search and web',
    description: 'Search the web through a configured search connection.',
    href: '/docs/connections',
  })),
  {
    id: 'native:github',
    provider: 'github',
    name: 'GitHub',
    category: 'Version control',
    description: 'Import, push, pull, and inspect repository synchronization for a workspace.',
    href: '/docs/workspaces',
  },
  {
    id: 'native:mcp_remote',
    provider: 'mcp_remote',
    name: 'Remote MCP',
    category: 'Custom tools',
    description: 'Connect an authorized remote MCP server over HTTP.',
    href: '/docs/connections',
  },
  {
    id: 'native:mcp_stdio',
    provider: 'mcp_stdio',
    name: 'Command MCP',
    category: 'Custom tools',
    description: 'Run an approved MCP server command inside the agent sandbox.',
    href: '/docs/connections',
  },
];
export const publicConnectors = {
  updated_at: snapshot.updated_at,
  source_url: snapshot.source_url,
  native: nativeConnectors,
  apps: snapshot.data.map(({ slug, name, description, categories, tool_count }) => ({
    slug,
    name,
    description,
    categories,
    tool_count,
  })),
};
export type PublicConnectors = typeof publicConnectors;
