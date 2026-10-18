import { pool, queryGroup, transaction, type Tx } from '../../db';
import { id } from './crypto';
import './config';

/** Optional HTTP observations are independent of authority, actor journals,
 * domain product milestones and financial accounting. Restart to change policy. */
const policy = Object.freeze({
  requests: process.env.REQUEST_ANALYTICS_ENABLED !== 'false',
  apiProductEvents: process.env.API_PRODUCT_EVENTS_ENABLED !== 'false',
});
export function requestObservationPolicy() {
  return policy;
}

type RequestIdentity = {
  requestId: string;
  organizationId?: string;
  principalId?: string;
  principalType: 'service' | 'operator' | 'human' | 'anonymous';
  userId?: string;
  route: string;
};
export type RequestObservation = Readonly<
  RequestIdentity & {
    method: string;
    status: number;
    durationMs: number;
    clientType: string;
    /** Only a committed, non-replayed successful API mutation supplies this. */
    operation?: string;
  }
>;
let inFlight = 0;
function diagnostic(requestId: string, code = 'request_observation_failed') {
  console.error(JSON.stringify({ request_id: requestId, code }));
}
async function boundedObservation(
  organizationId: string | undefined,
  requestId: string,
  write: (tx: Tx) => Promise<unknown>,
) {
  // Leave SQL headroom for execution/accounting during refusal storms.
  const maximum = Math.max(1, Math.min(4, Math.floor((pool.options.max ?? 80) / 8)));
  if (inFlight >= maximum || pool.waitingCount > 0) return;
  inFlight++;
  try {
    await transaction(organizationId ?? null, write, { deadlineAtMs: Date.now() + 500 });
  } catch {
    diagnostic(requestId);
  } finally {
    inFlight--;
  }
}

/** Preserve interrupted-attempt rows for the existing non-background fallback. */
export async function beginRequestObservation(input: { requestId: string; method: string }) {
  if (!policy.requests) return;
  await boundedObservation(undefined, input.requestId, (tx) =>
    tx.query('INSERT INTO api_requests(request_id,method,route) VALUES($1,$2,$3)', [
      input.requestId,
      input.method,
      'unmatched',
    ]),
  );
}
export async function enrichRequestObservation(input: RequestIdentity) {
  if (!policy.requests) return;
  await boundedObservation(input.organizationId, input.requestId, (tx) =>
    tx.query(
      'UPDATE api_requests SET organization_id=$2,principal_id=$3,principal_type=$4,user_id=$5,route=$6 WHERE request_id=$1',
      [
        input.requestId,
        input.organizationId ?? null,
        input.principalId ?? null,
        input.principalType,
        input.userId ?? null,
        input.route,
      ],
    ),
  );
}

export async function observeRequest(
  input: RequestObservation,
  background: ((task: () => Promise<void>) => void) | undefined,
  options: { fallback: boolean },
) {
  const product =
    policy.apiProductEvents &&
    input.operation &&
    input.organizationId &&
    input.status >= 200 &&
    input.status < 300;
  if (!policy.requests && !product) return;
  // This copied scalar record is the callback's only request state. Never pass
  // Request/body/response/Principal objects into an optional diagnostics owner.
  const record = { ...input };
  const write = () =>
    boundedObservation(record.organizationId, record.requestId, async (tx) => {
      const statements = [];
      if (policy.requests)
        statements.push({
          text: 'INSERT INTO api_requests(request_id,organization_id,principal_id,principal_type,user_id,method,route,status,duration_ms,client_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(request_id) DO UPDATE SET organization_id=excluded.organization_id,principal_id=excluded.principal_id,principal_type=excluded.principal_type,user_id=excluded.user_id,route=excluded.route,status=excluded.status,duration_ms=excluded.duration_ms,client_type=excluded.client_type',
          values: [
            record.requestId,
            record.organizationId ?? null,
            record.principalId ?? null,
            record.principalType,
            record.userId ?? null,
            record.method,
            record.route,
            record.status,
            record.durationMs,
            record.clientType,
          ],
        });
      if (product)
        statements.push({
          text: 'INSERT INTO product_events(id,organization_id,user_id,name,data) VALUES($1,$2,$3,$4,$5)',
          values: [
            id(),
            record.organizationId,
            record.userId ?? null,
            record.operation,
            JSON.stringify({
              principal_type: record.principalType,
              source: 'public_api',
              principal_id: record.principalId,
            }),
          ],
        });
      await queryGroup(tx, statements);
    });
  if (background) {
    try {
      background(write);
    } catch {
      diagnostic(record.requestId, 'request_observation_scheduling_failed');
    }
  } else if (options.fallback) await write();
}
