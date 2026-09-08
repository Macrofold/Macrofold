import { pool, transaction, type Tx } from '../../db';
import { AppError } from './errors';
import { actorAuthorized } from './actor-authorization';
import { unseal } from './crypto';
import { config } from './config';
import { admitRun, terminal, type RunRow } from './runs';
import { nextOccurrence } from './trigger-policy';
import { triggerPrincipal, type TriggerRow, type SlackConnectionRow, type SlackSecrets } from './triggers';
import { enqueueTrigger, type TriggerDelivery } from './trigger-deliveries';
import { SlackClient, SlackError } from '../../providers/src/slack';

async function finish(tx: Tx, d: TriggerDelivery, error?: string) {
  if (error)
    await tx.query(
      "UPDATE trigger_deliveries SET status=CASE WHEN run_id IS NULL THEN 'failed' ELSE status END,error_code=$2,reply_state=CASE WHEN reply_state='pending' THEN 'failed' ELSE reply_state END WHERE id=$1",
      [d.id, error],
    );
  await tx.query(
    "UPDATE dispatch_jobs SET state='done',lease_until=NULL WHERE kind='trigger' AND resource_id=$1",
    [d.id],
  );
}
async function later(tx: Tx, deliveryId: string, now: Date, seconds = 30) {
  await tx.query(
    "UPDATE dispatch_jobs SET state='pending',available_at=$2,lease_until=NULL WHERE kind='trigger' AND resource_id=$1",
    [deliveryId, new Date(now.getTime() + seconds * 1000)],
  );
}

export async function fireSchedule(org: string, triggerId: string, now = new Date()) {
  return transaction(org, async (tx) => {
    const t = (
      await tx.query<TriggerRow>('SELECT * FROM triggers WHERE id=$1 FOR UPDATE SKIP LOCKED', [triggerId])
    ).rows[0];
    if (!t) return;
    if (!t.enabled || t.deleted_at) {
      await tx.query(
        "UPDATE dispatch_jobs SET state='done' WHERE kind='trigger_schedule' AND resource_id=$1",
        [triggerId],
      );
      return;
    }
    if (!t.next_fire_at || t.next_fire_at > now) return;
    let error: string | null = null;
    const overlap = (
      await tx.query(
        `SELECT 1 FROM trigger_deliveries d LEFT JOIN runs r ON r.id=d.run_id
      WHERE d.trigger_id=$1 AND (d.status='pending' OR (d.status='accepted' AND r.status NOT IN ('succeeded','failed','cancelled','timed_out'))) LIMIT 1`,
        [triggerId],
      )
    ).rowCount;
    if (overlap) error = 'previous_run_unfinished';
    else if (!(await triggerPrincipal(tx, t))) error = 'authorization_revoked';
    else {
      try {
        await enqueueTrigger(tx, t, `cron:${t.next_fire_at.toISOString()}`, '', undefined, now);
      } catch (e) {
        if (e instanceof AppError && e.status === 429) error = e.code;
        else throw e;
      }
    }
    // Coalesce missed occurrences into at most one delivery; never replay an outage's entire backlog.
    const next = nextOccurrence(t.settings.cron!, t.settings.timezone!, now);
    await tx.query('UPDATE triggers SET next_fire_at=$2,last_fired_at=$3,last_error_code=$4 WHERE id=$1', [
      triggerId,
      next,
      now,
      error,
    ]);
    await tx.query(
      "UPDATE dispatch_jobs SET available_at=$2,state='pending' WHERE kind='trigger_schedule' AND resource_id=$1",
      [triggerId, next],
    );
  });
}

