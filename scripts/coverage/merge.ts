import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { convert, type Options } from 'ast-v8-to-istanbul';
import { AnyMap, encodedMap } from '@jridgewell/trace-mapping';
import { mergeScriptCovs } from '@bcoe/v8-coverage';
import { parseAstAsync } from 'vitest/node';
import libCoverage, { type CoverageMapData } from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';
import { applicationThresholds, combinedThresholds } from './policy';
import type { Profiler } from 'node:inspector';
import {
  checkGates,
  digest,
  overlay,
  sourceManifest,
  sourcePath,
  sameSources,
  mappedSourcePath,
} from './maps';

const root = process.cwd();
const directory = path.resolve(process.env.COVERAGE_DIR || 'coverage/full');
type SourceMap = NonNullable<Options['sourceMap']>;
type Sample = Profiler.ScriptCoverage & { source?: string; sourceMap?: SourceMap };
type Raw = { result: Sample[]; 'source-map-cache'?: Record<string, { data?: SourceMap }> };
async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : path.join(dir, e.name))),
    )
  ).flat();
}
const canonical: CoverageMapData = JSON.parse(
  await readFile(path.join(directory, 'domain/coverage-final.json'), 'utf8'),
);
const manifest: Record<string, string> = JSON.parse(
  await readFile(path.join(directory, 'sources.json'), 'utf8'),
);
if (!sameSources(await sourceManifest(canonical, root), manifest))
  throw new Error('Coverage sources changed during this run. Start a fresh collection.');
const buildSources: Record<string, string> = await readFile(
  path.join(directory, 'build-sources.json'),
  'utf8',
)
  .then(JSON.parse)
  .catch(() => ({}));
const data: CoverageMapData = {};
for (const [file, coverage] of Object.entries(canonical))
  data[path.join(root, sourcePath(file, root)!)] = {
    ...coverage,
    path: path.join(root, sourcePath(file, root)!),
  };
const evidence: Record<
  string,
  { samples: number; sources: string[]; matched: number; unmatched: number; unmappedSources: string[] }
> = {};
const seen = new Set<string>();
for (const surface of ['browser', 'server', 'worker', 'cli', 'native']) {
  const stats = { samples: 0, sources: new Set<string>(), matched: 0, unmatched: 0 };
  const unmappedSources = new Set<string>();
  const observations = new Map<
    string,
    { code: string; sourceMap: SourceMap; coverage: Profiler.ScriptCoverage }
  >();
  const inputs = await files(path.join(directory, surface)).catch(() => []);
  for (const file of inputs.filter((f) => f.endsWith('.json'))) {
    const raw: Raw = JSON.parse(await readFile(file, 'utf8'));
    for (const sample of raw.result || []) {
      let code = sample.source,
        map = sample.sourceMap || raw['source-map-cache']?.[sample.url]?.data;
      let url = sample.url;
      if (!code && url.startsWith('file:')) {
        let local = fileURLToPath(url);
        // Runtime image maps point at /build; only our known fixture artifacts are read.
        if (local.startsWith('/opt/platform/'))
          local = path.join(root, 'packages/runtime/dist', path.basename(local));
        if (!local.startsWith(root + path.sep)) continue;
        code = await readFile(local, 'utf8').catch(() => undefined);
        if (!map)
          map = await readFile(local + '.map', 'utf8')
            .then(JSON.parse)
            .catch(() => undefined);
        url = pathToFileURL(local).href;
      }
      if (!code) continue;
      if (!map) {
        const inline = code.match(/\/\/[#@] sourceMappingURL=data:application\/json[^,]*;base64,([^\s]+)/);
        if (inline) map = JSON.parse(Buffer.from(inline[1], 'base64').toString());
      }
      if (!map) continue;
      map = encodedMap(AnyMap(JSON.stringify(map), url));
      if (!map.sources.length) continue;
      let owned = false;
      const sources = map.sources.map((source, i) => {
        const external = pathToFileURL(
          path.join(root, 'node_modules/.coverage-external', String(i) + '.js'),
        ).href;
        if (source === null) return external;
        const relative = mappedSourcePath(source, url, root, surface === 'native');
        if (!relative || !manifest[relative]) return external;
        if (map!.sourcesContent?.[i] == null || digest(map!.sourcesContent[i]!) !== manifest[relative]) {
          // Workflow's server transform can publish intermediate JS under a .ts filename.
          // Build provenance proves the input revision, but those coordinates receive no credit.
          if (surface === 'server' && sameSources(buildSources, manifest)) {
            unmappedSources.add(relative);
            return external;
          }
          throw new Error(`Stale or missing source content in ${surface}: ${relative}`);
        }
        owned = true;
        return pathToFileURL(path.join(root, relative)).href;
      });
      if (!owned) continue;
      const signature = digest(
        JSON.stringify([
          url,
          code,
          sample.functions.map((fn) => ({
            ...fn,
            ranges: fn.ranges.map((range) => ({ ...range, count: range.count > 0 ? 1 : 0 })),
          })),
        ]),
      );
      if (seen.has(signature)) continue;
      seen.add(signature);
      stats.samples++;
      const coverage = {
        ...sample,
        url: url.startsWith('file:')
          ? url
          : pathToFileURL(path.join(directory, 'browser-build', path.basename(new URL(url).pathname))).href,
      };
      const sourceMap = { ...map, sources };
      const key = digest(JSON.stringify([url, code, sourceMap]));
      const prior = observations.get(key);
      if (prior) prior.coverage = mergeScriptCovs([prior.coverage, coverage])!;
      else observations.set(key, { code, sourceMap, coverage });
    }
  }
  // Convert each immutable bundle once after merging V8 observations in its own coordinate space.
  for (const observation of observations.values()) {
    const converted = await convert({ ...observation, ast: parseAstAsync(observation.code) });
    for (const [name, incoming] of Object.entries(converted)) {
      const relative = sourcePath(name, root);
      if (!relative || !manifest[relative]) continue;
      const result = overlay(data[path.join(root, relative)], incoming);
      stats.sources.add(relative);
      stats.matched += result.matched;
      stats.unmatched += result.unmatched;
    }
  }
  evidence[surface] = {
    ...stats,
    sources: [...stats.sources].sort(),
    unmappedSources: [...unmappedSources].sort(),
  };
}
const output = path.join(directory, 'merged');
await mkdir(output, { recursive: true });
const coverageMap = libCoverage.createCoverageMap(data);
const context = libReport.createContext({ dir: output, coverageMap });
for (const name of ['html', 'lcovonly', 'json', 'json-summary', 'text-summary'] as const)
  reports.create(name).execute(context);
await writeFile(path.join(output, 'surfaces.json'), JSON.stringify(evidence, null, 2));
for (const required of (process.env.COVERAGE_REQUIRED_SURFACES || '').split(',').filter(Boolean)) {
  if (!evidence[required]?.samples || !evidence[required]?.matched)
    throw new Error(`Missing coverage surface: ${required}`);
}
const failures = checkGates(data, root, evidence.native.samples ? combinedThresholds : applicationThresholds);
if (failures.length) throw new Error(failures.join('\n'));
console.log('Coverage gates passed; per-surface evidence:', path.join(output, 'surfaces.json'));
