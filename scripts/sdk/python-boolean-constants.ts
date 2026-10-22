import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Generator 7.24 emits string enum checks for boolean consts. Retain the
 * authored literal constraint without making valid JSON booleans unparseable. */
export function pythonBooleanConstants(source: string): string {
  return source.replace(
    /(@field_validator\('([a-z_][a-z0-9_]*)'\)\n    def [a-z_][a-z0-9_]*\(cls, value\):\n        """Validates the enum"""\n        )if value not in set\(\['(true|false)'\]\):/g,
    (match: string, prefix: string, field: string, literal: string) =>
      source.includes(`    ${field}: StrictBool`)
        ? `${prefix}if value is not ${literal === 'true' ? 'True' : 'False'}:`
        : match,
  );
}

export async function preservePythonBooleanConstants(output: string) {
  const directory = path.join(output, 'macrofold/models');
  for (const file of await readdir(directory)) {
    if (!file.endsWith('.py')) continue;
    const target = path.join(directory, file);
    const source = await readFile(target, 'utf8');
    const updated = pythonBooleanConstants(source);
    if (updated !== source) await writeFile(target, updated);
  }
}