export async function dispatchTriggerDelivery(
  org: string,
  deliveryId: string,
  provider = new SlackClient(),
  now = new Date(),
) {
  const reply = await transaction(org, async (tx) => {
    const job = (
      await tx.query(
        "SELECT * FROM dispatch_jobs WHERE kind='trigger' AND resource_id=$1 AND state<>'done' AND available_at<=$2 AND (lease_until IS NULL OR lease_until<=$2) FOR UPDATE SKIP LOCKED",
        [deliveryId, now],
      )
    ).rows[0];
    if (!job) return;
    const d = (
      await tx.query<TriggerDelivery>('SELECT * FROM trigger_deliveries WHERE id=$1 FOR UPDATE', [deliveryId])
    ).rows[0];
    if (!d) {
      await tx.query("UPDATE dispatch_jobs SET state='done' WHERE id=$1", [job.id]);
      return;
    }
    const t = (await tx.query<TriggerRow>('SELECT * FROM triggers WHERE id=$1 FOR SHARE', [d.trigger_id]))
      .rows[0];
    if (!t || t.deleted_at) return finish(tx, d, 'trigger_deleted');
    // A crashed sender may have posted. Preserve the run and ask for explicit reply retry.
    if (d.reply_state === 'sending') {
      await tx.query(
        "UPDATE trigger_deliveries SET reply_state='uncertain',error_code='reply_outcome_unknown' WHERE id=$1",
        [d.id],
      );
      return finish(tx, d);
    }
    const p = await triggerPrincipal(tx, t);
    if (!p) return finish(tx, d, 'authorization_revoked');
    if (d.status === 'pending') {
      if (d.expires_at <= now) return finish(tx, d, 'trigger_delivery_expired');
      if (!t.enabled) return finish(tx, d, 'trigger_paused');
      if (t.revision !== d.trigger_revision) return finish(tx, d, 'trigger_configuration_changed');
      const earlier = await tx.query(
        `SELECT 1 FROM trigger_deliveries d JOIN triggers t ON t.id=d.trigger_id
        WHERE t.project_id=$1 AND t.enabled AND t.deleted_at IS NULL AND d.status='pending' AND d.trigger_revision=t.revision
          AND d.expires_at>$2 AND d.id<$3 LIMIT 1`,
        [t.project_id, now, d.id],
      );
      if (earlier.rowCount) {
        await tx.query("UPDATE trigger_deliveries SET error_code='earlier_workspace_work' WHERE id=$1", [
          d.id,
        ]);
        await later(
          tx,
          d.id,
          now,
          Math.min(30, Math.max(1, (d.expires_at.getTime() - now.getTime()) / 1000)),
        );
        return;
      }
      // Admission locks the workspace and rechecks its writer, grants, models and financial limits.
      // Roll back only this admission on a policy rejection, then retain a visible receipt outcome.
      await tx.query('SAVEPOINT trigger_admission');
      try {
        const accepted = await admitRun(
          tx,
          p,
          {
            project_id: t.project_id,
            agent_id: t.agent_id,
            prompt: unseal<string>(d.prompt_ciphertext),
            scheduling_class: 'background',
            queue_timeout_seconds: Math.max(
              1,
              Math.min(86400, Math.ceil((d.expires_at.getTime() - now.getTime()) / 1000)),
            ),
          },
          t.kind === 'schedule' ? 'scheduled' : t.kind,
          false,
        );
        await tx.query(
          "UPDATE runs SET config=config||jsonb_build_object('trigger_id',$2::text,'trigger_delivery_id',$3::text) WHERE id=$1",
          [accepted.run_id, t.id, d.id],
        );
        await tx.query(
          "UPDATE trigger_deliveries SET status='accepted',run_id=$2,error_code=NULL WHERE id=$1",
          [d.id, accepted.run_id],
        );
        await tx.query('RELEASE SAVEPOINT trigger_admission');
        if (d.reply_state === 'pending') await later(tx, d.id, now);
        else await finish(tx, d);
      } catch (e) {
        await tx.query('ROLLBACK TO SAVEPOINT trigger_admission');
        if (!(e instanceof AppError)) throw e;
        if (
          [
            'workspace_busy',
            'admission_paused',
            'execution_disabled',
            'storage_capacity_unavailable',
          ].includes(e.code)
        ) {
          await tx.query('UPDATE trigger_deliveries SET error_code=$2 WHERE id=$1', [d.id, e.code]);
          await later(
            tx,
            d.id,
            now,
            Math.min(30, Math.max(1, (d.expires_at.getTime() - now.getTime()) / 1000)),
          );
        } else await finish(tx, d, e.code);
      }
      return;
    }
    if (d.status !== 'accepted' || d.reply_state !== 'pending' || !d.run_id) return finish(tx, d);
    const run = (await tx.query<RunRow>('SELECT * FROM runs WHERE id=$1', [d.run_id])).rows[0];
    if (!run || !terminal(run.status)) {
      await later(tx, d.id, now);
      return;
    }
    if (!(await actorAuthorized(tx, run))) return finish(tx, d, 'authorization_revoked');
    const c = (
      await tx.query<SlackConnectionRow>(
        'SELECT * FROM slack_connections WHERE id=$1 AND revoked_at IS NULL',
        [d.reply_connection_id],
      )
    ).rows[0];
    if (!c || c.owner_user_id !== run.config.user_id) return finish(tx, d, 'slack_connection_revoked');
    const text =
      run.status === 'succeeded'
        ? String(run.result.output_text || 'Run completed.')
        : `Run ${run.status}. Open Macrofold for details.`;
    const message = `${text.slice(0, 2600)}${text.length > 2600 ? '\n…' : ''}\n\n${config.origin}/runs/${run.id}`;
    await tx.query("UPDATE trigger_deliveries SET reply_state='sending' WHERE id=$1", [d.id]);
    await tx.query(
      "UPDATE dispatch_jobs SET state='running',lease_until=$2,attempts=attempts+1 WHERE id=$1",
      [job.id, new Date(now.getTime() + 60000)],
    );
    return {
      token: unseal<SlackSecrets>(c.secret_ciphertext).bot_token,
      channel: d.reply_channel!,
      thread: d.reply_thread!,
      message,
      attempt: Number(job.attempts) + 1,
    };
  });
  if (!reply) return;
  let ts: string | undefined, failure: SlackError | undefined;
  try {
    ts = await provider.reply(reply.token, reply.channel, reply.thread, reply.message, deliveryId);
  } catch (e) {
    failure = e instanceof SlackError ? e : new SlackError('unreachable', true);
  }
  await transaction(org, async (tx) => {
    // Fence completion by the monotonic send attempt; an older process cannot overwrite a manual retry.
    const owned = await tx.query(
      "SELECT id FROM dispatch_jobs WHERE kind='trigger' AND resource_id=$1 AND attempts=$2 AND state='running' FOR UPDATE",
      [deliveryId, reply.attempt],
    );
    if (!owned.rowCount) return;
    const retry = failure?.retryAfter && reply.attempt < 8;
    await tx.query(
      "UPDATE trigger_deliveries SET reply_state=$2,reply_ts=$3,error_code=$4 WHERE id=$1 AND reply_state='sending'",
      [
        deliveryId,
        ts ? 'sent' : retry ? 'pending' : failure?.uncertain ? 'uncertain' : 'failed',
        ts || null,
        failure ? `slack_${failure.code}` : null,
      ],
    );
    if (retry) await later(tx, deliveryId, now, failure!.retryAfter);
    else
      await tx.query(
        "UPDATE dispatch_jobs SET state='done',lease_until=NULL WHERE kind='trigger' AND resource_id=$1",
        [deliveryId],
      );
  });
}

