# Files and media

Give an agent documents or images, then retrieve the files it creates. Originals stay in the workspace's persistent worktree. Attachments are optional inputs to ordinary runs and session messages; they are not a separate kind of agent.

## Start in the dashboard

1. Open a workspace and choose **New run**.
2. Describe the task, then use **Attach files**. For example: “Summarize this PDF and save the summary in `outputs/summary.md`.”
3. Select a compatible harness/model and start the run. The dashboard checks file types, sizes, and image compatibility before uploading, including for saved presets and existing conversations. Files upload and checkpoint before the run is submitted.
4. After persistence finishes, **Files from this run** offers downloads of new or changed deliverables under `outputs/`. The workspace's **Files** view previews supported images, PDFs, video and audio, and offers original-file downloads.

For files you only want to store, use **Files → Upload files**. Uploading or previewing does not invoke a model. Video and audio playback depends on the browser's codecs.

If a preview cannot load, use **Try again** or download the original. Changing or removing an incompatible attachment preserves your prompt. File bytes and document extraction are validated during execution; passing the upload checks does not guarantee a document can be read.

## Supported inputs

| File | Run attachment behavior | Limits |
| --- | --- | --- |
| PNG, JPEG, WebP | Native image input with Codex + `gpt-5.4-mini`, or Claude Code + `claude-sonnet-4-6` / `claude-haiku-4-5-20251001` | 1 MiB; 2048 pixels per side |
| PDF | Extracted text in page order, across the supported harnesses | 10 MiB; 100 pages; must contain extractable text |
| DOCX | Extracted paragraph text | 10 MiB |
| TXT, Markdown, CSV, JSON | UTF-8 text | 10 MiB |
| Video and audio | Store, download, and play compatible files in the dashboard | Not accepted as analysis attachments |
| Other files, including archives and spreadsheets | Store and download the original bytes | Not accepted as analysis attachments |

Each run accepts up to **five attachments**, **20 MiB total**, and **100,000 extracted characters across documents**. Oversized documents fail explicitly; they are not silently truncated. A model request can contain at most five images, including earlier conversation images. Start another session when that image limit is reached. The selected model still needs to be enabled on your deployment. Model context limits also apply. The native runtime automatically stages encrypted model requests larger than 4 MiB through private object storage, avoiding the hosting request-body limit. The complete model request still has an 8 MiB ceiling, including encoded images and conversation history. If that ceiling is reached, start a new session with fewer/smaller images; content is never silently truncated. This requires the matching runtime and API release.

PDF/DOCX extraction does not interpret embedded images, page layout, handwriting, comments, or charts. Image-only/scanned PDFs require OCR elsewhere before attachment. Export spreadsheets to CSV. Password-protected, malformed, empty, or excessively large documents can fail extraction. The error appears on the run; the original upload remains available. No extraction service receives the file, but extracted text and native images are sent to the configured model provider during execution.

## Use the API or an SDK

Use a server-side API key with workspace access, `runs:write`, and `files:read`. Uploading also requires `files:write`; reading workspaces/worktrees and watching results requires the corresponding read scopes. Never put a privileged API key in a customer browser.

All five SDKs expose `attachments` on run creation, session follow-ups, and [customer-agent messages](../customer-agents/README.md). Values are paths of files **already uploaded to that run's worktree**. IDs identify the workspace/worktree/session; filenames never identify the tenant.

For a small document, install the [TypeScript SDK](../../../sdk/typescript/README.md), set `MACROFOLD_API_KEY`, and use this in a server-side script. Set `MACROFOLD_BASE_URL` for staging, local or self-hosted use. Use an existing workspace/worktree in an application instead of creating one per request.

