import { DatabaseError } from 'pg';
import { DatabaseBudgetError, TransactionCommitUnknownError } from '../../db/budget';
import { AppError } from './errors';

/** Content-free dependency diagnostics. Never copy messages, SQL, arbitrary
 * error names or properties from upstream failures into application logs. */
export function errorDiagnostics(error: unknown) {
  if (error instanceof AppError)
    return { error_type: 'AppError', error_code: error.code, error_status: error.status };
  const cause =
    error instanceof DatabaseBudgetError || error instanceof TransactionCommitUnknownError
      ? error.cause
      : error;
  const underlying = cause instanceof DatabaseBudgetError ? cause.cause : cause;
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
    ...(underlying instanceof DatabaseError &&
    typeof underlying.code === 'string' &&
    /^[0-9A-Z]{5}$/.test(underlying.code)
      ? { sqlstate: underlying.code }
      : {}),
  };
}
