import assert from 'node:assert/strict';
import { config } from '../../packages/core/src/config';
import { sendMail } from '../../packages/core/src/auth';
import { pool, authPool } from '../../packages/db';
import { charge, check, safeError } from './guard';

const original = { ...config },
  nativeFetch = globalThis.fetch;
const sender = process.env.EMAIL_FROM || 'Platform acceptance <onboarding@resend.dev>';
let delivery: Record<string, unknown> = {};
globalThis.fetch = async (input, init) => {
  try {
    assert.equal(String(input), 'https://api.resend.com/emails');
    assert.equal(init?.method, 'POST');
    const request = JSON.parse(String(init?.body));
    assert.deepEqual(Array.isArray(request.to) ? request.to : [request.to], ['delivered@resend.dev']);
    assert.equal(request.from, sender);
    charge('resend', 'test-delivery', 10_000);
    const response = await nativeFetch(input, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.clone().json();
    delivery = { status: response.status, id: body.id, providerError: body.message };
    return response;
  } catch (error) {
    delivery = { providerError: safeError(error).message };
    throw error;
  }
};
try {
  await check('resend', 'test-delivery', async () => {
    config.mode = 'production';
    config.origin = 'https://fixture.invalid';
    process.env.EMAIL_FROM = sender;
    try {
      await sendMail(
        'delivered@resend.dev',
        'Synthetic integration acceptance',
        'Delivery test only. No customer data or authentication tokens.',
      );
    } catch {
      throw Object.assign(
        new Error(String(delivery.providerError || 'Mail adapter failed before provider response')),
        { status: delivery.status },
      );
    }
    assert.equal(typeof delivery.id, 'string');
    return {
      ...delivery,
      sender,
      recipient: 'delivered@resend.dev',
      path: 'application sendMail → Resend SDK',
      deliveredToHuman: false,
    };
  });
} finally {
  globalThis.fetch = nativeFetch;
  Object.assign(config, original);
  await pool.end();
  await authPool.end();
}
