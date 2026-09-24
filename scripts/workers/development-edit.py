"""Reviewed mechanical integration; removed by the feature-branch workflow after application."""
from pathlib import Path

def edit(file, old, new, all=False):
    p=Path(file); s=p.read_text()
    if old not in s: raise RuntimeError(f'Expected source changed: {file}: {old[:100]}')
    p.write_text(s.replace(old,new) if all else s.replace(old,new,1))

edit('scripts/migrate.ts', "await client.query('REVOKE INSERT, UPDATE, DELETE ON worker_offerings FROM platform_app');", "await client.query(`REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON worker_offerings FROM ${role}`);")
edit('packages/runtime/src/types.ts', "import type { RunAttachment }", "import type { HostRunContext } from './host-paths';\nimport type { RunAttachment }")
edit('packages/runtime/src/types.ts', '  runId: string;', '  runId: string;\n  hostRun?: HostRunContext;')
# Use one internal name for retained process ownership.
for p in [*Path('packages/runtime').rglob('*.ts'), *Path('tests').rglob('*.ts')]:
    s=p.read_text(); n=s.replace('ResidentWorker','LiveHarness').replace('discardResident','discardHarness')
    if n!=s:p.write_text(n)
edit('packages/runtime/src/supervisor.ts', "import { controlDirectory }", "import { hostRunContextSchema, hostRunPaths } from './host-paths';\nimport { controlDirectory }")
edit('packages/runtime/src/supervisor.ts', 'agentProcesses, freezeAgent, stopAgent, signalAgent', 'agentProcesses, agentMemoryMiB, freezeAgent, stopAgent, signalAgents')
edit('packages/runtime/src/supervisor.ts', 'const UID = 10001;\n', '')
edit('packages/runtime/src/supervisor.ts', '  runId: z.uuid(),', '  runId: z.uuid(),\n  hostRun: hostRunContextSchema.optional(),')
edit('packages/runtime/src/supervisor.ts', 'export type LiveHarness = {', 'export type LiveHarness = {\n  uid?: number;')
edit('packages/runtime/src/supervisor.ts', '  await stopAgent();\n  resident.child?.stdin.destroy();', '  await stopAgent(resident.uid ?? 10001);\n  resident.child?.stdin.destroy();')
edit('packages/runtime/src/supervisor.ts', '  const directory = path.dirname(configurationPath);', "  const UID = c.hostRun?.uid ?? resident?.uid ?? 10001;\n  const directory = path.dirname(configurationPath);\n  const hostPaths = c.hostRun ? hostRunPaths(c.hostRun) : undefined;\n  if (c.hostRun && (!resident || resident.uid !== UID)) throw new Error('Invalid handle ownership');")
edit('packages/runtime/src/supervisor.ts', "    c.workspace !== '/workspace' ||\n    c.stateHome !== '/agent-home' ||\n    (directory !== controlDirectory() &&", "    c.workspace !== (hostPaths?.workspace ?? '/workspace') ||\n    c.stateHome !== (hostPaths?.home ?? '/agent-home') ||\n    (directory !== (hostPaths?.control ?? controlDirectory()) &&")
edit('packages/runtime/src/supervisor.ts', "  const workerConfig = '/agent-home/.runtime-config.json';", "  const workerConfig = path.join(c.stateHome, '.runtime-config.json');\n  const temporary = hostPaths?.temp ?? path.join(c.stateHome, '.runtime-transient/tmp');\n  await mkdir(temporary, { recursive: true, mode: 0o700 });\n  await chown(temporary, UID, UID);")
edit('packages/runtime/src/supervisor.ts', "HOME: c.stateHome, LANG: 'C.UTF-8'", "HOME: c.stateHome, TMPDIR: temporary, USER: `agent${UID}`, LOGNAME: `agent${UID}`, LANG: 'C.UTF-8'")
# Remaining UID operations now live inside supervise, after resolving the handle identity.
p=Path('packages/runtime/src/supervisor.ts'); s=p.read_text(); split=s.index('export async function supervise')
s=s[:split]+s[split:].replace('agentProcesses()','agentProcesses(UID)').replace('stopAgent()','stopAgent(UID)').replace('freezeAgent(resident.processes)','freezeAgent(resident.processes, UID)')
s=s.replace("for (const pid of resident.processes) signalAgent(pid, 'SIGCONT');", "await signalAgents(resident.processes, 'SIGCONT', UID);")
s=s.replace("failure: 'cancelled' | 'timed_out' | undefined;", "failure: 'cancelled' | 'timed_out' | undefined;\n  let resourceFailure: string | undefined;")
s=s.replace("        if (Date.now() >= Date.parse(c.deadline)) failure = 'timed_out';", "        if (Date.now() >= Date.parse(c.deadline)) failure = 'timed_out';\n        if (!failure && c.hostRun && await agentMemoryMiB(UID) > c.hostRun.memoryMiB) {\n          resourceFailure = 'memory_limit';\n          failure = 'cancelled';\n        }")
s=s.replace("  let persistence: 'captured' | 'failed' = 'captured',", "  let snapshotBytes = 0;\n  let persistence: 'captured' | 'failed' = 'captured',")
s=s.replace("    await captureSnapshot({ workspace: c.workspace, home: c.stateHome }, path.join(directory, 'snapshot'));", "    const snapshot = await captureSnapshot({ workspace: c.workspace, home: c.stateHome }, path.join(directory, 'snapshot'));\n    snapshotBytes = snapshot.totalBytes;")
s=s.replace("    ...(failure ? { outcome: failure, failureCode: failure } : {}),", "    ...(failure ? { outcome: resourceFailure ? 'failure' : failure, failureCode: resourceFailure || failure } : {}),\n    snapshotBytes,")
p.write_text(s)

