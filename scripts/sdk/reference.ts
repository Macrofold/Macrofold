import { writeFile } from 'node:fs/promises';
import { groups, operations, pascal, snake } from './schema';

/** Navigation for humans and agents, derived alongside the code rather than a second endpoint list. */
export async function generateResourceReference() {
  const sections = groups.map((group) => {
    const rows = operations
      .filter((operation) => operation.group === group)
      .map((operation) => {
        const method = operation.id === 'streamRun' ? 'events' : operation.name;
        return `| \`${operation.id}\` | \`${group}.${method}\` | \`${snake(group)}.${snake(method)}\` | \`${pascal(group)}.${pascal(method)}\` |`;
      });
    return `## ${pascal(group)}\n\n| OpenAPI operation | TypeScript / Java | Python / Rust | Go |\n| --- | --- | --- | --- |\n${rows.join('\n')}`;
  });
  await writeFile(
    'docs/features/api/sdks/reference.md',
    `# SDK resource reference

Generated from the [OpenAPI contract](../../../api/openapi.json). All ${operations.length} public operations have a resource method. Start with the [language guides](README.md) for installation, authentication, and runnable examples.

Names below follow each language's casing. TypeScript, Python, and Go use resource properties; Java and Rust use resource accessors, such as \`client.projects().create(...)\`. Rust network methods are async. Signatures and response types are available in editor completion and checked-in generated sources; query/header options use typed parameter classes in Go, Rust, and Java. Python uses keyword arguments; TypeScript uses typed options.

Path identifiers are positional. Required request values stay typed; optional transport settings expose idempotency, cancellation, and organization selection where supported. Methods retain each SDK's documented transport behavior. The run \`events\` method delegates to resumable incremental streaming; \`stream\` remains available. Closing a stream leaves the remote run active; call \`runs.cancel\` to stop it.

## Run convenience helpers

These compose existing operations and add no backend endpoints.

| Purpose | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| Assistant text fragments | \`runs.streamText\` | \`runs.stream_text\` | \`Runs.StreamText\` |
| Typed complete result after execution and persistence | \`runs.wait\` | \`runs.wait\` | \`Runs.Wait\` |

Text streams handle SSE, cursors and duplicate suppression internally, excluding tool payloads and status events. Both convenience helpers report unsuccessful execution or persistence as a typed run error carrying the run ID. A wait timeout stops local waiting without cancelling execution. The language guides describe timeout options, callbacks/iterators, and advanced replay.

${sections.join('\n\n')}
`,
  );
}
