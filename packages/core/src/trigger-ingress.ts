import { z } from 'zod';
import { pool, transaction } from '../../db';
import { boundedBody } from './body';
import { assert, errorBody } from './errors';
import { id, sameSecret, sha256, unseal } from './crypto';
import { verifySlackSignature, slackMessage } from './trigger-policy';
import { enqueueTrigger } from './trigger-deliveries';
import type { SlackConnectionRow, SlackSecrets, TriggerRow } from './triggers';

function json(raw: Buffer): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw.toString('utf8'));
    assert(
      value && typeof value === 'object' && !Array.isArray(value),
      400,
      'invalid_payload',
      'Send a JSON object.',
    );
    return value as Record<string, unknown>;
  } catch {
    assert(false, 400, 'invalid_payload', 'Send a valid JSON object.');
  }
}
export async function triggerIngress(request: Request, kind: 'slack' | 'webhook', resourceId: string) {
  try {
    assert(z.uuid().safeParse(resourceId).success, 404, 'not_found', 'Incoming endpoint not found.');
    const route = (
      await pool.query('SELECT organization_id FROM trigger_routes WHERE id=$1 AND kind=$2', [
        resourceId,
        kind,
      ])
    ).rows[0];
    assert(route, 404, 'not_found', 'Incoming endpoint not found.');
    const raw = await boundedBody(request.body, 64 * 1024);
    const result = await transaction(
      route.organization_id,
      async (tx) => {
        if (kind === 'webhook') {
          const t = (
            await tx.query<TriggerRow>(
              "SELECT * FROM triggers WHERE id=$1 AND kind='webhook' AND deleted_at IS NULL FOR SHARE",
              [resourceId],
            )
          ).rows[0];
          const auth = request.headers.get('authorization') || '';
          assert(
            t?.secret_hash && auth.startsWith('Bearer ') && sameSecret(sha256(auth.slice(7)), t.secret_hash),
            401,
            'invalid_trigger_secret',
            'Provide the webhook trigger secret in the Authorization header.',
          );
          const key = request.headers.get('idempotency-key');
          assert(
            key && /^[\x21-\x7e]{1,200}$/.test(key),
            400,
            'missing_idempotency_key',
            'Send a unique Idempotency-Key for this event; reuse it for retries.',
          );
          const body = json(raw);
          const incoming = typeof body.prompt === 'string' ? body.prompt : JSON.stringify(body);
          const delivery = await enqueueTrigger(tx, t, key, incoming);
          return { value: delivery, status: 202 };
        }
        const c = (
          await tx.query<SlackConnectionRow>(
            'SELECT * FROM slack_connections WHERE id=$1 AND revoked_at IS NULL FOR SHARE',
            [resourceId],
          )
        ).rows[0];
        assert(c, 404, 'not_found', 'Incoming endpoint not found.');
        verifySlackSignature(raw, request.headers, unseal<SlackSecrets>(c.secret_ciphertext).signing_secret);
        const body = json(raw);
        if (body.type === 'url_verification') {
          assert(
            typeof body.challenge === 'string' && body.challenge.length <= 1000,
            400,
            'invalid_payload',
            'A Slack challenge is required.',
          );
          return { value: { challenge: body.challenge }, status: 200 };
        }
        assert(
          body.team_id === c.team_id,
          403,
          'slack_team_mismatch',
          'This event belongs to another Slack workspace.',
        );
        const message = body.type === 'event_callback' ? slackMessage(body.event, c.bot_user_id) : undefined;
        if (!message) return { value: { ignored: true }, status: 200 };
        const t = (
          await tx.query<TriggerRow>(
            "SELECT * FROM triggers WHERE slack_connection_id=$1 AND channel_id=$2 AND kind='slack' AND enabled AND deleted_at IS NULL FOR SHARE",
            [c.id, message.channel],
          )
        ).rows[0];
        if (!t) return { value: { ignored: true }, status: 200 };
        await enqueueTrigger(tx, t, `slack:${message.channel}:${message.ts}`, message.text, message.thread);
        return { value: { accepted: true }, status: 200 };
      },
      { statementTimeoutMs: 1800 },
    );
    return Response.json(result.value, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const failure = errorBody(error, id());
    return Response.json(failure.body, { status: failure.status, headers: { 'Cache-Control': 'no-store' } });
  }
}
