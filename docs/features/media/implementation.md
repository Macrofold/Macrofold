# Multimedia implementation

The [public media guide](README.md) owns supported formats and user-visible limits. This implementation extends existing file storage, run admission, native adapters, metering and artifact endpoints. It introduces no service, database table or external document-upload API.

## Ownership and interfaces

| Boundary | Owner |
| --- | --- |
| Shared format hints, metadata validation, limits, reviewed image combinations | [Media contract](../../../packages/contracts/media.ts) |
| Image header, MIME and dimension validation without I/O | [Image input validation](../../../packages/contracts/image-input.ts) |
| API path references resolved to authorized content hashes | [Run attachments](../../../packages/core/src/run-attachments.ts), called by run admission |
| Runtime preparation and replaceable text extraction port | [Attachment preparation](../../../packages/runtime/src/attachments.ts) |
| PDF/DOCX/UTF-8 extraction in a bounded subprocess | [Document worker](../../../packages/runtime/src/document-worker.ts) |
| Native image protocol mapping | Codex inline-image turn inputs and Claude Agent SDK user-message image blocks |
| Rate-aware inline image validation/reservation | [Model content](../../../packages/core/src/model-content.ts), called inside existing gateway authorization |
| Verified output publication | [Artifacts](../../../packages/core/src/artifacts.ts), shared by cloud and simulator finalization |
| Browser transfers / passive previews | [Upload helper](../../../apps/web/lib/upload-workspace-files.ts), [media preview](../../../apps/web/components/files/media-preview.tsx) |

`attachments` is an optional array of worktree-relative paths on `RunCreate`, `MessageCreate` and `CustomerAgentMessage` in OpenAPI. Generated SDKs carry it unchanged. Run configuration stores path, hash, size and media type, never base64 contents. Existing worktree IDs, tenant authorization and workspace restrictions remain authoritative. Customer-agent endpoints forward the option to normal run admission.

The `DocumentExtractor` function receives a format kind, verified local path and cancellation signal and returns text. A replacement OCR/parser can implement that interface without changing storage, admission or native adapters. Adding a remote processor would also require explicit privacy, credentials, cost and cancellation handling; no speculative plugin registry exists now.

## Admission, runtime and privacy

Admission requires `files:read` when attaching files, checks inherited run read permissions and rejects unsupported formats or oversized metadata before reserving funds. It reads the selected worktree's current metadata under the writer lock. Queued runs freeze content hashes, not a second copy of bytes. Runtime rejects changed/missing bytes rather than silently consuming another revision. Originals remain ordinary persistent files.

`attachmentIssue` owns pure count/uniqueness, extension, byte-limit and model-compatibility checks. The picker and API reuse it; the server supplies authorized file metadata and the resolved model, never client claims. Format lookup requires an actual filename extension and rejects inherited object properties. The composer resolves custom, preset and session configurations before uploading; incompatible selections retain the draft and block submission. Metadata request failures have an explicit retry. Runs without attachments do not fetch attachment metadata. Runtime byte/hash/parser checks remain independent enforcement rather than being replaced by browser validation.

Preparation occurs before native harness startup, after sandbox hydration. It rejects path traversal, reserved runtime directories and symlinks, checks actual size/hash and permissions again, and processes documents sequentially. Extracted text is labeled and JSON-quoted as data; that label is not a security boundary. Existing tool/file policies remain the enforcement boundary for malicious document instructions.

PDF.js extracts text, with page count limits and no rendering. Mammoth extracts DOCX raw text; no HTML conversion or external file access is enabled. Parsing runs in a short-lived process under the sandbox's unprivileged UID, with no inherited credentials, a 256 MiB V8 heap limit, a 15-second deadline and a 1 MiB stdout/stderr limit. Overall native allocations are still bounded by sandbox memory, not by the V8 flag alone. Abort signals terminate extraction. Failures become content-free failure codes; parser stacks/document bytes are not logged.

PDF page graphics and embedded DOCX images are intentionally excluded. Scans without extractable text fail. This avoids automatic OCR, image expansion and unpredictable visual token costs. Dedicated rendering/OCR, streaming large-file processing and richer office formats are future adapters with separate resource/cost acceptance.

The browser fetches authorized, short-lived downloads into bounded local Blobs, revokes URLs on replacement/unmount, and does not cache them in the general query cache. Only raster image/PDF/audio/video types are embedded; customer HTML and SVG never execute. PDF.js renders one bounded page at a time in an on-demand browser worker, with plain text for assistive technology and no PDF scripts, forms or annotation actions. A sandboxed native PDF embed was rejected after Chromium displayed a blocked document. Other formats retain downloads. Audio/video playback depends on browser codec support. Previews fetch up to 25 MiB; large-media seeking/streaming is deferred.

Preview transport and browser decoding failures offer an explicit retry or original download. Retrying obtains fresh authorized bytes and revokes the previous Blob URL; it does not retry an agent run or invoke a model.

## Native images and money

Image forwarding initially supports reviewed direct OpenAI and Anthropic combinations only. Discovery of a new model does not imply permission to bill its media inputs. `supportsImageInput` is the single compatibility owner; enable more combinations only with native protocol and metering fixtures.

The gateway accepts only inline PNG/JPEG/WebP blocks in the correct provider shape. Remote URLs, provider file IDs, arbitrary documents, audio/video, hosted generation and hosted tools remain rejected. It validates actual headers/MIME/dimensions and counts images across the complete submitted context. Base64 bytes are excluded from the text bound, and each image reserves 32,768 input tokens, a conservative ceiling for the admitted dimensions on reviewed models. Existing text-byte/output bounds, Claude cache-write multiplier, BYOK isolation, usage settlement and usage-bound circuit breaker remain intact. Final cost comes from provider usage, not that reservation.

