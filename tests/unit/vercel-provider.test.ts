import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { APIError, Sandbox } from '@vercel/sandbox';
vi.mock('../../packages/core/src/config', () => ({
  config: { allowPaid: true, origin: 'https://fixture.example.test' },
  isLocal: () => false,
}));
import { VercelMachines } from '../../packages/providers/src/vercel';
const createdAt = new Date('2026-09-06T00:00:00Z');
const sandbox = {
  currentSession: () => ({ status: 'running', sessionId: 'fixture-session', createdAt }),
} as unknown as Awaited<ReturnType<typeof Sandbox.create>>;
beforeEach(() => {
  vi.stubEnv('RUNTIME_IMAGE', 'fixture@sha256:' + '0'.repeat(64));
  // Every SDK network entrypoint used by these cases is replaced before invoking the adapter.
  vi.spyOn(Sandbox, 'get').mockRejectedValue(new Error('Unexpected fixture lookup'));
  vi.spyOn(Sandbox, 'create').mockRejectedValue(new Error('Unexpected fixture creation'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('creates a named sandbox after an actual SDK APIError with HTTP 404', async () => {
  vi.mocked(Sandbox.get).mockRejectedValueOnce(new APIError(new Response(null, { status: 404 })));
  vi.mocked(Sandbox.create).mockResolvedValueOnce(sandbox);
  expect(await new VercelMachines().provision('fixture-run', 300)).toEqual({
    name: 'fixture-run',
    sessionId: 'fixture-session',
    createdAt: createdAt.toISOString(),
  });
  expect(Sandbox.get).toHaveBeenCalledWith({ name: 'fixture-run', resume: false });
  expect(Sandbox.create).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'fixture-run', persistent: true }),
  );
});

it.each([403, 429, 500])('does not create on an ambiguous or rejected HTTP %i lookup', async (status) => {
  vi.mocked(Sandbox.get).mockRejectedValueOnce(new APIError(new Response(null, { status })));
  await expect(new VercelMachines().provision('fixture-run', 300)).rejects.toMatchObject({
    code: 'sandbox_lookup_failed',
  });
  expect(Sandbox.create).not.toHaveBeenCalled();
});

it('recovers a lost creation acknowledgement by looking up the same identity without resuming', async () => {
  vi.mocked(Sandbox.get)
    .mockRejectedValueOnce(new APIError(new Response(null, { status: 404 })))
    .mockResolvedValueOnce(sandbox);
  vi.mocked(Sandbox.create).mockRejectedValueOnce(new Error('Response lost after creation'));
  expect((await new VercelMachines().provision('fixture-run', 300)).sessionId).toBe('fixture-session');
  expect(Sandbox.create).toHaveBeenCalledOnce();
  expect(Sandbox.get).toHaveBeenNthCalledWith(2, { name: 'fixture-run', resume: false });
});
