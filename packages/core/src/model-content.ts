import { validateImage } from '../../contracts/image-input';
import { mediaLimits, supportsImageInput } from '../../contracts/media';
import { assert } from './errors';
import type { EncodedJson } from './prepared-json';

/** Conservative reservation, not the customer's final charge. Current reviewed
 * models stay below 32k input tokens for a <=2048×2048 image; actual provider
 * usage still settles normally and the existing breach breaker remains active. */
const IMAGE_TOKEN_BOUND = 32_768;
export function modelInputBound(
  payload: Record<string, unknown>,
  configuration: { harness: string; provider: string; model: string },
  encoded?: EncodedJson<Record<string, unknown>>,
) {
  let images = 0;
  let jsonSafe = true;
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') {
      if (
        value !== null &&
        (!['string', 'boolean', 'number'].includes(typeof value) ||
          (typeof value === 'number' && !Number.isFinite(value)))
      )
        jsonSafe = false;
      return;
    }
    if (Array.isArray(value)) {
      if (typeof Reflect.get(value, 'toJSON') === 'function') jsonSafe = false;
      // for..of also sees sparse slots, whose canonical and JSON encodings differ.
      for (const child of value) visit(child);
      return;
    }
    const object = value as Record<string, unknown>;
    if (
      ![Object.prototype, null].includes(Object.getPrototypeOf(object)) ||
      typeof object.toJSON === 'function'
    )
      jsonSafe = false;
    if (object.type === 'input_image' || object.type === 'image') {
      assert(
        supportsImageInput(configuration.harness, configuration.provider, configuration.model),
        400,
        'unsupported_model_content',
        'This harness/model combination does not support metered image input.',
      );
      assert(
        ++images <= mediaLimits.attachments,
        413,
        'too_many_images',
        'A model request can contain up to five images, including conversation history.',
      );
      let data: string, mime: string;
      if (configuration.provider === 'openai' && object.type === 'input_image') {
        assert(
          Object.keys(object).every((key) => ['type', 'image_url', 'detail'].includes(key)) &&
            [undefined, 'auto', 'low', 'high'].includes(object.detail as string | undefined),
          400,
          'unsupported_model_content',
          'Use an inline image with auto, low, or high detail.',
        );
        const match =
          typeof object.image_url === 'string' &&
          /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(object.image_url);
        assert(match, 400, 'unsupported_model_content', 'Remote image URLs and file IDs are not supported.');
        [, mime, data] = match;
      } else {
        const source = object.source as Record<string, unknown> | undefined;
        assert(
          configuration.provider === 'anthropic' &&
            object.type === 'image' &&
            source &&
            Object.keys(object).every((key) => ['type', 'source', 'cache_control'].includes(key)) &&
            Object.keys(source).every((key) => ['type', 'media_type', 'data'].includes(key)) &&
            source.type === 'base64' &&
            typeof source.data === 'string' &&
            typeof source.media_type === 'string',
          400,
          'unsupported_model_content',
          'Use a base64 image source.',
        );
        data = source.data;
        mime = source.media_type;
      }
      try {
        const bytes = Buffer.from(data, 'base64');
        if (bytes.toString('base64') !== data) throw new Error('Invalid base64');
        validateImage(bytes, mime);
      } catch {
        assert(
          false,
          400,
          'invalid_image',
          'Use a valid PNG, JPEG or WebP up to 1 MiB and 2048 pixels per side.',
        );
      }
      return;
    }
    assert(
      typeof object.type !== 'string' ||
        !/image|audio|video|file|document|web_search|computer_use/.test(object.type),
      400,
      'unsupported_model_content',
      'This route accepts text, supported inline images, and client-executed tools.',
    );
    for (const key of ['image_url', 'input_audio', 'audio', 'file_id', 'file_data'])
      assert(!(key in object), 400, 'unsupported_model_content', 'Unsupported media input.');
    for (const child of Object.values(object)) visit(child);
  }
  visit(payload);
  if (!images && jsonSafe)
    return (encoded?.value === payload ? encoded.bytes : Buffer.byteLength(JSON.stringify(payload))) + 1024;

  // Only media and internal non-JSON values need the old projection semantics.
  // Ordinary text requests validate in place without rebuilding every object.
  function project(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(project);
    const object = value as Record<string, unknown>;
    if (object.type === 'input_image' || object.type === 'image')
      return { type: 'validated_image', cache_control: object.cache_control };
    return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, project(child)]));
  }
  return Buffer.byteLength(JSON.stringify(project(payload))) + 1024 + images * IMAGE_TOKEN_BOUND;
}
