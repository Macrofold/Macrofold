import { copyFile } from 'node:fs/promises';
import { build } from 'esbuild';
const result = await build({
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
  metafile: true,
});

// Local dynamic imports alone can still hoist external SDKs in this bundle
// layout. Keep required selected SDK evaluation inside its awaited factory.
const exclusiveSDKs = [
  '@anthropic-ai/claude-agent-sdk',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-coding-agent',
  '@opencode-ai/sdk',
];
const native = result.metafile.outputs['packages/runtime/dist/native-worker.mjs'];
if (!native) throw new Error('Native worker build metadata is missing.');
const eager = native.imports.filter(
  (item) =>
    item.kind === 'import-statement' &&
    exclusiveSDKs.some((sdk) => item.path === sdk || item.path.startsWith(`${sdk}/`)),
);
if (eager.length)
  throw new Error(
    `Exclusive native SDK imports must stay lazy: ${eager.map((item) => item.path).join(', ')}`,
  );

await copyFile('packages/runtime/src/hermes-bridge.py', 'packages/runtime/dist/hermes-bridge.py');
