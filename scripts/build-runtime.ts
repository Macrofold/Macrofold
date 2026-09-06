import { build } from 'esbuild';
await build({
  entryPoints: [
    'packages/runtime/src/entry.ts',
    'packages/runtime/src/native-worker.ts',
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
