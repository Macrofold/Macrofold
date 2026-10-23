import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Generator 7.24 emits string enum checks for boolean consts. Retain the
 * authored literal constraint without making valid JSON booleans unparseable. */
export function pythonBooleanConstants(
  source: string,
  expected?: { field: string; literal: boolean },
): string {
  const updated = source.replace(
    /(@field_validator\('([a-z_][a-z0-9_]*)'\)\n    def [a-z_][a-z0-9_]*\(cls, value\):\n        """Validates the enum"""\n        )if value not in set\(\['(true|false)'\]\):/g,
    (match: string, prefix: string, field: string, literal: string) =>
      source.includes(`    ${field}: StrictBool`)
        ? `${prefix}if value is not ${literal === 'true' ? 'True' : 'False'}:`
        : match,
  );
  if (expected) {
    const check = `if value is not ${expected.literal ? 'True' : 'False'}:`;
    if (
      !source.includes(`    ${expected.field}: StrictBool`) ||
      source === updated ||
      updated.split(check).length !== 2
    )
      throw new Error(`Recheck Python boolean constant generation: ${expected.field}`);
  }
  return updated;
}

export async function preservePythonBooleanConstants(output: string) {
  const directory = path.join(output, 'macrofold/models');
  const expected: Record<string, { field: string; literal: boolean }> = {
    'inference_receipt_cost_attribution.py': { field: 'infrastructure_cost_included', literal: false },
    'model_deployment_cost_policy.py': { field: 'infrastructure_cost_included', literal: false },
    'model_deployment_hosting_one_of1.py': { field: 'external_hosting_acknowledged', literal: true },
    'recommendation.py': { field: 'action_executed', literal: false },
  };
  const files = await readdir(directory);
  for (const file of Object.keys(expected))
    if (!files.includes(file)) throw new Error(`Missing Python boolean constant model: ${file}`);
  for (const file of files) {
    if (!file.endsWith('.py')) continue;
    const target = path.join(directory, file);
    const source = await readFile(target, 'utf8');
    const updated = pythonBooleanConstants(source, expected[file]);
    if (updated !== source) await writeFile(target, updated);
  }
}
