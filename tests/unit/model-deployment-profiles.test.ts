import { afterEach, describe, expect, it, vi } from 'vitest';
import { modelServingImage } from '../../packages/core/src/model-deployment-profiles';

afterEach(() => vi.unstubAllEnvs());

it('uses the reviewed native wrapper without operator configuration', () => {
  vi.stubEnv('MODEL_DECISION_SERVING_IMAGE', undefined);
  vi.stubEnv('MODEL_SERVING_IMAGE', `fixture/chat@sha256:${'a'.repeat(64)}`);
  expect(modelServingImage('kev-systemone-v1')).toBe(
    'ghcr.io/macrofold/model-serving-kev@sha256:f64e30cc0f40085bf15fa7c65a6886b5953edf3dbc8b8783f820ecd770780d5a',
  );
});

it('preserves independent immutable operator overrides', () => {
  const native = `fixture/native@sha256:${'b'.repeat(64)}`;
  const chat = `fixture/chat@sha256:${'a'.repeat(64)}`;
  vi.stubEnv('MODEL_DECISION_SERVING_IMAGE', native);
  vi.stubEnv('MODEL_SERVING_IMAGE', chat);
  expect(modelServingImage('kev-systemone-v1')).toBe(native);
  expect(modelServingImage()).toBe(chat);
});

describe.each([
  { profileId: 'kev-systemone-v1', setting: 'MODEL_DECISION_SERVING_IMAGE' },
  { profileId: 'vllm-0.32.0-text', setting: 'MODEL_SERVING_IMAGE' },
])('$profileId', ({ profileId, setting }) => {
  it.each(['', 'fixture/wrapper:latest', 'fixture/wrapper@sha256:invalid'])(
    'rejects an invalid explicit override instead of falling back: %j',
    (image) => {
      vi.stubEnv(setting, image);
      expect(() => modelServingImage(profileId)).toThrowError(
        expect.objectContaining({ code: 'model_runtime_unconfigured', status: 503 }),
      );
    },
  );
});

it('uses the reviewed chat wrapper independently of native configuration', () => {
  vi.stubEnv('MODEL_SERVING_IMAGE', undefined);
  vi.stubEnv('MODEL_DECISION_SERVING_IMAGE', `fixture/native@sha256:${'b'.repeat(64)}`);
  expect(modelServingImage()).toBe(
    'ghcr.io/macrofold/model-serving@sha256:ad0c99ffaaa3a868f1ff5c493af89feb9eafecc379b79449991d2a8ddacce385',
  );
});
