import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Runs only inside an owned network-isolated Docker fixture. A matching local
// file deliberately exists: wrong HTTP credentials must never fall back to it.
const secret = randomUUID() + randomUUID();
await mkdir('/platform-control', { recursive: true });
await writeFile('/platform-control/control-secret', secret, { mode: 0o600 });
let controller;
async function start() {
  controller = spawn('node', ['/opt/platform/host-control.mjs'], {
    env: { ...process.env, HOST_CONTROL_SECRET: secret },
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (controller.exitCode !== null || controller.signalCode !== null)
      throw new Error('Fixture controller exited');
    if (
      await fetch('http://127.0.0.1:10000/health')
        .then((r) => r.ok)
        .catch(() => false)
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Fixture controller did not start');
}
async function stop() {
  if (!controller || controller.exitCode !== null || controller.signalCode !== null) return;
  const exited = once(controller, 'exit');
  controller.kill('SIGTERM');
  await exited;
}
async function call(envelope) {
  const response = await fetch('http://127.0.0.1:10000/control', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    headers: {
      ...(envelope.secret ? { authorization: `Bearer ${envelope.secret}` } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ boot_id: envelope.boot_id, request: envelope.request }),
  });
  const text = await response.text();
  assert(!text.includes(secret), 'Secret reached controller output');
  return {
    code: response.ok ? 0 : response.status,
    output: response.ok ? text : '',
    error: response.ok ? '' : text,
  };
}

try {
  await start();
  const first = await call({ secret, request: { action: 'health' } });
  assert.equal(first.code, 0);
  const boot = JSON.parse(first.output).value.boot_id;
  const wrong = await call({ secret: randomUUID() + randomUUID(), request: { action: 'health' } });
  assert.notEqual(wrong.code, 0);
  assert.equal(wrong.code, 401);
  const missing = await call({ request: { action: 'health' } });
  assert.notEqual(missing.code, 0);
  assert.equal(missing.code, 401);
  const mismatch = await call({ secret, boot_id: randomUUID(), request: { action: 'quiesce' } });
  assert.notEqual(mismatch.code, 0);
  assert(mismatch.error.includes('host_restarted'));
  await stop();
  await start(); // Same container and disk; a new controller must have a new boot identity.
  const restarted = await call({ secret, boot_id: boot, request: { action: 'quiesce' } });
  assert.notEqual(restarted.code, 0);
  assert(restarted.error.includes('host_restarted'));
  const healthy = await call({ secret, request: { action: 'health' } });
  assert.equal(healthy.code, 0);
  assert.notEqual(JSON.parse(healthy.output).value.boot_id, boot);
  console.log(
    JSON.stringify({
      private_http_auth_passed: true,
      wrong_secret_rejected: true,
      restarted_boot_rejected: true,
    }),
  );
} finally {
  await stop();
}
