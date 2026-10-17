import pg from 'pg';
import { config, isLocal } from './config';

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
  let stopped = false,
    connected = false,
    client: pg.Client | undefined,
    retry: NodeJS.Timeout | undefined;
  const connect = () => {
    const current = new pg.Client({
      connectionString: config.databaseUrl,
      connectionTimeoutMillis: 1000,
      query_timeout: 1000,
    });
    client = current;
    const disconnected = () => {
      if (client !== current) return;
      connected = false;
      client = undefined;
      void current.end().catch(() => {});
      if (!stopped && !retry) {
        retry = setTimeout(() => {
          retry = undefined;
          connect();
        }, 5000);
        retry.unref();
      }
    };
    current.on('error', disconnected);
    current.on('end', disconnected);
    current.on('notification', (notification) => {
      if (stopped || notification.channel !== runEventChannel || !notification.payload) return;
      try {
        const ids: unknown = JSON.parse(notification.payload);
        if (
          Array.isArray(ids) &&
          ids.length === 2 &&
          ids.every((id) => typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id))
        )
          hint(ids[0], ids[1]);
      } catch {
        /* Malformed hints cannot affect durable replay. */
      }
    });
    void current
      .connect()
      .then(() => current.query(`LISTEN ${runEventChannel}`))
      .then(() => {
        if (stopped || client !== current) return;
        connected = true;
      })
      .catch(disconnected);
  };
  connect();
  return {
    connected: () => connected,
    close() {
      stopped = true;
      connected = false;
      clearTimeout(retry);
      const current = client;
      client = undefined;
      void current?.end().catch(() => {});
    },
  };
};