The complete model request has an 8 MiB ceiling for up to five 1 MiB inline images plus text and native history. A per-worker loopback transport sends requests up to 4 MiB directly. Larger requests receive a five-minute, run/lease/path/size/hash-bound grant, encrypt with a fresh AES-GCM key, and upload directly through the existing object-store port. The gateway receives an empty POST with a sealed claim, verifies and decrypts the exact bytes, then uses its ordinary authorization, permission, reservation and settlement pipeline. This avoids Vercel's 4.5 MB HTTP request limit without exposing plaintext in the bucket or adding a separate service. Staged data is deleted after reading; the existing staging-prefix expiry is the crash backstop. The sandbox egress policy permits the configured object-store host only. No ambiguous inference retries are introduced.

Ownership: `packages/contracts/model-transport.ts` defines shared limits and byte encryption; `packages/runtime/src/model-transport.ts` owns the loopback/streaming adapter; `packages/core/src/model-request-upload.ts` owns grant validation and storage access. Model protocol adapters and public attachment schemas remain unchanged. The runtime and API must be deployed together. Local protocol, encryption, failure and native replay tests pass; maximum-size hosted acceptance remains in release TODO.

Native session replay keeps image context and can eventually reach the five-image or 8 MiB request limit. There is no silent history deletion; a new session is the documented escape path. Provider-specific image references and more precise reservations remain deferred until their accounting/replay behavior is accepted.

## Output lifecycle

The shared native-worker instructions direct deliverables to `outputs/`. This is a filesystem convention rather than a model-response parser. No local or remote URL in generated prose grants a download capability.

Finalization compares the prior and verified final manifests. It publishes only new/changed regular files under `outputs/`, excluding hidden paths and files the run cannot read. Each artifact points at the existing immutable, tenant-owned encrypted content object. Artifact IDs are added to the normal run result in the same transaction as checkpoint publication. Repeated terminal finalization cannot republish artifacts. Failed/cancelled runs can expose verified partial files; unverified persistence cannot create artifacts.

Existing artifact endpoints enforce tenant/workspace authority and return short-lived downloads. History expiration removes artifact content metadata and run attachment references. Storage GC honors remaining worktree/checkpoint references, so expiration cannot delete a current deliverable. Workspace purge follows the existing resource deletion flow. No compatibility migration is needed because this is optional JSON configuration and the existing artifact resource.

The simulator checks admitted hashes and, for attachment journeys, saves a clearly labeled simulation report under `outputs/`. It performs no content understanding. Fixture-only output is never reported as live model acceptance.

## Decisions and deferred work

- Reuse checkpoint storage and artifact resources; do not add a competing file service, vector store or provider-file lifetime model.
- Prefer text extraction for portable document inputs and native image blocks where metering is understood. Layout-faithful visual PDFs, OCR and video analysis need separate bounded processing.
- Deliver any file the harness successfully creates; do not add a media-authoring service or assume a provider/tool can generate every advertised file extension.
- Use an explicit output directory rather than scraping Markdown links or publishing every code change as an artifact. Nested directories work; hidden files remain excluded.
- Keep file display and document edit state separate. Binary preview never initializes the text editor or rewrites original bytes.
- Do not silently retry failed parsing, switch image models, overwrite changed attachments, or recover media through an unapproved external service.

## Research and acceptance

The review used published API/protocol documentation and public repositories, not proprietary ChatGPT or Claude application internals. [OpenAI file inputs](https://developers.openai.com/api/docs/guides/file-inputs) and [vision inputs](https://developers.openai.com/api/docs/guides/images-vision) distinguish native content blocks and model compatibility. [Claude PDF support](https://platform.claude.com/docs/en/build-with-claude/pdf-support) explains text-plus-page-image processing; the initial implementation intentionally chooses bounded text extraction instead.

[OpenClaw media understanding](https://docs.openclaw.ai/nodes/media-understanding) informs preserving originals and making processing capability-dependent. [HarnessRouter's public protocol](https://github.com/HarnessRouter/harnessrouter/blob/main/protocol/versions/2026-08-11/architecture.md) informs separate input file references and output artifact retrieval. No upstream implementation was copied.

The follow-up review compared [Claude's Files API](https://platform.claude.com/docs/en/build-with-claude/files) and [Gemini's Files API](https://ai.google.dev/gemini-api/docs/files) as well: both separate upload/reference from inference and expose generated files separately. Adopt the reusable-reference and explicit-capability patterns through our existing worktree/artifact APIs. Do not add vendor file IDs or a second retention lifecycle just to mirror another API. OpenAI's document support distinguishes text extraction from visual PDF interpretation; that reinforces clear text-only PDF/DOCX labeling here, not a claim of visual parity. OpenClaw's automatic model fallback is deliberately not adopted because it would change the caller's chosen provider, cost and data destination.

Browser rendering follows the [PDF.js example API](https://mozilla.github.io/pdf.js/examples/); parser/worker versions match between browser and runtime. Dependencies are pinned: PDF.js 6.3.289 (Apache-2.0), Mammoth 1.12.3 (BSD-2-Clause), and image-size 2.0.4 (MIT). Their [dependency review](../../engineering/dependencies.md) and [verification record](verification.md) cover actual acceptance and remaining release work.
