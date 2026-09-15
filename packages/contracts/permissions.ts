import path from 'node:path';
import { z } from 'zod';
import type { components } from './api';
export type AgentPermissions = components['schemas']['AgentPermissions'];
export type PermissionPatterns = components['schemas']['PermissionPatterns'];

// Deliberately portable grammar: *, ** and ?. Avoid negation/extglob and absolute
// paths whose meanings differ between native harnesses. Dotfiles match explicitly.
const pattern = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !/[\\\0\[\]{}()!]/.test(value) &&
      !value.split('/').some((part) => !part || part === '.' || part === '..'),
    'Use relative glob patterns (*, **, ?).',
  );
const patterns = z
  .object({ include: z.array(pattern).max(64).optional(), exclude: z.array(pattern).max(64).optional() })
  .strict();
export const agentPermissionsSchema: z.ZodType<AgentPermissions> = z
  .object({
    version: z.literal(1),
    files: z.object({ read: patterns.optional(), write: patterns.optional() }).strict().optional(),
    shell: z.enum(['allow', 'deny']).optional(),
    tools: patterns.optional(),
  })
  .strict();
export const permissionLayersSchema = z.array(agentPermissionsSchema).max(3);
export type PermissionLayers = AgentPermissions[];
export function permissionLayers(...policies: (AgentPermissions | undefined)[]): PermissionLayers {
  return policies
    .filter((policy): policy is AgentPermissions => Boolean(policy))
    .map((policy) => agentPermissionsSchema.parse(policy));
}
function matches(value: string, glob: string) {
  // Prefixing each segment prevents Node's default hidden-file exclusion from
  // making an explicit deny like **/*.env accidentally omit .private.env.
  const visible = (input: string) =>
    input
      .split('/')
      .map((s) => (s === '**' ? s : `x${s}`))
      .join('/');
  return path.posix.matchesGlob(visible(value), visible(glob));
}
function allows(rule: PermissionPatterns | undefined, value: string) {
  return (
    (!rule?.include || rule.include.some((glob) => matches(value, glob))) &&
    !rule?.exclude?.some((glob) => matches(value, glob))
  );
}
export function fileAllowed(layers: PermissionLayers, action: 'read' | 'write', file: string) {
  if (
    !file ||
    file.startsWith('/') ||
    /[\\\0]/.test(file) ||
    file
      .split('/')
      .some((p) => !p || p === '.' || p === '..' || ['.git', '.agent', '.platform-runtime'].includes(p))
  )
    return false;
  return (
    layers.every((policy) => allows(policy.files?.[action], file)) &&
    (action !== 'write' || layers.every((policy) => allows(policy.files?.read, file)))
  );
}
export function toolAllowed(layers: PermissionLayers, name: string) {
  return layers.every((policy) => allows(policy.tools, name));
}
function restricted(rule?: PermissionPatterns) {
  return Boolean(rule && (rule.include !== undefined || rule.exclude?.length));
}
export function filesRestricted(layers: PermissionLayers) {
  return layers.some((policy) => restricted(policy.files?.read) || restricted(policy.files?.write));
}
export function shellAllowed(layers: PermissionLayers) {
  return !filesRestricted(layers) && !layers.some((policy) => policy.shell === 'deny');
}
export function guardedToolsRequired(layers: PermissionLayers) {
  return filesRestricted(layers) || !shellAllowed(layers);
}
