import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest: { slug: string; source: string; title: string; section: string; description: string }[] =
  JSON.parse(await readFile(path.join(root, 'docs/navigation.json'), 'utf8'));
const { repository, branch }: { repository: string; branch: string } = JSON.parse(
  await readFile(path.join(root, 'docs/site.json'), 'utf8'),
);
const urlFor = (slug: string) => '/docs' + (slug ? '/' + slug : '');
const paths = new Map(manifest.map((page) => [page.source, urlFor(page.slug)]));
if (paths.size !== manifest.length || new Set(manifest.map((page) => page.slug)).size !== manifest.length)
  throw new Error('Documentation sources and slugs must be unique');

// Only explicitly published files are included. Never crawl the checkout or private launch artifacts.
const pages = await Promise.all(
  manifest.map(async (page) => {
    if (!/^(docs|sdk|examples)\/[\w/.-]+\.md$/.test(page.source) || page.source.split('/').includes('..'))
      throw new Error('Invalid public documentation source');
    if (page.slug && !/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(page.slug))
      throw new Error('Invalid documentation slug');
    const source = await readFile(path.join(root, page.source), 'utf8');
    const markdown = source.replace(/\]\(([^\s)]+)\)/g, (match, target: string) => {
      if (target.startsWith('#') || /^(https?:|mailto:)/.test(target)) return match;
      const [file, anchor] = target.split('#');
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(page.source), file));
      const href =
        resolved === 'docs/api/openapi.json'
          ? '/openapi.json'
          : paths.get(resolved) || `${repository}/blob/${branch}/${resolved}`;
      return `](${href}${anchor ? '#' + anchor : ''})`;
    });
    return { ...page, url: urlFor(page.slug), markdown };
  }),
);
// The public content module is a disposable build artifact, not another source
// copy. Keep the small repository discovery index under drift verification.
const contentModule = 'apps/web/lib/docs/generated.json';
const outputs = new Map([
  [contentModule, JSON.stringify(pages, null, 2) + '\n'],
  [
    'llms.txt',
    '# Macrofold documentation\n\n> Persistent agents on Macrofold Cloud or your own infrastructure. Start with Build with AI or the API quickstart.\n\n' +
      [...new Set(manifest.map((page) => page.section))]
        .map(
          (section) =>
            `## ${section}\n\n` +
            manifest
              .filter((page) => page.section === section)
              .map((page) => `- [${page.title}](${page.source}): ${page.description}`)
              .join('\n'),
        )
        .join('\n\n') +
      '\n\n## Contracts and contributors\n\n- [OpenAPI](docs/api/openapi.json)\n- [CLI commands](docs/api/cli.json)\n- [Management MCP](docs/api/admin-mcp.json)\n- [Codebase map](docs/architecture/codebase.md)\n- [Contributor instructions](AGENTS.md)\n',
  ],
]);
for (const [file, content] of outputs) {
  const target = path.join(root, file);
  if (process.argv.includes('--check')) {
    const existing = await readFile(target, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    // A clean checkout has no compiled content. Materialize it from the approved
    // manifest; an existing stale module or a stale tracked index still fails.
    if (existing === null && file === contentModule) {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    } else if (existing !== content) throw new Error(`${file} is stale. Run pnpm docs:generate.`);
  } else {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}
console.log(
  `${pages.length} public documentation pages ${process.argv.includes('--check') ? 'verified' : 'generated'}.`,
);
