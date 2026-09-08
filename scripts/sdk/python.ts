import { writeFile } from 'node:fs/promises';
import type { ReferenceObject, SchemaObject } from 'openapi-typescript';
import { resolve, pascal, snake, groups, properties } from './schema';
import type { VendorOperation } from './metadata';
import configuration from './config.json';

/** Typed keyword inputs are derived from the same schemas, including nested input objects. */
export async function generatePythonResources(ops: VendorOperation[], destination: string) {
  const definitions = new Map<string, string>();
  function type(value: SchemaObject | ReferenceObject | undefined, name: string): string {
    if (!value) return 'object';
    if ('$ref' in value) {
      const ref = value.$ref.split('/').pop()!;
      if (!definitions.has(ref)) {
        definitions.set(ref, '');
        const expression = type(resolve(value), ref);
        if (expression !== `${ref}Params`) definitions.set(ref, `${ref}Params = ${expression}`);
      }
      return `${ref}Params`;
    }
    const literal = (v: unknown) =>
      v === null ? 'None' : v === true ? 'True' : v === false ? 'False' : JSON.stringify(v);
    if ('const' in value) return `Literal[${literal(value.const)}]`;
    if (value.enum) return `Literal[${value.enum.map(literal).join(', ')}]`;
    if (Array.isArray(value.type))
      return value.type.map((t) => type({ ...value, type: t } as SchemaObject, name)).join(' | ');
    if (value.oneOf?.length && !Object.keys(properties(value)).length)
      return value.oneOf.map((v, i) => type(v, `${name}Choice${i + 1}`)).join(' | ');
    if (value.type === 'array')
      return `list[${type(Array.isArray(value.items) ? value.items[0] : value.items, name + 'Item')}]`;
    if (value.type === 'object' || Object.keys(properties(value)).length) {
      if (!Object.keys(properties(value)).length) {
        const entry =
          'additionalProperties' in value && typeof value.additionalProperties === 'object'
            ? type(value.additionalProperties as SchemaObject | ReferenceObject, name + 'Value')
            : 'object';
        return `dict[str, ${entry}]`;
      }
      const fields = Object.entries(properties(value)).map(([key, property]) => {
        const field = type(property, name + pascal(key));
        return `${JSON.stringify(key)}: ${JSON.stringify(value.required?.includes(key) ? field : `NotRequired[${field}]`)}`;
      });
      definitions.set(name, `${name}Params = TypedDict('${name}Params', {${fields.join(', ')}})`);
      return `${name}Params`;
    }
    if (value.type === 'null') return 'None';
    if (value.type === 'integer') return 'int';
    if (value.type === 'number') return 'float';
    if (value.type === 'boolean') return 'bool';
    if (value.type === 'string')
      return value.format === 'uuid'
        ? 'str | UUID'
        : value.format === 'date-time'
          ? 'str | datetime'
          : value.format === 'date'
            ? 'str | date'
            : 'str';
    return 'object';
  }
  const content = [
    `# Generated from OpenAPI by pnpm sdk:generate:all. Do not edit.
from __future__ import annotations
from collections.abc import Generator
from datetime import date, datetime
from typing import TYPE_CHECKING, Literal
from uuid import UUID
from . import models
from . import params
from .resource_options import OMIT, Omit, RequestOptions, payload, parameters, decode
from .run_helpers import stream_run_text, wait_for_run
if TYPE_CHECKING:
    from .client import Client
DEFAULT_ORIGIN = ${JSON.stringify(configuration.defaultOrigin)}
`,
  ];
  for (const group of groups) {
    content.push(
      `class ${pascal(group)}Resource:\n    def __init__(self, client: Client):\n        self._client = client\n`,
    );
    for (const op of ops.filter((o) => o.contract.group === group)) {
      if (op.originalId === 'streamRun') {
        content.push(`    def stream(self, run_id: str | UUID, *, after: str = '0') -> Generator[models.Event, None, None]:
        stream = self._client.stream(str(run_id), after=after)
        try:
            for event in stream:
                yield models.Event.model_validate(event)
        finally:
            stream.close()

    def events(self, run_id: str | UUID, *, after: str = '0') -> Generator[models.Event, None, None]:
        return self.stream(run_id, after=after)

    def stream_text(self, run_id: str | UUID, *, after: str = '0') -> Generator[str, None, None]:
        return stream_run_text(self.events(run_id, after=after), lambda: self.wait(run_id))

    def wait(self, run_id: str | UUID, *, timeout: float | None = None, poll_interval: float = 1) -> models.RunResult:
        return wait_for_run(self._client, str(run_id), timeout=timeout, poll_interval=poll_interval)
`);
        continue;
      }
      const contract = op.contract;
      const fields: { name: string; wire: string; type: string; required: boolean; location: string }[] = [];
      for (const p of contract.parameters.filter(
        (p) => !['Idempotency-Key', 'X-Organization-Id', 'Last-Event-ID'].includes(p.name),
      ))
        fields.push({
          name: snake(p.name),
          wire: p.name,
          type: type(p.schema, pascal(op.originalId) + pascal(p.name)),
          required: !!p.required,
          location: p.in,
        });
      if (contract.body) {
        if (contract.body.binary)
          fields.push({
            name: 'content',
            wire: 'content',
            type: 'bytes',
            required: true,
            location: 'binary',
          });
        else
          for (const [key, value] of Object.entries(properties(contract.body.schema))) {
            if (fields.some((p) => p.name === snake(key)))
              throw new Error(`SDK parameter collision: ${op.originalId}/${key}`);
            fields.push({
              name: snake(key),
              wire: key,
              type: type(value, pascal(op.originalId) + pascal(key)),
              required: !!resolve(contract.body.schema).required?.includes(key),
              location: 'body',
            });
          }
      }
      for (const field of fields) field.type = field.type.replace(/\b(\w+Params)\b/g, 'params.$1');
      for (const field of fields)
        if (['from', 'type', 'class', 'in', 'is', 'not', 'global'].includes(field.name)) field.name += '_';
      const paths = fields.filter((f) => f.location === 'path');
      const keywords = fields.filter((f) => f.location !== 'path');
      const result =
        op.originalId === 'readFile' ? 'bytes' : op.returnType ? `models.${op.returnType}` : 'None';
      content.push(`    def ${snake(contract.name)}(self${paths.map((f) => `, ${f.name}: ${f.type}`).join('')}, *, ${keywords.map((f) => `${f.name}: ${f.type}${f.required ? '' : ' | Omit = OMIT'}, `).join('')}request_options: RequestOptions | None = None) -> ${result}:
        options = request_options or RequestOptions()
        identity = options.identity(${['GET', 'HEAD'].includes(contract.method) ? 'False' : 'True'})
        result = self._client.request(${JSON.stringify(contract.id)},
            ${['path', 'query']
              .map(
                (where) =>
                  `${where}=parameters({${fields
                    .filter((f) => f.location === where)
                    .map((f) => `${JSON.stringify(f.wire)}: ${f.name}`)
                    .join(',')}}),`,
              )
              .join('\n            ')}
            headers={**options.headers, **parameters({${fields
              .filter((f) => f.location === 'header')
              .map((f) => `${JSON.stringify(f.wire)}: ${f.name}`)
              .join(',')}})},
            idempotency_key=identity,
            ${
              contract.body
                ? `body=${
                    contract.body.binary
                      ? 'content'
                      : `payload({${fields
                          .filter((f) => f.location === 'body')
                          .map((f) => `${JSON.stringify(f.wire)}: ${f.name}`)
                          .join(',')}})`
                  },`
                : ''
            }
        )
        ${result === 'None' ? 'return None' : result === 'bytes' ? 'return result' : `return decode(${result}, result, identity)`}
`);
    }
  }
  content.push(
    `class Resources:\n    def _init_resources(self, client: Client) -> None:\n${groups.map((g) => `        self.${snake(g)} = ${pascal(g)}Resource(client)`).join('\n')}\n`,
  );
  await writeFile(`${destination}/macrofold/resources.py`, content.join('\n'));
  await writeFile(
    `${destination}/macrofold/params.py`,
    `# Generated keyword-input types from OpenAPI. Do not edit.
from __future__ import annotations
from datetime import date, datetime
from typing import Literal, NotRequired, TypedDict
from uuid import UUID
${[...definitions.values()]
  .filter(Boolean)
  .sort((a, b) => Number(b.includes('TypedDict(')) - Number(a.includes('TypedDict(')))
  .join('\n\n')}\n`,
  );
  return ['macrofold/resources.py', 'macrofold/params.py'];
}
