/** Each invocation retains its execution marker for the lifetime of this VM. */
export function controlDirectory() {
  const run = process.env.PLATFORM_RUN_ID;
  if (!run) return '/platform-control';
  if (!/^[a-f0-9-]{36}$/.test(run)) throw new Error('Invalid runtime run ID');
  return `/platform-control/runs/${run}`;
}
