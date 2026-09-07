export const thresholds = {
  lines: 48,
  statements: 46,
  branches: 38,
  functions: 38,
  'packages/core/src/runtime-auth.ts': { 100: true },
  'packages/core/src/ledger.ts': { 100: true },
  'packages/core/src/runs.ts': { lines: 95, statements: 94, branches: 90, functions: 92 },
  'packages/core/src/auth.ts': { lines: 86, statements: 84, branches: 59, functions: 78 },
  'packages/core/src/actor-authorization.ts': { 100: true },
  'packages/core/src/plans.ts': { 100: true },
  'packages/core/src/queue-wait.ts': { 100: true },
  'packages/core/src/cloud-engine.ts': { lines: 93, statements: 91, branches: 77, functions: 90 },
  'packages/runtime/src/manifest.ts': { lines: 97, statements: 94, branches: 86, functions: 100 },
  'packages/runtime/src/restore.ts': { lines: 83, statements: 80, branches: 78, functions: 100 },
};

// Supplemental acceptance has a higher measured baseline; the domain gate still runs independently.
export const applicationThresholds = {
  ...thresholds,
  lines: 63,
  statements: 61,
  branches: 48,
  functions: 49,
};

export const combinedThresholds = {
  ...thresholds,
  lines: 65,
  statements: 63,
  branches: 50,
  functions: 51,
};
