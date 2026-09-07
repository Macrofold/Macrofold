import { readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { mergeScriptCovs } from '@bcoe/v8-coverage';
import { digest } from './maps';
import type { Profiler } from 'node:inspector';
import type { Options } from 'ast-v8-to-istanbul';

type Artifact = { source: string; sourceMap: NonNullable<Options['sourceMap']> };
type Observation = Profiler.ScriptCoverage & Artifact;

/** Pack each immutable bundle once. Repeating large server maps for every flush can exceed
 * V8's string limit; merge ranges before serialization and keep separate bounded files. */
export async function pack(directory: string, runtime = false, serverDist?: string) {
  const files = (await readdir(directory)).filter((f) => /^coverage-.*\.json$/.test(f));
  if (!files.length) return;
  const runtimeSources: Record<string, Artifact> = runtime
    ? JSON.parse(await readFile(path.join(directory, 'runtime-sources.json'), 'utf8'))
    : {};
  const artifacts = new Map<string, Artifact | undefined>();
  const observations = new Map<string, Observation>();
  for (const file of files) {
    const raw = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
    for (const entry of raw.result as Profiler.ScriptCoverage[]) {
      if (!entry.url.startsWith('file:') || entry.url.includes('/node_modules/')) continue;
      const native = runtime && entry.url.startsWith('file:///opt/platform/');
      const local = fileURLToPath(entry.url);
      if (!native && !local.startsWith(process.cwd() + path.sep)) continue;
      if (!artifacts.has(entry.url)) {
        if (native) {
          if (!runtimeSources[entry.url]) throw new Error('Missing executed runtime source: ' + entry.url);
          artifacts.set(entry.url, runtimeSources[entry.url]);
        } else {
          const source = await readFile(local, 'utf8').catch(() => undefined);
          const mapPath =
            serverDist && local.includes('/standalone/') && local.includes('/server/')
              ? path.join(serverDist, 'server', local.split('/server/').at(-1)!) + '.map'
              : local + '.map';
          const sourceMap = await readFile(mapPath, 'utf8')
            .then(JSON.parse)
            .catch(() => raw['source-map-cache']?.[entry.url]?.data);
          artifacts.set(entry.url, source && sourceMap ? { source, sourceMap } : undefined);
        }
      }
      const artifact = artifacts.get(entry.url);
      if (!artifact) continue;
      const url = native ? entry.url : pathToFileURL(local).href;
      const prior = observations.get(url);
      const coverage = prior ? mergeScriptCovs([prior, { ...entry, url }])! : { ...entry, url };
      observations.set(url, { ...coverage, ...artifact });
    }
  }
  // Delete raw inputs only after all portable artifacts have been written successfully.
  for (const [url, observation] of observations)
    await writeFile(
      path.join(directory, 'packed-' + digest(url) + '.json'),
      JSON.stringify({ result: [observation] }),
    );
  await Promise.all(files.map((file) => unlink(path.join(directory, file))));
  if (runtime) await unlink(path.join(directory, 'runtime-sources.json'));
}
