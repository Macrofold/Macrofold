import { expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ loaded: vi.fn(), constructed: vi.fn(), send: vi.fn() }));
vi.mock('@aws-sdk/client-s3', () => {
  sdk.loaded();
  return {
    S3Client: class {
      constructor() {
        sdk.constructed();
      }
      send = sdk.send;
    },
    DeleteObjectCommand: class {
      constructor(readonly input: unknown) {}
    },
  };
});

it('keeps object SDK initialization off unrelated paths and shares concurrent first-use clients', async () => {
  const { LocalStore, R2Store } = await import('../../packages/providers/src/storage');
  new LocalStore();
  const store = new R2Store(undefined, 'synthetic-bucket');
  expect(sdk.loaded).not.toHaveBeenCalled();
  expect(sdk.constructed).not.toHaveBeenCalled();

  await Promise.all([store.delete('synthetic/one'), store.delete('synthetic/two')]);
  expect(sdk.loaded).toHaveBeenCalledOnce();
  expect(sdk.constructed).toHaveBeenCalledOnce();
  expect(sdk.send).toHaveBeenCalledTimes(2);
  expect(sdk.send.mock.calls.map(([command]) => command.input)).toEqual([
    { Bucket: 'synthetic-bucket', Key: 'synthetic/one' },
    { Bucket: 'synthetic-bucket', Key: 'synthetic/two' },
  ]);
});
