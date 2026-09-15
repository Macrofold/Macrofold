import { SURFACE_VARIATIONS } from './variations.mjs';

const stage = document.querySelector('#stage');
const canvas = document.querySelector('#particles');
const poster = document.querySelector('#poster');
const timeline = document.querySelector('#timeline');
const time = document.querySelector('#time');
const speedControl = document.querySelector('#speed');
const speedValue = document.querySelector('#speed-value');
const status = document.querySelector('#status');
const note = document.querySelector('#playback-note');
const playButton = document.querySelector('#play');
const formation = document.querySelector('#formation');
const loop = document.querySelector('#loop');
const pause = document.querySelector('#pause');
const originalButton = document.querySelector('#original');
const gridButton = document.querySelector('#grid');
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
const abort = new AbortController();
const listeners = [];
const select = document.querySelector('#variation');
const previousButton = document.querySelector('#previous');
const nextButton = document.querySelector('#next');
const description = document.querySelector('#variation-description');
const posterNote = document.querySelector('#poster-note');
const download = document.querySelector('#surface-download');
const downloads = document.querySelector('#downloads');
const defaultId = SURFACE_VARIATIONS[0].id;
const requestedId = new URL(location.href).searchParams.get('variation') || defaultId;
function variationIndexFor(id) {
  const index = SURFACE_VARIATIONS.findIndex((item) => item.id === id);
  return index >= 0 ? index : SURFACE_VARIATIONS.findIndex((item) => item.id === defaultId);
}
let variationIndex = variationIndexFor(requestedId);
let surfacePoster = `./surfaces/${defaultId}.webp`;
let posterName = SURFACE_VARIATIONS[0].name;
let assetAbort;
const duration = 21;
const formationEnd = 6;
document.querySelector('#static-notice').hidden = true;
status.textContent = 'Loading efflorescence study…';
let renderer;
let ready = false;
let disposed = false;
let visible = true;
let original = false;
let seconds = 14;
let speed = 1;
let playback = null;
let frame = 0;
let previous = 0;
let lastTimeLabel = 0;
let pointerX = 0;
let pointerY = 0;
let targetX = 0;
let targetY = 0;
let maximumDpr = 1;
let dpr = 1;
let lastAdjustment = 0;
let timingSamples = [];

function listen(target, event, callback) {
  target.addEventListener(event, callback);
  listeners.push(() => target.removeEventListener(event, callback));
}

function updateTime() {
  timeline.value = String(seconds);
  timeline.setAttribute('aria-valuetext', `${seconds.toFixed(1)} of ${duration} seconds`);
  time.replaceChildren(`${seconds.toFixed(1).padStart(4, '0')} `);
  const total = document.createElement('span');
  total.textContent = `/ ${duration.toFixed(1)} s`;
  time.append(total);
}

function updateControls() {
  playButton.disabled = !ready || original || Boolean(playback);
  formation.disabled = !ready || original;
  loop.disabled = !ready || original;
  pause.disabled = !playback;
  timeline.disabled = !ready || original;
  speedControl.disabled = !ready || original;
  originalButton.disabled = false;
  originalButton.setAttribute('aria-pressed', String(original));
  loop.setAttribute('aria-pressed', String(playback === 'loop'));
  poster.hidden = ready && !original;
  canvas.hidden = !ready || original;
  if (!poster.hidden) {
    poster.src = original ? './reference.webp' : surfacePoster || './reference.webp';
    poster.alt = original
      ? 'The original Swarm artwork: a fine cyan and ivory particle structure on black.'
      : surfacePoster
        ? `${posterName} efflorescence study at fourteen seconds.`
        : 'Original Swarm artwork; a still for the selected variation is unavailable.';
  }
  note.textContent = original
    ? 'Original reference'
    : !ready
      ? surfacePoster
        ? `${posterName} still · 14 s`
        : 'Original artwork still'
      : playback === 'formation'
        ? `Formation · 0–${formationEnd} s`
        : playback === 'loop'
          ? `Loop · ${duration} s`
          : playback === 'once'
            ? 'Playing from selected frame'
            : `Still frame · ${seconds.toFixed(1)} s`;
  posterNote.hidden = ready || original || Boolean(surfacePoster);
  updateTime();
}

function schedule() {
  if (!frame && renderer && !disposed && visible && !document.hidden && !original) {
    frame = requestAnimationFrame(draw);
  }
}

function resize() {
  if (!renderer) return;
  const bounds = stage.getBoundingClientRect();
  const nextMaximum = Math.min(window.devicePixelRatio || 1, 2, 3840 / bounds.width, 2560 / bounds.height);
  if (maximumDpr !== nextMaximum) {
    maximumDpr = nextMaximum;
    dpr = maximumDpr;
  }
  renderer.resize(Math.max(1, Math.round(bounds.width * dpr)), Math.max(1, Math.round(bounds.height * dpr)));
  canvas.dataset.pixelRatio = dpr.toFixed(2);
  timingSamples = [];
  schedule();
}

