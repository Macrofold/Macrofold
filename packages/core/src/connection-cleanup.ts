import { pool, transaction, lock, type Tx } from '../../db';
import { id, unseal } from './crypto';
import { isLocal } from './config';
import type { Principal } from './auth';
import { assertConnectionOwner, composio } from './connections';
import * as resources from './resources';
import { safeFetch } from '../../providers/src/network';
import { assert } from './errors';

export async function disconnectConnection(tx: Tx, p: Principal, c: resources.Document) {
  assertConnectionOwner(p, c);
  await resources.update(tx, 'connections', c.id, {
    deleted: true,
    status: 'error',
    cleanup_status: 'pending',
    grants: {
      version: Number((c.grants as { version: number }).version) + 1,
      subject_type: 'user',
      subject_id: p.userId,
      tools: [],
    },
  });
  await tx.query(
    "INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id) VALUES($1,$2,'connection_cleanup',$3) ON CONFLICT(kind,resource_id) DO NOTHING",
    [id(), p.organizationId, c.id],
  );
}
export async function cleanConnection(
  org: string,
  connectionId: string,
  transport: typeof fetch = safeFetch,
  deleteApp = async (account: string) => {
    try {
      await composio().connectedAccounts.delete(account);
    } catch (error) {
      if (
        (error as { status?: number; statusCode?: number }).status !== 404 &&
        (error as { statusCode?: number }).statusCode !== 404
      )
        throw error;
    }
  },
) {
  return transaction(org, async (tx) => {
    const got = await tx.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', [
      `cleanup:${connectionId}`,
    ]);
    if (!got.rows[0].locked) return;
    await lock(tx, `mcp-oauth:${connectionId}`);
    const c = await resources.get(tx, 'connections', connectionId);
    if (!c.deleted) return;
    const job = (
      await tx.query(
        "SELECT attempts,state FROM dispatch_jobs WHERE kind='connection_cleanup' AND resource_id=$1",
        [connectionId],
      )
    ).rows[0];
    if (!job || job.state === 'done') return;
    let status = 'revoked';
    try {
      if (c.kind === 'composio' && c.external_account_id) await deleteApp(String(c.external_account_id));
      else if (c.oauth_ciphertext) {
        const oauth = unseal<{
          client?: { client_id: string; client_secret?: string; token_endpoint_auth_method?: string };
          tokens?: { access_token: string; refresh_token?: string };
          discovery?: {
            authorizationServerMetadata?: {
              revocation_endpoint?: string;
              revocation_endpoint_auth_methods_supported?: string[];
            };
          };
        }>(String(c.oauth_ciphertext));
        const endpoint = oauth.discovery?.authorizationServerMetadata?.revocation_endpoint;
        if (endpoint && oauth.tokens && oauth.client) {
          for (const [hint, token] of [
            ['refresh_token', oauth.tokens.refresh_token],
            ['access_token', oauth.tokens.access_token],
          ])
            if (token) {
              const body = new URLSearchParams({
                token,
                token_type_hint: hint!,
                client_id: oauth.client.client_id,
              });
              const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
              const supported =
                oauth.discovery?.authorizationServerMetadata?.revocation_endpoint_auth_methods_supported;
              const method =
                oauth.client.token_endpoint_auth_method ||
                (oauth.client.client_secret ? 'client_secret_post' : 'none');
              assert(
                !supported || supported.includes(method),
                409,
                'revocation_auth_unsupported',
                'The provider requires another revocation authentication method.',
              );
              if (oauth.client.client_secret && method === 'client_secret_basic')
                headers.Authorization =
                  'Basic ' +
                  Buffer.from(
                    encodeURIComponent(oauth.client.client_id) +
                      ':' +
                      encodeURIComponent(oauth.client.client_secret),
                  ).toString('base64');
              else if (oauth.client.client_secret) body.set('client_secret', oauth.client.client_secret);
              const response = await transport(endpoint, {
                method: 'POST',
                headers,
                body,
                redirect: 'error',
                signal: AbortSignal.timeout(10000),
              });
              await response.body?.cancel();
              assert(response.ok, 502, 'revocation_failed', 'Provider revocation failed.');
            }
        } else status = 'manual_revocation_required';
      } else if (c.secret_ciphertext || c.headers_ciphertext || c.environment_ciphertext)
        status = 'manual_revocation_required';
    } catch {
      const attempt = Number(job.attempts) + 1;
      await resources.update(tx, 'connections', c.id, {
        cleanup_status: attempt >= 8 ? 'manual_revocation_required' : 'retrying',
      });
      await tx.query(
        "UPDATE dispatch_jobs SET attempts=$2,state=$3,available_at=now()+interval '10 minutes',error='credential_revocation_failed' WHERE kind='connection_cleanup' AND resource_id=$1",
        [connectionId, attempt, attempt >= 8 ? 'done' : 'pending'],
      );
      // Local authorization was revoked before any provider call. Do not keep user secrets indefinitely.
      if (attempt < 8) return;
      status = 'manual_revocation_required';
    }
    await resources.update(tx, 'connections', c.id, {
      secret_ciphertext: null,
      headers_ciphertext: null,
      environment_ciphertext: null,
      oauth_ciphertext: null,
      external_account_id: null,
      cleanup_status: status,
    });
    await tx.query(
      "UPDATE dispatch_jobs SET state='done',lease_until=NULL WHERE kind='connection_cleanup' AND resource_id=$1",
      [connectionId],
    );
  });
}
export async function dispatchConnectionCleanup() {
  if (isLocal()) return { connection_cleanups: 0 };
  const jobs = await pool.query(
    "SELECT organization_id,resource_id FROM dispatch_jobs WHERE kind='connection_cleanup' AND state='pending' AND available_at<=now() ORDER BY available_at LIMIT 5",
  );
  await Promise.all(jobs.rows.map((job) => cleanConnection(job.organization_id, job.resource_id)));
  return { connection_cleanups: jobs.rowCount || 0 };
}