edit('packages/runtime/src/native-worker.ts', "['PATH', 'NODE_ENV', 'LANG', 'SSL_CERT_FILE', 'SSL_CERT_DIR']", "['PATH', 'NODE_ENV', 'LANG', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'TMPDIR', 'USER', 'LOGNAME']")
edit('packages/runtime/src/control-directory.ts', "  const run = process.env.PLATFORM_RUN_ID;", "  const assignment = process.env.PLATFORM_ASSIGNMENT_ID;\n  if (assignment) {\n    if (!/^[a-f0-9-]{36}$/.test(assignment)) throw new Error('Invalid runtime assignment ID');\n    return `/platform-control/assignments/${assignment}`;\n  }\n  const run = process.env.PLATFORM_RUN_ID;")
edit('packages/runtime/src/restore.ts', "      await restoreSnapshot(\n        `${controlDirectory()}/restore`,\n        { workspace: '/workspace', home: '/agent-home' },\n        10001,\n      );", "      const configuration = JSON.parse(await readFile(`${controlDirectory()}/config.json`, 'utf8'));\n      const { runtimeConfiguration } = await import('./supervisor');\n      const checked = runtimeConfiguration.parse(configuration);\n      const { hostRunPaths } = await import('./host-paths');\n      const assigned = checked.hostRun ? hostRunPaths(checked.hostRun) : undefined;\n      if (checked.workspace !== (assigned?.workspace ?? '/workspace') || checked.stateHome !== (assigned?.home ?? '/agent-home') ||\n          (assigned && assigned.control !== controlDirectory())) throw new Error('Unexpected restore roots');\n      await restoreSnapshot(`${controlDirectory()}/restore`, { workspace: checked.workspace, home: checked.stateHome }, checked.hostRun?.uid ?? 10001);")
edit('packages/runtime/src/stdio-call.ts', "const configuration = JSON.parse(await readFile(`${root}/config.json`, 'utf8'));", "const { runtimeConfiguration } = await import('./supervisor');\nconst configuration = runtimeConfiguration.parse(JSON.parse(await readFile(`${root}/config.json`, 'utf8')));\nconst uid = configuration.hostRun?.uid ?? 10001;")
edit('packages/runtime/src/stdio-call.ts', "process.env.HOME = '/agent-home';", 'process.env.HOME = configuration.stateHome;')
edit('packages/runtime/src/stdio-call.ts', 'process.setgid!(10001);', 'process.setgid!(uid);')
edit('packages/runtime/src/stdio-call.ts', 'process.setuid!(10001);', 'process.setuid!(uid);')
edit('packages/runtime/src/stdio-call.ts', "process.chdir('/workspace');", 'process.chdir(configuration.workspace);')
edit('packages/runtime/src/stdio-call.ts', "  cwd: '/workspace',", '  cwd: configuration.workspace,')

# Bound full manifest memory without serializing cancel/probe/control traffic.
p=Path('packages/runtime/src/manifest.ts'); s=p.read_text()
s=s.replace('export async function captureSnapshot(', 'async function captureSnapshotOwned(',1)
idx=s.index('/** A bounded probe')
wrapper='''let captures = 0;
const captureWaiters: (() => void)[] = [];
export async function captureSnapshot(
  roots: { workspace: string; home: string }, output: string,
  limits = { bytes: 10 * 1024 ** 3, entries: 100_000 },
): Promise<SnapshotIndex> {
  if (captures >= 2) await new Promise<void>(resolve => captureWaiters.push(resolve));
  else captures++;
  try { return await captureSnapshotOwned(roots, output, limits); }
  finally {
    const next = captureWaiters.shift();
    if (next) next();
    else captures--;
  }
}

'''
s=s[:idx]+wrapper+s[idx:]
s=s.replace('only after every process belonging to the agent UID has exited.', 'only after the current handle\'s writers are stopped or safely suspended.')
p.write_text(s)

