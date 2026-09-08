import { writeFile } from 'node:fs/promises';
import { groups, pascal, snake } from './schema';
import { dataParams, type VendorOperation, type Parameter } from './metadata';
import configuration from './config.json';
const scalar = (p: Parameter) => (['String', 'uuid::Uuid'].includes(p.type) ? 'String' : p.type);

export async function generateRustResources(ops: VendorOperation[], destination: string) {
  const lines = [
    `// Generated from OpenAPI by pnpm sdk:generate:all. Do not edit.
use crate::{Client, ClientError, models, RequestOptions};
pub const DEFAULT_ORIGIN: &str = ${JSON.stringify(configuration.defaultOrigin)};
impl Client { ${groups.map((g) => `pub fn ${snake(g)}(&self) -> ${pascal(g)}Resource<'_> {${pascal(g)}Resource {client:self, options:RequestOptions::default()}}`).join('\n')} }
`,
  ];
  for (const group of groups) {
    const methods: string[] = [];
    for (const op of ops.filter((o) => o.contract.group === group)) {
      if (op.originalId === 'streamRun') {
        methods.push(
          `pub async fn stream(&self, run_id:&str, after:&str, receive:impl FnMut(models::Event)->bool) -> Result<(),ClientError> {self.client.stream_in_organization(run_id,after,self.options.organization.as_deref(),receive).await}`,
        );
        continue;
      }
      const paths = op.params.filter((p) => p.path),
        body = op.params.find((p) => p.body),
        data = dataParams(op);
      const empty = op.contract.body?.empty;
      const name = pascal(op.originalId) + 'Params';
      if (data.length)
        lines.push(
          `#[derive(Debug,Clone${data.some((p) => p.required) ? '' : ',Default'})] pub struct ${name} {${data.map((p) => `pub ${p.name}: ${p.required ? scalar(p) : `Option<${scalar(p)}>`}`).join(',')}}`,
        );
      const signature = [
        '&self',
        ...paths.map((p) => `${p.name}: &str`),
        ...(body && !empty
          ? [
              `input: ${body.required ? '' : 'Option<'}${op.contract.body?.binary ? 'std::path::PathBuf' : body.type.includes('::') ? body.type : `models::${body.type}`}${body.required ? '' : '>'}`,
            ]
          : []),
        ...(data.length ? [`params: ${name}`] : []),
      ].join(', ');
      const key = op.params.some((p) => p.wireName === 'Idempotency-Key');
      const arguments_ = op.params.map((p) => {
        if (p.wireName === 'Idempotency-Key') return '&key';
        if (p.wireName === 'X-Organization-Id') return 'self.options.organization.as_deref()';
        if (p.wireName === 'Last-Event-ID') return 'None';
        if (p.path) return p.name;
        if (p.body) {
          const value = empty
            ? p.type.includes('HashMap')
              ? 'std::collections::HashMap::new()'
              : 'serde_json::json!({})'
            : 'input';
          return p.required && p.nullable ? `Some(${value})` : value;
        }
        const val = `params.${p.name}`;
        return scalar(p) === 'String' ? (p.required ? `&${val}` : `${val}.as_deref()`) : val;
      });
      methods.push(`pub async fn ${snake(op.contract.name)}(${signature}) -> Result<${op.originalId === 'readFile' ? 'reqwest::Response' : op.returnType || '()'},ClientError> {
        ${key ? 'let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());' : ''}
        crate::apis::${op.module}::${op.id}(self.client.configuration(), ${arguments_.join(', ')}).await
          .map_err(|error|crate::request_error(error,${key ? 'Some(key)' : 'None'}))
      }`);
    }
    lines.push(`pub struct ${pascal(group)}Resource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> ${pascal(group)}Resource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      ${methods.join('\n')}
    }`);
  }
  await writeFile(`${destination}/src/resources.rs`, lines.join('\n') + '\n');
  return ['src/resources.rs'];
}
