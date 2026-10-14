import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { transaction } from '../packages/db';
import { id, seal, sha256 } from '../packages/core/src/crypto';
import { stageRestoreObjects, type RestoreObject } from '../packages/core/src/execution-hydration';
import { storage } from '../packages/providers/src/storage';
import { FaultMachine } from '../tests/fixtures/cloud-machine';
import { deliverWebhook } from '../packages/core/src/webhooks';
import { reconcileFinance } from '../packages/core/src/maintenance';
import { readDashboardSnapshot, type DashboardAccess } from '../packages/core/src/dashboard-freshness';
import { maintainStorage } from '../packages/core/src/storage-maintenance';
import { fixtureAccount } from '../tests/fixtures/account';
import * as resources from '../packages/core/src/resources';

export type ComponentMode = 'webhook' | 'finance' | 'storage' | 'snapshot' | 'restore';
export async function componentWorkload(
  mode: ComponentMode,
  accounts: Awaited<ReturnType<typeof fixtureAccount>>[],
  count: number,
  delay: number,
  size: number,
  networkFetch: typeof fetch,
) {
  const sleep = () => new Promise<void>((resolve) => setTimeout(resolve, delay));
  let requests = 0;
  // A real loopback transport owns response lifetime; never forward a fixture to a vendor.
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
      /* Drain bounded synthetic bytes. */
    }
    requests++;
    await sleep();
    res.writeHead(204).end();
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const items: { org: string; run: () => Promise<unknown> }[] = [];
  const accessesByOrg = new Map<string, DashboardAccess[]>();
  let ledgerPlan: unknown;
  let verifiedBytes = 0;
  const content = Buffer.alloc(size || 128 * 1024, 7),
    hash = sha256(content);
  if (mode === 'restore') {
    assert(content.length <= 128 * 1024, 'Restore fixture needs all 32 objects to fit in one 4 MiB batch');
    const key = 'capacity/content';
    await storage.put(key, Buffer.from(seal({ bytes: content.toString('base64') })));
    const objects: RestoreObject[] = Array.from({ length: 32 }, (_, i) => ({
      id: String(i),
      name: hash,
      kind: 'input_chunk',
      data: { key, size: content.length, sha256: hash },
    }));
    const machine = new FaultMachine();
    machine.stage = async (_binding, files) => {
      for (const file of files) {
        assert.equal(sha256(file.content), hash);
        verifiedBytes += file.content.length;
      }
      const response = await networkFetch(url, {
        method: 'POST',
        body: JSON.stringify(files.map((f) => f.content.toString('base64'))),
      });
      assert.equal(response.status, 204);
    };
    for (let i = 0; i < count; i++)
      items.push({
        org: '',
        run: () =>
          stageRestoreObjects(
            machine,
            { name: 'fixture', sessionId: 'fixture', createdAt: new Date().toISOString() },
            objects,
          ),
      });
  } else {
    for (const account of accounts) {
      if (mode === 'snapshot') {
        assert(account.p.userId);
        const userId = account.p.userId,
          organizationId = account.p.organizationId;
        const session = await transaction(organizationId, (tx) =>
          tx.query<{ id: string }>('SELECT id FROM auth.session WHERE "userId"=$1 LIMIT 1', [userId]),
        );
        accessesByOrg.set(
          organizationId,
          Array.from({ length: size || 4 }, () => ({
            organizationId,
            userId,
            sessionId: session.rows[0].id,
            role: 'owner',
          })),
        );
      }
      if (mode === 'webhook') {
        await transaction(account.p.organizationId, async (tx) => {
          const endpoint = await resources.create(tx, 'webhooks', account.p.organizationId, {
            url,
            enabled: true,
            secret_ciphertext: seal('synthetic-secret'),
          });
          const n =
            Math.floor(count / accounts.length) +
            (accounts.indexOf(account) < count % accounts.length ? 1 : 0);
          for (let i = 0; i < n; i++) {
            const delivery = await resources.create(tx, 'deliveries', account.p.organizationId, {
              endpoint_id: endpoint.id,
              event_id: id(),
              status: 'pending',
              attempts: 0,
              payload: '{}',
            });
            await tx.query(
              "INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id) VALUES($1,$2,'webhook',$3)",
              [id(), account.p.organizationId, delivery.id],
            );
            items.push({
              org: account.p.organizationId,
              run: () => deliverWebhook(account.p.organizationId, delivery.id, networkFetch),
            });
          }
        });
      } else if (mode === 'finance') {
        // Balanced synthetic history, with no funds created. Measure aggregation
        // over retained journals, not only an empty newly-created organization.
        await transaction(account.p.organizationId, (tx) =>
          tx.query(
            `INSERT INTO ledger(id,organization_id,journal_id,account,amount_micro_usd,reference)
          SELECT gen_random_uuid(),$1,j,account,amount,'capacity-history' FROM
          (SELECT gen_random_uuid() AS j FROM generate_series(1,$2)) journals,
          (VALUES ('capacity-debit',1::bigint),('capacity-credit',-1::bigint)) entries(account,amount)`,
            [account.p.organizationId, size || 1000],
          ),
        );
      }
    }
    if (mode !== 'webhook')
      for (let i = 0; i < count; i++) {
        const a = accounts[i % accounts.length];
        const org = a.p.organizationId;
        items.push({
          org,
          run: async () => {
            if (mode === 'finance') {
              const report = await transaction(org, (tx) => reconcileFinance(tx, org));
              assert.equal(report.status, 'balanced');
            } else if (mode === 'storage') {
              const result = await maintainStorage(org, {
                list: async () => {
                  await sleep();
                  return {
                    objects: Array.from({ length: size || 1000 }, (_, j) => ({
                      key: `${org}/content/${j}`,
                      size: 1024,
                      modified_at: new Date().toISOString(),
                    })),
                  };
                },
                get: async () => {
                  throw Error('Unexpected manifest read');
                },
                put: async () => {
                  throw Error('Unexpected object write');
                },
                delete: async () => {
                  throw Error('Fresh objects must not be deleted');
                },
              });
              assert.equal(result.deleted, 0);
            } else {
              const snapshot = await readDashboardSnapshot(org, accessesByOrg.get(org)!);
              assert(snapshot.authorizedSessions.size > 0);
            }
          },
        });
      }
    if (mode === 'finance') {
      const org = accounts[0].p.organizationId;
      ledgerPlan = await transaction(org, async (tx) => {
        const result = await tx.query(
          `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT journal_id FROM ledger
           WHERE organization_id=$1 GROUP BY journal_id
           HAVING sum(amount_micro_usd)<>0 OR count(*)<2`,
          [org],
        );
        return result.rows[0]['QUERY PLAN'];
      });
    }
  }
  return {
    run: (index: number) => items[index].run(),
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (mode === 'webhook')
        for (const account of accounts)
          await transaction(account.p.organizationId, async (tx) => {
            const pending = await tx.query(
              "SELECT count(*)::integer AS n FROM deliveries WHERE data->>'status'<>'delivered'",
            );
            assert.equal(pending.rows[0].n, 0);
          });
      if (mode === 'restore') assert.equal(verifiedBytes, count * 32 * content.length);
      return { requests, verified_bytes: verifiedBytes, ...(ledgerPlan ? { ledger_plan: ledgerPlan } : {}) };
    },
  };
}