```ts
import { Macrofold } from 'macrofold';
import { readFile, writeFile } from 'node:fs/promises';

const app = new Macrofold({
  ...(process.env.MACROFOLD_BASE_URL ? { baseURL: process.env.MACROFOLD_BASE_URL } : {}),
});
const workspace = await app.workspaces.create({ name: 'Document assistant' });
const worktreeId = workspace.default_worktree_id!;
const worktree = await app.worktrees.get(worktreeId);
await app.worktrees.writeFile(worktreeId, {
  path: 'brief.pdf',
  content: new Uint8Array(await readFile('./brief.pdf')),
  ifMatch: worktree.revision,
  create_only: true,
});
const accepted = await app.runs.create({
  worktree_id: worktreeId,
  harness: 'codex',
  model: 'gpt-5.4-mini',
  billing_mode: 'managed',
  prompt: 'Summarize the attached brief. Save outputs/summary.md.',
  attachments: ['brief.pdf'],
  limits: { max_cost_micro_usd: '2000000', timeout_seconds: 300 },
});
const result = await app.runs.wait(accepted.run_id);
console.log(result.output_text);
const artifacts = await app.runs.listArtifacts(accepted.run_id);
for (const artifact of artifacts.data) {
  const download = await app.artifacts.download(artifact.id);
  // The short-lived URL authorizes this download. Do not forward your API key.
  const response = await fetch(download.url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  // Choose your own destination; never trust a returned filename as a local path.
  await writeFile(`./result-${artifact.id}`, new Uint8Array(await response.arrayBuffer()));
}
```

Paginate `listArtifacts` with `next_cursor` for additional results. For larger uploads, use [staged transfers](../cli/README.md) or the dashboard's uploader. The direct write endpoint accepts up to 25 MiB on a host that allows that request size; attachment limits are smaller. Vercel Functions impose a 4.5 MB request ceiling, so use staged transfers for larger uploads. [File reads](../workspaces/read-files.md) explain byte responses, revision headers and large downloads.

For the optional customer-agent integration path, get the binding's `worktree_id`, upload through the same authorized worktree API, then send `attachments: ['brief.pdf']` with `customerAgents.sendMessage`. This adds no new customer-specific storage primitive. Your server must continue to map the signed-in customer to the correct binding.

## Outputs and costs

Ask the agent to save deliverables in **`outputs/`**. Any format can be downloaded: PDFs, images, DOCX, text, archives and more. The harness must actually create a valid file using its available tools. Macrofold does not add an image-generation, PDF-authoring, video-generation or conversion service automatically. Restricted file-only execution cannot use shell-based authoring tools.

Only new or changed, readable, non-hidden regular files under `outputs/` become run artifacts. Other files remain in the worktree. Artifacts become visible after verified persistence and retain the exact bytes from that run even if a later run edits the path. A failed or cancelled run may still have verified partial deliverables; check execution and persistence status before treating them as complete.

Downloads use short-lived private links. Treat those links as bearer credentials and do not publish or log them. Run-artifact metadata expires with detailed run history; current worktree files and retained checkpoints have their own [retention rules](../workspaces/README.md).

Original uploads use ordinary storage quota/billing. Extraction uses runtime compute; extracted text and images consume model input tokens. Image requests use a conservative reservation before dispatch and settle using the provider's reported usage. Unsupported image models fail instead of switching providers or credentials. The [billing guide](../billing/README.md) explains reservations and limits.

## Troubleshooting

| Error | Next step |
| --- | --- |
| `attachment_not_found` | Upload to the exact worktree used by the run. |
| `file_permission_denied` / `attachment_not_readable` | Check inherited read patterns and the submitting key's scopes. Symlinks are not valid attachments. |
| `attachment_changed` | A queued attachment was replaced or removed. Submit a new run with the current file. |
| `image_input_unsupported` | Choose one of the supported harness/model combinations above. |
| `invalid_image` | Export PNG/JPEG/WebP within the byte and dimension limits. |
| `attachment_extraction_failed` | Export a smaller, unlocked text-bearing PDF, DOCX or UTF-8 file. |
| `attachment_text_too_large` | Split documents into smaller tasks. |
| `run_budget_exhausted` | Shorten the input or deliberately increase the next run's budget. |

An unsuccessful submission can leave its uploaded files in the worktree. Remove them through Files if no longer needed; retries do not blindly delete or duplicate the run. The local simulator tests storage and delivery, and does not understand document or image content.
