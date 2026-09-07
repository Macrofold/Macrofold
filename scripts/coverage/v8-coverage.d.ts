// The package is the merger used by Vitest; its CommonJS release omits declarations.
declare module '@bcoe/v8-coverage' {
  import type { Profiler } from 'node:inspector';
  export function mergeScriptCovs(coverages: Profiler.ScriptCoverage[]): Profiler.ScriptCoverage | undefined;
}
