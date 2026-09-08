import { lock, type Tx } from '../../db';
import { type Principal, requireProject, requireScopes } from './auth';
import { actorAuthorized } from './actor-authorization';
import { AppError, assert } from './errors';
import { id, seal, sha256, token, unseal } from './crypto';
import { config } from './config';
import * as resources from './resources';
import { nextOccurrence } from './trigger-policy';
import { SlackClient, SlackError } from '../../providers/src/slack';

async function slackSetup<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (e) {
    if (e instanceof SlackError)
      throw new AppError(
        502,
        `slack_${e.code}`,
        `Slack could not complete this request (${e.code}). Check the bot token, scopes and channel membership, then retry.`,
      );
    throw e;
  }
}

export type TriggerInput = {
  name: string;
  project_id: string;
  agent_id: string;
  kind: 'slack' | 'webhook' | 'schedule';
  prompt: string;
  enabled?: boolean;
  max_runs_per_day?: number;
  cron?: string;
  timezone?: string;
  slack_connection_id?: string;
  channel_id?: string;
};
export type TriggerActor = Pick<Principal, 'id' | 'userId' | 'kind' | 'oauthTokenId' | 'projectIds'>;
export type TriggerRow = {
  id: string;
  organization_id: string;
  project_id: string;
  agent_id: string;
  kind: TriggerInput['kind'];
  name: string;
  prompt: string;
  enabled: boolean;
  max_runs_per_day: number;
  actor: TriggerActor;
  settings: { cron?: string; timezone?: string };
  slack_connection_id: string | null;
  channel_id: string | null;
  secret_hash: string | null;
  next_fire_at: Date | null;
  revision: number;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  last_error_code: string | null;
  last_fired_at: Date | null;
};
export type SlackConnectionRow = {
  id: string;
  organization_id: string;
  owner_user_id: string;
  name: string;
  team_id: string;
  bot_user_id: string;
  secret_ciphertext: string;
  revoked_at: Date | null;
  created_at: Date;
};
export type SlackSecrets = { bot_token: string; signing_secret: string };

