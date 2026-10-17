import { afterEach, expect, it, vi } from 'vitest';
import { hostHttpControl } from '../../packages/providers/src/host-http';
const binding = { name: 'fixture', sessionId: 'fixture', createdAt: '', controlBootId: 'fixture-boot' };
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('caps both request and response bytes without following redirects or exposing response errors', async () => {
  const request = vi.fn<typeof fetch>(async () => Response.json({ value: 'ready' }));
  const call = (operation: Parameters<typeof hostHttpControl>[4]) =>
    hostHttpControl(request, 'http://127.0.0.1:49152', binding, 'fixture-secret', operation);
  await expect(call({ action: 'health' })).resolves.toBe('ready');
  expect(request.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  request.mockClear();
  await expect(
    call({
      action: 'stage',
      run_id: 'fixture',
      assignment_id: 'fixture',
      files: [{ path: 'chunks/fixture', content: 'x'.repeat(8 * 1024 * 1024) }],
    }),
  ).rejects.toMatchObject({ code: 'stage_too_large' });
  expect(request).not.toHaveBeenCalled();
  request.mockResolvedValueOnce(new Response('x'.repeat(8 * 1024 * 1024 + 1)));
  await expect(call({ action: 'health' })).rejects.toMatchObject({ code: 'body_too_large' });
  request.mockResolvedValueOnce(new Response('private error text', { status: 401 }));
  await expect(call({ action: 'health' })).rejects.toMatchObject({ code: 'host_control_failed' });
  request.mockResolvedValueOnce(new Response('invalid json'));
  await expect(call({ action: 'health' })).rejects.toMatchObject({ code: 'upstream_invalid_json' });
});

it('includes response reading in the health deadline and cancels a stalled body', async () => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('fixture deadline')), milliseconds);
    return controller.signal;
  });
  const cancelled = vi.fn();
  const request = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ cancel: cancelled })));
  const result = hostHttpControl(request, 'http://127.0.0.1:49152', binding, 'fixture-secret', {
    action: 'health',
  });
  const assertion = expect(result).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(5000);
  await assertion;
  expect(cancelled).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
