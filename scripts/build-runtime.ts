import { copyFile } from 'node:fs/promises';
import { build } from 'esbuild';
await build({
  entryPoints: [
    'packages/runtime/src/entry.ts',
    'packages/runtime/src/host-control.ts',
    'packages/runtime/src/host-control-cli.ts',
    'packages/runtime/src/native-worker.ts',
    'packages/runtime/src/document-worker.ts',
    'packages/runtime/src/deepseek-bridge.ts',
    'packages/runtime/src/probe.ts',
    'packages/runtime/src/restore.ts',
    'packages/runtime/src/snapshot-page.ts',
    'packages/runtime/src/stdio-call.ts',
  ],
  outdir: 'packages/runtime/dist',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outExtension: { '.js': '.mjs' },
  packages: 'external',
  sourcemap: true,
});

await copyFile('packages/runtime/src/hermes-bridge.py', 'packages/runtime/dist/hermes-bridge.py');