# Reuse provider transports, while keeping the two protocols distinguishable during this WIP cutover.
for name in ['docker','vercel']:
    p=Path(f'packages/providers/src/{name}.ts'); s=p.read_text()
    s="import type { HostBinding, HostControlRequest } from '../../contracts/host-control';\n"+s
    if name=='docker':
        s=s.replace('async provision(name: string, timeoutSeconds: number | null):', 'async provision(name: string, timeoutSeconds: number | null, resources?: { memory_mib: number; cpu_millis: number }):')
        s=s.replace("'--cpus=2',", "`--cpus=${resources ? resources.cpu_millis / 1000 : 2}`,")
        s=s.replace("'--memory=4g',", "`--memory=${resources ? `${resources.memory_mib}m` : '4g'}`,")
        s=s.replace("'--memory-swap=4g',", "`--memory-swap=${resources ? `${resources.memory_mib}m` : '4g'}`,")
        s=s.replace("'--pids-limit=512',", "`--pids-limit=${resources ? 4096 : 512}`,")
    else:
        s=s.replace('async provision(name: string, timeoutSeconds: number):', 'async provision(name: string, timeoutSeconds: number, resources?: { memory_mib: number; cpu_millis: number }):')
        s=s.replace('resources: { vcpus: 2 },', 'resources: { vcpus: resources ? resources.cpu_millis / 1000 : 2 },')
    s=s.replace('async startControl(binding: MachineBinding, secret: string) {', "async startControl(binding: MachineBinding, secret: string, entry: 'sandbox-control' | 'host-control' = 'sandbox-control') {")
    s=s.replace("'/opt/platform/sandbox-control.mjs'", "'/opt/platform/"+'" + entry + "'+".mjs'")
    marker='  async control(binding: SandboxBinding, _secret: string, request: SandboxControlRequest) {'
    if marker not in s: raise RuntimeError('Missing provider control: '+name)
    s=s.replace(marker, '''  startHostControl(binding: MachineBinding, secret: string) { return this.startControl(binding, secret, 'host-control'); }
  hostControl(binding: HostBinding, secret: string, request: HostControlRequest) { return this.controlRequest(binding, secret, request, 'host-control-cli'); }
  control(binding: SandboxBinding, secret: string, request: SandboxControlRequest) { return this.controlRequest(binding, secret, request, 'sandbox-control-cli'); }
  private async controlRequest(binding: SandboxBinding | HostBinding, _secret: string, request: SandboxControlRequest | HostControlRequest, entry: 'sandbox-control-cli' | 'host-control-cli') {''')
    s=s.replace("'/opt/platform/sandbox-control-cli.mjs'", '`/opt/platform/${entry}.mjs`')
    p.write_text(s)

# Configure and meter returns are part of the boot-fenced Host protocol.
edit('packages/contracts/host-control.ts', "  boot_id: z.uuid(), started_at: z.string(), configured: z.boolean(),", "  boot_id: z.uuid(), started_at: z.string(), configured: z.boolean(), rotation_requested: z.boolean().optional(),")
p=Path('packages/providers/src/hosts.ts'); s=p.read_text()
old="""    try {
      const health = hostHealth.parse(await this.control(binding, spec.secret, { action: 'health' }));
      return { ...binding, sessionId: health.boot_id, controlBootId: health.boot_id };
    } catch { return null; }"""
if old not in s:raise RuntimeError('Render receipt boundary changed')
s=s.replace(old,'    return binding;')
p.write_text(s)
edit('packages/core/src/worker-reconciler.ts', 'if (meters) await mutateHost(org, hostId, leaseId, async (tx, current) => settleHostSample(tx, current, meters));', 'if (meters) { const sample = meters; await mutateHost(org, hostId, leaseId, async (tx, current) => settleHostSample(tx, current, sample)); }')
p=Path('packages/runtime/src/host-control.ts'); s=p.read_text()
s=s.replace("import path from 'node:path';\n",'').replace('readFile, readdir, rm, statfs','readFile, rm, statfs')
s=s.replace('    const context: HostRunContext=', '    const owner = handle;\n    const context: HostRunContext=')
s=s.replace('paths.temp],handle.uid);','paths.temp],owner.uid);')
s=s.replace("        case 'release': {", "        case 'release': return this.commands.run('allocation', async () => {")
s=s.replace("await this.commands.run('allocation',()=>this.trimCaches());", 'await this.trimCaches();')
s=s.replace("          return {};\n        }\n      }\n    });", "          return {};\n        });\n      }\n    });")
p.write_text(s)

# Build the new controller and the existing authenticated CLI transport under its new executable name.
p=Path('scripts/build-runtime.ts');s=p.read_text()
print('BUILD_SCRIPT_FOR_FOLLOWUP',s)
print('MIGRATION_GRANTS_UPDATED')
