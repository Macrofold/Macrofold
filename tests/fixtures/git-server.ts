import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gitTransport } from '../../packages/providers/src/git-http';
const exec = promisify(execFile);
/** Real Git smart-HTTP, backed by a throwaway local bare repository. No GitHub or paid services. */
export async function gitServer() {
  const dir = await mkdtemp(path.join(tmpdir(), 'git-remote-fixture-')),
    work = path.join(dir, 'work');
  const env = {
    PATH: process.env.PATH,
    NODE_ENV: process.env.NODE_ENV,
    HOME: dir,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@localhost',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@localhost',
  };
  const command = (args: string[], cwd = work) =>
    exec('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...args], { cwd, env });
  await command(['init', '--bare', '--initial-branch=main', 'repo.git'], dir);
  await command(['config', 'http.receivepack', 'true'], path.join(dir, 'repo.git'));
  await mkdir(work);
  await command(['init', '--initial-branch=main']);
  await writeFile(path.join(work, 'README.md'), 'initial\n');
  await command(['add', '.']);
  await command(['commit', '-m', 'Initial']);
  await command(['remote', 'add', 'origin', path.join(dir, 'repo.git')]);
  await command(['push', 'origin', 'main']);
  const server = createServer((request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    const child = spawn('git', ['http-backend'], {
      env: {
        ...env,
        GIT_PROJECT_ROOT: dir,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: request.method!,
        CONTENT_TYPE: request.headers['content-type'] || '',
        REMOTE_USER: 'fixture',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let pending = Buffer.alloc(0),
      started = false;
    request.pipe(child.stdin);
    child.stderr.resume();
    child.stdout.on('data', (chunk: Buffer) => {
      if (started) {
        response.write(chunk);
        return;
      }
      pending = Buffer.concat([pending, chunk]);
      const split = pending.indexOf('\r\n\r\n');
      if (split < 0) return;
      const values = pending.subarray(0, split).toString().split('\r\n');
      for (const value of values) {
        const colon = value.indexOf(':');
        const name = value.slice(0, colon),
          text = value.slice(colon + 1).trim();
        if (name.toLowerCase() === 'status') response.statusCode = parseInt(text);
        else response.setHeader(name, text);
      }
      started = true;
      response.write(pending.subarray(split + 4));
      pending = Buffer.alloc(0);
    });
    child.on('error', () => {
      response.statusCode = 500;
      response.end();
    });
    child.on('close', () => response.end());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number },
    url = `http://127.0.0.1:${address.port}/repo.git`;
  return {
    remote: {
      url,
      token: 'local-fixture-token',
      http: gitTransport(url),
      fullName: 'fixture/repo',
      defaultBranch: 'main',
      repositoryId: '1',
    },
    command,
    work,
    async change(text: string) {
      await command(['pull', '--ff-only', 'origin', 'main']);
      await writeFile(path.join(work, 'README.md'), text);
      await command(['add', '.']);
      await command(['commit', '-m', 'Remote change']);
      await command(['push', 'origin', 'main']);
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    },
  };
}
