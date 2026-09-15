import type { HarnessName } from './harnesses';
import { guardedToolsRequired, permissionLayersSchema, type PermissionLayers } from './permissions';

/** Native settings are an implementation detail. Unsupported translations are
 * errors, never a lossy conversion into a broader permission mode. */
export interface PermissionAdapter {
  /** Native extension surface used to expose the canonical checked file tool. */
  fileTools: 'sdk' | 'dynamic' | 'mcp';
  translate(layers: PermissionLayers): { mode: 'native' | 'guarded'; shell: 'allow' | 'deny' };
}
function adapter(fileTools: PermissionAdapter['fileTools']): PermissionAdapter {
  return {
    fileTools,
    translate(layers) {
      permissionLayersSchema.parse(layers);
      const guarded = guardedToolsRequired(layers);
      return { mode: guarded ? 'guarded' : 'native', shell: guarded ? 'deny' : 'allow' };
    },
  };
}
export const permissionAdapters: Record<HarnessName, PermissionAdapter> = {
  'claude-code': adapter('sdk'),
  pi: adapter('sdk'),
  codex: adapter('dynamic'),
  opencode: adapter('mcp'),
  hermes: adapter('mcp'),
  deepseek: adapter('mcp'),
};
