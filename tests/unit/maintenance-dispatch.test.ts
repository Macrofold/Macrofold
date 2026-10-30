import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseError } from 'pg';
import { AppError } from '../../packages/core/src/errors';
import { MaintenanceDispatcher } from '../../packages/core/src/maintenance-dispatch';

afterEach(() => vi.restoreAllMocks());

async function failureLog(error: unknown) {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const dispatcher = new MaintenanceDispatcher([
    {
      name: 'model_deployments',
      run: async () => {
        throw error;
      },
    },
    { name: 'healthy', run: async () => ({ healthy: 1 }) },
  ]);
  expect(await dispatcher.sweep()).toEqual({ model_deployments_failed: 1, healthy: 1 });
  expect(log).toHaveBeenCalledOnce();
  return { line: String(log.mock.calls[0][0]), value: JSON.parse(String(log.mock.calls[0][0])) };
}

it('retains SQLSTATE without logging upstream messages, names, SQL or parameters', async () => {
  const secret = 'private-provider-credential';
  const error = Object.assign(new DatabaseError(secret, 0, 'error'), {
    name: secret,
    code: '23502',
    detail: secret,
    query: secret,
    parameters: [secret],
  });
  const { line, value } = await failureLog(error);
  expect(value).toEqual({
    code: 'maintenance_failed',
    component: 'model_deployments',
    error_type: 'Error',
    sqlstate: '23502',
  });
  expect(line).not.toContain(secret);
});

it('retains trusted domain status and code without logging error details', async () => {
  const secret = 'private-provider-credential';
  const { line, value } = await failureLog(
    new AppError(503, 'deployment_provider_unavailable', secret, { authorization: secret }),
  );
  expect(value).toEqual({
    code: 'maintenance_failed',
    component: 'model_deployments',
    error_type: 'AppError',
    error_code: 'deployment_provider_unavailable',
    error_status: 503,
  });
  expect(line).not.toContain(secret);
});

it.each(['abcde', '23502 secret', '23502\nsecret', 23502, null, 'EPERM', '23502'])(
  'rejects non-SQLSTATE diagnostic codes: %s',
  async (code) => {
    const { value } = await failureLog(Object.assign(new Error('private'), { code }));
    expect(value).toEqual({
      code: 'maintenance_failed',
      component: 'model_deployments',
      error_type: 'Error',
    });
  },
);
