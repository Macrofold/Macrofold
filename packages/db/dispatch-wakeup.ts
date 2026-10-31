import { config } from '../core/src/config';
import { listenDatabaseNotifications } from './notifications';

export const dispatchWakeupChannel = 'macrofold_dispatch_wakeup';

/** One direct session connection per standalone poller. Payload-free hints do
 * not select a tenant/Run or grant execution; every wake rescans durable SQL. */
export function listenDispatchWakeup(wake: () => void) {
  return listenDatabaseNotifications({
    connectionString:
      process.env.DATABASE_LISTENER_URL || process.env.AUTH_DATABASE_URL || config.databaseUrl,
    channel: dispatchWakeupChannel,
    notification: wake,
    connected: wake,
    retryMs: 1000,
    unavailable: () => console.warn(JSON.stringify({ code: 'dispatch_wakeup_unavailable' })),
  });
}
