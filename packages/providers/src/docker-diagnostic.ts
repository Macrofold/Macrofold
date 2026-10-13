import { AppError } from '../../core/src/errors';

// Fixed messages are safe for operator checks and API errors. Never return the
// source stderr: it may contain credentials or native tool/customer output.
const messages = {
  docker_unavailable: 'Docker could not be started. Install Docker and start its daemon.',
  docker_daemon_unavailable: 'Docker is not reachable. Start Docker and check the configured Docker context.',
  docker_image_missing: 'The configured runtime image is missing. Build infra/runtime.Dockerfile or set DOCKER_RUNTIME_IMAGE to an existing runtime image.',
  docker_network_missing: 'The configured Docker network is missing. Create it or correct DOCKER_NETWORK.',
  docker_disk_full: 'Docker has no free disk space. Free space before retrying; keep recoverable execution containers.',
  docker_command_timeout: 'Docker did not confirm the operation before its deadline. Check Docker health; execution identity is retained.',
  docker_transport_failed: 'Docker did not confirm the operation. Execution identity is retained.',
} as const;

/** Lookup instead of trusting an arbitrary error.message when printing diagnostics. */
export function dockerDiagnostic(code: string): string | undefined {
  return Object.hasOwn(messages, code) ? messages[code as keyof typeof messages] : undefined;
}

export function dockerFailure(stderr: string, timedOut = false): AppError {
  const code = timedOut ? 'docker_command_timeout'
    : /cannot connect to the docker daemon|is the docker daemon running|error during connect|failed to connect to the docker api/i.test(stderr) ? 'docker_daemon_unavailable'
    : /no such image|unable to find image/i.test(stderr) ? 'docker_image_missing'
    : /network .* not found/i.test(stderr) ? 'docker_network_missing'
    : /no space left on device/i.test(stderr) ? 'docker_disk_full'
    : 'docker_transport_failed';
  return new AppError(503, code, messages[code]);
}
