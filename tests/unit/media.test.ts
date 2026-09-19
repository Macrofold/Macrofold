import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveRunAttachments } from '../../packages/core/src/run-attachments';
import { modelInputBound } from '../../packages/core/src/model-content';
import { prepareAttachments } from '../../packages/runtime/src/attachments';
import type { NativeConfiguration } from '../../packages/runtime/src/types';
import type { FileRecord } from '../../packages/core/src/files';
import { attachmentIssue, mediaFormat, mediaLimits } from '../../packages/contracts/media';
import { runtimeConfiguration } from '../../packages/runtime/src/supervisor';

const png = await readFile('tests/fixtures/media/pixel.png');
const image = { type: 'input_image', image_url: `data:image/png;base64,${png.toString('base64')}` };
const config = { harness: 'codex' as const, provider: 'openai', model: 'gpt-5.4-mini' };
const admission = { ...config, rate_card: { provider: config.provider } };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const file: FileRecord = {
  path: 'pixel.png',
  type: 'file',
  key: 'fixture',
  sha256: hash(png),
  size_bytes: String(png.length),
  modified_at: new Date().toISOString(),
  git_ignored: false,
};
let directory = '';
afterEach(async () => {
  if (directory) {
    await rm(directory, { recursive: true, force: true });
    directory = '';
  }
});

it('requires a real, allowlisted filename extension, not an inherited object property', () => {
  for (const name of ['file.constructor', 'file.__proto__', 'file.toString', 'png', '.png', 'dir.pdf/file']) {
    expect(mediaFormat(name)).toBeUndefined();
    expect(() => resolveRunAttachments([name], [{ ...file, path: name }], [], admission)).toThrow(
      'attach PNG',
    );
  }
  expect(mediaFormat('dir.name/FILE.PDF')).toEqual({ kind: 'pdf', mime: 'application/pdf' });
});

it('shares attachment limits and capability errors between preflight and admission', () => {
  const document = { path: 'brief.pdf', size: mediaLimits.fileBytes };
  expect(attachmentIssue([document, { ...document, path: 'other.pdf' }], config)).toBeUndefined();
  expect(
    attachmentIssue([document, { ...document, path: 'other.pdf' }, { path: 'small.txt', size: 1 }]),
  ).toMatchObject({ code: 'attachment_too_large', message: expect.stringContaining('20 MiB') });
  expect(attachmentIssue(Array.from({ length: 6 }, (_, i) => ({ path: `${i}.txt`, size: 1 })))).toMatchObject(
    { code: 'invalid_attachments' },
  );
  for (const size of [NaN, -1, Infinity, 0.5])
    expect(attachmentIssue([{ path: 'brief.pdf', size }])).toMatchObject({ code: 'invalid_attachments' });
  const image = { path: 'photo.png', size: 100 };
  expect(attachmentIssue([image], config)).toBeUndefined();
  expect(
    attachmentIssue([image], { harness: 'claude-code', provider: 'anthropic', model: 'claude-sonnet-4-6' }),
  ).toBeUndefined();
  expect(attachmentIssue([image], { ...config, model: 'fixture-model' })).toMatchObject({
    code: 'image_input_unsupported',
  });
  expect(attachmentIssue([{ ...image, size: mediaLimits.imageBytes + 1 }])).toMatchObject({
    code: 'attachment_too_large',
    message: expect.stringContaining('photo.png'),
  });
});

it('preserves attachment references across the supervisor configuration boundary', () => {
  const attachments = resolveRunAttachments(['pixel.png'], [file], [], admission);
  const parsed = runtimeConfiguration.parse({
    ...config,
    runId: '00000000-0000-4000-8000-000000000001',
    workspace: '/workspace',
    stateHome: '/agent-home',
    prompt: 'Describe',
    gatewayURL: 'https://example.test',
    toolURL: 'https://example.test',
    token: 'fixture',
    deadline: new Date().toISOString(),
    toolGrants: false,
    attachments,
  });
  expect(parsed.attachments).toEqual(attachments);
});

