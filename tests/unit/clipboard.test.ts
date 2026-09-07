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
  await copyText('one-time fixture secret', 'Key copied');
  expect(writeText).toHaveBeenCalledWith('one-time fixture secret');
  expect(toast.success).toHaveBeenCalledWith('Key copied');
  expect(toast.error).not.toHaveBeenCalled();
});

it.each([undefined, { writeText: vi.fn().mockRejectedValue(new Error('Permission denied')) }])(
  'handles unavailable or denied clipboard access without a false success',
  async (clipboard) => {
    vi.stubGlobal('navigator', { clipboard });
    await expect(copyText('fixture secret')).resolves.toBeUndefined();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Clipboard unavailable. Select and copy the text manually.');
  },
);
