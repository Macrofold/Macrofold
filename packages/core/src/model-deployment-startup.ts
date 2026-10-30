import type { DeploymentRow } from './model-deployment-types';

type StartupClock = Pick<DeploymentRow, 'startup_at' | 'readiness_started_at' | 'policy'>;
const PROVISIONING_MS = 30 * 60_000;
const READINESS_MS = 20 * 60_000;
const EPISODE_MS = PROVISIONING_MS + READINESS_MS;

function startupWindow(row: StartupClock) {
  if (!row.startup_at) return null;
  const started = row.startup_at.getTime();
  const readiness = row.readiness_started_at?.getTime();
  const phaseStarted = readiness ?? started;
  return {
    phase: readiness === undefined ? ('provisioning' as const) : ('model_readiness' as const),
    started,
    phaseStarted,
    deadline: Math.min(
      started + EPISODE_MS,
      phaseStarted + (readiness === undefined ? PROVISIONING_MS : READINESS_MS),
    ),
  };
}

/** Provider progress starts one durable readiness window, never another episode.
 * See docs/projects/hugging-face-model-deployments-tech-design.md#startup-reliability-correction. */
export function deploymentStartupStatus(row: StartupClock) {
  const window = startupWindow(row);
  if (!window) return null;
  const stopAt = row.policy?.stop_at ? Date.parse(row.policy.stop_at) : Infinity;
  return {
    phase: window.phase,
    started_at: new Date(window.started).toISOString(),
    phase_started_at: new Date(window.phaseStarted).toISOString(),
    deadline_at: new Date(Math.min(window.deadline, stopAt)).toISOString(),
  };
}

export function deploymentStartupExpired(row: StartupClock, now = Date.now()) {
  const window = startupWindow(row);
  // Scheduled stop has its own ordinary shutdown path, not a startup failure.
  return window !== null && now >= window.deadline;
}
