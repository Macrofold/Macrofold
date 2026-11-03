import pg, { DatabaseError } from 'pg';
import { DatabaseBudgetError, TransactionCommitUnknownError } from './budget';

const networkCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
]);

/** Content-free dependency diagnostics. Messages, SQL, addresses and arbitrary
 * error properties never belong in application logs. Bound nested causes too. */
export function dependencyErrorDiagnostics(error: unknown) {
  const pending: unknown[] = [error];
  const seen = new Set<Error>();
  let sqlstate: string | undefined, networkCode: string | undefined;
  for (let index = 0; index < pending.length && index < 8; index++) {
    const current = pending[index];
    if (!(current instanceof Error) || seen.has(current)) continue;
    seen.add(current);
    if (
      current instanceof DatabaseError &&
      typeof current.code === 'string' &&
      /^[0-9A-Z]{5}$/.test(current.code)
    )
      sqlstate ??= current.code;
    if ('code' in current && typeof current.code === 'string' && networkCodes.has(current.code))
      networkCode ??= current.code;
    if (current.cause instanceof Error && pending.length < 8) pending.push(current.cause);
    if (current instanceof AggregateError && Array.isArray(current.errors))
      pending.push(...current.errors.slice(0, 8 - pending.length));
  }
  return {
    error_type:
      error instanceof DatabaseBudgetError
        ? 'DatabaseBudgetError'
        : error instanceof TransactionCommitUnknownError
          ? 'TransactionCommitUnknownError'
          : error instanceof TypeError
            ? 'TypeError'
            : 'Error',
    ...(error instanceof DatabaseBudgetError
      ? { database_phase: error.phase }
      : error instanceof TransactionCommitUnknownError
        ? { database_phase: 'commit' }
        : {}),
    ...(sqlstate ? { sqlstate } : {}),
    ...(networkCode ? { network_code: networkCode } : {}),
  };
}

const globals = globalThis as typeof globalThis & { observedDatabasePools?: WeakSet<pg.Pool> };
const observedPools = (globals.observedDatabasePools ||= new WeakSet<pg.Pool>());

/** pg removes an idle broken client before emitting this pool-level error.
 * Own that event so reconnectable socket loss cannot terminate the process. */
export function observePoolErrors(pool: pg.Pool, name: 'domain' | 'identity' | 'credential') {
  if (observedPools.has(pool)) return;
  observedPools.add(pool);
  pool.on('error', (error) =>
    console.warn(
      JSON.stringify({ code: 'database_pool_unavailable', pool: name, ...dependencyErrorDiagnostics(error) }),
    ),
  );
}
