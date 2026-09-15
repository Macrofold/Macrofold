import { createSwarmRenderer, LOOP_SECONDS, type SwarmVariant } from './renderer';

const DURATION_MS = LOOP_SECONDS * 1000;
const FRAME_RATE = 30;

export async function exportSwarmVideo(
  variant: SwarmVariant,
  options: {
    width: number;
    height: number;
    signal: AbortSignal;
    onProgress: (progress: number) => void;
  },
): Promise<{ blob: Blob; extension: 'webm' | 'mp4' }> {
  const { width, height, signal, onProgress } = options;
  if (signal.aborted) throw new DOMException('Export canceled.', 'AbortError');
  if (document.hidden) throw new Error('Keep this tab visible while exporting the video.');
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Video export is unavailable in this browser. Try a current desktop browser.');
  }
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/mp4'].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
  if (!mimeType) throw new Error('This browser does not support a video export format.');

  const canvas = document.createElement('canvas');
  if (typeof canvas.captureStream !== 'function') {
    throw new Error('Canvas video export is unavailable in this browser.');
  }
  const renderer = createSwarmRenderer(canvas);
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let cleanRecording = () => {};

  try {
    renderer.resize(width, height, 1);
    renderer.render(0, variant);
    stream = canvas.captureStream(FRAME_RATE);
    const activeRecorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: width * height > 1920 * 1080 ? 22_000_000 : 8_000_000,
    });
    recorder = activeRecorder;

    return await new Promise((resolve, reject) => {
      const chunks: Blob[] = [];
      let animationFrame = 0;
      let settled = false;
      let finishedLoop = false;
      let startTime = 0;
      let lastFrameTime = 0;
      let renderedFrame = -1;
      let progressPercent = -1;

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const onAbort = () => fail(new DOMException('Export canceled.', 'AbortError'));
      const onVisibilityChange = () => {
        if (document.hidden) {
          fail(new Error('Export stopped when the tab was hidden. Keep this tab visible and try again.'));
        }
      };
      const onContextLost = () =>
        fail(new Error('The graphics context was interrupted. Reload and try again.'));
      const timeout = window.setTimeout(() => {
        fail(new Error('Video export timed out. Try again at a lower resolution.'));
      }, DURATION_MS + 10_000);

      cleanRecording = () => {
        cancelAnimationFrame(animationFrame);
        window.clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        canvas.removeEventListener('webglcontextlost', onContextLost);
        activeRecorder.ondataavailable = null;
        activeRecorder.onerror = null;
        activeRecorder.onstop = null;
      };
      signal.addEventListener('abort', onAbort, { once: true });
      document.addEventListener('visibilitychange', onVisibilityChange);
      canvas.addEventListener('webglcontextlost', onContextLost);

      activeRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      activeRecorder.onerror = () =>
        fail(new Error('Video encoding failed. Try again at a lower resolution.'));
      activeRecorder.onstop = () => {
        if (settled) return;
        try {
          if (!finishedLoop) {
            fail(new Error('The video capture ended before the loop finished. Please try again.'));
            return;
          }
          const blob = new Blob(chunks, { type: activeRecorder.mimeType || mimeType });
          if (!blob.size) {
            fail(new Error('The browser produced an empty video. Please try again.'));
            return;
          }
          onProgress(1);
          settled = true;
          resolve({ blob, extension: blob.type.startsWith('video/mp4') ? 'mp4' : 'webm' });
        } catch (error) {
          fail(error);
        }
      };

      const draw = (now: number) => {
        if (settled || finishedLoop) return;
        try {
          if (now - lastFrameTime > 1000) {
            fail(new Error('Rendering was interrupted. Keep this tab visible and try a lower resolution.'));
            return;
          }
          lastFrameTime = now;
          const elapsed = now - startTime;
          if (elapsed >= DURATION_MS) {
            finishedLoop = true;
            activeRecorder.stop();
            return;
          }
          const frame = Math.floor((elapsed * FRAME_RATE) / 1000);
          if (frame !== renderedFrame) {
            renderer.render(frame / FRAME_RATE, variant);
            renderedFrame = frame;
          }
          const percent = Math.floor((elapsed / DURATION_MS) * 100);
          if (percent !== progressPercent) {
            progressPercent = percent;
            onProgress(percent / 100);
          }
          animationFrame = requestAnimationFrame(draw);
        } catch (error) {
          fail(error);
        }
      };

      startTime = performance.now();
      lastFrameTime = startTime;
      activeRecorder.start();
      animationFrame = requestAnimationFrame(draw);
    });
  } finally {
    cleanRecording();
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      renderer.dispose();
    }
  }
}
