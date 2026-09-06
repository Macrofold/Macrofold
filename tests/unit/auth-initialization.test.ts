import { expect, it, vi } from 'vitest';

const { initialize, backend } = vi.hoisted(() => {
  const handler = vi.fn(async () => Response.json({ handled: true }));
  const backend = {
    handler,
    fetch: handler,
    api: { getSession: vi.fn(async () => null) },
    options: { basePath: '/auth' },
    $context: Promise.resolve({ initialized: true }),
    $ERROR_CODES: { INVALID_TOKEN: 'Invalid token' },
    $Infer: undefined,
  };
  return { backend, initialize: vi.fn(() => backend) };
});
vi.mock('better-auth', () => ({ betterAuth: initialize }));

import { toNextJsHandler } from 'better-auth/next-js';
import { auth, customerScopes, operatorScopes } from '../../packages/core/src/auth';

it('imports scopes and creates framework handlers without initializing auth, then reuses one instance', async () => {
  const handlers = toNextJsHandler(auth);
  expect(customerScopes).toContain('runs:read');
  expect(operatorScopes).toContain('metrics:read');
  expect(initialize).not.toHaveBeenCalled();

  const request = new Request('https://agents.example.test/auth/get-session');
  expect(await (await handlers.GET(request)).json()).toEqual({ handled: true });
  expect(await auth.api.getSession({ headers: request.headers })).toBeNull();
  expect(await (await auth.fetch(request)).json()).toEqual({ handled: true });
  expect(auth.options).toBe(backend.options);
  expect(await auth.$context).toEqual({ initialized: true });
  expect(auth.$ERROR_CODES).toBe(backend.$ERROR_CODES);
  expect(auth.$Infer).toBeUndefined();
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(backend.handler).toHaveBeenCalledTimes(2);
});
