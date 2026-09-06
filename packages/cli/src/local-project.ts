import { lstat, mkdir, readFile, realpath, rename, rm, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';

const linkSchema = z.object({
  version: z.literal(1),
  profile: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  organizationId: z.uuid(),
  projectId: z.uuid(),
  workspaceId: z.uuid(),
  sessionId: z.uuid().optional(),
});
export type ProjectLink = z.infer<typeof linkSchema>;
export type Baseline = Record<string, string | null>;
export async function git(args: string[], cwd = process.cwd()): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'credential.helper=',
        '-c',
        'protocol.file.allow=always',
        '-c',
        'submodule.recurse=false',
        ...args,
      ],
      {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '',
      error = '';
    child.stdout.on('data', (b) => {
      output += b;
      if (output.length > 8 * 1024 * 1024) child.kill();
    });
    child.stderr.on('data', (b) => {
      error += b;
      if (error.length > 65536) child.kill();
    });
    child.on('error', reject);
    // `close` guarantees stdout/stderr have drained, unlike process `exit`.
    child.on('close', (code) =>
      code === 0 ? resolve(output) : reject(new Error(error.trim() || 'Git command failed')),
    );
  });
}
export function relativeFile(value: string) {
  const normalized = value.split(path.sep).join('/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.includes('\\') ||
    /[\x00-\x1f<>:"|?*]/.test(normalized) ||
    normalized
      .split('/')
      .some(
        (p) =>
          !p ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p) ||
          ['.', '..', '.git', '.agent', '.platform-runtime'].includes(p.toLowerCase()),
      )
  )
    throw new Error(`Unsafe project path: ${value}`);
  return normalized;
}
async function metadataDirectory(root: string) {
  const directory = path.join(root, '.agent');
  try {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error('.agent must be an ordinary local directory.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(directory, { mode: 0o700 });
  }
  return directory;
}
export async function findLink(
  start = process.cwd(),
): Promise<{ root: string; link: ProjectLink } | undefined> {
  let directory = await realpath(start);
  while (true) {
    const file = path.join(directory, '.agent', 'link.json');
    try {
      const parent = await lstat(path.dirname(file));
      if (parent.isSymbolicLink() || !parent.isDirectory())
        throw new Error('Refusing a symlinked project association.');
      const stat = await lstat(file);
      if (stat.isSymbolicLink() || !stat.isFile())
        throw new Error('Refusing a symlinked project association.');
      return { root: directory, link: linkSchema.parse(JSON.parse(await readFile(file, 'utf8'))) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}
export async function writeLink(root: string, link: ProjectLink) {
  const directory = await metadataDirectory(root),
    dest = path.join(directory, 'link.json'),
    temp = `${dest}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(linkSchema.parse(link), null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temp, dest);
  try {
    const exclude = (await git(['rev-parse', '--git-path', 'info/exclude'], root)).trim();
    const file = path.resolve(root, exclude);
    await mkdir(path.dirname(file), { recursive: true });
    const previous = await readFile(file, 'utf8').catch(() => '');
    if (!previous.split('\n').includes('.agent/')) await appendFile(file, '\n.agent/\n');
  } catch {
    /* A standalone linked folder need not be a Git checkout. */
  }
}
export async function unlinkProject(root: string) {
  await metadataDirectory(root);
  await rm(path.join(root, '.agent', 'link.json'), { force: true });
}
export async function loadBaseline(root: string, workspace: string): Promise<Baseline> {
  const directory = await metadataDirectory(root);
  const file = path.join(directory, `baseline-${z.uuid().parse(workspace)}.json`);
  try {
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) throw new Error('Refusing a symlinked baseline.');
    return z
      .record(
        z.string(),
        z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
      )
      .parse(JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}
export async function saveBaseline(root: string, workspace: string, baseline: Baseline) {
  const directory = await metadataDirectory(root);
  const file = path.join(directory, `baseline-${z.uuid().parse(workspace)}.json`),
    temp = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(baseline), { mode: 0o600, flag: 'wx' });
  await rename(temp, file);
}
/** Reject symlink ancestors before reading or replacing local files. Remote content never chooses an absolute path. */
export async function safeLocalPath(root: string, relative: string) {
  const value = relativeFile(relative);
  let current = await realpath(root);
  for (const segment of value.split('/')) {
    current = path.join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`Refusing symlink path: ${relative}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return current;
}
