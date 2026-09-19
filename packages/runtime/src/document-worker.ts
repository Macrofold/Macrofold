import { readFile } from 'node:fs/promises';
import { mediaLimits } from '../../contracts/media';

// This process is short lived, runs as the sandbox's unprivileged agent UID,
// receives no credentials, and has a parent-enforced heap/output/time limit.
const [kind, filename] = process.argv.slice(2);
try {
  const bytes = await readFile(filename);
  if (bytes.length > mediaLimits.fileBytes) throw new Error('Document too large');
  let text = '';
  if (kind === 'pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
      stopAtErrors: true,
    });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > mediaLimits.pdfPages) throw new Error('Too many pages');
      for (let n = 1; n <= pdf.numPages && text.length <= mediaLimits.extractedCharacters; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        text +=
          `\n[Page ${n}]\n` +
          content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join('');
        page.cleanup();
      }
      // Page labels alone must never make an image-only PDF look understood.
      if (!text.replace(/\[Page \d+\]/g, '').trim()) throw new Error('No extractable text');
    } finally {
      await task.destroy();
    }
  } else if (kind === 'document') {
    const mammoth = await import('mammoth');
    // Raw text only: no generated HTML, image conversion, or external file access.
    text = (await mammoth.extractRawText({ buffer: bytes })).value;
  } else {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) throw new Error('Not a text document');
  }
  if (!text.trim() || text.length > mediaLimits.extractedCharacters)
    throw new Error('Document text limit exceeded');
  process.stdout.write(JSON.stringify({ text }));
} catch {
  process.exitCode = 1;
}
