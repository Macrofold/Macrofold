// Pause real filesystem publication at a deterministic boundary; the parent kills this process.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const [mode, snapshot, workspace, home] = process.argv.slice(2);
const rename = fs.promises.rename;
fs.promises.rename = async (from, to) => {
  const pause = mode === 'capture' ? to.endsWith('/index.json') : to.endsWith('/file.txt');
  if (pause && mode === 'after-file') await rename(from, to);
  if (pause) {
    process.send({ paused: true });
    await new Promise(() => {});
  }
  return rename(from, to);
};
syncBuiltinESMExports();
if (mode === 'capture') {
  const { captureSnapshot } = await import('../../packages/runtime/src/manifest.ts');
  await captureSnapshot({ workspace, home }, snapshot);
} else {
  const { restoreSnapshot } = await import('../../packages/runtime/src/restore.ts');
  await restoreSnapshot(snapshot, { workspace, home });
}
throw new Error('The crash barrier was not reached');
