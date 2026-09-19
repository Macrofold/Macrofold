import { expect, it } from 'vitest';
import {
  absoluteMarkdown,
  findPage,
  headings,
  markdownUrl,
  pages,
  setupPrompt,
} from '../../apps/web/lib/docs/content';
import { GET as raw } from '../../apps/web/app/docs/raw/[...path]/route';
import { GET as search } from '../../apps/web/app/docs/search-index.json/route';
import { GET as llms } from '../../apps/web/app/llms.txt/route';
import { GET as full } from '../../apps/web/app/llms-full.txt/route';
import sitemap from '../../apps/web/app/sitemap';
import { GET as openapi } from '../../apps/web/app/openapi.json/route';

it('serves current API metadata with the deployment origin', async () => {
  const response = await openapi().json();
  expect(response.info.title).toBe('Macrofold API');
  expect(response.info.description).toContain('Manage persistent workspaces');
  expect(response.info.description).not.toContain('Design contract');
  expect(response.servers).toEqual([{ url: process.env.APP_ORIGIN || 'http://localhost:3210' }]);
  expect(response.paths['/v1/runs'].post.operationId).toBe('createRun');
});

it('resolves explicit published pages without treating file paths as routes', () => {
  expect(findPage()?.url).toBe('/docs');
  expect(findPage('api/quickstart')?.source).toBe('docs/features/api/quickstart.md');
  for (const path of ['../.env', 'self-hosting/../../status', 'maintainers/TODO', 'status', 'index'])
    expect(findPage(path)).toBeUndefined();
});
it('keeps heading IDs stable across code fences, inline code, punctuation, and duplicates', () => {
  expect(
    headings('# Guide\n\n## Use `BYOK` & keys\n```sh\n## Not a heading\n```\n### Café\n## Use `BYOK` & keys'),
  ).toEqual([
    { text: 'Use BYOK & keys', id: 'use-byok--keys', level: 2, line: 3 },
    { text: 'Café', id: 'café', level: 3, line: 7 },
    { text: 'Use BYOK & keys', id: 'use-byok--keys-1', level: 2, line: 8 },
  ]);
});
it('exports navigable Markdown with deployment-specific absolute links and source links intact', () => {
  const example = {
    ...pages[0],
    markdown:
      '[Guide](/docs/api#errors-and-retries) [API](/openapi.json) [Source](https://github.com/Macrofold/Macrofold)',
  };
  expect(absoluteMarkdown(example, 'https://docs.example.test')).toBe(
    '[Guide](https://docs.example.test/docs/raw/api.md#errors-and-retries) [API](https://docs.example.test/openapi.json) [Source](https://github.com/Macrofold/Macrofold)',
  );
  expect(markdownUrl('')).toBe('/docs/raw/index.md');
});
it('keeps the setup prompt readable and its links scoped to the documentation deployment', () => {
  for (const origin of [
    'https://app.macrofold.ai',
    'https://self-host.example.test',
    'http://localhost:3210',
  ]) {
    const prompt = setupPrompt(origin);
    expect(prompt).toContain('Feature to build:');
    expect(prompt).toContain('MACROFOLD_API_KEY');
    expect(prompt).toContain('worktree');
    const links = [...prompt.matchAll(/\]\(([^)]+)\)/g)].map((match) => new URL(match[1]));
    expect(links.length).toBeGreaterThanOrEqual(6);
    for (const link of links) {
      expect(link.origin).toBe(origin);
      expect(link.pathname).toMatch(/^\/docs\/raw\/.+\.md$/);
      const slug = link.pathname.replace('/docs/raw/', '').replace(/\.md$/, '');
      expect(findPage(slug)).toBeDefined();
    }
    expect(prompt).not.toContain('```');
  }
});
it('publishes distinct hosting setup and shared product guides in a simple entry order', () => {
  expect(pages.slice(0, 3).map((page) => page.slug)).toEqual(['', 'agents', 'api/quickstart']);
  expect(findPage('cloud')?.section).toBe(findPage('self-hosting')?.section);
  expect(findPage('api/conventions')).toBeDefined();
  expect(findPage('api/http-quickstart')).toBeDefined();
  expect(findPage('workspaces/shared-agents')).toBeDefined();
  expect(findPage('local-development')?.section).toBe('Development');
});
it('raw handlers return only published Markdown and canonical metadata', async () => {
  for (const path of [['.env'], ['..', 'status.md'], ['maintainers', 'TODO.md'], ['api']])
    expect((await raw(new Request('http://localhost'), { params: Promise.resolve({ path }) })).status).toBe(
      404,
    );
  const response = await raw(new Request('http://localhost'), {
    params: Promise.resolve({ path: ['api', 'quickstart.md'] }),
  });
  expect(response.headers.get('Content-Type')).toContain('text/markdown');
  expect(response.headers.get('Link')).toContain('/docs/api/quickstart');
  expect(await response.text()).toContain('# API quickstart');
});
it('search, sitemaps, and agent indexes share the public inventory without publishing maintainer records', async () => {
  const entries = await search().json();
  expect(entries.map((entry: { url: string }) => entry.url)).toEqual(pages.map((page) => page.url));
  expect(sitemap().filter((page) => new URL(page.url).pathname.startsWith('/docs')).length).toBe(
    pages.length,
  );
  const index = await llms().text(),
    all = await full().text();
  const sections = [...index.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
  expect(new Set(sections).size).toBe(sections.length);
  for (const page of pages) expect(index).toContain(markdownUrl(page.slug));
  expect(all).toContain('Source:');
  for (const privateContent of [
    'dry-thunder-',
    '/Users/mzw',
    'R2 writes await',
    'Live badges require',
    '## Remaining launch work',
  ]) {
    expect(all).not.toContain(privateContent);
    expect(JSON.stringify(entries)).not.toContain(privateContent);
  }
});

it('renders every guide as readable server HTML with heading targets and canonical metadata', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const {
    default: Doc,
    generateMetadata,
    generateStaticParams,
  } = await import('../../apps/web/app/docs/[[...slug]]/page');
  expect(generateStaticParams().length).toBe(pages.length);
  for (const page of pages) {
    const params = Promise.resolve({ slug: page.slug ? page.slug.split('/') : [] });
    const html = renderToStaticMarkup(await Doc({ params }));
    expect(html).toContain('<h1>');
    expect(html).toContain('View Markdown');
    for (const heading of headings(page.markdown)) expect(html).toContain(`id="${heading.id}"`);
    const metadata = await generateMetadata({ params });
    expect(metadata.description).toBe(page.description);
    expect(metadata.alternates?.canonical).toContain(page.url);
  }
  const params = Promise.resolve({ slug: ['not-published'] });
  expect((await generateMetadata({ params })).robots).toEqual({ index: false });
  await expect(Doc({ params })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
});

it('the generator rejects stale output and publication outside the approved source directories', async () => {
  const { mkdtemp, mkdir, copyFile, writeFile, rm, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { promisify } = await import('node:util');
  const { execFile } = await import('node:child_process');
  const directory = await mkdtemp(path.join(tmpdir(), 'docs-generator-'));
  try {
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
    await mkdir(path.join(directory, 'scripts/docs'), { recursive: true });
    await mkdir(path.join(directory, 'docs'));
    const script = path.join(directory, 'scripts/docs/generate.ts');
    await copyFile('scripts/docs/generate.ts', script);
    await writeFile(
      path.join(directory, 'docs/site.json'),
      JSON.stringify({ repository: 'https://github.com/example/docs', branch: 'main' }),
    );
    const entry = {
      slug: 'guide',
      source: 'docs/guide.md',
      title: 'Guide',
      description: 'An example guide',
      section: 'Start',
    };
    await writeFile(path.join(directory, 'docs/navigation.json'), JSON.stringify([entry]));
    await writeFile(path.join(directory, entry.source), '# Guide\n\nA public guide.\n');
    const invoke = (flags: string[] = []) =>
      promisify(execFile)(process.execPath, ['--import', 'tsx', script, ...flags], { cwd: process.cwd() });
    await invoke();
    await invoke(['--check']);
    expect(await readFile(path.join(directory, 'apps/web/lib/docs/generated.json'), 'utf8')).toContain(
      'A public guide.',
    );
    await writeFile(path.join(directory, entry.source), '# Guide\n\nUpdated content.\n');
    await expect(invoke(['--check'])).rejects.toThrow('is stale');
    await mkdir(path.join(directory, 'examples'));
    await writeFile(path.join(directory, 'examples/README.md'), '# Runnable example\n');
    await writeFile(
      path.join(directory, 'docs/navigation.json'),
      JSON.stringify([{ ...entry, source: 'examples/README.md' }]),
    );
    await invoke();
    await invoke(['--check']);
    await writeFile(
      path.join(directory, 'docs/navigation.json'),
      JSON.stringify([{ ...entry, source: '.data/private.md' }]),
    );
    await expect(invoke()).rejects.toThrow('Invalid public documentation source');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('search ranks topic headings and keeps matches beyond the first ten guides reachable', async () => {
  const { searchDocs } = await import('../../apps/web/lib/docs/search');
  const entries = await search().json();
  const matches = searchDocs(entries, 'idempotency');
  expect(matches.length).toBeGreaterThan(10);
  expect(matches.slice(0, 10).some((entry) => entry.url === '/docs/api/conventions')).toBe(true);
  expect(
    searchDocs(entries, 'customer agent').some((entry) => entry.url === '/docs/customer-agents/example'),
  ).toBe(true);
  expect(searchDocs(entries, 'zzzzunfindable')).toEqual([]);
});
