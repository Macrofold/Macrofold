import { controlDirectory } from './control-directory';
import { supervise } from './supervisor';
await supervise(`${controlDirectory()}/config.json`, '/opt/platform/native-worker.mjs');
