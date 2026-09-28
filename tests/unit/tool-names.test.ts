import { describe, expect, it } from 'vitest';
import { exposedToolName } from '../../packages/core/src/tool-names';

describe('connector tool names', () => {
  it('retains a readable operation and fits native provider prefixes', () => {
    const name = exposedToolName('connection-a', 'ol_authoring_submit');
    expect(name).toMatch(/^c_ol_authoring_submit_[a-f0-9]{24}$/);
    expect(`mcp__platform__${name}`.length).toBeLessThanOrEqual(64);
    expect(exposedToolName('connection-a', 'ol_authoring_submit')).toBe(name);
  });
  it('binds the full connection identity rather than its common UUID prefix', () => {
    expect(exposedToolName('01234567-89ab-7000-aaaa-000000000001', 'save'))
      .not.toBe(exposedToolName('01234567-89ab-7000-bbbb-000000000002', 'save'));
  });
  it('keeps normalized or truncated operation names distinct', () => {
    const names = ['read/file', 'read?file', 'a'.repeat(100) + 'x', 'a'.repeat(100) + 'y', ''];
    const aliases = names.map((name) => exposedToolName('connection', name));
    expect(new Set(aliases).size).toBe(names.length);
    for (const alias of aliases) {
      expect(alias).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(alias.length).toBeLessThanOrEqual(47);
    }
  });
});
