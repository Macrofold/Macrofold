import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { sendMail } from '../../packages/core/src/auth';
import { config } from '../../packages/core/src/config';
import { pool, authPool } from '../../packages/db';

const original = { ...config };
afterEach(() => {
  Object.assign(config, original);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});

function transport() {
  const http = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network'));
  config.mode = 'production';
  config.origin = 'https://fixture.invalid';
  vi.stubEnv('RESEND_API_KEY', 'fixture-resend-key');
  vi.stubEnv('EMAIL_FROM', 'Fixture <sender@example.test>');
  vi.stubEnv('RESEND_BASE_URL', 'https://api.resend.com');
  vi.stubEnv('NODE_ENV', 'production');
  return http;
}

it('sends verification/reset text through the real Resend SDK contract', async () => {
  const http = transport();
  http.mockImplementation(async (url, init) => {
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-resend-key');
    expect(JSON.parse(String(init?.body))).toEqual({
      from: 'Fixture <sender@example.test>',
      to: 'delivered@resend.dev',
      subject: 'Verification fixture',
      text: 'Synthetic link',
    });
    return Response.json({ id: 'fixture-email-id' });
  });
  await expect(
    sendMail('delivered@resend.dev', 'Verification fixture', 'Synthetic link'),
  ).resolves.toBeUndefined();
  expect(http).toHaveBeenCalledOnce();
});

it.each([401, 403, 429, 500])(
  'fails delivery without exposing provider details on HTTP %s',
  async (status) => {
    const http = transport();
    http.mockResolvedValue(
      Response.json(
        { name: 'validation_error', message: 'Private provider diagnostic', statusCode: status },
        { status },
      ),
    );
    await expect(sendMail('delivered@resend.dev', 'Fixture', 'Fixture')).rejects.toThrow(
      'Email delivery failed',
    );
    expect(http).toHaveBeenCalledOnce();
  },
);

it('does not report an interrupted delivery as success or automatically resend', async () => {
  const http = transport();
  http.mockRejectedValue(new Error('Connection reset after request upload'));
  await expect(sendMail('delivered@resend.dev', 'Fixture', 'Fixture')).rejects.toThrow(
    'Email delivery failed',
  );
  expect(http).toHaveBeenCalledOnce();
});
