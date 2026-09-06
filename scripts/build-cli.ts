import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [path.join(root, 'packages/cli/src/index.ts')],
  outfile: path.join(root, 'packages/cli/dist/index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  sourcemap: true,
});
await chmod(path.join(root, 'packages/cli/dist/index.mjs'), 0o755);
console.log('Built portable CLI package.');
