import { it, expect, vi } from 'vitest';
vi.mock('@platform/core/auth', () => ({ auth: {} }));
vi.mock('@platform/core/config', () => ({ assertSecurityConfiguration: () => {} }));
vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: () => ({
    GET: async () => {
      throw new Error('private upstream detail');
    },
    POST: async () => {
      throw new Error('private upstream detail');
    },
  }),
}));
import { GET, POST } from '../../apps/web/app/auth/[...all]/route';

it('normalizes asynchronous authentication failures without exposing upstream details', async () => {
  for (const [method, handler] of [
    ['GET', GET],
    ['POST', POST],
  ] as const) {
    const response = await handler(new Request('https://agents.example.test/auth/example', { method }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe('internal_error');
    expect(body.error.request_id).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain('private upstream detail');
  }
});
