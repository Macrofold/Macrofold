import { expect, it } from 'vitest';
import { fileMemory, taskFileSchema } from '../../examples/shared/file-memory';

it('starts empty, supports independent layouts, and makes no reserved-file assumptions', () => {
  const starter = fileMemory({ profile: 'customer/about.md', memories: 'notes', tasks: 'work.json' });
  expect(Object.keys(starter.files)).toEqual(['customer/about.md', 'notes/README.md', 'work.json']);
  expect(taskFileSchema.parse(JSON.parse(starter.files['work.json']))).toEqual({ version: 1, tasks: [] });
  expect(starter.instructions).toContain('customer/about.md');
  expect(fileMemory().paths.profile).toBe('profile.md');
});

it.each(['../other', '/etc', 'notes/../private', '.git/config', 'notes\\secret'])(
  'rejects unsafe path %s',
  (profile) => {
    expect(() => fileMemory({ profile })).toThrow();
  },
);
it('rejects a file occupying the memory directory', () => {
  expect(() => fileMemory({ profile: 'memory' })).toThrow('overlap');
});
