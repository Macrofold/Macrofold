import { lstat, readFile } from 'node:fs/promises';
import { CliError, readStdin } from './output';

function parseProtectedJSON(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    // Native syntax errors can quote secret-bearing input fragments.
    if (error instanceof SyntaxError) throw new CliError('Input must contain valid JSON.');
    throw error;
  }
}

/** Connection and deployment setup share one bounded, protected input boundary. */
export async function protectedJSON(file: string): Promise<unknown> {
  if (file === '-') return parseProtectedJSON(await readStdin());
  const stat = await lstat(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new CliError('Use an ordinary protected JSON file.');
  if (process.platform !== 'win32' && stat.mode & 0o077)
    throw new CliError('Input files must have private permissions (chmod 600 FILE).');
  if (stat.size > 4 * 1024 * 1024) throw new CliError('Input file exceeds 4 MiB.');
  return parseProtectedJSON(await readFile(file, 'utf8'));
}
