import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** The pinned generator omits string const validation. The open HF source
 * otherwise also matches an external source with declared provenance. */
export function goSourceKind(source: string, model: string, kind: 'external' | 'hugging_face'): string {
  const before = `\tvar${model} := _${model}{}`;
  if (source.split(before).length !== 2) throw new Error(`Recheck Go source kind generation: ${model}`);
  return source.replace(
    before,
    `\tif kind, ok := allProperties["kind"].(string); !ok || kind != "${kind}" {
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
    await writeFile(target, goSourceKind(await readFile(target, 'utf8'), model, kind));
  }
}
