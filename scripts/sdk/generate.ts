import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, readdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import configuration from './config.json';
import { metadata } from './metadata';
import { generatePythonResources } from './python';
import { generateGoResources } from './go';
import { generateRustResources } from './rust';
import { generateJavaResources } from './java';

// One reviewed OpenAPI contract; vendor output stays separate from maintained streaming helpers.
const exec = promisify(execFile);
const cache = path.resolve('.data/sdk-generator');
await mkdir(cache, { recursive: true });
const jar = path.join(cache, `openapi-generator-${configuration.version}.jar`);
let bytes: Buffer;
try {
  bytes = await readFile(jar);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  const response = await fetch(
    `https://repo.maven.apache.org/maven2/org/openapitools/openapi-generator-cli/${configuration.version}/openapi-generator-cli-${configuration.version}.jar`,
    { signal: AbortSignal.timeout(60_000) },
  );
  if (!response.ok) throw new Error(`Generator download failed: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha256').update(bytes).digest('hex') !== configuration.sha256)
  throw new Error('Generator checksum mismatch');
await writeFile(jar, bytes);
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java') : 'java';
const temporary = await mkdtemp(path.join(tmpdir(), 'macrofold-sdk-'));
// Pinned generator gaps proven by binary transport fixtures. Fail loudly when upstream changes.
async function replaceOnce(file: string, before: string, after: string) {
  const source = await readFile(file, 'utf8');
  if (source.split(before).length !== 2) throw new Error(`Recheck the binary transport adapter: ${file}`);
  await writeFile(file, source.replace(before, after));
}
try {
  for (const [language, options] of Object.entries(configuration.targets)) {
    const output = path.join(temporary, language);
    const config = path.join(temporary, language + '.json');
    await writeFile(
      config,
      JSON.stringify({
        ...options,
        hideGenerationTimestamp: true,
        templateDir: path.resolve('scripts/sdk'),
        files: { 'metadata.mustache': { templateType: 'API', destinationFilename: '.sdkmeta.json' } },
      }),
    );
    try {
      await exec(
        java,
        [
          '-jar',
          jar,
          'generate',
          '-g',
          language,
          '-i',
          path.resolve('docs/api/openapi.json'),
          '-o',
          output,
          '-c',
          config,
          ...(['go', 'python'].includes(language)
            ? [
                ...(language === 'go'
                  ? [
                      '--model-name-mappings',
                      Object.entries(configuration.targets.go.modelNameMappings)
                        .map(([from, to]) => `${from}=${to}`)
                        .join(','),
                    ]
                  : []),
                '--openapi-normalizer',
                'REMOVE_ANYOF_ONEOF_AND_KEEP_PROPERTIES_ONLY=true',
              ]
            : []),
          '--global-property',
          'apiTests=false,modelTests=false,apiDocs=false,modelDocs=false',
        ],
        { maxBuffer: 8 * 1024 * 1024 },
      );
    } catch (error) {
      throw new Error(`Could not generate ${language}. Install JDK 21 and set JAVA_HOME.`, { cause: error });
    }
    if (language === 'go') {
      // A successful zero-byte download still owns a usable temporary file.
      await replaceOnce(
        path.join(output, 'client.go'),
        'if len(b) == 0 {\n\t\treturn nil\n\t}',
        'if len(b) == 0 {\n\t\tif _, file := v.(**os.File); !file {\n\t\t\treturn nil\n\t\t}\n\t}',
      );
    }
    if (language === 'java') {
      await replaceOnce(
        path.join(output, 'src/main/java/dev/macrofold/api/WorkspacesApi.java'),
        'byte[] localVarPostBody = memberVarObjectMapper.writeValueAsBytes(body);\n      localVarRequestBuilder.method("PUT", HttpRequest.BodyPublishers.ofByteArray(localVarPostBody));',
        'localVarRequestBuilder.method("PUT", HttpRequest.BodyPublishers.ofFile(body.toPath()));',
      );
    }
    if (language === 'rust') {
      await replaceOnce(
        path.join(output, 'src/apis/workspaces_api.rs'),
        'let file = TokioFile::open(p_body_body).await?;',
        'let file = TokioFile::open(p_body_body).await?;\n    req_builder = req_builder.header(reqwest::header::CONTENT_TYPE, "application/octet-stream").header(reqwest::header::CONTENT_LENGTH, file.metadata().await?.len());',
      );
    }
    const destination = path.resolve('sdk', language);
    const generated: string[] = [];
    async function copy(from: string, relative = '') {
      for (const entry of await readdir(from, { withFileTypes: true })) {
        const file = path.join(relative, entry.name);
        if (entry.isDirectory()) {
          await copy(path.join(from, entry.name), file);
          continue;
        }
        const included =
          language === 'python'
            ? file.startsWith('macrofold/models/') && file.endsWith('.py')
            : language === 'go'
              ? /\.go$/.test(file)
              : language === 'rust'
                ? file.startsWith('src/') && file.endsWith('.rs') && file !== 'src/lib.rs'
                : file.startsWith('src/main/java/') && file.endsWith('.java');
        if (!included) continue;
        await mkdir(path.dirname(path.join(destination, file)), { recursive: true });
        await copyFile(path.join(from, entry.name), path.join(destination, file));
        generated.push(file);
      }
    }
    await copy(output);
    const generators = {
      python: generatePythonResources,
      go: generateGoResources,
      rust: generateRustResources,
      java: generateJavaResources,
    };
    generated.push(
      ...(await generators[language as keyof typeof generators](await metadata(output), destination)),
    );
    // Remove only paths recorded by the previous generation, never hand-maintained helpers/tests.
    const manifest = path.join(destination, '.generated-files.json');
    let previous: string[] = [];
    try {
      previous = JSON.parse(await readFile(manifest, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const file of previous) {
      if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..'))
        throw new Error('Unsafe generated-file manifest');
      if (!generated.includes(file)) await rm(path.join(destination, file), { force: true });
    }
    await writeFile(manifest, JSON.stringify(generated.sort(), null, 2) + '\n');
    console.log(`Generated ${language}: ${generated.length} source files`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
