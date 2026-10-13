import { describe, expect, it } from 'vitest';
import { runRecoveryMessage } from '../../apps/web/lib/run-recovery';
import type { RunRecoveryStep } from '../../packages/contracts/run-recovery';

const event = (data: Record<string, unknown>) => ({ type: 'run.recovery_required', data });
describe('actionable stopped-run messages', () => {
  it.each([
    ['dispatch', 'Run processing stopped.'],
    ['checkpoint', 'Couldn’t save run files.'],
    ['billing', 'Couldn’t finalize run billing.'],
    ['finalization', 'Couldn’t finish recording this run.'],
    ['cleanup', 'Couldn’t clean up the worker.'],
  ] satisfies [RunRecoveryStep, string][])(
    'identifies %s without guessing from persistence',
    (step, title) => {
      const message = runRecoveryMessage(
        [event({ step, cause: 'file_permission_denied', attempts: 8 })],
        'pending',
      );
      expect(message.title).toBe(title);
      expect(message.reason).toContain('rejected');
      expect(message.attempts).toBe(8);
      expect(message.consequence).toContain('not confirmed saved');
    },
  );

  it('keeps verified files separate from failed cleanup and earlier execution failure', () => {
    const message = runRecoveryMessage(
      [
        event({ step: 'checkpoint', cause: 'file_permission_denied', attempts: 3 }),
        event({
          step: 'cleanup',
          cause: 'docker_command_timeout',
          attempts: 8,
          original_failure_code: 'model_request_timeout',
        }),
      ],
      'verified',
    );
    expect(message.title).toBe('Couldn’t clean up the worker.');
    expect(message.consequence).toContain('saved in a verified checkpoint');
    expect(message.originalFailure).toBe('model_request_timeout');
    expect(message.cause).toBe('docker_command_timeout');
    expect(message.action).toContain('execution environment');
  });

  it('leaves missing or unrecognized details unknown and withholds arbitrary error text', () => {
    for (const data of [
      {},
      {
        step: '__proto__',
        cause: 'secret: arbitrary exception',
        attempts: -1,
        original_failure_code: '<script>',
      },
    ]) {
      const message = runRecoveryMessage([event(data)]);
      expect(message.title).toBe('Run processing stopped.');
      expect(message.label).toContain('not recorded');
      expect(message.reason).toContain('No further safe error detail');
      expect(message.attempts).toBeUndefined();
      expect(message.cause).toBeUndefined();
      expect(message.originalFailure).toBeUndefined();
    }
    const unknown = runRecoveryMessage([event({ cause: 'unknown_error', attempts: NaN })], 'not_required');
    expect(unknown.cause).toBe('unknown_error');
    expect(unknown.consequence).toContain('did not require');
    expect(unknown.attempts).toBeUndefined();
  });
});