function adjustResolution(timestamp, interval) {
  // Adapt from observed animation-frame pacing, not a guessed device tier.
  if (interval <= 0 || interval > 100) return;
  timingSamples.push(interval);
  if (timingSamples.length < 45 || timestamp - lastAdjustment < 1500) return;
  const ordered = timingSamples.toSorted((a, b) => a - b);
  const pacing = ordered[Math.floor(ordered.length * 0.75)];
  timingSamples = [];
  const minimumDpr = Math.min(maximumDpr, 0.75);
  if (pacing > 26 && dpr > minimumDpr) {
    dpr = Math.max(minimumDpr, dpr * 0.85);
    lastAdjustment = timestamp;
    resize();
  } else if (pacing < 18.5 && timestamp - lastAdjustment > 5000 && dpr < maximumDpr) {
    dpr = Math.min(maximumDpr, dpr / 0.85);
    lastAdjustment = timestamp;
    resize();
  }
}

function restoreStillResolution() {
  if (!renderer) return;
  timingSamples = [];
  if (dpr !== maximumDpr) {
    dpr = maximumDpr;
    resize();
  }
}

function advancePlayback(interval) {
  if (!playback) return;
  seconds += (interval / 1000) * speed;
  if (playback === 'loop') {
    seconds %= duration;
    return;
  }
  const end = playback === 'formation' ? formationEnd : duration;
  if (seconds >= end) {
    seconds = end;
    playback = null;
    restoreStillResolution();
    updateControls();
  }
}

function draw(timestamp) {
  frame = 0;
  if (!renderer || disposed || document.hidden || !visible || original) return;
  const interval = previous ? Math.max(0, timestamp - previous) : 0;
  previous = timestamp;
  advancePlayback(interval);
  const easing = 1 - Math.exp(-Math.min(interval || 16.7, 64) / 85);
  pointerX += (targetX - pointerX) * easing;
  pointerY += (targetY - pointerY) * easing;
  const moving = Math.abs(targetX - pointerX) + Math.abs(targetY - pointerY) > 0.002;
  if (!moving) {
    pointerX = targetX;
    pointerY = targetY;
  }
  try {
    renderer.render(seconds, pointerX, pointerY);
  } catch {
    fail();
    return;
  }
  if (timestamp - lastTimeLabel > 100) {
    updateTime();
    lastTimeLabel = timestamp;
  }
  if (playback) adjustResolution(timestamp, interval);
  if (playback || moving) schedule();
  else previous = 0;
}

function stopFrames() {
  cancelAnimationFrame(frame);
  frame = 0;
  previous = 0;
  timingSamples = [];
}

function play(mode, restart = true) {
  if (!ready || original) return;
  stopFrames();
  if (restart || seconds >= duration) seconds = 0;
  playback = mode;
  updateControls();
  schedule();
}

function fail() {
  stopFrames();
  playback = null;
  ready = false;
  renderer?.dispose();
  renderer = undefined;
  stage.dataset.renderer = 'fallback';
  status.textContent = 'Live particle rendering is unavailable. A still is shown.';
  updateControls();
}

listen(playButton, 'click', () => play('once', false));
listen(formation, 'click', () => play('formation'));
listen(loop, 'click', () => play('loop'));
listen(pause, 'click', () => {
  playback = null;
  stopFrames();
  restoreStillResolution();
  updateControls();
  schedule();
});
listen(speedControl, 'input', () => {
  // Account for the elapsed interval at the old rate before changing it.
  // Hidden/offscreen suspension resets previous, so it never adds hidden time.
  if (playback && previous) {
    const timestamp = performance.now();
    advancePlayback(Math.max(0, timestamp - previous));
    previous = timestamp;
  }
  speed = Number(speedControl.value);
  speedControl.setAttribute('aria-valuetext', `${speed.toFixed(1)} times normal speed`);
  speedValue.textContent = `${speed.toFixed(1)}×`;
  updateTime();
  schedule();
});
listen(timeline, 'input', () => {
  playback = null;
  seconds = Math.max(0, Math.min(duration, Number(timeline.value)));
  stopFrames();
  restoreStillResolution();
  updateControls();
  schedule();
});
listen(originalButton, 'click', () => {
  original = !original;
  playback = null;
  targetX = targetY = pointerX = pointerY = 0;
  stopFrames();
  if (!original) restoreStillResolution();
  updateControls();
  schedule();
});
listen(gridButton, 'click', () => {
  const enabled = stage.dataset.grid !== 'true';
  stage.dataset.grid = String(enabled);
  gridButton.setAttribute('aria-pressed', String(enabled));
  updateControls();
});
gridButton.disabled = false;
listen(stage, 'pointermove', (event) => {
  if (motion.matches || original || event.pointerType === 'touch') return;
  const bounds = stage.getBoundingClientRect();
  targetX = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1));
  targetY = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height) * 2 - 1));
  schedule();
});
listen(stage, 'pointerleave', () => {
  targetX = targetY = 0;
  schedule();
});
listen(motion, 'change', () => {
  playback = null;
  targetX = targetY = pointerX = pointerY = 0;
  stopFrames();
  restoreStillResolution();
  updateControls();
  schedule();
});
listen(document, 'visibilitychange', () => {
  stopFrames();
  schedule();
});
listen(window, 'resize', resize);
listen(canvas, 'webglcontextlost', fail);

