import { afterAll, describe, it, expect, vi } from 'vitest';
import { auth, identify } from '../../packages/core/src/auth';
import { config } from '../../packages/core/src/config';
import { pool, authPool } from '../../packages/db';
import { id } from '../../packages/core/src/crypto';

const messages = vi.hoisted(() => [] as { to: string; subject: string; text: string }[]);
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (mail: (typeof messages)[number]) => {
        messages.push(mail);
      },
    }),
  },
}));
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
const request = (route: string, body: unknown) =>
  auth.handler(
    new Request(config.origin + '/auth/' + route, {
      method: 'POST',
      headers: { origin: config.origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

describe('our Better Auth email and recovery integration', () => {
  it('requires verification and consumes a real verification link before issuing usable sessions', async () => {
    const email = id() + '@example.test',
      password = 'verification-fixture-password';
    const signup = await request('sign-up/email', { email, password, name: 'Verification fixture' });
    expect(signup.status).toBe(200);
    expect((await request('sign-in/email', { email, password })).status).toBe(403);
    const mail = messages.find((m) => m.to === email && m.subject === 'Verify your email')!;
    expect(mail).toBeDefined();
    const url = mail.text.match(/https?:\/\/\S+/)![0];
    expect(new URL(url).origin).toBe(config.origin);
    const verified = await auth.handler(new Request(url));
    expect(verified.status).toBeLessThan(400);
    expect(
      (await pool.query('SELECT "emailVerified" FROM auth."user" WHERE email=$1', [email])).rows[0]
        .emailVerified,
    ).toBe(true);
    const signed = await request('sign-in/email', { email, password });
    expect(signed.status).toBe(200);
    const cookie = signed.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; ');
    expect((await identify(new Request(config.origin + '/v1/me', { headers: { cookie } }))).email).toBe(
      email,
    );
  });
  it('resets through the delivered single-use token and rejects old passwords and token replay', async () => {
    const email = id() + '@example.test',
      password = 'old-fixture-password-2026',
      next = 'new-fixture-password-2026';
    const signup = await request('sign-up/email', { email, password, name: 'Reset fixture' });
    expect(signup.status).toBe(200);
    const link = messages
      .find((m) => m.to === email && m.subject === 'Verify your email')!
      .text.match(/https?:\/\/\S+/)![0];
    expect((await auth.handler(new Request(link))).status).toBeLessThan(400);
    expect(
      (await request('request-password-reset', { email, redirectTo: config.origin + '/reset-password' }))
        .status,
    ).toBe(200);
    const resetLink = new URL(
      messages
        .find((m) => m.to === email && m.subject === 'Reset your password')!
        .text.match(/https?:\/\/\S+/)![0],
    );
    const token = resetLink.pathname.split('/').at(-1)!;
    expect((await request('reset-password', { token: 'invalid', newPassword: next })).status).toBe(400);
    expect((await request('sign-in/email', { email, password })).status).toBe(200);
    expect((await request('reset-password', { token, newPassword: next })).status).toBe(200);
    expect((await request('sign-in/email', { email, password })).status).toBe(401);
    expect((await request('sign-in/email', { email, password: next })).status).toBe(200);
    expect((await request('reset-password', { token, newPassword: 'replayed-password-2026' })).status).toBe(
      400,
    );
    expect((await request('sign-in/email', { email, password: next })).status).toBe(200);
  });
});
