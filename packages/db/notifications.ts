import pg from 'pg';

type NotificationOptions = {
  connectionString: string;
  channel: string;
  notification: (payload: string | undefined) => void;
  connected?: () => void;
  unavailable?: () => void;
  retryMs?: number;
};

/** Session-owned, best-effort hints. Callers retain SQL polling/replay authority;
 * transaction poolers need a separate direct connection for LISTEN. */
export function listenDatabaseNotifications(
  options: NotificationOptions,
  createClient = () =>
    new pg.Client({
      connectionString: options.connectionString,
      connectionTimeoutMillis: 1000,
      query_timeout: 1000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    }),
) {
  if (!/^[a-z_][a-z0-9_]*$/.test(options.channel)) throw new Error('Invalid notification channel.');
  let stopped = false,
    connected = false,
    client: pg.Client | undefined,
    retry: NodeJS.Timeout | undefined,
    attempt: Promise<void> | undefined,
    retiring: Promise<void> | undefined,
    closing: Promise<void> | undefined;

  async function retire(current: pg.Client) {
    // pg exposes its owned stream. Force a stuck graceful close to finish too;
    // this client is never returned to a domain/auth pool or used for SQL work.
    const timer = setTimeout(() => current.connection.stream.destroy(), 1000);
    timer.unref();
    try {
      await current.end();
    } catch {
      // Reconnect/polling handles a lost hint connection, never a domain retry.
    } finally {
      clearTimeout(timer);
    }
  }
  function reconnect() {
    if (stopped || retry) return;
    retry = setTimeout(() => {
      retry = undefined;
      connect();
    }, options.retryMs ?? 5000);
    retry.unref();
  }
  function connect() {
    if (stopped || client) return;
    let current: pg.Client;
    try {
      current = createClient();
    } catch {
      options.unavailable?.();
      reconnect();
      return;
    }
    client = current;
    const disconnected = () => {
      if (client !== current) return;
      connected = false;
      client = undefined;
      options.unavailable?.();
      retiring = retire(current).then(reconnect);
    };
    current.on('error', disconnected);
    current.on('end', disconnected);
    current.on('notification', (notification) => {
      if (!stopped && client === current && notification.channel === options.channel)
        options.notification(notification.payload);
    });
    attempt = current
      .connect()
      .then(() => {
        if (!stopped && client === current) return current.query(`LISTEN ${options.channel}`);
      })
      .then(() => {
        if (stopped || client !== current) return;
        connected = true;
        // Rescan after reconnect: notifications missed while disconnected are
        // deliberately not replayed by PostgreSQL.
        options.connected?.();
      })
      .catch(disconnected);
  }
  connect();
  return {
    connected: () => connected,
    close(): Promise<void> {
      if (closing) return closing;
      stopped = true;
      connected = false;
      clearTimeout(retry);
      const current = client;
      client = undefined;
      closing = Promise.allSettled([attempt, retiring, ...(current ? [retire(current)] : [])]).then(() => {});
      return closing;
    },
  };
}
