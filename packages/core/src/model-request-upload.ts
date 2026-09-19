import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { modelTransport, decryptModelBody } from '../../contracts/model-transport';
import { transaction } from '../../db';
import { storage } from '../../providers/src/storage';
import { boundedBody } from './body';
import { config, isLocal } from './config';
import { id, seal, sha256, unseal } from './crypto';
import { assert } from './errors';
import { getRun } from './runs';
import { requireRunActor } from './actor-authorization';
import type { RuntimeCapability } from './runtime-auth';

const inputSchema = z
  .object({
    size: z.number().int().min(1).max(modelTransport.maximumBytes),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    path: z.enum(modelTransport.paths),
  })
  .strict();
type UploadClaim = z.infer<typeof inputSchema> & {
  purpose: 'model-upload';
  organization: string;
  run: string;
  lease: string;
  key: string;
  encryption_key: string;
  expires: number;
};
function claimFor(request: Request, cap: RuntimeCapability, path?: string) {
  let claim: UploadClaim;
  try {
    claim = unseal<UploadClaim>(request.headers.get(modelTransport.uploadHeader) || '');
  } catch {
    assert(false, 401, 'invalid_model_upload', 'The model upload grant is invalid.');
  }
  assert(
    claim.purpose === 'model-upload' &&
      claim.organization === cap.organization &&
      claim.run === cap.run &&
      claim.lease === cap.lease &&
      claim.expires > Date.now() &&
      (!path || path === claim.path),
    401,
    'invalid_model_upload',
    'The model upload expired or belongs to another request.',
  );
  return claim;
}

/** A grant only stages encrypted bytes; normal gateway admission still authorizes and meters inference. */
export async function prepareModelUpload(request: Request, cap: RuntimeCapability) {
  if (request.method === 'PUT') {
    assert(isLocal(), 405, 'method_not_allowed', 'Hosted uploads use the signed object URL.');
    const claim = claimFor(request, cap);
    const bytes = await boundedBody(request.body, claim.size + modelTransport.encryptedOverhead);
    assert(
      bytes.length === claim.size + modelTransport.encryptedOverhead,
      400,
      'invalid_model_upload',
      'Encrypted upload size does not match the grant.',
    );
    await storage.put(claim.key, bytes);
    return new Response(null, { status: 204 });
  }
  assert(request.method === 'POST', 405, 'method_not_allowed', 'Create an upload grant with POST.');
  let value: unknown;
  try {
    value = JSON.parse((await boundedBody(request.body, 4096)).toString());
  } catch {
    assert(false, 400, 'invalid_request', 'Supply the model request size, SHA-256 and endpoint path.');
  }
  const parsed = inputSchema.safeParse(value);
  assert(parsed.success, 400, 'invalid_request', 'Invalid model upload metadata.');
  await transaction(cap.organization, async (tx) => {
    const run = await getRun(tx, cap.run);
    await requireRunActor(tx, run);
    assert(
      run.lease_generation === cap.lease &&
        ['running', 'waiting_for_input'].includes(run.status) &&
        !run.cancel_requested &&
        run.deadline &&
        run.deadline.getTime() > Date.now(),
      409,
      'run_unavailable',
      'This run cannot stage model requests.',
    );
    const limit = await tx.query(
      'INSERT INTO rate_limits(key,bucket,count) VALUES($1,$2,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.bucket=excluded.bucket THEN rate_limits.count+1 ELSE 1 END,bucket=excluded.bucket RETURNING count',
      [`model-upload:${cap.run}`, Math.floor(Date.now() / 60000)],
    );
    assert(
      limit.rows[0].count <= 30,
      429,
      'rate_limited',
      'Too many large model requests. Retry after one minute.',
    );
  });
  const claim: UploadClaim = {
    ...parsed.data,
    purpose: 'model-upload',
    organization: cap.organization,
    run: cap.run,
    lease: cap.lease,
    key: `staging/model/${cap.organization}/${cap.run}/${id()}`,
    encryption_key: randomBytes(32).toString('base64'),
    expires: Math.min(cap.expires, Date.now() + 5 * 60_000),
  };
  const token = seal(claim);
  const upload = storage.uploadURL
    ? await storage.uploadURL(claim.key, claim.size + modelTransport.encryptedOverhead, claim.expires)
    : {
        url: `${config.origin}/runtime/runs/${cap.run}/model/${modelTransport.uploadPath}`,
        headers: {
          Authorization: request.headers.get('authorization') || `Bearer ${request.headers.get('x-api-key')}`,
          [modelTransport.uploadHeader]: token,
          'Content-Type': 'application/octet-stream',
        },
      };
  return Response.json(
    { ...upload, token, encryption_key: claim.encryption_key },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function readModelBody(request: Request, cap: RuntimeCapability, path: string) {
  if (!request.headers.has(modelTransport.uploadHeader))
    return boundedBody(request.body, modelTransport.maximumBytes);
  // The signed claim, not a caller URL/key, binds the object, exact bytes, endpoint and run generation.
  const claim = claimFor(request, cap, path);
  assert(
    (await boundedBody(request.body, 4096)).length === 0,
    400,
    'invalid_model_upload',
    'A staged model request must not include an inline body.',
  );
  try {
    const encrypted = storage.readUpload
      ? await storage.readUpload(claim.key, claim.size + modelTransport.encryptedOverhead)
      : await storage.get(claim.key);
    assert(
      encrypted.length === claim.size + modelTransport.encryptedOverhead,
      400,
      'invalid_model_upload',
      'Model upload size mismatch.',
    );
    const bytes = Buffer.from(
      await decryptModelBody(
        new Uint8Array(encrypted),
        new Uint8Array(Buffer.from(claim.encryption_key, 'base64')),
      ),
    );
    assert(
      bytes.length === claim.size && sha256(bytes) === claim.sha256,
      400,
      'invalid_model_upload',
      'Model upload integrity check failed.',
    );
    return bytes;
  } catch {
    assert(
      false,
      400,
      'invalid_model_upload',
      'Model upload is missing or corrupt. Stage the request again; inference has not started.',
    );
  } finally {
    // Lifecycle expiration of staging/ is the crash/failed-delete backstop, never a durable content store.
    await storage.delete(claim.key).catch(() => {});
  }
}
