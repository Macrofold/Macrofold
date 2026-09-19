import type contract from '../../../docs/api/openapi.json';

type CustomerScope =
  keyof typeof contract.components.securitySchemes.CustomerOAuth.flows.authorizationCode.scopes;
type KeyScope = Exclude<CustomerScope, 'offline_access'>;
type Preset = 'read-only' | 'read-write' | 'full-access';

// Classify each customer scope explicitly so new API capabilities need a preset
// decision. OAuth refresh authority and operator scopes do not belong on API keys.
export const keyPermissions = {
  'identity:read': { label: 'View identity', preset: 'read-only' },
  'workspaces:read': { label: 'View workspaces and worktrees', preset: 'read-only' },
  'workspaces:write': { label: 'Manage workspaces and worktrees', preset: 'read-write' },
  'files:read': { label: 'Read files and checkpoints', preset: 'read-only' },
  'files:write': { label: 'Edit files, restore checkpoints and sync Git', preset: 'read-write' },
  'runs:read': { label: 'View presets, sessions and runs', preset: 'read-only' },
  'runs:write': { label: 'Manage presets and run agents', preset: 'read-write' },
  'connections:read': { label: 'View connections and tools', preset: 'read-only' },
  'connections:write': { label: 'Manage connections and access rules', preset: 'read-write' },
  'usage:read': { label: 'View usage and billing', preset: 'read-only' },
  'webhooks:read': { label: 'View webhooks', preset: 'read-only' },
  'webhooks:write': { label: 'Manage webhooks and deliveries', preset: 'read-write' },
  'triggers:read': { label: 'View triggers and schedules', preset: 'read-only' },
  'triggers:write': { label: 'Manage triggers and schedules', preset: 'read-write' },
  'organizations:read': { label: 'View team membership', preset: 'read-only' },
  'billing:write': { label: 'Manage billing', preset: 'full-access' },
  'keys:write': { label: 'Manage API keys', preset: 'full-access' },
  'organizations:write': { label: 'Manage teams, roles and invitations', preset: 'full-access' },
  'workspaces:delete': { label: 'Schedule or cancel permanent workspace deletion', preset: 'full-access' },
} satisfies Record<KeyScope, { label: string; preset: Preset }>;

export const keyPermissionPresets = [
  {
    value: 'read-only',
    label: 'Read-only',
    description: 'View data without changing resources or running agents.',
  },
  {
    value: 'read-write',
    label: 'Read & write',
    description:
      'Run agents and manage workspaces, files, connections and automation. Excludes billing, API-key and team administration, and permanent workspace deletion.',
  },
  {
    value: 'full-access',
    label: 'Full access',
    description:
      'All available API permissions, including billing, API-key and team administration, and permanent workspace deletion. Your role and workspace limits still apply.',
  },
  { value: 'custom', label: 'Custom', description: 'Choose exactly which permissions this key needs.' },
] as const;

export type KeyPermissionSelection = { preset: Preset } | { preset: 'custom'; scopes: string[] };

export function availableKeyPermissions(effectiveScopes: readonly string[]) {
  return Object.entries(keyPermissions)
    .filter(([scope]) => effectiveScopes.includes(scope))
    .map(([scope, permission]) => ({ scope, ...permission }));
}

/** Presets are creation shortcuts, not roles or dynamically expanding grants.
 * Submit concrete scopes through the existing server authorization boundary. */
export function resolveKeyPermissions(selection: KeyPermissionSelection, effectiveScopes: readonly string[]) {
  return availableKeyPermissions(effectiveScopes)
    .filter(({ scope, preset }) =>
      selection.preset === 'custom'
        ? selection.scopes.includes(scope)
        : selection.preset === 'full-access' || preset === 'read-only' || preset === selection.preset,
    )
    .map(({ scope }) => scope);
}
