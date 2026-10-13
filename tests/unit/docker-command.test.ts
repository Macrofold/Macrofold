import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dockerCommand } from '../../packages/providers/src/docker';
import { dockerDiagnostic, dockerFailure } from '../../packages/providers/src/docker-diagnostic';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));
afterEach(() => {
  spawn.mockReset();
  vi.useRealTimers();
});
function processFixture() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
  });
  spawn.mockReturnValue(child);
  return child;
}

describe('safe Docker diagnostics', () => {
  it.each([
    ['Error response from daemon: No such image: private-image', 'docker_image_missing'],
    ['Unable to find image private-image locally', 'docker_image_missing'],
    ['Cannot connect to the Docker daemon at unix:///private/socket', 'docker_daemon_unavailable'],
    ['error during connect: secret TLS error', 'docker_daemon_unavailable'],
    ['network private-network not found', 'docker_network_missing'],
    ['write /private/customer-file: no space left on device', 'docker_disk_full'],
    ['private customer output and secret credentials', 'docker_transport_failed'],
  ])('classifies %s without returning raw details', (stderr, code) => {
    const error = dockerFailure(stderr);
    expect(error).toMatchObject({ status: 503, code, details: {} });
    expect(error.message).toBe(dockerDiagnostic(code));
    expect(JSON.stringify(error)).not.toContain('private');
    expect(error.message).not.toMatch(/private|secret/);
  });
  it('does not trust unknown error messages for operator diagnostics', () => {
    expect(dockerDiagnostic('__proto__')).toBeUndefined();
    expect(dockerDiagnostic('secret_error')).toBeUndefined();
  });
  it('returns successful binary output and keeps credentials on stdin', async () => {
    const child = processFixture();
    const pending = dockerCommand(['exec', 'container', 'command'], Buffer.from('synthetic-secret'));
    child.stdout.write(Buffer.from([0, 255, 1]));
    child.emit('close', 0);
    expect(await pending).toEqual(Buffer.from([0, 255, 1]));
    expect(child.stdin.read().toString()).toBe('synthetic-secret');
    expect(JSON.stringify(spawn.mock.calls)).not.toContain('synthetic-secret');
  });
  it('classifies actual command failure using only a bounded stderr prefix', async () => {
    const child = processFixture();
    const pending = expect(dockerCommand(['create'])).rejects.toMatchObject({ code: 'docker_transport_failed' });
    child.stderr.write(Buffer.alloc(16 * 1024, 'x'));
    child.stderr.write('No such image: private-image');
    child.emit('close', 1);
    await pending;
  });
  it('reports a missing binary safely', async () => {
    const child = processFixture();
    const pending = expect(dockerCommand(['ps'])).rejects.toMatchObject({ code: 'docker_unavailable' });
    child.emit('error', new Error('secret binary path'));
    child.emit('close', -2);
    await pending;
  });
  it.each([['inspect', 30_000], ['/opt/platform/stdio-call.mjs', 60_000]] as const)(
    'kills an unconfirmed %s command at its deadline', async (operation, deadline) => {
      vi.useFakeTimers();
      const child = processFixture();
      const pending = expect(dockerCommand([operation])).rejects.toMatchObject({ code: 'docker_command_timeout' });
      await vi.advanceTimersByTimeAsync(deadline - 1);
      expect(child.kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      child.emit('close', null);
      await pending;
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it('kills oversized command output instead of buffering it', async () => {
    const child = processFixture();
    const pending = expect(dockerCommand(['inspect'])).rejects.toMatchObject({ code: 'docker_transport_failed' });
    child.stdout.write(Buffer.alloc(8 * 1024 * 1024 + 1));
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.emit('close', null);
    await pending;
  });
  it('treats broken stdin as an unconfirmed operation', async () => {
    const child = processFixture();
    const pending = expect(dockerCommand(['exec'])).rejects.toMatchObject({ code: 'docker_transport_failed' });
    child.stdin.emit('error', new Error('secret input error'));
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.emit('close', null);
    await pending;
  });
});
