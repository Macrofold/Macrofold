import { expect, it } from 'vitest';
import { FairAdmissionQueue } from '../../packages/core/src/admission-queue';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

it('alternates waiting execution-class heads while preserving FIFO within each class', async () => {
  const queue = new FairAdmissionQueue(),
    first = barrier(),
    entered: string[] = [];
  const one = queue.run('inference', async () => {
    entered.push('inference-one');
    await first.promise;
    return 1;
  });
  const two = queue.run('inference', async () => {
    entered.push('inference-two');
    return 2;
  });
  const nativeOne = queue.run('native', async () => {
    entered.push('native-one');
    return 3;
  });
  const nativeTwo = queue.run('native', async () => {
    entered.push('native-two');
    return 4;
  });
  expect(entered).toEqual(['inference-one']);
  first.release();
  expect(await Promise.all([one, two, nativeOne, nativeTwo])).toEqual([1, 2, 3, 4]);
  expect(entered).toEqual(['inference-one', 'native-one', 'inference-two', 'native-two']);
});

it('continues after a failed admission and does not wait for returned execution work', async () => {
  const queue = new FairAdmissionQueue(),
    admission = barrier(),
    execution = barrier();
  const failed = queue.run('inference', async () => {
    await admission.promise;
    throw new Error('Synthetic admission rejection');
  });
  const rejection = expect(failed).rejects.toThrow('Synthetic admission rejection');
  const accepted = queue.run('native', async () => ({ completion: execution.promise }));
  admission.release();
  await rejection;
  const result = await accepted;
  expect(await queue.run('inference', async () => 'next admission')).toBe('next admission');
  execution.release();
  await result.completion;
});