export function presentTrigger(t: TriggerRow) {
  return {
    id: t.id,
    name: t.name,
    project_id: t.project_id,
    agent_id: t.agent_id,
    kind: t.kind,
    prompt: t.prompt,
    enabled: t.enabled,
    max_runs_per_day: t.max_runs_per_day,
    cron: t.settings.cron,
    timezone: t.settings.timezone,
    slack_connection_id: t.slack_connection_id,
    channel_id: t.channel_id,
    next_fire_at: t.next_fire_at?.toISOString() || null,
    last_error_code: t.last_error_code,
    last_fired_at: t.last_fired_at?.toISOString() || null,
    webhook_url: t.kind === 'webhook' ? `${config.origin}/events/webhook/${t.id}` : null,
    created_at: t.created_at.toISOString(),
    updated_at: t.updated_at.toISOString(),
  };
}
async function findTrigger(tx: Tx, p: Principal, triggerId: string) {
  const t = (
    await tx.query<TriggerRow>('SELECT * FROM triggers WHERE id=$1 AND deleted_at IS NULL', [triggerId])
  ).rows[0];
  assert(t, 404, 'not_found', 'Trigger not found.');
  requireProject(p, t.project_id);
  return t;
}
export async function getTrigger(tx: Tx, p: Principal, triggerId: string, write = false) {
  requireScopes(p, [write ? 'triggers:write' : 'triggers:read']);
  const t = await findTrigger(tx, p, triggerId);
  if (write)
    assert(
      t.actor.userId === p.userId,
      403,
      'trigger_owner_required',
      'Only the creator can change this trigger.',
    );
  return t;
}
export async function triggerPrincipal(tx: Tx, t: TriggerRow): Promise<Principal | undefined> {
  const a = t.actor;
  if (
    !(await actorAuthorized(tx, {
      organization_id: t.organization_id,
      project_id: t.project_id,
      config: {
        user_id: a.userId!,
        principal_id: a.id,
        principal_kind: a.kind,
        oauth_token_id: a.oauthTokenId,
      },
    }))
  )
    return;
  // A recurring trigger is new admission, not continuation of an already admitted OAuth run.
  if (
    a.oauthTokenId &&
    !(
      await tx.query('SELECT 1 FROM auth."oauthAccessToken" WHERE id=$1 AND "expiresAt">now()', [
        a.oauthTokenId,
      ])
    ).rowCount
  )
    return;
  const role = (
    await tx.query('SELECT role FROM memberships WHERE organization_id=$1 AND user_id=$2', [
      t.organization_id,
      a.userId,
    ])
  ).rows[0]?.role;
  return {
    ...a,
    organizationId: t.organization_id,
    role,
    scopes: ['runs:write', 'projects:read', 'runs:read'],
    operator: false,
  };
}
function connectionManager(p: Principal) {
  requireScopes(p, ['connections:write']);
  assert(
    p.userId && !p.projectIds.length,
    403,
    'forbidden',
    'Use an unrestricted organization credential to manage Slack connections.',
  );
}
export async function slackConnection(tx: Tx, p: Principal, connectionId: string) {
  connectionManager(p);
  const c = (
    await tx.query<SlackConnectionRow>(
      'SELECT * FROM slack_connections WHERE id=$1 AND owner_user_id=$2 AND revoked_at IS NULL',
      [connectionId, p.userId],
    )
  ).rows[0];
  assert(c, 404, 'not_found', 'Slack connection not found.');
  return c;
}
function presentConnection(c: SlackConnectionRow) {
  return {
    id: c.id,
    name: c.name,
    team_id: c.team_id,
    bot_user_id: c.bot_user_id,
    events_url: `${config.origin}/events/slack/${c.id}`,
    created_at: c.created_at.toISOString(),
  };
}
export async function listSlackConnections(tx: Tx, p: Principal) {
  connectionManager(p);
  return {
    data: (
      await tx.query<SlackConnectionRow>(
        'SELECT * FROM slack_connections WHERE owner_user_id=$1 AND revoked_at IS NULL ORDER BY id',
        [p.userId],
      )
    ).rows.map(presentConnection),
    next_cursor: null,
  };
}
export async function saveSlackConnection(
  tx: Tx,
  p: Principal,
  input: SlackSecrets & { name: string },
  provider = new SlackClient(),
) {
  connectionManager(p);
  await lock(tx, `slack-connections:${p.organizationId}`);
  assert(
    Number(
      (await tx.query('SELECT count(*) FROM slack_connections WHERE revoked_at IS NULL')).rows[0].count,
    ) < 20,
    409,
    'connection_limit',
    'An organization can have up to 20 Slack connections.',
  );
  const identity = await slackSetup(() => provider.identity(input.bot_token));
  const connectionId = id();
  const c = (
    await tx.query<SlackConnectionRow>(
      `INSERT INTO slack_connections(id,organization_id,owner_user_id,name,team_id,bot_user_id,secret_ciphertext)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        connectionId,
        p.organizationId,
        p.userId,
        input.name,
        identity.team_id,
        identity.bot_user_id,
        seal({ bot_token: input.bot_token, signing_secret: input.signing_secret }),
      ],
    )
  ).rows[0];
  await tx.query("INSERT INTO trigger_routes VALUES($1,$2,'slack')", [connectionId, p.organizationId]);
  return presentConnection(c);
}
export async function disconnectSlack(tx: Tx, p: Principal, connectionId: string) {
  await slackConnection(tx, p, connectionId);
  await tx.query("UPDATE slack_connections SET revoked_at=now(),secret_ciphertext='' WHERE id=$1", [
    connectionId,
  ]);
  await tx.query('UPDATE triggers SET enabled=false,updated_at=now() WHERE slack_connection_id=$1', [
    connectionId,
  ]);
  await tx.query('DELETE FROM trigger_routes WHERE id=$1 AND organization_id=$2', [
    connectionId,
    p.organizationId,
  ]);
  return { deleted: true };
}
export async function listSlackChannels(
  tx: Tx,
  p: Principal,
  connectionId: string,
  cursor?: string,
  provider = new SlackClient(),
) {
  const c = await slackConnection(tx, p, connectionId);
  return slackSetup(() => provider.channels(unseal<SlackSecrets>(c.secret_ciphertext).bot_token, cursor));
}
export async function saveTrigger(tx: Tx, p: Principal, input: TriggerInput, triggerId?: string) {
  requireScopes(p, ['triggers:write', 'runs:write', 'projects:read', 'runs:read']);
  assert(p.userId, 403, 'forbidden', 'A verified user must own a trigger.');
  if (triggerId) await tx.query('SELECT id FROM triggers WHERE id=$1 FOR UPDATE', [triggerId]);
  const previous = triggerId ? await getTrigger(tx, p, triggerId, true) : undefined;
  assert(
    !previous || previous.project_id === input.project_id,
    400,
    'trigger_project_immutable',
    'Create a new trigger to change its project. Existing delivery history stays with its original project.',
  );
  await resources.get(tx, 'projects', input.project_id, p);
  await resources.get(tx, 'agents', input.agent_id, p);
  assert(
    !previous || previous.kind === input.kind,
    400,
    'trigger_kind_immutable',
    'Create a new trigger to change its integration.',
  );
  const actor: TriggerActor = {
    id: p.id,
    userId: p.userId,
    kind: p.kind,
    oauthTokenId: p.oauthTokenId,
    projectIds: p.projectIds,
  };
  const next = input.kind === 'schedule' ? nextOccurrence(input.cron || '', input.timezone || 'UTC') : null;
  if (input.kind === 'slack') {
    assert(
      input.slack_connection_id && input.channel_id && /^[CG][A-Z0-9]+$/.test(input.channel_id),
      400,
      'invalid_slack_channel',
      'Choose a Slack connection and channel ID.',
    );
    await slackConnection(tx, p, input.slack_connection_id);
  }
  await lock(tx, `triggers:${p.organizationId}`);
  if (!previous)
    assert(
      Number((await tx.query('SELECT count(*) FROM triggers WHERE deleted_at IS NULL')).rows[0].count) < 100,
      409,
      'trigger_limit',
      'An organization can have up to 100 triggers.',
    );
  if (input.kind === 'slack')
    assert(
      !(
        await tx.query(
          'SELECT 1 FROM triggers WHERE slack_connection_id=$1 AND channel_id=$2 AND deleted_at IS NULL AND id<>$3',
          [input.slack_connection_id, input.channel_id, triggerId || id()],
        )
      ).rowCount,
      409,
      'channel_already_connected',
      'This Slack channel already has a trigger.',
    );
  const secret = !previous && input.kind === 'webhook' ? token('trigger') : undefined;
  const t = (
    await tx.query<TriggerRow>(
      `INSERT INTO triggers(id,organization_id,project_id,agent_id,kind,name,prompt,enabled,actor,settings,secret_hash,slack_connection_id,channel_id,next_fire_at,max_runs_per_day)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,agent_id=excluded.agent_id,name=excluded.name,prompt=excluded.prompt,enabled=excluded.enabled,
      actor=excluded.actor,settings=excluded.settings,slack_connection_id=excluded.slack_connection_id,channel_id=excluded.channel_id,
      next_fire_at=excluded.next_fire_at,max_runs_per_day=excluded.max_runs_per_day,revision=triggers.revision+1,updated_at=now() RETURNING *`,
      [
        triggerId || id(),
        p.organizationId,
        input.project_id,
        input.agent_id,
        input.kind,
        input.name,
        input.prompt,
        input.enabled ?? true,
        JSON.stringify(actor),
        JSON.stringify(
          input.kind === 'schedule' ? { cron: input.cron, timezone: input.timezone || 'UTC' } : {},
        ),
        secret ? sha256(secret) : null,
        input.kind === 'slack' ? input.slack_connection_id : null,
        input.kind === 'slack' ? input.channel_id : null,
        next,
        input.max_runs_per_day ?? 100,
      ],
    )
  ).rows[0];
  if (secret) await tx.query("INSERT INTO trigger_routes VALUES($1,$2,'webhook')", [t.id, p.organizationId]);
  if (t.kind === 'schedule')
    await tx.query(
      `INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id,available_at,state)
    VALUES($1,$2,'trigger_schedule',$3,$4,$5) ON CONFLICT(kind,resource_id) DO UPDATE SET available_at=excluded.available_at,state=excluded.state`,
      [id(), p.organizationId, t.id, next, t.enabled ? 'pending' : 'done'],
    );
  return { ...presentTrigger(t), ...(secret ? { webhook_secret: secret } : {}) };
}
export async function patchTrigger(
  tx: Tx,
  p: Principal,
  triggerId: string,
  patch: Partial<Omit<TriggerInput, 'kind'>>,
) {
  requireScopes(p, ['triggers:write']);
  await tx.query('SELECT id FROM triggers WHERE id=$1 FOR UPDATE', [triggerId]);
  const t = await findTrigger(tx, p, triggerId);
  // Administrators may stop another member's automation without assuming that member's authority.
  if (Object.keys(patch).length === 1 && patch.enabled === false && ['owner', 'admin'].includes(p.role)) {
    return presentTrigger(
      (
        await tx.query<TriggerRow>(
          'UPDATE triggers SET enabled=false,updated_at=now() WHERE id=$1 RETURNING *',
          [triggerId],
        )
      ).rows[0],
    );
  }
  return saveTrigger(
    tx,
    p,
    {
      ...presentTrigger(t),
      slack_connection_id: t.slack_connection_id || undefined,
      channel_id: t.channel_id || undefined,
      ...patch,
    },
    triggerId,
  );
}
export async function deleteTrigger(tx: Tx, p: Principal, triggerId: string) {
  requireScopes(p, ['triggers:write']);
  const t = await findTrigger(tx, p, triggerId);
  assert(
    t.actor.userId === p.userId || ['owner', 'admin'].includes(p.role),
    403,
    'trigger_owner_required',
    'Only the creator or an administrator can delete this trigger.',
  );
  await tx.query(
    'UPDATE triggers SET enabled=false,deleted_at=now(),updated_at=now(),secret_hash=NULL WHERE id=$1',
    [triggerId],
  );
  await tx.query('DELETE FROM trigger_routes WHERE id=$1 AND organization_id=$2', [
    triggerId,
    p.organizationId,
  ]);
  return { deleted: true };
}
export async function rotateTriggerSecret(tx: Tx, p: Principal, triggerId: string) {
  const t = await getTrigger(tx, p, triggerId, true);
  assert(t.kind === 'webhook', 400, 'invalid_trigger_kind', 'Only webhook triggers have an incoming secret.');
  const secret = token('trigger');
  await tx.query('UPDATE triggers SET secret_hash=$2,updated_at=now() WHERE id=$1', [
    triggerId,
    sha256(secret),
  ]);
  return { webhook_secret: secret };
}
export async function listTriggers(tx: Tx, p: Principal, query: URLSearchParams) {
  requireScopes(p, ['triggers:read']);
  const limit = Math.min(100, Number(query.get('limit')) || 25);
  const rows = (
    await tx.query<TriggerRow>(
      `SELECT * FROM triggers WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR id<$1)
    AND ($2::text IS NULL OR kind=$2) AND (cardinality($3::uuid[])=0 OR project_id=ANY($3)) ORDER BY id DESC LIMIT $4`,
      [query.get('cursor'), query.get('kind'), p.projectIds, limit + 1],
    )
  ).rows;
  return {
    data: rows.slice(0, limit).map(presentTrigger),
    next_cursor: rows.length > limit ? rows[limit - 1].id : null,
  };
}
