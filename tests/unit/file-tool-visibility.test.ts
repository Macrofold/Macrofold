import { expect, it } from 'vitest';
import { fileAccess } from '../../packages/contracts/permissions';
import {
  permissionFileDefinition,
  permissionFileTools,
  worktreeInstructions,
} from '../../packages/runtime/src/permission-files';
it.each([{ include: [] }, { exclude: ['**'] }, { include: ['docs/**'], exclude: ['docs/**'] }])(
  'omits denied file tools and filesystem guidance (%j)',
  (rule) => {
    const layers = [{ version: 1 as const, files: { read: rule } }];
    expect(fileAccess(layers)).toEqual({ read: false, write: false });
    expect(permissionFileDefinition(layers)).toBeUndefined();
    expect(worktreeInstructions('/worktree', layers)).toBe('');
    return expect(
      permissionFileTools('/not-accessed', layers)({ action: 'list', path: '.' }),
    ).rejects.toThrow('File permission denied');
  },
);
it('narrows inherited read-only schemas and instructions without weakening per-path checks', () => {
  const layers = [{ version: 1 as const }, { version: 1 as const, files: { write: { include: [] } } }];
  const definition = permissionFileDefinition(layers)!;
  expect(definition.schema.safeParse({ action: 'read', path: 'a' }).success).toBe(true);
  expect(definition.schema.safeParse({ action: 'list', path: '.' }).success).toBe(true);
  expect(definition.schema.safeParse({ action: 'write', path: 'a', content: 'b' }).success).toBe(false);
  expect(worktreeInstructions('/worktree', layers)).toContain('read-only');
  expect(worktreeInstructions('/worktree', layers)).not.toContain('outputs/');
  expect(worktreeInstructions('/worktree', [])).toContain('If outputs/ is writable');
});
