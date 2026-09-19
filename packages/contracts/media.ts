/** Shared format hints and admission limits. Extensions select a processor;
 * the processor must still validate bytes. Upload/storage accepts other formats. */
export const mediaLimits = {
  attachments: 5,
  fileBytes: 10 * 1024 * 1024,
  totalBytes: 20 * 1024 * 1024,
  imageBytes: 1024 * 1024,
  imageSide: 2048,
  extractedCharacters: 100_000,
  pdfPages: 100,
} as const;

const formats: Record<
  string,
  { kind: 'image' | 'pdf' | 'document' | 'text' | 'video' | 'audio'; mime: string }
> = {
  png: { kind: 'image', mime: 'image/png' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  webp: { kind: 'image', mime: 'image/webp' },
  pdf: { kind: 'pdf', mime: 'application/pdf' },
  docx: { kind: 'document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  txt: { kind: 'text', mime: 'text/plain' },
  md: { kind: 'text', mime: 'text/markdown' },
  csv: { kind: 'text', mime: 'text/csv' },
  json: { kind: 'text', mime: 'application/json' },
  mp4: { kind: 'video', mime: 'video/mp4' },
  webm: { kind: 'video', mime: 'video/webm' },
  mp3: { kind: 'audio', mime: 'audio/mpeg' },
  wav: { kind: 'audio', mime: 'audio/wav' },
  m4a: { kind: 'audio', mime: 'audio/mp4' },
};
export function mediaFormat(path: string) {
  const filename = path.split('/').at(-1) || '';
  const dot = filename.lastIndexOf('.');
  const extension = dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
  return Object.hasOwn(formats, extension) ? formats[extension] : undefined;
}

export const attachmentAccept = Object.entries(formats)
  .filter(([, format]) => format.kind !== 'audio' && format.kind !== 'video')
  .map(([extension]) => `.${extension}`)
  .join(',');

interface AttachmentIssue {
  code: 'invalid_attachments' | 'unsupported_attachment' | 'attachment_too_large' | 'image_input_unsupported';
  message: string;
}

/** Pure metadata checks shared by the picker and API. Authorization and byte
 * validation remain at the server/runtime boundaries; this is not authority. */
export function attachmentIssue(
  files: readonly { path: string; size: number }[],
  configuration?: { harness: string; provider: string; model: string },
): AttachmentIssue | undefined {
  if (files.length > mediaLimits.attachments || new Set(files.map((file) => file.path)).size !== files.length)
    return { code: 'invalid_attachments', message: 'Attach up to five distinct files.' };
  let total = 0;
  for (const file of files) {
    const name = file.path.split('/').at(-1);
    const format = mediaFormat(file.path);
    if (!format || format.kind === 'audio' || format.kind === 'video')
      return {
        code: 'unsupported_attachment',
        message: `${name}: attach PNG, JPEG, WebP, PDF, DOCX, TXT, Markdown, CSV or JSON. Audio/video can be stored and downloaded; automatic analysis is not available.`,
      };
    const limit = format.kind === 'image' ? mediaLimits.imageBytes : mediaLimits.fileBytes;
    if (!Number.isSafeInteger(file.size) || file.size < 0)
      return { code: 'invalid_attachments', message: `${name}: invalid file size.` };
    if (file.size > limit)
      return {
        code: 'attachment_too_large',
        message: `${name}: use ${format.kind === 'image' ? 'an image up to 1 MiB' : 'a document up to 10 MiB'}.`,
      };
    total += file.size;
    if (total > mediaLimits.totalBytes)
      return {
        code: 'attachment_too_large',
        message: 'Attachments exceed 20 MiB total. Remove a file or use smaller files.',
      };
    if (
      format.kind === 'image' &&
      configuration &&
      !supportsImageInput(configuration.harness, configuration.provider, configuration.model)
    )
      return {
        code: 'image_input_unsupported',
        message:
          'Choose Codex with GPT-5.4 mini or Claude Code with Sonnet 4.6 or Haiku 4.5 for images. For an existing conversation, start a new one with a supported model.',
      };
  }
}

export interface RunAttachment {
  path: string;
  sha256: string;
  size_bytes: string;
  media_type: string;
}

/** Deliberately reviewed combinations: discovery alone cannot authorize image billing. */
export function supportsImageInput(harness: string, provider: string, model: string) {
  return (
    (harness === 'codex' && provider === 'openai' && model === 'gpt-5.4-mini') ||
    (harness === 'claude-code' &&
      provider === 'anthropic' &&
      ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'].includes(model))
  );
}
