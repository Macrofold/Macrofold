import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import { composio } from '../../packages/core/src/connections';
import { R2Store } from '../../packages/providers/src/storage';
import { pool, authPool } from '../../packages/db';
import { charge, check, jsonRequest } from './guard';

try {
  await check('openai', 'model-access', async () => {
    const body = await jsonRequest(
      'openai',
      'model-access',
      'https://api.openai.com/v1/models/gpt-4.1-nano',
      {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      },
    );
    assert.equal(body.id, 'gpt-4.1-nano');
    return { model: body.id, object: body.object };
  });
  await check('anthropic', 'model-access', async () => {
    const body = await jsonRequest(
      'anthropic',
      'model-access',
      'https://api.anthropic.com/v1/models?limit=20',
      {
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      },
    );
    assert(Array.isArray(body.data));
    return {
      haikuModels: body.data
        .filter((m: { id: string }) => m.id.includes('haiku'))
        .map((m: { id: string }) => m.id),
      hasMore: body.has_more,
    };
  });
  await check('openrouter', 'key-access', async () => {
    const body = await jsonRequest('openrouter', 'key-access', 'https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    });
    assert(body.data && typeof body.data.usage === 'number');
    return { authenticated: true, shape: Object.keys(body.data).sort() };
  });
  await check('openrouter', 'model-pricing', async () => {
    const body = await jsonRequest('openrouter', 'model-pricing', 'https://openrouter.ai/api/v1/models');
    const model = body.data.find((m: { id: string }) => m.id === 'openai/gpt-4.1-nano');
    assert(model?.pricing);
    return { model: model.id, pricing: model.pricing, supportedParameters: model.supported_parameters };
  });
  await check('resend', 'domains', async () => {
    let body;
    try {
      body = await jsonRequest('resend', 'domains', 'https://api.resend.com/domains?limit=10', {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      });
    } catch (error) {
      if (
        (error as { status?: number }).status === 401 &&
        (error as Error).message === 'This API key is restricted to only send emails'
      )
        return { domainListing: false, permission: 'send-only', senderMustBeConfigured: true };
      throw error;
    }
    assert(Array.isArray(body.data));
    return {
      domains: body.data.map((d: { name: string; status: string }) => ({ name: d.name, status: d.status })),
    };
  });
  await check('composio', 'catalog', async () => {
    charge('composio', 'catalog', 0);
    const page = await composio()
      .getClient()
      .toolkits.list({ limit: 2, sort_by: 'usage' }, { maxRetries: 0, timeout: 30_000 });
    assert(Array.isArray(page.items) && page.items.length > 0);
    return {
      toolkits: page.items.map((t) => ({ slug: t.slug, name: t.name })),
      paginated: Boolean(page.next_cursor),
    };
  });
  await check('r2', 'read-authentication', async () => {
    // One Class B billing block is $0.36 even when the monthly free allowance is exhausted.
    charge('r2', 'read-authentication', 360_000);
    const client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      maxAttempts: 1,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
    try {
      await new R2Store(client).get(`live-smoke/${randomUUID()}/absent.bin`);
      throw new Error('Unexpected existing smoke key');
    } catch (error) {
      assert.equal((error as Error).name, 'NoSuchKey', 'Expected authenticated missing-key response');
      return { authenticated: true, response: 'NoSuchKey', customerObjectsRead: 0 };
    } finally {
      client.destroy();
    }
  });
} finally {
  await pool.end();
  await authPool.end();
}
