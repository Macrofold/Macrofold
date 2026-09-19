import { config } from '../packages/core/src/config';
import { storage } from '../packages/providers/src/storage';
import { backupRecoverySet, restoreRecoverySet, verifyRecoverySet } from './recovery/archive';

const [command, directory] = process.argv.slice(2);
if (!directory || !['backup', 'verify', 'restore'].includes(command || ''))
  throw new Error(
    'Usage: pnpm recovery <backup|verify|restore> /private/new-directory [--confirm-writers-paused|--confirm-isolated-target]',
  );
const options = { container: process.env.RECOVERY_POSTGRES_CONTAINER };
if (command === 'backup' && !process.argv.includes('--confirm-writers-paused'))
  throw new Error(
    'Pause all API/worker/cron writers and key rotation before --confirm-writers-paused. Admission pause alone is insufficient.',
  );
if (command === 'restore' && (!process.argv.includes('--confirm-isolated-target') || config.allowPaid))
  throw new Error(
    'Use --confirm-isolated-target with paid execution disabled and an empty independent database/store; never attach a scheduler.',
  );
const result =
  command === 'backup'
    ? await backupRecoverySet(config.ownerDatabaseUrl, storage, directory, options)
    : command === 'restore'
      ? await restoreRecoverySet(directory, config.ownerDatabaseUrl, storage, options)
      : await verifyRecoverySet(directory).then((m) => ({
          snapshot_at: m.started_at,
          objects: m.objects.length,
          verified: true,
        }));
console.log(JSON.stringify(result));
