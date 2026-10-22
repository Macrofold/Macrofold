import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SchemaObject } from 'openapi-typescript';
import { resolve, specification } from './schema';

/** The pinned generator omits string const validation. The open HF source
 * otherwise also matches an external source with declared provenance. */
export function goSourceKind(
  source: string,
  model: string,
  kind: 'external' | 'hugging_face',
  allowed: string[],
): string {
  const before = `\tvar${model} := _${model}{}`;
  if (source.split(before).length !== 2) throw new Error(`Recheck Go source kind generation: ${model}`);
  return source.replace(
    before,
    `\tfor property := range allProperties {
\t\tswitch property {
\t\tcase ${allowed.map((name) => JSON.stringify(name)).join(', ')}:
\t\tdefault:
\t\t\treturn fmt.Errorf("unexpected source property %v", property)
\t\t}
\t}
\tif kind, ok := allProperties["kind"].(string); !ok || kind != "${kind}" {
\t\treturn fmt.Errorf("expected source kind ${kind}")
\t}

${before}`,
  );
}

export async function preserveGoSourceKinds(output: string) {
  for (const [file, model, kind] of [
    ['model_model_deployment_external_source.go', 'ModelDeploymentExternalSource', 'external'],
    ['model_model_deployment_hugging_face_source.go', 'ModelDeploymentHuggingFaceSource', 'hugging_face'],
  ] as const) {
    const target = path.join(output, file);
    const definition = specification.components?.schemas?.[model];
    if (!definition) throw new Error(`Missing Go source schema: ${model}`);
    const schema = resolve<SchemaObject>(definition);
    if (
      !('additionalProperties' in schema) ||
      schema.additionalProperties !== false ||
      !('properties' in schema) ||
      !schema.properties
    )
      throw new Error(`Recheck Go source schema: ${model}`);
    await writeFile(
      target,
      goSourceKind(await readFile(target, 'utf8'), model, kind, Object.keys(schema.properties)),
    );
  }
}