it('binds authorized file hashes and refuses missing files, duplicates, excluded paths and unsupported analysis', () => {
  expect(resolveRunAttachments(['pixel.png'], [file], [], admission)[0]).toMatchObject({
    path: 'pixel.png',
    sha256: file.sha256,
    media_type: 'image/png',
  });
  expect(() => resolveRunAttachments(['pixel.png', 'pixel.png'], [file], [], admission)).toThrow('distinct');
  expect(() => resolveRunAttachments(['missing.pdf'], [file], [], admission)).toThrow('Upload');
  expect(() =>
    resolveRunAttachments(
      ['pixel.png'],
      [file],
      [{ version: 1, files: { read: { exclude: ['*.png'] } } }],
      admission,
    ),
  ).toThrow('cannot read');
  expect(() => resolveRunAttachments(['pixel.png'], [file], [], { ...admission, model: 'unknown' })).toThrow(
    'Choose Codex',
  );
  expect(() => resolveRunAttachments(['movie.mp4'], [{ ...file, path: 'movie.mp4' }], [], admission)).toThrow(
    'Audio/video',
  );
  expect(() =>
    resolveRunAttachments(
      ['pixel.png'],
      [{ ...file, size_bytes: String(mediaLimits.imageBytes + 1) }],
      [],
      admission,
    ),
  ).toThrow('1 MiB');
});
it('reserves bounded native images without charging base64 as text and rejects unmetered routes', () => {
  const bound = modelInputBound({ input: [{ role: 'user', content: [image] }] }, config);
  expect(bound).toBeGreaterThan(32_768);
  expect(bound).toBeLessThan(34_500);
  for (const invalid of [
    { ...image, image_url: 'https://example.test/image.png' },
    { ...image, file_id: 'provider-file' },
    { ...image, image_url: 'data:image/png;base64,AAAA' },
    { type: 'input_file', file_data: 'data:application/pdf;base64,AAAA' },
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'AAAA' } },
    { type: 'document', source: { type: 'url', url: 'https://example.test/document.pdf' } },
    { type: 'input_audio', data: 'AAAA' },
  ])
    expect(() => modelInputBound({ input: [invalid] }, config)).toThrow();
  expect(() => modelInputBound({ input: Array(6).fill(image) }, config)).toThrow('five images');
  expect(() => modelInputBound({ input: [image] }, { ...config, model: 'unreviewed' })).toThrow(
    'does not support',
  );
  expect(
    modelInputBound(
      {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') },
              },
            ],
          },
        ],
      },
      { harness: 'claude-code', provider: 'anthropic', model: 'claude-sonnet-4-6' },
    ),
  ).toBeGreaterThan(32_768);
});
it('prepares native images and fails closed on changes and symlinks before invoking a harness', async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'media-test-'));
  await writeFile(path.join(directory, 'pixel.png'), png);
  const c: NativeConfiguration = {
    ...config,
    runId: 'fixture',
    workspace: directory,
    stateHome: directory,
    prompt: 'Describe the image',
    gatewayURL: '',
    toolURL: '',
    token: '',
    deadline: '',
    toolGrants: false,
    attachments: resolveRunAttachments(['pixel.png'], [file], [], admission),
  };
  const extract = vi.fn();
  const result = await prepareAttachments(c, new AbortController().signal, extract);
  expect(result.images[0].data).toBe(png.toString('base64'));
  expect(extract).not.toHaveBeenCalled();
  await writeFile(path.join(directory, 'pixel.png'), Buffer.from('changed'));
  await expect(prepareAttachments(c, new AbortController().signal, extract)).rejects.toMatchObject({
    code: 'attachment_changed',
  });
  await rm(path.join(directory, 'pixel.png'));
  await expect(prepareAttachments(c, new AbortController().signal, extract)).rejects.toMatchObject({
    code: 'attachment_changed',
  });
  await symlink('/etc/hosts', path.join(directory, 'pixel.png'));
  await expect(prepareAttachments(c, new AbortController().signal, extract)).rejects.toMatchObject({
    code: 'attachment_not_readable',
  });
});
it.each([
  ['pdf', 'document.pdf'],
  ['document', 'document.docx'],
])('extracts real %s content using the isolated parser', async (kind, filename) => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    '--import',
    'tsx',
    'packages/runtime/src/document-worker.ts',
    kind,
    `tests/fixtures/media/${filename}`,
  ]);
  expect(JSON.parse(stdout).text).toContain('Media document fixture');
});
it('rejects corrupt documents and invalid UTF-8 without leaking parser contents', async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'media-test-'));
  const filename = path.join(directory, 'bad.pdf');
  await writeFile(filename, Buffer.from([0xff, 0, 0xfe]));
  for (const kind of ['pdf', 'document', 'text'])
    await expect(
      promisify(execFile)(process.execPath, [
        '--import',
        'tsx',
        'packages/runtime/src/document-worker.ts',
        kind,
        filename,
      ]),
    ).rejects.toMatchObject({ code: 1, stdout: '' });
});
