import { config, isLocal } from './config';
import { errorDiagnostics } from './error-diagnostics';
import { listenDatabaseNotifications } from '../../db/notifications';

export const runEventChannel = 'macrofold_run_events';
export type EventListener = (
  hint: (organization: string, run: string) => void,
) => { connected: () => boolean; close: () => void } | undefined;

/** LISTEN requires a session connection, so enable it only for a direct local
 * PostgreSQL endpoint. Transaction poolers/serverless deployments use the shared
 * repair observer instead. Notifications are hints, never tenant authority. */
export const listenRunEvents: EventListener = (hint) => {
  if (!isLocal() || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.databaseUrl).hostname))
    return;
  const listener = listenDatabaseNotifications({
    connectionString: config.databaseUrl,
    channel: runEventChannel,
    unavailable: (error) =>
      console.warn(JSON.stringify({ code: 'run_event_listener_unavailable', ...errorDiagnostics(error) })),
    notification(payload) {
      if (!payload) return;
      try {
        const ids: unknown = JSON.parse(payload);
        if (
          Array.isArray(ids) &&
          ids.length === 2 &&
          ids.every((id) => typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id))
        )
          hint(ids[0], ids[1]);
      } catch {
        /* Malformed hints cannot affect durable replay. */
      }
    },
  });
  return {
    connected: listener.connected,
    close() {
      void listener.close();
    },
  };
};
