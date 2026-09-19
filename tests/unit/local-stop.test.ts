import { describe, expect, it } from 'vitest';
import { isTestProcess, parseProcesses, serviceKind } from '../../scripts/stop';

describe('local shutdown process selection', () => {
  it('recognizes supported launchers without matching arbitrary Node commands', () => {
    expect(serviceKind('/usr/bin/node --import tsx scripts/worker.ts')).toBe('worker');
    expect(serviceKind('/usr/bin/node /repo/node_modules/next/dist/bin/next dev -p 3210')).toBe('web');
    expect(serviceKind('/usr/bin/node /repo/node_modules/.bin/next start -p 3210')).toBe('web');
    expect(serviceKind('/usr/bin/node /repo/node_modules/.bin/next dev -p 4321')).toBeUndefined();
    expect(serviceKind('rg scripts/worker.ts')).toBeUndefined();
    expect(serviceKind('/usr/bin/node scripts/worker.ts.backup')).toBeUndefined();
  });

  it('protects workers owned by test runners, including launcher ancestors', () => {
    const entries = parseProcesses(
      '10 1 node scripts/test-sdks.ts\n11 10 node tsx\n12 11 node --import tsx scripts/worker.ts\n13 1 node scripts/worker.ts',
    );
    expect(isTestProcess(entries[2], entries)).toBe(true);
    expect(isTestProcess(entries[3], entries)).toBe(false);
    expect(parseProcesses('\ninvalid line\n')).toEqual([]);
  });
});
