import { lstat, readFile } from 'node:fs/promises';
import { CliError, readStdin } from './output';

/** Connection and deployment setup share one bounded, protected input boundary. */
export async function protectedJSON(file: string): Promise<unknown> {
  if (file === '-') return JSON.parse(await readStdin()) as unknown;
  const stat = await lstat(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new CliError('Use an ordinary protected JSON file.');
  if (process.platform !== 'win32' && stat.mode & 0o077)
    throw new CliError('Input files must have private permissions (chmod 600 FILE).');
  if (stat.size > 4 * 1024 * 1024) throw new CliError('Input file exceeds 4 MiB.');
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}