export async function dispatchTriggers(provider = new SlackClient(), now = new Date()) {
  const jobs = (
    await pool.query(
      `SELECT organization_id,resource_id,kind FROM dispatch_jobs
    WHERE kind IN ('trigger','trigger_schedule') AND state<>'done' AND available_at<=$1 AND (lease_until IS NULL OR lease_until<=$1)
    ORDER BY available_at,id LIMIT 25`,
      [now],
    )
  ).rows;
  let failed = 0;
  // Bound the maintenance invocation even when Slack is slow. Remaining work stays durable in SQL.
  const deadline = Date.now() + 20000;
  let processed = 0;
  for (const job of jobs) {
    if (Date.now() >= deadline) break;
    try {
      if (job.kind === 'trigger_schedule') await fireSchedule(job.organization_id, job.resource_id, now);
      else await dispatchTriggerDelivery(job.organization_id, job.resource_id, provider, now);
    } catch {
      failed++;
      await pool.query(
        "UPDATE dispatch_jobs SET available_at=$2,error='trigger_dispatch_failed' WHERE kind=$3 AND resource_id=$1 AND state<>'done'",
        [job.resource_id, new Date(now.getTime() + 30000), job.kind],
      );
    }
    processed++;
  }
  return { triggers_processed: processed, triggers_failed: failed };
}
