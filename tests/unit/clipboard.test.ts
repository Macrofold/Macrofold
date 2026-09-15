import { afterEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { copyText } from '../../apps/web/lib/clipboard';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('reports success only after the clipboard accepts the text', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  await expect(copyText('one-time fixture secret')).resolves.toBe(true);
  expect(writeText).toHaveBeenCalledWith('one-time fixture secret');
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

it.each([undefined, { writeText: vi.fn().mockRejectedValue(new Error('Permission denied')) }])(
  'handles unavailable or denied clipboard access without a false success',
  async (clipboard) => {
    vi.stubGlobal('navigator', { clipboard });
    await expect(copyText('fixture secret')).resolves.toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  },
);

it('does not report acceptance while the browser write is pending', async () => {
  let accept = () => {};
  const write = new Promise<void>((resolve) => {
    accept = resolve;
  });
  vi.stubGlobal('navigator', { clipboard: { writeText: () => write } });
  const result = vi.fn();
  const pending = copyText('fixture prompt').then(result);
  await Promise.resolve();
  expect(result).not.toHaveBeenCalled();
  accept();
  await pending;
  expect(result).toHaveBeenCalledWith(true);
  expect(toast.success).not.toHaveBeenCalled();
});

it('writes again for identical text and reports a later rejection independently', async () => {
  const writeText = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('Clipboard permission revoked'));
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  await expect(copyText('same prompt')).resolves.toBe(true);
  await expect(copyText('same prompt')).resolves.toBe(true);
  await expect(copyText('same prompt')).resolves.toBe(false);
  expect(writeText.mock.calls).toEqual([['same prompt'], ['same prompt'], ['same prompt']]);
});
