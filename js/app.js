import { traceWork } from './tracer.js';
import { EtchASketch } from './etch.js';
import { makeSampleImage } from './sample.js';

const SCREEN_W = 1000;
const SCREEN_H = 618;

const $ = (id) => document.getElementById(id);
const el = {
  toy: $('toy'),
  screen: $('screen'),
  screenHint: $('screenHint'),
  knobL: $('knobL'),
  knobR: $('knobR'),
  progressWrap: $('progressWrap'),
  progressFill: $('progressFill'),
  status: $('status'),
  dropzone: $('dropzone'),
  fileInput: $('fileInput'),
  dropEmpty: $('dropEmpty'),
  dropPreview: $('dropPreview'),
  thumb: $('thumb'),
  edgeThumb: $('edgeThumb'),
  fileName: $('fileName'),
  showEdges: $('showEdges'),
  btnSample: $('btnSample'),
  speed: $('speed'),
  speedLabel: $('speedLabel'),
  detail: $('detail'),
  detailLabel: $('detailLabel'),
  shading: $('shading'),
  shadingLabel: $('shadingLabel'),
  hatchStyle: $('hatchStyle'),
  hideTravel: $('hideTravel'),
  btnPlay: $('btnPlay'),
  btnRestart: $('btnRestart'),
  btnShake: $('btnShake'),
  stats: $('stats'),
  statStrokes: $('statStrokes'),
  statLength: $('statLength'),
  statTurns: $('statTurns'),
  dropOverlay: $('dropOverlay'),
};

const state = {
  source: null, // CanvasImageSource for tracing
  sourceName: '',
  path: null,
  busy: false,
  startedAt: 0,
  traceToken: 0,
};

const etch = new EtchASketch({
  canvas: el.screen,
  leftKnob: el.knobL,
  rightKnob: el.knobR,
  toy: el.toy,
  width: SCREEN_W,
  height: SCREEN_H,
  onProgress: updateProgress,
  onDone: onDrawingDone,
});

/* ---------------- speed & detail ---------------- */

const SPEED_MIN = 12;
const SPEED_MAX = 80000;

function sliderToSpeed(v) {
  const t = v / 1000;
  return SPEED_MIN * Math.pow(SPEED_MAX / SPEED_MIN, t);
}

function speedName(pxPerSec) {
  if (pxPerSec < 80) return 'Meditative';
  if (pxPerSec < 400) return 'Leisurely';
  if (pxPerSec < 2500) return 'Brisk';
  if (pxPerSec < 9000) return 'Frantic';
  if (pxPerSec < 30000) return 'Ludicrous';
  return 'Time-lapse';
}

function applySpeed() {
  const s = sliderToSpeed(Number(el.speed.value));
  etch.setSpeed(s);
  el.speedLabel.textContent = `${speedName(s)} · ${formatSpeed(s)}`;
  if (etch.hasPath && !etch.done) {
    updateProgress(etch.total ? etch.progress / etch.total : 0, (etch.total - etch.progress) / s);
  }
}

function formatSpeed(s) {
  if (s >= 1000) return `${(s / 1000).toFixed(s >= 10000 ? 0 : 1)}k px/s`;
  return `${Math.round(s)} px/s`;
}

function detailValue() {
  return Number(el.detail.value) / 1000;
}

function detailName(d) {
  if (d < 0.2) return 'Bold';
  if (d < 0.4) return 'Low';
  if (d < 0.6) return 'Medium';
  if (d < 0.8) return 'High';
  return 'Maximum';
}

function shadingValue() {
  return Number(el.shading.value) / 1000;
}

function shadingName(v) {
  if (v < 0.03) return 'Outlines only';
  if (v < 0.3) return 'Light';
  if (v < 0.6) return 'Medium';
  if (v < 0.85) return 'Heavy';
  return 'Full';
}

/* ---------------- progress & status ---------------- */

function updateProgress(fraction, remainingSec) {
  el.progressFill.style.width = `${(fraction * 100).toFixed(1)}%`;
  if (state.busy) return;
  if (!etch.hasPath) return;
  const pct = Math.floor(fraction * 100);
  if (etch.done) return;
  const verb = etch.playing ? 'Drawing' : 'Paused';
  el.status.textContent = `${verb} · ${pct}% · about ${formatDuration(remainingSec)} left`;
}

function onDrawingDone() {
  const took = (performance.now() - state.startedAt) / 1000;
  el.status.textContent = `Finished in ${formatDuration(took)}. Shake to erase, or drop another picture.`;
  el.btnPlay.textContent = 'Play';
  el.btnPlay.disabled = true;
}

