import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { command } from './processes';
import { sourceManifest, currentSourceManifest, sameSources } from './maps';

const directory = path.resolve(process.env.COVERAGE_DIR || 'coverage/full');
// Never merge a previous run. A nonempty destination is an error, not permission to erase it.
await mkdir(path.dirname(directory), { recursive: true });
await mkdir(directory);
const env = { ...process.env, COVERAGE_DIR: directory, VITEST_COVERAGE_DIR: path.join(directory, 'domain') };
const sources = await currentSourceManifest(process.cwd());
await writeFile(path.join(directory, 'sources.json'), JSON.stringify(sources));
await command(['test:coverage'], env);
const baseline = JSON.parse(await readFile(path.join(directory, 'domain/coverage-final.json'), 'utf8'));
if (!sameSources(sources, await sourceManifest(baseline, process.cwd())))
  throw new Error('Source changed while domain tests ran');
let acceptanceFailure: unknown;
try {
  await command(['exec', 'tsx', 'scripts/test-dashboard.ts'], env);
} catch (error) {
  acceptanceFailure = error;
}
await command(['exec', 'tsx', 'scripts/coverage/merge.ts'], {
  ...env,
  COVERAGE_REQUIRED_SURFACES: 'browser,server,worker,cli',
});

if (acceptanceFailure) throw acceptanceFailure;
