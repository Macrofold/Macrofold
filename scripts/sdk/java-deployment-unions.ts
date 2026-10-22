import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SchemaObject } from 'openapi-typescript';
import { resolve, specification } from './schema';

type Variant = { model: string; required: string[]; properties: string[]; closed: boolean };

/** Jackson does not enforce required/closed object shapes during oneOf matching.
 * Retain these authored constraints before asking the generated typed decoder. */
export function javaUnionConstraints(source: string, variants: Variant[]): string {
  for (const variant of variants) {
    const before = `// deserialize ${variant.model}
            try {
                boolean attemptParsing = true;`;
    if (source.split(before).length !== 2) throw new Error(`Recheck Java union generation: ${variant.model}`);
    const checks = [
      'tree.isObject()',
      ...variant.required.map((name) => `tree.hasNonNull(${JSON.stringify(name)})`),
      ...(variant.closed
        ? [
            `java.util.stream.StreamSupport.stream(java.util.Spliterators.spliteratorUnknownSize(tree.fieldNames(), java.util.Spliterator.ORDERED), false).allMatch(java.util.Set.of(${variant.properties.map((name) => JSON.stringify(name)).join(', ')})::contains)`,
          ]
        : []),
    ];
    source = source.replace(before, before.replace('true;', checks.join(' && ') + ';'));
  }
  return source;
}

export async function preserveJavaDeploymentUnions(output: string) {
  const unions: Record<string, [string, number][]> = {
    InferenceBinding: [
      ['DecisionBinding', 0],
      ['ModelDeploymentBinding', 1],
    ],
    ModelDeploymentSource: [
      ['ModelDeploymentExternalSource', 1],
      ['ModelDeploymentHuggingFaceSource', 0],
    ],
    ModelDeploymentRuntime: [
      ['ModelDeploymentRuntimeOneOf', 0],
      ['ModelDeploymentRuntimeOneOf1', 1],
    ],
    ModelDeploymentHosting: [
      ['ModelDeploymentHostingOneOf', 0],
      ['ModelDeploymentHostingOneOf1', 1],
    ],
    ModelDeploymentServicePolicy: [
      ['ModelDeploymentServicePolicyOneOf', 0],
      ['ModelDeploymentServicePolicyOneOf1', 1],
    ],
  };
  for (const [name, models] of Object.entries(unions)) {
    const definition = specification.components?.schemas?.[name];
    if (!definition) throw new Error(`Missing Java union schema: ${name}`);
    const schema = resolve<SchemaObject>(definition);
    const branches = schema.oneOf;
    if (!branches || branches.length !== models.length) throw new Error(`Recheck Java union schema: ${name}`);
    const variants = models.map(([model, index]) => {
      const branch = resolve<SchemaObject>(branches[index]);
      if (!('properties' in branch) || !branch.properties || !branch.required?.length)
        throw new Error(`Recheck Java union branch: ${name}/${model}`);
      return {
        model,
        required: branch.required,
        properties: Object.keys(branch.properties),
        closed: 'additionalProperties' in branch && branch.additionalProperties === false,
      };
    });
    const target = path.join(output, 'src/main/java/dev/macrofold/model', name + '.java');
    await writeFile(target, javaUnionConstraints(await readFile(target, 'utf8'), variants));
  }
}
