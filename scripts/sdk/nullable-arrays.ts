import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SchemaObject } from 'openapi-typescript';
import { specification, resolve, pascal, snake, properties } from './schema';

/** The pinned Go generator preserves nullable scalar presence, but loses it for
 * arrays. Keep nil-as-null through setters, while a zero-value patch still omits
 * the field. The contract determines the affected fields; anchors fail loudly. */
export async function preserveGoNullableArrays(directory: string) {
  for (const [model, raw] of Object.entries(specification.components?.schemas || {})) {
    const fields = Object.entries(properties(raw)).filter(([, value]) => {
      const property = resolve<SchemaObject>(value);
      const types: readonly string[] = Array.isArray(property.type) ? property.type : [];
      return types.includes('array') && types.includes('null');
    });
    if (!fields.length) continue;
    const file = path.join(directory, `model_${snake(model)}.go`);
    let source = await readFile(file, 'utf8');
    function replace(before: string, after: string) {
      if (source.split(before).length !== 2)
        throw new Error(`Recheck nullable array generation: ${model}/${before}`);
      source = source.replace(before, after);
    }
    replace(
      `type ${model} struct {`,
      `type ${model} struct {\n${fields.map(([field]) => `\t${field}Set bool`).join('\n')}`,
    );
    for (const [field] of fields) {
      const name = pascal(field);
      replace(`if o == nil || IsNil(o.${name}) {`, `if o == nil || (!o.${field}Set && IsNil(o.${name})) {`);
      replace(`if o != nil && !IsNil(o.${name}) {`, `if o != nil && (o.${field}Set || !IsNil(o.${name})) {`);
      replace(`o.${name} = v\n}`, `o.${name} = v\n\to.${field}Set = true\n}`);
      replace(`if o.${name} != nil {`, `if o.${field}Set || o.${name} != nil {`);
      source += `\n// Unset${name} restores omission; Set${name}(nil) sends JSON null.\nfunc (o *${model}) Unset${name}() { o.${name} = nil; o.${field}Set = false }\n`;
    }
    source += `\nfunc (o *${model}) UnmarshalJSON(data []byte) error {
 type Alias ${model}
 var value Alias
 if err := json.Unmarshal(data, &value); err != nil { return err }
 var fields map[string]json.RawMessage
 if err := json.Unmarshal(data, &fields); err != nil { return err }
 *o = ${model}(value)
 ${fields.map(([field]) => `_, o.${field}Set = fields[${JSON.stringify(field)}]`).join('\n ')}
 return nil
}\n`;
    await writeFile(file, source);
  }
}
