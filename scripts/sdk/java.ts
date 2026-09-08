import { writeFile } from 'node:fs/promises';
import { groups, pascal } from './schema';
import { dataParams, type VendorOperation } from './metadata';
import configuration from './config.json';

export async function generateJavaResources(ops: VendorOperation[], destination: string) {
  const lines = [
    `// Generated from OpenAPI by pnpm sdk:generate:all. Do not edit.
package dev.macrofold;
import dev.macrofold.api.*;
import dev.macrofold.model.*;
import java.io.*;
import java.time.*;
import java.util.*;
import java.util.function.Predicate;
public abstract class Resources extends ApiClient {
  public static final String DEFAULT_ORIGIN = ${JSON.stringify(configuration.defaultOrigin)};
  protected Resources(java.net.http.HttpClient.Builder http, com.fasterxml.jackson.databind.ObjectMapper mapper, String origin) {super(http,mapper,origin);}
  public abstract void stream(UUID runId,String after,Predicate<Event> receive) throws IOException,InterruptedException,ApiException;
  protected abstract void streamInOrganization(UUID runId,String after,UUID organization,Predicate<Event> receive) throws IOException,InterruptedException,ApiException;
  ${groups.map((g) => `public ${pascal(g)}Resource ${g}(){return new ${pascal(g)}Resource(this,RequestOptions.defaults());}`).join('\n')}
`,
  ];
  for (const group of groups) {
    const methods: string[] = [];
    for (const op of ops.filter((o) => o.contract.group === group)) {
      if (op.originalId === 'streamRun') {
        methods.push(`public void stream(UUID runId,Predicate<Event> receive) throws IOException,InterruptedException,ApiException {stream(runId,"0",receive);}
          public void stream(UUID runId,String after,Predicate<Event> receive) throws IOException,InterruptedException,ApiException {client.streamInOrganization(runId,after,options.organization(),receive);}
          public void events(UUID runId,Predicate<Event> receive) throws IOException,InterruptedException,ApiException {stream(runId,receive);}
          public void events(UUID runId,String after,Predicate<Event> receive) throws IOException,InterruptedException,ApiException {stream(runId,after,receive);}
          public void streamText(UUID runId,Predicate<String> receive) throws IOException,InterruptedException,ApiException,RunFailedException,WaitTimeoutException {streamText(runId,"0",receive);}
          public void streamText(UUID runId,String after,Predicate<String> receive) throws IOException,InterruptedException,ApiException,RunFailedException,WaitTimeoutException {RunHelpers.streamText(this,runId,after,receive);}
          public RunResult wait(UUID runId) throws ApiException,InterruptedException,RunFailedException,WaitTimeoutException {return wait(runId,null);}
          public RunResult wait(UUID runId,Duration timeout) throws ApiException,InterruptedException,RunFailedException,WaitTimeoutException {return RunHelpers.waitForRun(client,runId,options.organization(),timeout);}`);
        continue;
      }
      const paths = op.params.filter((p) => p.path),
        body = op.params.find((p) => p.body),
        data = dataParams(op);
      const empty = op.contract.body?.empty;
      const name = pascal(op.originalId) + 'Params';
      if (data.length)
        lines.push(`public static final class ${name} {
        ${data.map((p) => `private ${p.type} ${p.name};`).join('\n')}
        public ${name}(${data
          .filter((p) => p.required)
          .map((p) => `${p.type} ${p.name}`)
          .join(',')}){${data
          .filter((p) => p.required)
          .map((p) => `this.${p.name}=Objects.requireNonNull(${p.name},"${p.name}");`)
          .join('')}}
        ${data.map((p) => `public ${name} ${p.name}(${p.type} value){this.${p.name}=value;return this;}`).join('\n')}
      }`);
      const params = [
        ...paths.map((p) => `${p.type} ${p.name}`),
        ...(body && !empty ? [`${body.type} ${body.name === 'body' ? 'content' : 'input'}`] : []),
        ...(data.length ? [`${name} params`] : []),
      ];
      const key = op.params.some((p) => p.wireName === 'Idempotency-Key');
      const args = op.params.map((p) =>
        p.wireName === 'Idempotency-Key'
          ? 'key'
          : p.wireName === 'X-Organization-Id'
            ? 'options.organization()'
            : p.wireName === 'Last-Event-ID'
              ? 'null'
              : p.body
                ? empty
                  ? 'new HashMap<>()'
                  : p.name === 'body'
                    ? 'content'
                    : 'input'
                : p.path
                  ? p.name
                  : `params.${p.name}`,
      );
      if (data.length && !data.some((p) => p.required))
        methods.push(`public ${op.returnType || 'void'} ${op.contract.name}(${params.slice(0, -1).join(',')}) throws ApiException {
        ${op.returnType ? 'return ' : ''}${op.contract.name}(${[...paths.map((p) => p.name), ...(body && !empty ? [body.name === 'body' ? 'content' : 'input'] : []), `new ${name}()`].join(',')});
      }`);
      methods.push(`public ${op.returnType || 'void'} ${op.contract.name}(${params.join(',')}) throws ApiException {
        ${key ? 'String key=options.identity();' : ''}
        ${data.length ? 'Objects.requireNonNull(params,"params");' : ''}
        try {${op.returnType ? 'return ' : ''}new ${op.classname}(client).${op.id}(${args.join(',')});}
        catch(ApiException error) {throw new RequestException(error,${key ? 'key' : 'null'});}
      }`);
    }
    lines.push(`public static final class ${pascal(group)}Resource {
      private final Resources client; private final RequestOptions options;
      private ${pascal(group)}Resource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public ${pascal(group)}Resource withOptions(RequestOptions options){return new ${pascal(group)}Resource(client,Objects.requireNonNull(options));}
      ${methods.join('\n')}
    }`);
  }
  lines.push('}');
  await writeFile(`${destination}/src/main/java/dev/macrofold/Resources.java`, lines.join('\n') + '\n');
  return ['src/main/java/dev/macrofold/Resources.java'];
}
