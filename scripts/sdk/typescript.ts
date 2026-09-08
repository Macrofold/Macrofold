import { writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import { operations, groups, dataParameters, pascal, camel, resolve } from './schema';
import type { SchemaObject } from 'openapi-typescript';
import configuration from './config.json';

export async function generateTypeScriptResources() {
  const content = [
    `// Generated from OpenAPI by pnpm contracts. Do not edit.
import type { Client, Operation, Result, RequestOptions, Schema } from './client.js';
import type { operations } from './schema.js';
import { streamRunText, waitForRun, type WaitOptions } from './run-helpers.js';
export const DEFAULT_ORIGIN = ${JSON.stringify(configuration.defaultOrigin)};
export type RequestSettings = { signal?: AbortSignal; idempotencyKey?: string; headers?: Record<string,string> };
type Transport = Pick<Client, 'request' | 'stream'>;`,
  ];
  for (const group of groups) {
    const methods: string[] = [];
    for (const op of operations.filter((o) => o.group === group)) {
      if (op.id === 'streamRun') {
        methods.push(`/** Stream live or historical events; reconnects from the last delivered cursor. */
          stream(runId: string, options: {after?: string; signal?: AbortSignal} = {}) { return this.client.stream(runId, options); }
          events(runId: string, options: {after?: string; signal?: AbortSignal} = {}) { return this.stream(runId, options); }
          streamText(runId: string, options: {after?: string; signal?: AbortSignal} = {}): AsyncGenerator<string> {
            return streamRunText(this.events(runId, options), () => this.wait(runId, {signal:options.signal}));
          }
          wait(runId: string, options: WaitOptions = {}): Promise<Schema['RunResult']> { return waitForRun(this, runId, options); }`);
        continue;
      }
      const path = op.parameters.filter((p) => p.in === 'path');
      const data = dataParameters(op);
      const fields = data.map(
        (p) =>
          `${p.in === 'header' ? camel(p.name) : p.name}${p.required ? '' : '?'}: NonNullable<operations['${op.id}']['parameters']['${p.in}']>[${JSON.stringify(p.name)}]`,
      );
      const body = op.body;
      if (body?.binary) fields.push('content: Uint8Array');
      const schema = body && resolve(body.schema);
      let bodyType =
        body && !body.binary
          ? `NonNullable<operations['${op.id}']['requestBody']>['content']['application/json']`
          : '';
      // openapi-typescript does not narrow property-less required/not selector branches.
      const branches = schema?.oneOf?.map((choice) => resolve<SchemaObject>(choice));
      if (branches?.length && branches.every((choice) => choice.required?.length === 1 && 'not' in choice)) {
        const keys = branches.map((choice) => choice.required![0]);
        bodyType += ` & (${keys.map((key) => `{${keys.map((field) => (field === key ? `${field}: NonNullable<${bodyType}[${JSON.stringify(field)}]>` : `${field}?: never`)).join(';')}}`).join(' | ')})`;
      }
      const type = [bodyType, fields.length ? `{${fields.join(';')}}` : ''].filter(Boolean).join(' & ');
      const required =
        data.some((p) => p.required) ||
        body?.binary ||
        (body?.required && (schema?.required?.length || schema?.oneOf));
      if (type) content.push(`export type ${pascal(op.id)}Options = ${type};`);
      const signature = [
        ...path.map((p) => `${camel(p.name)}: string`),
        ...(type ? [`options: ${pascal(op.id)}Options${required ? '' : ' = {}'}`] : []),
        'requestOptions: RequestSettings = {}',
      ].join(', ');
      const destructured = data.map((p) => (p.in === 'header' ? camel(p.name) : p.name));
      const setup =
        body && !body.binary && destructured.length
          ? `const {${destructured.join(',')}, ...body} = options;`
          : '';
      const parameterGroups = ['path', 'query', 'header'].flatMap((location) => {
        const parameters = location === 'path' ? path : data.filter((p) => p.in === location);
        return parameters.length
          ? [
              `${location}: {${parameters.map((p) => `${JSON.stringify(p.name)}: ${location === 'path' ? camel(p.name) : `${setup ? '' : 'options.'}${p.in === 'header' ? camel(p.name) : p.name}`}`).join(',')}}`,
            ]
          : [];
      });
      methods.push(`${op.name}(${signature}): Promise<Result<'${op.id}'>> {
        ${setup}
        return this.client.request('${op.id}', { ...requestOptions,
          ${parameterGroups.length ? `params: {${parameterGroups.join(',')}},` : ''}
          ${body ? `body: ${body.binary ? 'options.content' : setup ? 'body' : 'options'},` : ''}
        });
      }`);
    }
    content.push(
      `export class ${pascal(group)}Resource { constructor(private client: Transport) {} ${methods.join('\n')} }`,
    );
  }
  content.push(`export abstract class Resources {
    abstract request<O extends Operation>(operation: O, options?: RequestOptions<O>): Promise<Result<O>>;
    abstract stream(runId: string, options?: {after?:string; signal?:AbortSignal}): AsyncGenerator<Schema['Event']>;
    ${groups.map((group) => `readonly ${group} = new ${pascal(group)}Resource(this);`).join('\n')}
  }`);
  await writeFile(
    'sdk/typescript/src/resources.ts',
    await format(content.join('\n'), { parser: 'typescript', singleQuote: true, printWidth: 110 }),
  );
}
