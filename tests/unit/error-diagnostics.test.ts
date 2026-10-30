import { expect, it } from 'vitest';
import { DatabaseError } from 'pg';
import { DatabaseBudgetError, TransactionCommitUnknownError } from '../../packages/db/budget';
import { errorDiagnostics } from '../../packages/core/src/error-diagnostics';

it.each(['acquire', 'statement'] as const)('identifies the database %s budget without messages', (phase) => {
  const error = new DatabaseBudgetError(phase, new Error('private content'));
  expect(errorDiagnostics(error)).toEqual({ error_type: 'DatabaseBudgetError', database_phase: phase });
});

it('preserves a PostgreSQL statement timeout through its budget wrapper', () => {
  const cause = Object.assign(new DatabaseError('private query and parameter', 0, 'error'), {
    code: '57014',
    detail: 'private detail',
  });
  expect(errorDiagnostics(new DatabaseBudgetError('statement', cause))).toEqual({
    error_type: 'DatabaseBudgetError',
    database_phase: 'statement',
    sqlstate: '57014',
  });
});

it('identifies a read-only transaction commit error and underlying PostgreSQL classification', () => {
  const cause = Object.assign(new DatabaseError('private connection information', 0, 'error'), {
    code: '08006',
  });
  expect(
    errorDiagnostics(new TransactionCommitUnknownError(new DatabaseBudgetError('statement', cause))),
  ).toEqual({
    error_type: 'TransactionCommitUnknownError',
    database_phase: 'commit',
    sqlstate: '08006',
  });
});

it.each([new TypeError('private input'), { message: 'private input' }, 'private input'])(
  'classifies unexpected errors without copying their content',
  (error) => {
    expect(errorDiagnostics(error)).toEqual({
      error_type: error instanceof TypeError ? 'TypeError' : 'Error',
    });
  },
);
