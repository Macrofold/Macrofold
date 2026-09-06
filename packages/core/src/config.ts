import path from 'node:path';
import { existsSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { AppError } from './errors';

// Next, the worker, and the CLI start in different directories. Share one local store.
let root = process.cwd();
while (!existsSync(path.join(root, 'pnpm-workspace.yaml')) && path.dirname(root) !== root)
  root = path.dirname(root);
loadEnv({ path: path.join(root, '.env'), quiet: true });

export const config = {
  name: process.env.PRODUCT_NAME || 'Platform',
  origin: process.env.APP_ORIGIN || 'http://localhost:3210',
  databaseUrl: process.env.DATABASE_URL || 'postgres://platform_app:local-app-only@127.0.0.1:55432/platform',
  ownerDatabaseUrl:
    process.env.MIGRATION_DATABASE_URL ||
    'postgres://platform_owner:local-development-only@127.0.0.1:55432/platform',
  dataDir: path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || path.join(root, '.data')),
  mode: process.env.PLATFORM_MODE || 'local',
  execution: process.env.EXECUTION_PROVIDER || 'simulator',
  orchestration: process.env.ORCHESTRATION_BACKEND || 'workflow',
  secret: process.env.AUTH_SECRET || 'local-only-change-before-deploy-32-bytes',
  vaultKey: process.env.VAULT_KEY || 'local-vault-only-change-before-deploy',
  allowPaid: process.env.ALLOW_PAID_EXECUTION === 'true',
  operatorEmails: (process.env.OPERATOR_EMAILS || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean),
};
export function isLocal() {
  return (
    config.mode === 'local' &&
    !process.env.VERCEL_ENV &&
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.origin).hostname)
  );
}
export function assertSecurityConfiguration() {
  if (isLocal()) return;
  if (
    !process.env.DATABASE_URL ||
    !process.env.AUTH_SECRET ||
    !process.env.VAULT_KEY ||
    config.secret.length < 32 ||
    config.vaultKey.length < 32 ||
    config.secret.startsWith('local-') ||
    config.vaultKey.startsWith('local-') ||
    !config.origin.startsWith('https://')
  )
    throw new AppError(
      503,
      'deployment_not_configured',
      'The operator must complete the database, public HTTPS origin, and encryption configuration.',
    );
}
export function readinessErrors() {
  if (isLocal()) return [];
  return [
    !process.env.DATABASE_URL && 'DATABASE_URL is required',
    !process.env.AUTH_SECRET && 'AUTH_SECRET is required',
    !process.env.VAULT_KEY && 'VAULT_KEY is required',
    config.secret.length < 32 && 'AUTH_SECRET must be at least 32 characters',
    (config.secret.startsWith('local-') ||
      config.vaultKey.startsWith('local-') ||
      config.vaultKey.length < 32) &&
      'Production requires independent strong auth and vault secrets',
    !config.origin.startsWith('https://') && 'APP_ORIGIN must use HTTPS',
    config.execution !== 'vercel' && 'Production requires isolated Vercel execution',
    !process.env.R2_BUCKET && 'R2_BUCKET is required',
    !process.env.R2_ENDPOINT?.startsWith('https://') && 'R2_ENDPOINT must use HTTPS',
    !process.env.R2_ACCESS_KEY_ID && 'R2_ACCESS_KEY_ID is required',
    !process.env.R2_SECRET_ACCESS_KEY && 'R2_SECRET_ACCESS_KEY is required',
    !process.env.RUNTIME_IMAGE?.match(/@sha256:[a-f0-9]{64}$/) &&
      'RUNTIME_IMAGE must use a ready immutable digest',
    !['workflow', 'poller'].includes(config.orchestration) &&
      'ORCHESTRATION_BACKEND must be workflow or poller',
    config.orchestration === 'workflow' &&
      (process.env.CRON_SECRET || '').length < 32 &&
      'CRON_SECRET must be at least 32 characters',
    config.allowPaid &&
      !process.env.MODEL_CATALOG_JSON &&
      'Configure a reviewed model catalog before enabling execution',
    !process.env.RESEND_API_KEY && 'RESEND_API_KEY is required',
  ].filter((x): x is string => Boolean(x));
}
export function globalRunLimit() {
  const value = Number(process.env.GLOBAL_CONCURRENT_RUN_LIMIT || 50);
  if (!Number.isSafeInteger(value) || value < 1 || value > 10000)
    throw new AppError(
      503,
      'invalid_capacity_configuration',
      'The operator must configure a global run limit between 1 and 10000.',
    );
  return value;
}
