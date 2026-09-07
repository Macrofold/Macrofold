import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const exec = promisify(execFile),
  root = process.cwd(),
  temporary = await mkdtemp(path.join(tmpdir(), 'hosted-package-test-'));
try {
  const tarballs: string[] = [];
  for (const directory of ['sdk/typescript', 'packages/cli']) {
    const packed = JSON.parse(
      (
        await exec('npm', ['pack', '--json', '--pack-destination', temporary], {
          cwd: path.join(root, directory),
        })
      ).stdout,
    )[0];
    if (packed.files.some((file: { path: string }) => /(^|\/)(\.env|\.data|test-results)/.test(file.path)))
      throw new Error('Package unexpectedly includes private local files.');
    tarballs.push(path.join(temporary, packed.filename));
  }
  await writeFile(
    path.join(temporary, 'package.json'),
    JSON.stringify({ name: 'installation-test', private: true, type: 'module' }),
  );
  await exec('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs], {
    cwd: temporary,
    maxBuffer: 1024 * 1024,
  });
  const version = JSON.parse(
    (await exec(path.join(temporary, 'node_modules/.bin/agent'), ['version', '--json'], { cwd: temporary }))
      .stdout,
  );
  if (version.data.version !== '0.1.0') throw new Error('Installed CLI entry point failed.');
  await writeFile(
    path.join(temporary, 'verify.mjs'),
    "import {Client,ApiError} from 'macrofold'; if(typeof Client!=='function'||typeof ApiError!=='function')throw new Error('SDK exports missing'); console.log('SDK exports verified');\n",
  );
  await exec(process.execPath, ['verify.mjs'], { cwd: temporary });
  const artifacts = path.join(root, '.data/releases');
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  for (const file of tarballs)
    await writeFile(path.join(artifacts, path.basename(file)), await readFile(file));
  console.log('CLI and TypeScript SDK install from npm tarballs. No provider requests were made.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