function formatDuration(sec) {
  if (!isFinite(sec)) return '…';
  if (sec < 1) return 'a moment';
  if (sec < 60) return `${Math.ceil(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

function setButtons() {
  const has = etch.hasPath;
  el.btnPlay.disabled = !has || etch.done || state.busy;
  el.btnRestart.disabled = !has || state.busy;
  el.btnShake.disabled = state.busy;
  el.btnPlay.textContent = etch.playing ? 'Pause' : 'Play';
}

/* ---------------- loading pictures ---------------- */

async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    flashStatus('That does not look like an image file.');
    return;
  }
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    source = await loadViaImageElement(file);
  }
  if (el.thumb.dataset.objectUrl) URL.revokeObjectURL(el.thumb.dataset.objectUrl);
  const url = URL.createObjectURL(file);
  el.thumb.dataset.objectUrl = url;
  el.thumb.src = url;
  setSource(source, file.name || 'image');
}

function loadViaImageElement(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not decode image')); };
    img.src = url;
  });
}

function setSource(source, name) {
  state.source = source;
  state.sourceName = name;
  el.fileName.textContent = name;
  el.dropEmpty.hidden = true;
  el.dropPreview.hidden = false;
  el.screenHint.classList.add('hidden');
  el.progressWrap.hidden = false;
  retrace();
}

function loadSample() {
  const canvas = makeSampleImage();
  if (el.thumb.dataset.objectUrl) {
    URL.revokeObjectURL(el.thumb.dataset.objectUrl);
    delete el.thumb.dataset.objectUrl;
  }
  el.thumb.src = canvas.toDataURL('image/png');
  setSource(canvas, 'sample-house.png');
}

/* ---------------- tracing & drawing ---------------- */

const WORK_WIDTH = 1000;

let worker = null;
let workerBroken = false;

function getWorker() {
  if (workerBroken) return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./tracer.worker.js', import.meta.url), { type: 'module' });
      worker.onerror = () => {
        workerBroken = true;
        worker = null;
      };
    } catch {
      workerBroken = true;
      worker = null;
    }
  }
  return worker;
}

/** Fit the source into the working resolution and read its pixels (main thread only). */
function prepareWorkImage(source) {
  const workScale = WORK_WIDTH / SCREEN_W;
  const workH = Math.round(SCREEN_H * workScale);
  const margin = 0.03;
  const fit = Math.min((WORK_WIDTH * (1 - 2 * margin)) / source.width, (workH * (1 - 2 * margin)) / source.height);
  const w = Math.max(4, Math.round(source.width * fit));
  const h = Math.max(4, Math.round(source.height * fit));
  const ox = Math.floor((WORK_WIDTH - w) / 2);
  const oy = Math.floor((workH - h) / 2);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  return { pixels: { data: img.data, width: w, height: h }, ox, oy, workScale, upscale: w / source.width };
}

function runTrace(pixels, opts, onProgress) {
  const wk = getWorker();
  if (!wk) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try { resolve(traceWork(pixels, opts, onProgress)); } catch (e) { reject(e); }
      }, 20);
    });
  }
  return new Promise((resolve, reject) => {
    const id = ++state.traceToken;
    const handler = (e) => {
      if (e.data.id !== id) return;
      if (e.data.progress !== undefined) {
        onProgress(e.data.progress, e.data.stage);
        return;
      }
      wk.removeEventListener('message', handler);
      wk.removeEventListener('error', onErr);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.result);
    };
    const onErr = () => {
      wk.removeEventListener('message', handler);
      workerBroken = true;
      worker = null;
      // Fall back to the main thread.
      setTimeout(() => {
        try { resolve(traceWork(pixels, opts, onProgress)); } catch (e) { reject(e); }
      }, 20);
    };
    wk.addEventListener('message', handler);
    wk.addEventListener('error', onErr);
    wk.postMessage({ id, pixels, opts }, [pixels.data.buffer]);
  });
}

let traceRun = 0;

async function retrace() {
  if (!state.source) return;
  const run = ++traceRun;
  state.busy = true;
  etch.pause();
  setButtons();
  el.status.textContent = 'Planning the drawing…';

  const prep = prepareWorkImage(state.source);
  const startWork = { x: etch.pos.x * prep.workScale - prep.ox, y: etch.pos.y * prep.workScale - prep.oy };
  let result;
  try {
    result = await runTrace(prep.pixels, { detail: detailValue(), shading: shadingValue(), start: startWork, upscale: prep.upscale, flow: el.hatchStyle.value === 'flow' }, (f, stage) => {
      if (run !== traceRun) return;
      const label = stage === 'planning' ? 'Planning the route' : stage === 'shading' ? 'Working out the shading' : 'Finding the outlines';
      el.status.textContent = `${label}… ${Math.round(f * 100)}%`;
      el.progressFill.style.width = `${(f * 100).toFixed(1)}%`;
    });
  } catch (err) {
    if (run !== traceRun) return;
    state.busy = false;
    el.status.textContent = `Could not trace that picture (${err.message}).`;
    setButtons();
    return;
  }
  if (run !== traceRun) return;

  const toScreen = 1 / prep.workScale;
  const flat = result.path;
  const path = new Array(flat.length / 3);
  for (let i = 0, j = 0; j < flat.length; i++, j += 3) {
    path[i] = { x: (flat[j] + prep.ox + 0.5) * toScreen, y: (flat[j + 1] + prep.oy + 0.5) * toScreen, travel: flat[j + 2] === 1 };
  }
  state.path = path;
  state.strokes = result.strokes;
  drawPlanThumb(path);

  if (etch.dirty) await etch.shake();
  if (run !== traceRun) return;

  state.busy = false;
  startDrawing();
}

function startDrawing() {
  if (!state.path) return;
  etch.setPath(state.path);
  el.statStrokes.textContent = state.strokes.toLocaleString();
  el.statLength.textContent = formatLength(etch.stats.length);
  el.statTurns.textContent = Math.round(etch.stats.turns).toLocaleString();
  el.stats.hidden = false;
  state.startedAt = performance.now();
  if (!state.path.length) {
    el.status.textContent = 'Nothing to draw. Try more detail, or a picture with stronger lines.';
    setButtons();
    return;
  }
  etch.play();
  setButtons();
}

function formatLength(px) {
  // Treat the screen as a real one, about 16 cm wide.
  const cm = (px / SCREEN_W) * 16;
  if (cm >= 100) return `${(cm / 100).toFixed(1)} m`;
  return `${Math.round(cm)} cm`;
}

function drawPlanThumb(path) {
  const c = el.edgeThumb;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d2d1cc';
  ctx.fillRect(0, 0, c.width, c.height);
  if (!path.length) return;
  ctx.strokeStyle = '#3f3f42';
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(etch.pos.x, etch.pos.y);
  for (const p of path) ctx.lineTo(p.x, p.y);
  ctx.stroke();
}

async function restart() {
  if (!state.path || state.busy) return;
  state.busy = true;
  setButtons();
  el.status.textContent = 'Shaking…';
  await etch.shake();
  state.busy = false;
  startDrawing();
}

async function shakeOnly() {
  if (state.busy) return;
  state.busy = true;
  setButtons();
  el.status.textContent = 'Shaking…';
  el.progressWrap.hidden = false;
  await etch.shake();
  state.busy = false;
  state.path = null;
  etch.points = null;
  etch.done = false;
  el.progressFill.style.width = '0%';
  el.status.textContent = state.source ? 'Erased. Press Restart to draw it again.' : 'Waiting for a picture…';
  setButtons();
  // Restart still works from the retained trace.
  if (state.source) {
    el.btnRestart.disabled = false;
  }
}

let flashTimer = 0;
function flashStatus(msg) {
  el.progressWrap.hidden = false;
  const prev = el.status.textContent;
  el.status.textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { if (el.status.textContent === msg) el.status.textContent = prev; }, 3000);
}

/* ---------------- events ---------------- */

el.speed.addEventListener('input', applySpeed);

el.detail.addEventListener('input', () => {
  el.detailLabel.textContent = detailName(detailValue());
});
el.detail.addEventListener('change', () => {
  if (state.source) retrace();
});

el.shading.addEventListener('input', () => {
  el.shadingLabel.textContent = shadingName(shadingValue());
});
el.shading.addEventListener('change', () => {
  if (state.source) retrace();
});
el.hatchStyle.addEventListener('change', () => {
  if (state.source) retrace();
});

el.hideTravel.addEventListener('change', () => {
  etch.hideTravel = el.hideTravel.checked;
});

el.showEdges.addEventListener('change', () => {
  el.dropPreview.classList.toggle('show-edges', el.showEdges.checked);
});

el.btnPlay.addEventListener('click', () => {
  if (!etch.hasPath) return;
  etch.toggle();
  setButtons();
  updateProgress(etch.total ? etch.progress / etch.total : 0, (etch.total - etch.progress) / etch.speed);
});

el.btnRestart.addEventListener('click', () => {
  if (state.path) restart();
  else if (state.source) retrace();
});

el.btnShake.addEventListener('click', shakeOnly);
el.btnSample.addEventListener('click', (e) => {
  e.preventDefault();
  loadSample();
});

el.fileInput.addEventListener('change', () => {
  const f = el.fileInput.files && el.fileInput.files[0];
  if (f) loadFile(f);
  el.fileInput.value = '';
});

// Drag & drop anywhere on the page.
let dragDepth = 0;
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  el.dropOverlay.classList.add('active');
});
document.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) el.dropOverlay.classList.remove('active');
});
document.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  el.dropOverlay.classList.remove('active');
  const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
  if (file) loadFile(file);
  else flashStatus('Drop an image file (PNG, JPG, WebP, GIF…).');
});

function hasFiles(e) {
  return e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
}

// Paste an image from the clipboard.
document.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.files;
  if (!items || !items.length) return;
  const file = [...items].find((f) => f.type.startsWith('image/'));
  if (file) {
    e.preventDefault();
    loadFile(file);
  }
});

// Space toggles play/pause when not typing in a control.
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.target.closest('input, button, textarea, select')) return;
  if (!etch.hasPath || etch.done) return;
  e.preventDefault();
  etch.toggle();
  setButtons();
});

/* ---------------- init ---------------- */

applySpeed();
el.detailLabel.textContent = detailName(detailValue());
el.shadingLabel.textContent = shadingName(shadingValue());
setButtons();
getWorker();

// Handy for poking at things from the console.
window.etcha = { etch, state };
