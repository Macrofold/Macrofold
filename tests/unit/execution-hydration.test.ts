import { afterEach, expect, it, vi } from 'vitest';
import { seal, sha256 } from '../../packages/core/src/crypto';
import { stageRestoreObjects, type RestoreObject } from '../../packages/core/src/execution-hydration';
import { storage } from '../../packages/providers/src/storage';
import { FaultMachine } from '../fixtures/cloud-machine';

const machine = { name: 'fixture', sessionId: 'original', createdAt: '2026-09-19T00:00:00Z' };
function chunk(content: Buffer, key = sha256(content)): RestoreObject {
  return {
    id: key,
    name: sha256(content),
    kind: 'input_chunk',
    data: { key, sha256: sha256(content), size: content.length },
  };
}
afterEach(() => vi.restoreAllMocks());

it('stages small files and manifest pages in bounded batches with exact verified bytes', async () => {
  const provider = new FaultMachine();
  const bytes = Array.from({ length: 33 }, (_, i) => Buffer.from(`file-${i}`));
  const objects = bytes.map((b, i) => chunk(b, String(i)));
  objects.push({ id: 'page', kind: 'input_page', name: '0', data: { entries: [] } });
  vi.spyOn(storage, 'get').mockImplementation(async (key) =>
    Buffer.from(seal({ bytes: bytes[Number(key)].toString('base64') })),
  );
  const stage = vi.spyOn(provider, 'stage');
  const first = await stageRestoreObjects(provider, machine, objects);
  expect(first).toEqual(objects.slice(0, 32));
  expect(stage).toHaveBeenCalledTimes(1);
  expect(stage.mock.calls[0][1]).toHaveLength(32);
  const second = await stageRestoreObjects(provider, machine, objects.slice(first.length));
  expect(second).toEqual(objects.slice(32));
  expect(stage).toHaveBeenCalledTimes(2);
  for (const content of bytes)
    expect(provider.stageFiles.get(`/platform-control/restore/chunks/${sha256(content)}`)).toEqual(content);
  expect(provider.stageFiles.get('/platform-control/restore/page-0.json')).toEqual(Buffer.from('[]'));
});

it('caps decoded batch bytes at four MiB including a full-size checkpoint chunk', async () => {
  const provider = new FaultMachine();
  const full = Buffer.alloc(4 * 1024 ** 2, 1),
    small = Buffer.from('next');
  const objects = [chunk(full, 'full'), chunk(small, 'small')];
  const read = vi
    .spyOn(storage, 'get')
    .mockResolvedValue(Buffer.from(seal({ bytes: full.toString('base64') })));
  const stage = vi.spyOn(provider, 'stage');
  expect(await stageRestoreObjects(provider, machine, objects)).toEqual([objects[0]]);
  expect(read).toHaveBeenCalledExactlyOnceWith('full');
  expect(stage.mock.calls[0][1]).toEqual([
    { path: `/platform-control/restore/chunks/${sha256(full)}`, content: full },
  ]);
});

it('does not call the provider for an empty batch', async () => {
  const provider = new FaultMachine(),
    stage = vi.spyOn(provider, 'stage');
  expect(await stageRestoreObjects(provider, machine, [])).toEqual([]);
  expect(stage).not.toHaveBeenCalled();
});

it.each([-1, NaN, 0.5, 4 * 1024 ** 2 + 1])('rejects invalid object size %s before fetching', async (size) => {
  const provider = new FaultMachine(),
    read = vi.spyOn(storage, 'get'),
    stage = vi.spyOn(provider, 'stage');
  const item = chunk(Buffer.from('fixture'));
  if (item.kind !== 'input_chunk') throw new Error('Expected chunk');
  item.data.size = size;
  await expect(stageRestoreObjects(provider, machine, [item])).rejects.toMatchObject({
    code: 'restore_failed',
  });
  expect(read).not.toHaveBeenCalled();
  expect(stage).not.toHaveBeenCalled();
});

it.each(['hash', 'size'])('rejects a corrupt %s without uploading or advancing progress', async (fault) => {
  const content = Buffer.from('fixture'),
    item = chunk(content);
  if (item.kind !== 'input_chunk') throw new Error('Expected chunk');
  if (fault === 'hash') item.data.sha256 = '0'.repeat(64);
  else item.data.size++;
  vi.spyOn(storage, 'get').mockResolvedValue(Buffer.from(seal({ bytes: content.toString('base64') })));
  const provider = new FaultMachine(),
    stage = vi.spyOn(provider, 'stage');
  await expect(stageRestoreObjects(provider, machine, [item])).rejects.toThrow();
  expect(stage).not.toHaveBeenCalled();
});

it('limits reads to four and drains outstanding reads before reporting a failure', async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const content = Buffer.from('fixture'),
    objects = Array.from({ length: 8 }, (_, i) => chunk(content, String(i)));
  let active = 0,
    peak = 0;
  const read = vi.spyOn(storage, 'get').mockImplementation(async (key) => {
    active++;
    peak = Math.max(peak, active);
    try {
      if (key === '0') throw new Error('Unavailable object');
      await gate;
      return Buffer.from(seal({ bytes: content.toString('base64') }));
    } finally {
      active--;
    }
  });
  const provider = new FaultMachine(),
    stage = vi.spyOn(provider, 'stage');
  let settled = false;
  const result = stageRestoreObjects(provider, machine, objects).finally(() => {
    settled = true;
  });
  const rejected = expect(result).rejects.toThrow('Unavailable object');
  try {
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(4));
    expect(active).toBe(3);
    expect(settled).toBe(false);
  } finally {
    release();
  }
  await rejected;
  expect(active).toBe(0);
  expect(peak).toBeLessThanOrEqual(4);
  expect(read).toHaveBeenCalledTimes(4);
  expect(stage).not.toHaveBeenCalled();
});
