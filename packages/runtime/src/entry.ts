import { supervise } from './supervisor';
await supervise('/platform-control/config.json', '/opt/platform/native-worker.mjs');
