import { z } from 'zod';

// Discovery metadata never grants access. OAuth, pinned versions, and tool grants
// remain separate checks in the connection and execution services.
export const connectorSchema = z.object({
  slug: z.string().regex(/^[a-z0-9_][a-z0-9_-]{0,99}$/),
  name: z.string().min(1).max(200),
  description: z.string().max(2000),
  logo: z.string().max(2048),
  categories: z.array(z.string().min(1).max(100)).max(30),
  tool_count: z.number().int().nonnegative(),
});
export type Connector = z.infer<typeof connectorSchema>;
export type ConnectorCatalog = {
  data: Connector[];
  source: 'live' | 'snapshot';
  updated_at: string;
};
export interface ConnectorCatalogSource {
  read(): Promise<ConnectorCatalog>;
}

export function parseConnectorCatalog(input: unknown): Connector[] {
  const entries = z.array(connectorSchema).min(1).max(10000).parse(input);
  if (new Set(entries.map((entry) => entry.slug)).size !== entries.length)
    throw new Error('The connector catalog contains duplicate app identifiers.');
  return entries.map((entry) => ({
    ...entry,
    // Images render in an isolated <img>, never as SVG/HTML markup. Restrict
    // upstream image locations to the catalog's CDN, without credentials/query strings.
    logo: `https://logos.composio.dev/api/${entry.slug}`,
    categories: [...new Set(entry.categories.length ? entry.categories : ['Other'])],
  }));
}

function configuredMap(value: string | undefined): Record<string, string> {
  const parsed = z.record(z.string(), z.string().min(1)).safeParse(
    (() => {
      try {
        return JSON.parse(value || '{}');
      } catch {
        return null;
      }
    })(),
  );
  return parsed.success ? parsed.data : {};
}

export async function listConnectorCatalog(
  source: ConnectorCatalogSource,
  settings: { enabled: boolean; authConfigs?: string; versions?: string },
) {
  const catalog = await source.read();
  const auth = configuredMap(settings.authConfigs);
  const versions = configuredMap(settings.versions);
  return {
    ...catalog,
    data: catalog.data.map((entry) => ({
      ...entry,
      // Public metadata is shared; readiness is computed per response and never
      // exposes operator keys, auth-config IDs, or connected customer accounts.
      connectable: Boolean(
        settings.enabled && auth[entry.slug] && versions[entry.slug] && versions[entry.slug] !== 'latest',
      ),
    })),
  };
}