const sizeObserver = new ResizeObserver(resize);
sizeObserver.observe(stage);
const visibilityObserver = new IntersectionObserver(([entry]) => {
  visible = entry.isIntersecting;
  stopFrames();
  schedule();
});
visibilityObserver.observe(stage);

listen(window, 'pagehide', (event) => {
  stopFrames();
  if (event.persisted) return;
  disposed = true;
  abort.abort();
  assetAbort?.abort();
  sizeObserver.disconnect();
  visibilityObserver.disconnect();
  listeners.forEach((remove) => remove());
  renderer?.dispose();
});
listen(window, 'pageshow', () => {
  previous = 0;
  schedule();
});

async function load() {
  try {
    const [module, response] = await Promise.all([
      import('./renderer.mjs'),
      fetch('./scene.bin', { signal: abort.signal }),
    ]);
    if (!response.ok) throw new Error('Scene data is unavailable.');
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength % 48 !== 0) throw new Error('Scene data is incomplete.');
    if (disposed) return;
    renderer = module.createRenderer(canvas, new Float32Array(bytes));
    renderer.setVariation(SURFACE_VARIATIONS[variationIndex]);
    ready = true;
    stage.dataset.renderer = 'ready';
    status.textContent = `${SURFACE_VARIATIONS[variationIndex].name} ready.`;
    updateControls();
    resize();
  } catch {
    if (!disposed) fail();
  }
}

function updateVariationMetadata() {
  const config = SURFACE_VARIATIONS[variationIndex];
  select.value = config.id;
  description.textContent = config.description;
  stage.dataset.variation = config.id;
  const url = new URL(location.href);
  url.searchParams.set('variation', config.id);
  history.replaceState(null, '', url);
}

function chooseVariation(index) {
  variationIndex = (index + SURFACE_VARIATIONS.length) % SURFACE_VARIATIONS.length;
  stopFrames();
  updateVariationMetadata();
  if (renderer) {
    try {
      renderer.setVariation(SURFACE_VARIATIONS[variationIndex]);
      if (!playback) restoreStillResolution();
      status.textContent = `${SURFACE_VARIATIONS[variationIndex].name} ready.`;
    } catch {
      fail();
    }
  }
  updateControls();
  schedule();
  refreshAssets();
}

async function refreshAssets() {
  assetAbort?.abort();
  assetAbort = new AbortController();
  const { signal } = assetAbort;
  const config = SURFACE_VARIATIONS[variationIndex];
  download.hidden = downloads.hidden = true;
  download.href = `./surfaces/${config.id}.png`;
  document.querySelector('#download-name').textContent = `${config.name} still`;
  updateControls();
  await Promise.all([
    (async () => {
      const src = `./surfaces/${config.id}.webp`;
      let image;
      const cancelImage = () => {
        image?.removeAttribute('src');
      };
      try {
        const response = await fetch(src, { method: 'HEAD', signal });
        if (signal.aborted) return;
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/webp'))
          throw new Error('The selected efflorescence poster is unavailable.');
        image = new Image();
        signal.addEventListener('abort', cancelImage, { once: true });
        image.src = src;
        await image.decode();
        if (signal.aborted || disposed) return;
        surfacePoster = src;
        posterName = config.name;
        updateControls();
      } catch {
        if (!signal.aborted && !disposed) {
          surfacePoster = undefined;
          updateControls();
        }
      } finally {
        signal.removeEventListener('abort', cancelImage);
      }
    })(),
    (async () => {
      try {
        const response = await fetch(download.href, { method: 'HEAD', signal });
        if (
          !response.ok ||
          !response.headers.get('content-type')?.startsWith('image/png') ||
          signal.aborted ||
          disposed
        )
          return;
        download.hidden = downloads.hidden = false;
      } catch {
        // Unavailable exports stay hidden; the live study remains usable.
      }
    })(),
  ]);
}

select.replaceChildren(
  ...['Organic', 'Polyhedral'].map((name) => {
    const group = document.createElement('optgroup');
    group.label = name;
    for (const config of SURFACE_VARIATIONS.filter((item) => item.group === name)) {
      const option = document.createElement('option');
      option.value = config.id;
      option.textContent = config.name;
      group.append(option);
    }
    return group;
  }),
);
select.disabled = previousButton.disabled = nextButton.disabled = false;
listen(select, 'change', () =>
  chooseVariation(SURFACE_VARIATIONS.findIndex((item) => item.id === select.value)),
);
listen(previousButton, 'click', () => chooseVariation(variationIndex - 1));
listen(nextButton, 'click', () => chooseVariation(variationIndex + 1));
listen(window, 'popstate', () => {
  const id = new URL(location.href).searchParams.get('variation');
  chooseVariation(variationIndexFor(id));
});
updateVariationMetadata();
refreshAssets();
load();
