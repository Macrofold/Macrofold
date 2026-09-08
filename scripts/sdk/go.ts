import { writeFile } from 'node:fs/promises';
import { groups, pascal } from './schema';
import { dataParams, type VendorOperation } from './metadata';
import configuration from './config.json';

export async function generateGoResources(ops: VendorOperation[], destination: string) {
  const lines = [
    `// Code generated from OpenAPI by pnpm sdk:generate:all; DO NOT EDIT.
package macrofold
import ("context"; "os"; "time")
const DefaultOrigin = ${JSON.stringify(configuration.defaultOrigin)}
type Client struct { *APIClient; ${groups.map((g) => `${pascal(g)} *${pascal(g)}Resource`).join(';')} }
func resources(api *APIClient) *Client { return &Client{APIClient:api, ${groups.map((g) => `${pascal(g)}:&${pascal(g)}Resource{api},`).join('')}} }
`,
  ];
  for (const group of groups) {
    lines.push(`type ${pascal(group)}Resource struct {client *APIClient}`);
    for (const op of ops.filter((o) => o.contract.group === group)) {
      if (op.originalId === 'streamRun') {
        lines.push(
          `func (r *RunsResource) Stream(ctx context.Context, runID, after string, receive func(Event) error, options ...RequestOption) error { return r.client.Stream(ctx,runID,after,receive,options...) }`,
        );
        continue;
      }
      const paths = op.params.filter((p) => p.path),
        body = op.params.find((p) => p.body),
        data = dataParams(op);
      const empty = op.contract.body?.empty;
      const paramsType = `${op.id}Params`;
      if (data.length)
        lines.push(
          `type ${paramsType} struct {${data.map((p) => `${pascal(p.name)} ${p.required ? '' : '*'}${p.type}`).join(';')}}`,
        );
      const signature = [
        'ctx context.Context',
        ...paths.map((p) => `${p.name} ${p.type}`),
        ...(body && !empty
          ? [
              `${body.name === 'body' ? 'content' : 'input'} ${body.type.startsWith('*') ? body.type : '*' + body.type}`,
            ]
          : []),
        ...(data.length ? [`params *${paramsType}`] : []),
        'options ...RequestOption',
      ].join(', ');
      const returns = op.returnType
        ? `(${op.returnType.startsWith('*') ? '' : '*'}${op.returnType}, error)`
        : 'error';
      const key = op.params.some((p) => p.wireName === 'Idempotency-Key');
      const settings = op.params.some((p) => ['Idempotency-Key', 'X-Organization-Id'].includes(p.wireName));
      lines.push(`func (r *${pascal(group)}Resource) ${pascal(op.contract.name)}(${signature}) ${returns} {
        ${settings ? `settings, err := requestOptions(options, ${key}); if err != nil {return ${op.returnType ? 'nil, ' : ''}err}` : ''}
        ${body?.required && !empty ? `if ${body.name === 'body' ? 'content' : 'input'} == nil {return ${op.returnType ? 'nil, ' : ''}missingParameter("${body.name === 'body' ? 'content' : 'input'}")}` : ''}
        ${data.length ? `if params == nil {${data.some((p) => p.required) ? `return ${op.returnType ? 'nil, ' : ''}missingParameter("params")` : `params = &${paramsType}{}`}}` : ''}
        call := r.client.${op.classname}.${op.id}(ctx${paths.map((p) => `, ${p.name}`).join('')})
        ${empty ? `call = call.${pascal(body!.name)}(${body!.type.startsWith('map[') ? body!.type : 'map[string]interface{}'}{})` : body ? `if ${body.name === 'body' ? 'content' : 'input'} != nil {call = call.${pascal(body.name)}(${body.type.startsWith('*') ? '' : '*'}${body.name === 'body' ? 'content' : 'input'})}` : ''}
        ${key ? 'call = call.IdempotencyKey(settings.idempotencyKey)' : ''}
        ${op.params.some((p) => p.wireName === 'X-Organization-Id') ? 'if settings.organization != "" {call = call.XOrganizationId(settings.organization)}' : ''}
        ${data.map((p) => (p.required ? `call = call.${pascal(p.name)}(params.${pascal(p.name)})` : `if params.${pascal(p.name)} != nil {call = call.${pascal(p.name)}(*params.${pascal(p.name)})}`)).join('\n')}
        ${op.returnType ? 'result, ' : ''}response, callError := call.Execute()
        ${op.returnType ? 'return result,' : 'return'} requestError(callError, response, ${key ? 'settings.idempotencyKey' : '""'})
      }`);
    }
  }
  await writeFile(`${destination}/resources.go`, lines.join('\n') + '\n');
  return ['resources.go'];
}
