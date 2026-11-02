import { expect, it } from 'vitest';
import { integrationGuidance, listIntegrationPacks } from '../../packages/core/src/agent-integrations';
import { fileMemory } from '../../packages/contracts/file-memory';

it('does not add memory instructions to a file-denied Run', () => {
  expect(integrationGuidance([{ version: 1, files: { read: { include: [] } } }], false)).toBeUndefined();
});

it('provides reading guidance without saving instructions for read-only memory', () => {
  const instructions = integrationGuidance([{ version: 1, files: { write: { include: [] } } }], false);
  expect(instructions).toContain('Do not change memory files');
  expect(instructions).not.toContain('You may update');
});

it('omits denied memory filenames rather than encouraging their use', () => {
  const instructions = integrationGuidance(
    [{ version: 1, files: { read: { include: ['tasks.json'] } } }],
    false,
  );
  expect(instructions).toContain('tasks.json');
  expect(instructions).not.toContain('profile.md');
});

it('pauses instruction-driven learning while preserving reading', () => {
  expect(integrationGuidance([], true)).toContain('Do not change memory files');
  expect(integrationGuidance([], false)).toBe(fileMemory().instructions);
});

it('does not advertise pending service packs as active integrations', () => {
  const packs = listIntegrationPacks().data;
  expect(packs.map((pack) => pack.id)).toEqual(['file-memory', 'hindsight', 'claude-mem']);
  expect(packs.filter((pack) => pack.availability === 'available').map((pack) => pack.id)).toEqual([
    'file-memory',
  ]);
});
