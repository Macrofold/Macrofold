import type { HarnessName } from './harnesses';
import {
  guardedToolsRequired,
  questionsAllowed,
  permissionLayersSchema,
  type PermissionLayers,
} from './permissions';

/** Native settings are an implementation detail. Unsupported translations are
 * errors, never a lossy conversion into a broader permission mode. */
export interface PermissionAdapter {
  /** Native extension surface used to expose the canonical checked file tool. */
  fileTools: 'sdk' | 'dynamic' | 'mcp';
  translate(layers: PermissionLayers): { mode: 'native' | 'guarded'; shell: 'allow' | 'deny' };
}
function adapter(
  fileTools: PermissionAdapter['fileTools'],
  supportsQuestionDenial = false,
): PermissionAdapter {
  return {
    fileTools,
    translate(layers) {
      permissionLayersSchema.parse(layers);
      if (!supportsQuestionDenial && !questionsAllowed(layers))
        throw new Error('Disabling native questions is currently supported only by OpenCode.');
      const guarded = guardedToolsRequired(layers);
      return { mode: guarded ? 'guarded' : 'native', shell: guarded ? 'deny' : 'allow' };
    },
  };
}
export const permissionAdapters: Record<HarnessName, PermissionAdapter> = {
  'claude-code': adapter('sdk'),
  pi: adapter('sdk'),
  codex: adapter('dynamic'),
  opencode: adapter('mcp', true),
  hermes: adapter('mcp'),
  deepseek: adapter('mcp'),
};
