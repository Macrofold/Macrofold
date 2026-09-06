import { probeRuntime } from './manifest';
const offset = Number(process.argv[2] || 0);
if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid event offset');
process.stdout.write(JSON.stringify(await probeRuntime('/platform-control', offset)));
