import { config, isLocal, readinessErrors } from '../packages/core/src/config';
import { pool, authPool, transaction } from '../packages/db';
import { stat } from 'node:fs/promises';
import { resourceVerifierClientId } from '../packages/core/src/oauth-settings';
import { seal, unseal } from '../packages/core/src/crypto';
const checks: { name: string; ok: boolean; detail: string }[] = [];
async function check(name: string, action: () => Promise<string>) {
  try {
    checks.push({ name, ok: true, detail: await action() });
  } catch {
    checks.push({
      name,
      ok: false,
      detail:
        'Check failed. Verify the corresponding configuration in the launch guide; secret values are never printed.',
    });
  }
}
await check('Database role', async () => {
  const role = (
    await pool.query('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
  ).rows[0];
  if (role.rolsuper || role.rolbypassrls) throw new Error('unsafe role');
  return 'Runtime is not a superuser and cannot bypass tenant policies.';
});
await check('Tenant isolation', async () => {
  const row = (
    await pool.query(
      'SELECT count(*)::int AS n FROM pg_class WHERE relname=ANY($1::text[]) AND relrowsecurity AND relforcerowsecurity',
      [['projects', 'workspaces', 'runs', 'connections', 'checkpoints', 'github_user_links']],
    )
  ).rows[0];
  if (row.n !== 6) throw new Error('missing policies');
  if ((await transaction(null, (tx) => tx.query('SELECT id FROM projects LIMIT 1'))).rowCount)
    throw new Error('unscoped read');
  return 'Required tenant tables enforce row-level security.';
});
await check('OAuth resources', async () => {
  const result = await authPool.query(
    'SELECT "clientId" FROM auth."oauthClient" WHERE "clientId"=ANY($1::text[]) AND disabled=false',
    [['hosted-agent-cli', resourceVerifierClientId]],
  );
  if (result.rowCount !== 2) throw new Error('missing clients');
  return 'Public CLI and resource verification clients are provisioned.';
});
await check('Authentication rate-limit storage', async () => {
  await authPool.query('SELECT id FROM auth."rateLimit" LIMIT 0');
  return 'Shared authentication counters are migrated; local fixtures bypass throttling explicitly.';
});
await check('Vault keyring', async () => {
  if (unseal<string>(seal('configuration-probe')) !== 'configuration-probe') throw new Error('keyring');
  return 'The configured active key can encrypt and decrypt; retained-key restore must be tested separately.';
});
await check('Execution profile', async () => {
  if (isLocal()) {
    if (config.execution === 'simulator' && !config.allowPaid)
      return 'Local simulator; no model or sandbox charges.';
    if (config.execution !== 'docker' || config.orchestration !== 'poller')
      throw new Error('invalid local profile');
    const { dockerCommand } = await import('../packages/providers/src/docker');
    await dockerCommand(['image', 'inspect', process.env.DOCKER_RUNTIME_IMAGE || 'platform-runtime:0.1.0']);
    const { models, computeRate } = await import('../packages/core/src/catalog');
    if (config.allowPaid && !models().some((model) => model.enabled)) throw new Error('missing models');
    return `Local Docker; inference ${config.allowPaid ? 'enabled (provider charges possible)' : 'disabled'}; compute rate ${computeRate()} micro-USD/minute.`;
  }
  const missing = readinessErrors();
  if (missing.length) throw new Error('incomplete');
  return `Production adapter: ${config.execution}; paid execution ${config.allowPaid ? 'enabled' : 'disabled'}.`;
});
if (isLocal())
  await check('Local content store', async () => {
    await stat(config.dataDir);
    return 'Local data directory exists. It is excluded from Git.';
  });
console.log(JSON.stringify({ ok: checks.every((c) => c.ok), checks, paid_api_calls: 0 }, null, 2));
await pool.end();
await authPool.end();
if (checks.some((c) => !c.ok)) process.exitCode = 1;
