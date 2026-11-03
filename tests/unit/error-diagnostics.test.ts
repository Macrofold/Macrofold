import { expect, it } from 'vitest';
import { DatabaseError } from 'pg';
import { DatabaseBudgetError, TransactionCommitUnknownError } from '../../packages/db/budget';
import { errorDiagnostics } from '../../packages/core/src/error-diagnostics';
import { AppError } from '../../packages/core/src/errors';

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

it('preserves classified application errors without inspecting their private details', () => {
  expect(
    errorDiagnostics(new AppError(503, 'unavailable', 'private message', { secret: 'private' })),
  ).toEqual({ error_type: 'AppError', error_code: 'unavailable', error_status: 503 });
});

it.each([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
])('reports the safe network classification %s without private connection details', (code) => {
  const error = Object.assign(new Error('private connection URL'), {
    code,
    address: 'private host',
    port: 1234,
    query: 'private SQL',
  });
  expect(errorDiagnostics(error)).toEqual({ error_type: 'Error', network_code: code });
});

it('finds safe causes in aggregate connection errors through database wrappers', () => {
  const error = new AggregateError(
    [
      Object.assign(new Error('private IPv6 address'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('private IPv4 address'), { code: 'ECONNREFUSED' }),
    ],
    'private host',
  );
  expect(
    errorDiagnostics(new TransactionCommitUnknownError(new DatabaseBudgetError('statement', error))),
  ).toEqual({
    error_type: 'TransactionCommitUnknownError',
    database_phase: 'commit',
    network_code: 'ECONNREFUSED',
  });
});

it('bounds cycles and aggregate traversal and rejects arbitrary diagnostic properties', () => {
  const cycle = Object.assign(new Error('private'), { code: 'private custom code' });
  cycle.cause = cycle;
  expect(errorDiagnostics(cycle)).toEqual({ error_type: 'Error' });
  expect(errorDiagnostics({ code: 'ECONNREFUSED', cause: new Error('private') })).toEqual({
    error_type: 'Error',
  });
  const nested = Object.assign(new Error('private'), { code: 'ECONNRESET' });
  expect(
    errorDiagnostics(new AggregateError([...Array.from({ length: 8 }, () => new Error('private')), nested])),
  ).toEqual({ error_type: 'Error' });
  expect(errorDiagnostics(Object.assign(new DatabaseError('private', 0, 'error'), { code: 12345 }))).toEqual({
    error_type: 'Error',
  });
});
