import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseError } from 'pg';

const fixture = vi.hoisted(() => ({ unavailable: undefined as ((error: unknown) => void) | undefined }));
vi.mock('../../packages/core/src/config', () => ({ config: { databaseUrl: 'postgres://fixture/fixture' } }));
vi.mock('../../packages/db/notifications', () => ({
  listenDatabaseNotifications: (options: { unavailable?: (error: unknown) => void }) => {
    fixture.unavailable = options.unavailable;
    return { connected: () => false, close: async () => {} };
  },
}));
import { listenDispatchWakeup } from '../../packages/core/src/dispatch-wakeup';

afterEach(() => {
  fixture.unavailable = undefined;
  vi.restoreAllMocks();
});

it.each([
  {
    name: 'a PostgreSQL rejection',
    error: Object.assign(new DatabaseError('private URL, credentials and SQL', 0, 'error'), {
      code: '28P01',
    }),
    expected: { error_type: 'Error', sqlstate: '28P01' },
  },
  {
    name: 'a malformed connection',
    error: new TypeError('private URL, credentials and SQL'),
    expected: { error_type: 'TypeError' },
  },
  { name: 'a closed connection', error: undefined, expected: { error_type: 'Error' } },
])('logs safe wake-listener diagnostics for $name', ({ error, expected }) => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  listenDispatchWakeup(vi.fn());
  fixture.unavailable?.(error);
  expect(warn).toHaveBeenCalledExactlyOnceWith(
    JSON.stringify({ code: 'dispatch_wakeup_unavailable', ...expected }),
  );
  expect(warn.mock.calls.flat().join(' ')).not.toContain('private');
});
