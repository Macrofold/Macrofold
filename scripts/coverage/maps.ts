import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import libCoverage, { type CoverageMapData, type FileCoverageData, type Range } from 'istanbul-lib-coverage';
import { thresholds } from './policy';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Resolve only known application sources. Bundle names and dependency paths never become files. */
export function sourcePath(value: string, root: string): string | undefined {
  let decoded = decodeURIComponent(value)
    .replaceAll('\\', '/')
    .replace(/[?#].*$/, '');
  if (decoded.startsWith('file:')) decoded = fileURLToPath(decoded);
  const relative = path.relative(root, decoded);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) decoded = relative;
  // Webpack/Turbopack URLs and Linux /build source maps have different prefixes.
  const match = decoded.match(
    /(?:^|\/)((?:packages\/[^/]+\/src|sdk\/typescript\/src|apps\/web\/(?:app|components|lib|workflows))\/.*\.(?:ts|tsx)|packages\/db\/index\.ts)$/,
  );
  if (!match || match[1].includes('/node_modules/') || match[1].split('/').includes('..')) return;
  if (match[1].endsWith('.d.ts') || match[1] === 'sdk/typescript/src/routes.ts') return;
  return match[1];
}

export function mappedSourcePath(source: string, url: string, root: string, native = false) {
  const absolute = new URL(source, url).href;
  if (native && absolute.startsWith('file:///opt/src/'))
    return sourcePath('/build/packages/runtime/src/' + absolute.slice('file:///opt/src/'.length), root);
  return sourcePath(source, root) || sourcePath(absolute, root);
}

export async function sourceManifest(data: CoverageMapData, root: string) {
  const sources: Record<string, string> = {};
  for (const file of Object.keys(data)) {
    const relative = sourcePath(file, root);
    if (!relative) throw new Error(`Unexpected canonical coverage file: ${file}`);
    sources[relative] = digest(await readFile(path.join(root, relative), 'utf8'));
  }
  return sources;
}

const location = (range: Range) => JSON.stringify([range.start, range.end]);
function hitUnion(entries: Iterable<readonly [string, number]>) {
  const hits = new Map<string, number>();
  for (const [key, count] of entries) hits.set(key, Math.max(hits.get(key) || 0, count > 0 ? 1 : 0));
  return hits;
}

/** Keep Vitest's denominator. Compiler-created or differently mapped branches cannot inflate it.
 * Counts are boolean unions, not invocation totals: repeated artifacts cannot count a branch twice. */
export function overlay(target: FileCoverageData, incoming: FileCoverageData) {
  let matched = 0,
    unmatched = 0;
  const apply = (lookup: Map<string, number>, key: string, update: (value: number) => void) => {
    const value = lookup.get(key);
    if (value === undefined) unmatched++;
    else {
      matched++;
      update(value > 0 ? 1 : 0);
    }
  };
  const statements = hitUnion(
    Object.entries(incoming.statementMap).map(([id, loc]) => [location(loc), incoming.s[id]]),
  );
  for (const [id, loc] of Object.entries(target.statementMap))
    apply(statements, location(loc), (value) => {
      target.s[id] = Math.max(target.s[id] > 0 ? 1 : 0, value);
    });
  const functions = hitUnion(
    Object.entries(incoming.fnMap).map(([id, fn]) => [location(fn.loc), incoming.f[id]]),
  );
  for (const [id, fn] of Object.entries(target.fnMap))
    apply(functions, location(fn.loc), (value) => {
      target.f[id] = Math.max(target.f[id] > 0 ? 1 : 0, value);
    });
  const branches = hitUnion(
    Object.entries(incoming.branchMap).flatMap(([id, branch]) =>
      branch.locations.map(
        (loc, index) =>
          [
            JSON.stringify([branch.type, location(branch.loc), index, location(loc)]),
            incoming.b[id][index],
          ] as const,
      ),
    ),
  );
  for (const [id, branch] of Object.entries(target.branchMap))
    branch.locations.forEach((loc, index) =>
      apply(branches, JSON.stringify([branch.type, location(branch.loc), index, location(loc)]), (value) => {
        target.b[id][index] = Math.max(target.b[id][index] > 0 ? 1 : 0, value);
      }),
    );
  return { matched, unmatched };
}

export function checkGates(data: CoverageMapData, root: string, policy = thresholds) {
  const map = libCoverage.createCoverageMap(data),
    failures: string[] = [];
  const metrics = ['lines', 'statements', 'branches', 'functions'] as const;
  function check(
    label: string,
    summary: ReturnType<typeof map.getCoverageSummary>,
    floor: Record<string, unknown>,
  ) {
    for (const metric of metrics) {
      const required = floor[100] ? 100 : floor[metric];
      if (
        typeof required === 'number' &&
        (!Number.isFinite(summary[metric].pct) || summary[metric].pct < required)
      )
        failures.push(`${label} ${metric}: ${summary[metric].pct}% < ${required}%`);
    }
  }
  check('global', map.getCoverageSummary(), policy);
  for (const [file, floor] of Object.entries(policy)) {
    if (typeof floor !== 'object') continue;
    const absolute = path.join(root, file);
    if (!map.files().includes(absolute)) failures.push(`Missing gated module: ${file}`);
    else check(file, map.fileCoverageFor(absolute).toSummary(), floor);
  }
  return failures;
}

/** Build provenance is independent of which modules a test happened to import. */
export async function currentSourceManifest(root: string) {
  const { globSync } = await import('node:fs');
  const directories = [
    ...globSync('packages/*/src', { cwd: root }),
    'sdk/typescript/src',
    ...['app', 'components', 'lib', 'workflows'].map((dir) => 'apps/web/' + dir),
  ];
  // Node's glob skips dot directories; OAuth discovery routes must remain in the inventory.
  const files = ['packages/db/index.ts'];
  for (const directory of directories)
    for (const file of await readdir(path.join(root, directory), { recursive: true }))
      if (/\.(ts|tsx)$/.test(file)) files.push(path.join(directory, file));
  const data: Record<string, string> = {};
  for (const file of files.sort()) {
    const relative = sourcePath(path.join(root, file), root);
    if (relative) data[relative] = digest(await readFile(path.join(root, relative), 'utf8'));
  }
  return data;
}
export function sameSources(a: Record<string, string>, b: Record<string, string>) {
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([key, hash]) => b[key] === hash)
  );
}
