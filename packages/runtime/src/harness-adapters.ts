import type { HarnessAdapter, HarnessName } from './types';

/** Literal imports keep the selected SDK factory inside the measured load.
 * Warm turns retain its adapter; no Run capability is cached in this registry. */
export const harnessAdapters: Record<HarnessName, () => Promise<HarnessAdapter>> = {
  codex: async () => (await import('./codex')).createAdapter(),
  'claude-code': async () => (await import('./claude')).createAdapter(),
  opencode: async () => (await import('./opencode')).createAdapter(),
  hermes: async () => (await import('./hermes')).createAdapter(),
  deepseek: async () => (await import('./deepseek')).createAdapter(),
  pi: async () => (await import('./pi')).createAdapter(),
};
