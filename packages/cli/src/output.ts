import { stdin, stdout, stderr } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { stripVTControlCharacters } from 'node:util';
import { ApiError, TransportError } from '../../../sdk/typescript/src/client';

export class CliError extends Error {
  constructor(
    message: string,
    public exitCode = 2,
  ) {
    super(message);
  }
}
/** Strip terminal escape/clipboard sequences from all model, tool and remote resource strings. */
export const terminalText = (value: unknown) =>
  stripVTControlCharacters(String(value)).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
export function output(value: unknown, json = false) {
  if (json) {
    stdout.write(JSON.stringify(value) + '\n');
    return;
  }
  if (typeof value === 'string') {
    stdout.write(terminalText(value) + '\n');
    return;
  }
  if (value && typeof value === 'object' && 'data' in value && Array.isArray(value.data)) {
    const rows = value.data as Record<string, unknown>[];
    if (!rows.length) {
      stdout.write('No results.\n');
      return;
    }
    const keys = ['id', 'name', 'status', 'harness', 'model', 'created_at'].filter((k) =>
      rows.some((r) => r[k] !== undefined),
    );
    for (const row of rows) stdout.write(keys.map((k) => terminalText(row[k] ?? '')).join('  ') + '\n');
    if ('next_cursor' in value && value.next_cursor)
      stderr.write(`More results: --cursor ${terminalText(value.next_cursor)}\n`);
    return;
  }
  stdout.write(terminalText(JSON.stringify(value, null, 2)) + '\n');
}
export async function prompt(question: string) {
  if (!stdin.isTTY) throw new CliError('This command needs a terminal or explicit flags.');
  const reader = createInterface({ input: stdin, output: stderr });
  try {
    return await reader.question(question);
  } finally {
    reader.close();
  }
}
export async function confirm(question: string, yes = false) {
  if (yes) return;
  if (!stdin.isTTY) throw new CliError('Review with --dry-run, then pass --yes to apply without a terminal.');
  if (!/^y(es)?$/i.test((await prompt(question + ' [y/N] ')).trim()))
    throw new CliError('No changes applied.', 0);
}
export async function readStdin() {
  let text = '';
  for await (const chunk of stdin) {
    text += chunk;
    if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new CliError('Input exceeds 4 MiB.');
  }
  return text;
}
export function exitFor(error: unknown) {
  if (error instanceof CliError) return error.exitCode;
  if (error instanceof TransportError) return 7;
  if (error instanceof ApiError) {
    if ([401, 403].includes(error.status)) return 3;
    if ([409, 412].includes(error.status)) return 5;
    if ([402, 413, 429].includes(error.status)) return 6;
    if (error.status >= 500) return 7;
  }
  return 1;
}
