/**
 * Turns an image into a single continuous polyline that an Etch A Sketch can
 * draw, the way the professional Etch A Sketch artists do it:
 *
 *   1. Outlines: grayscale → Gaussian blur → Sobel → hysteresis threshold →
 *      morphological closing → Zhang-Suen thinning → contour tracing →
 *      Ramer-Douglas-Peucker simplification.
 *   2. Shading: local contrast is boosted, then dark regions are filled with
 *      hatch lines that follow the picture's edge tangent flow (see flow.js),
 *      in four hierarchical densities so tone runs smoothly from solid black
 *      to untouched highlights. A classic horizontal mode is kept as well.
 *   3. Planning: strokes are ordered greedily by proximity, and every move
 *      between strokes is routed with A* over a cost map that prefers dark
 *      regions and lines that are already drawn, so the connecting lines hide
 *      inside the picture instead of scarring the highlights.
 *
 * Because the stylus can never lift, those connecting moves are part of the
 * path. Points carry a `travel` flag meaning "the segment ending at this point
 * is a travel move".
 *
 * This module is pure math (no DOM) so it can run inside a Web Worker.
 * `traceWork` takes RGBA pixels of the already-fitted working image.
 */

import { toGray, boxBlurR, boxBlur3, gaussianBlur, sobel, simplify, lerp, clamp01 } from './imageops.js';
import { computeFlow, flowHatches } from './flow.js';

const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

/**
 * @param {{data: Uint8ClampedArray, width: number, height: number}} pixels
 * @param {object} opts
 * @param {number} [opts.detail]   0..1 edge sensitivity
 * @param {number} [opts.shading]  0..1 how much tone to hatch (0 = outlines only)
 * @param {number} [opts.upscale]  enlargement factor from source to working image
 * @param {boolean} [opts.flow]    shading follows the picture's shapes (default) or runs horizontally
 * @param {{x:number,y:number}} [opts.start] stylus position in work px
 * @param {(fraction:number, stage:string)=>void} [onProgress]
 * @returns {{path: Float32Array, strokes: number, edges: Uint8Array, width: number, height: number}}
 *   path is a flat [x, y, travel, x, y, travel, ...] array in work px.
 */
export function traceWork(pixels, opts = {}, onProgress = () => {}) {
  const { data, width: w, height: h } = pixels;
  const detail = clamp01(opts.detail ?? 0.5);
  const shading = clamp01(opts.shading ?? 1);
  const flowShading = opts.flow !== false;
  const start = opts.start || { x: w / 2, y: h / 2 };
  // How much the source was enlarged to reach the working resolution. Small
  // sources need proportionally more smoothing or their pixels become edges.
  const upscale = Math.max(1, opts.upscale || 1);

  onProgress(0, 'outlines');
  let gray = toGray(data, w, h);
  if (upscale > 1.5) gray = boxBlurR(gray, w, h, Math.round(upscale / 2));
  const tone = normalizeTone(gray, w, h);
  const blurred = gaussianBlur(gray, w, h);
  const mag = sobel(blurred, w, h);
  const bands = hysteresis(mag, w, h, detail);
  const closed = close3x3(bands, w, h);
  const edges = thin(closed, w, h);

  const minLength = Math.round(lerp(12, 5, detail));
  const rawContours = extractContours(edges, w, h, minLength);
  const epsilon = lerp(0.9, 0.45, detail);
  const strokes = rawContours.map((c) => simplify(c, epsilon)).filter((c) => c.length >= 2);

  onProgress(0.1, 'shading');
  const hatches = flowShading
    ? buildFlowHatches(tone, w, h, shading, (f) => onProgress(0.1 + 0.3 * f, 'shading'))
    : buildHatches(tone, w, h, shading);
  for (const s of hatches) strokes.push(s);

  onProgress(0.4, 'planning');
  const path = planPath(strokes, tone, w, h, start, (f) => onProgress(0.4 + 0.6 * f, 'planning'));

  return { path, strokes: strokes.length, edges, width: w, height: h };
}

/* ---------------- image processing ---------------- */

/** Contrast-stretched tone map in 0..1 (0 = black, 1 = white). */
function normalizeTone(gray, w, h) {
  const n = w * h;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[gray[i] | 0]++;
  let lo = 0, hi = 255, acc = 0;
  for (let b = 0; b < 256; b++) { acc += hist[b]; if (acc >= n * 0.01) { lo = b; break; } }
  acc = 0;
  for (let b = 255; b >= 0; b--) { acc += hist[b]; if (acc >= n * 0.01) { hi = b; break; } }
  if (hi - lo < 32) { lo = Math.max(0, lo - 16); hi = Math.min(255, hi + 16); }
  const range = Math.max(1, hi - lo);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.min(1, Math.max(0, (gray[i] - lo) / range));
  return out;
}


/** Unsharp mask: boosts local contrast so mid-tone structure survives the hatching. */
function localContrast(tone, w, h, amount) {
  const r = Math.max(3, Math.round(Math.min(w, h) / 60));
  const low = boxBlurR(boxBlurR(tone, w, h, r), w, h, r);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.min(1, Math.max(0, tone[i] + amount * (tone[i] - low[i])));
  }
  return out;
}


function hysteresis(mag, w, h, detail) {
  const n = w * h;
  let max = 0;
  for (let i = 0; i < n; i++) if (mag[i] > max) max = mag[i];
  if (max === 0) return new Uint8Array(n);
  // Robust normalisation: 99th percentile of non-zero magnitudes.
  const bins = 512;
  const hist = new Uint32Array(bins);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (mag[i] > 0) {
      hist[Math.min(bins - 1, ((mag[i] / max) * (bins - 1)) | 0)]++;
      count++;
    }
  }
  let acc = 0;
  let p99 = max;
  for (let b = 0; b < bins; b++) {
    acc += hist[b];
    if (acc >= count * 0.99) { p99 = (b / (bins - 1)) * max; break; }
  }
  const ref = Math.max(p99, 1e-6);
  const hi = ref * lerp(0.6, 0.18, detail);
  const lo = hi * 0.5;

  const edges = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  for (let i = 0; i < n; i++) {
    if (mag[i] >= hi && !edges[i]) {
      edges[i] = 1;
      stack[sp++] = i;
      while (sp > 0) {
        const cur = stack[--sp];
        const cx = cur % w;
        const cy = (cur - cx) / w;
        for (let d = 0; d < 8; d++) {
          const nx = cx + DX[d];
          const ny = cy + DY[d];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (!edges[ni] && mag[ni] >= lo) {
            edges[ni] = 1;
            stack[sp++] = ni;
          }
        }
      }
    }
  }
  return edges;
}

/* ---------------- morphology ---------------- */

/** 3x3 dilation followed by 3x3 erosion: merges double edges and bridges tiny gaps. */
function close3x3(src, w, h) {
  const dil = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!src[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          dil[yy * w + xx] = 1;
        }
      }
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!dil[i]) continue;
      let all = 1;
      for (let dy = -1; dy <= 1 && all; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dil[i + dy * w + dx]) { all = 0; break; }
        }
      }
      out[i] = all;
    }
  }
  return out;
}

/** Zhang-Suen thinning: reduces edge bands to 1-px-wide, 8-connected skeletons. */
function thin(src, w, h) {
  const img = new Uint8Array(src);
  const remove = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      remove.length = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!img[i]) continue;
          const p2 = img[i - w], p3 = img[i - w + 1], p4 = img[i + 1], p5 = img[i + w + 1];
          const p6 = img[i + w], p7 = img[i + w - 1], p8 = img[i - 1], p9 = img[i - w - 1];
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          let a = 0;
          if (!p2 && p3) a++;
          if (!p3 && p4) a++;
          if (!p4 && p5) a++;
          if (!p5 && p6) a++;
          if (!p6 && p7) a++;
          if (!p7 && p8) a++;
          if (!p8 && p9) a++;
          if (!p9 && p2) a++;
          if (a !== 1) continue;
          if (pass === 0) {
            if (p2 && p4 && p6) continue;
            if (p4 && p6 && p8) continue;
          } else {
            if (p2 && p4 && p8) continue;
            if (p2 && p6 && p8) continue;
          }
          remove.push(i);
        }
      }
      if (remove.length) {
        changed = true;
        for (const i of remove) img[i] = 0;
      }
    }
  }
  return img;
}

/* ---------------- contour extraction ---------------- */

function extractContours(edges, w, h, minLength) {
  const n = w * h;
  const visited = new Uint8Array(n);
  const degree = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!edges[i]) continue;
      let deg = 0;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (edges[ny * w + nx]) deg++;
      }
      degree[i] = deg;
    }
  }

  const contours = [];
  const trace = (startIdx) => {
    const pts = [];
    let cur = startIdx;
    visited[cur] = 1;
    pts.push(cur);
    let lastDir = -1;
    for (;;) {
      const cx = cur % w;
      const cy = (cur - cx) / w;
      let best = -1;
      let bestScore = -Infinity;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (!edges[ni] || visited[ni]) continue;
        let score = d % 2 === 0 ? 1.5 : 1; // prefer 4-connected steps
        if (lastDir >= 0) {
          const diff = Math.abs(d - lastDir);
          const turn = Math.min(diff, 8 - diff);
          score += 4 - turn; // prefer going straight
        }
        score -= degree[ni] * 0.1; // prefer thin lines over blobs
        if (score > bestScore) { bestScore = score; best = d; }
      }
      if (best >= 0) {
        cur = (cy + DY[best]) * w + cx + DX[best];
        visited[cur] = 1;
        pts.push(cur);
        lastDir = best;
        continue;
      }
      // No direct neighbour: bridge a 1-px gap if an unvisited edge pixel sits two steps away.
      let jump = -1;
      let jumpScore = -Infinity;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (!edges[ni] || visited[ni]) continue;
          let score = -Math.abs(dx) - Math.abs(dy);
          if (lastDir >= 0) score += (dx * DX[lastDir] + dy * DY[lastDir]) * 0.5;
          if (score > jumpScore) { jumpScore = score; jump = ni; }
        }
      }
      if (jump < 0) break;
      const jx = jump % w;
      const jy = (jump - jx) / w;
      lastDir = dirFromDelta(jx - cx, jy - cy);
      cur = jump;
      visited[cur] = 1;
      pts.push(cur);
    }
    return pts;
  };

  const emit = (idxs) => {
    if (idxs.length < minLength) return;
    const out = new Array(idxs.length);
    for (let i = 0; i < idxs.length; i++) {
      const x = idxs[i] % w;
      out[i] = { x, y: (idxs[i] - x) / w };
    }
    contours.push(out);
  };

  // Endpoints first so open lines are traced end to end.
  for (let i = 0; i < n; i++) {
    if (edges[i] && !visited[i] && degree[i] === 1) emit(trace(i));
  }
  // Then everything else (loops, leftovers from junctions).
  for (let i = 0; i < n; i++) {
    if (edges[i] && !visited[i]) emit(trace(i));
  }
  return contours;
}

/* ---------------- shading ---------------- */

/**
 * Hatch strokes for the dark parts of the picture. Rows sit at a fine pitch
 * and cycle through a bit-reversed (van der Corput) threshold sequence, so a
 * region of a given darkness switches on exactly that fraction of rows, with
 * the lit rows spread as evenly as possible: 8 tone levels, solid at black,
 * nothing in the highlights. Long, clean runs are favoured over tonal
 * precision: the tone is smoothed first and tiny gaps inside a run are bridged.
 */
/** Per-pixel darkness in 0..1 (0 = leave white), after local contrast and smoothing. */
function darknessMap(tone, w, h, shading) {
  const sharp = localContrast(tone, w, h, 0.7);
  const smooth = boxBlur3(sharp, w, h);
  const threshold = 0.3 + 0.48 * shading; // tones lighter than this stay white
  const darkness = new Float32Array(w * h);
  for (let i = 0; i < darkness.length; i++) {
    const t = smooth[i];
    darkness[i] = t >= threshold ? 0 : Math.pow((threshold - t) / threshold, 0.9);
  }
  return darkness;
}

const HATCH_PITCH = 1.6; // line spacing at solid black, in work px

/** Shading that follows the picture's shapes: streamlines through the edge tangent field. */
function buildFlowHatches(tone, w, h, shading, onProgress) {
  if (shading <= 0.02) return [];
  const darkness = darknessMap(tone, w, h, shading);
  const flow = computeFlow(tone, w, h);
  return flowHatches(darkness, flow, w, h, HATCH_PITCH, onProgress);
}

function buildHatches(tone, w, h, shading) {
  const strokes = [];
  if (shading <= 0.02) return strokes;
  const darkness = darknessMap(tone, w, h, shading);
  const pitch = HATCH_PITCH;
  const levels = 8;
  const thresholds = [];
  for (let i = 0; i < levels; i++) {
    // bit-reversed i / levels: 0, .5, .25, .75, .125, ...
    let v = 0, n = i, denom = 2;
    while (n > 0) { if (n & 1) v += 1 / denom; n >>= 1; denom *= 2; }
    thresholds.push(v);
  }
  const minRun = 3;
  const maxGap = 2;
  const rows = Math.floor((h - 1) / pitch);
  for (let i = 0; i <= rows; i++) {
    const y = i * pitch;
    const need = thresholds[i % levels] + 0.02;
    const row = Math.min(h - 1, Math.round(y)) * w;
    let runStart = -1;
    let lastDark = -1;
    for (let x = 0; x <= w; x++) {
      const dark = x < w && darkness[row + x] > need;
      if (dark) {
        if (runStart < 0) runStart = x;
        lastDark = x;
      } else if (runStart >= 0 && (x - lastDark > maxGap || x === w)) {
        if (lastDark - runStart + 1 >= minRun) strokes.push([{ x: runStart, y }, { x: lastDark, y }]);
        runStart = -1;
      }
    }
  }
  return strokes;
}

/* ---------------- planning ---------------- */

/**
 * Greedy nearest-neighbour ordering of strokes (either end may be used) with
 * A*-routed travel between them. Returns a flat Float32Array [x, y, travel, ...].
 */
function planPath(strokes, tone, w, h, start, onProgress) {
  const n = strokes.length;
  if (!n) return new Float32Array(0);

  // --- endpoint grid for nearest-neighbour search
  const cell = 16;
  const gw = Math.ceil(w / cell) + 1;
  const gh = Math.ceil(h / cell) + 1;
  const grid = new Array(gw * gh);
  const cellOf = (x, y) => {
    const gx = Math.min(gw - 1, Math.max(0, (x / cell) | 0));
    const gy = Math.min(gh - 1, Math.max(0, (y / cell) | 0));
    return gy * gw + gx;
  };
  for (let i = 0; i < n; i++) {
    const s = strokes[i];
    let k = cellOf(s[0].x, s[0].y);
    (grid[k] || (grid[k] = [])).push(i, 0);
    const e = s[s.length - 1];
    k = cellOf(e.x, e.y);
    (grid[k] || (grid[k] = [])).push(i, 1);
  }

  const router = new Router(tone, w, h);
  const used = new Uint8Array(n);
  const out = [];
  let cur = { x: start.x, y: start.y };
  const maxR = Math.max(gw, gh);

  for (let k = 0; k < n; k++) {
    if ((k & 127) === 0) onProgress(k / n);
    const cx = Math.min(gw - 1, Math.max(0, (cur.x / cell) | 0));
    const cy = Math.min(gh - 1, Math.max(0, (cur.y / cell) | 0));
    let bestCi = -1, bestEnd = 0, bestD2 = Infinity;

    for (let r = 0; r <= maxR; r++) {
      if (r > 0 && (r - 1) * cell > Math.sqrt(bestD2)) break;
      const x0 = cx - r, x1 = cx + r, y0 = cy - r, y1 = cy + r;
      for (let gy = y0; gy <= y1; gy++) {
        if (gy < 0 || gy >= gh) continue;
        const edgeRow = gy === y0 || gy === y1;
        for (let gx = x0; gx <= x1; gx += edgeRow ? 1 : (x1 - x0 || 1)) {
          if (gx < 0 || gx >= gw) continue;
          const bucket = grid[gy * gw + gx];
          if (!bucket) continue;
          for (let b = 0; b < bucket.length; b += 2) {
            const ci = bucket[b];
            if (used[ci]) continue;
            const end = bucket[b + 1];
            const s = strokes[ci];
            const p = end === 0 ? s[0] : s[s.length - 1];
            const dx = p.x - cur.x, dy = p.y - cur.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) { bestD2 = d2; bestCi = ci; bestEnd = end; }
          }
        }
      }
    }
    if (bestCi < 0) break;

    used[bestCi] = 1;
    let pts = strokes[bestCi];
    if (bestEnd === 1) pts = pts.slice().reverse();

    // Travel from cur to the stroke start, hidden inside the picture where possible.
    const route = router.route(cur, pts[0]);
    for (const p of route) out.push(p.x, p.y, 1);
    out.push(pts[0].x, pts[0].y, 1);
    router.markSegment(cur, route.length ? route[0] : pts[0]);
    for (let i = 0; i < route.length; i++) router.markSegment(route[i], i + 1 < route.length ? route[i + 1] : pts[0]);

    for (let i = 1; i < pts.length; i++) {
      out.push(pts[i].x, pts[i].y, 0);
      router.markSegment(pts[i - 1], pts[i]);
    }
    cur = pts[pts.length - 1];
  }
  onProgress(1);
  return Float32Array.from(out);
}

/**
 * A* router over a half-resolution cost map. Cells that are dark (about to be
 * shaded anyway) or already drawn are cheap; bright cells are expensive.
 */
class Router {
  constructor(tone, w, h) {
    // Keep the routing grid around 300 cells wide whatever the working resolution.
    const scale = (this.scale = Math.max(2, Math.round(w / 300)));
    this.w = w;
    this.h = h;
    const cw = (this.cw = Math.ceil(w / scale));
    const ch = (this.ch = Math.ceil(h / scale));
    const n = cw * ch;
    this.base = new Float32Array(n);
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        let s = 0, c = 0;
        for (let dy = 0; dy < scale; dy++) {
          const y = cy * scale + dy;
          if (y >= h) continue;
          for (let dx = 0; dx < scale; dx++) {
            const x = cx * scale + dx;
            if (x >= w) continue;
            s += tone[y * w + x];
            c++;
          }
        }
        const light = c ? s / c : 1;
        this.base[cy * cw + cx] = 0.4 + 5 * light * light;
      }
    }
    this.drawn = new Uint8Array(n);
    this.drawnCost = 0.5;
    this.minCost = 0.4;
    this.g = new Float32Array(n);
    this.gen = new Int32Array(n);
    this.from = new Int32Array(n);
    this.closed = new Int32Array(n);
    this.generation = 0;
    this.maxExpand = 60000;
    this.heapF = [];
    this.heapI = [];
  }

  cost(i) {
    return this.drawn[i] ? this.drawnCost : this.base[i];
  }

  cellIndex(p) {
    const cx = Math.min(this.cw - 1, Math.max(0, (p.x / this.scale) | 0));
    const cy = Math.min(this.ch - 1, Math.max(0, (p.y / this.scale) | 0));
    return cy * this.cw + cx;
  }

  markSegment(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      this.drawn[this.cellIndex({ x: a.x + dx * t, y: a.y + dy * t })] = 1;
    }
  }

  /** Returns intermediate waypoints (work px) between a and b, excluding both ends. */
  route(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < this.scale * 1.5) return [];

    // Straight line is fine if it only crosses cheap cells.
    const steps = Math.ceil(dist);
    let straight = 0;
    let cheap = true;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const c = this.cost(this.cellIndex({ x: a.x + dx * t, y: a.y + dy * t }));
      straight += c;
      if (c > 0.7) cheap = false;
    }
    if (cheap) return [];

    const path = this.astar(this.cellIndex(a), this.cellIndex(b));
    if (!path) return [];
    // Convert cells to work px (cell centres) and simplify.
    const half = this.scale / 2;
    const pts = path.map((i) => {
      const cx = i % this.cw;
      const cy = (i - cx) / this.cw;
      return { x: cx * this.scale + half, y: cy * this.scale + half };
    });
    const simp = simplify(pts, half);
    // Drop the endpoints (the caller supplies real start/end positions).
    return simp.slice(1, -1);
  }

  astar(startI, goalI) {
    const { cw, ch, g, gen, from, closed } = this;
    const generation = ++this.generation;
    const gx1 = goalI % cw;
    const gy1 = (goalI - gx1) / cw;
    const heur = (i) => {
      const x = i % cw;
      const y = (i - x) / cw;
      return Math.hypot(x - gx1, y - gy1) * this.minCost;
    };
    const heapF = this.heapF;
    const heapI = this.heapI;
    heapF.length = 0;
    heapI.length = 0;
    const push = (f, i) => {
      heapF.push(f);
      heapI.push(i);
      let k = heapF.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heapF[p] <= heapF[k]) break;
        [heapF[p], heapF[k]] = [heapF[k], heapF[p]];
        [heapI[p], heapI[k]] = [heapI[k], heapI[p]];
        k = p;
      }
    };
    const pop = () => {
      const topI = heapI[0];
      const lf = heapF.pop();
      const li = heapI.pop();
      if (heapF.length) {
        heapF[0] = lf;
        heapI[0] = li;
        let k = 0;
        const len = heapF.length;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < len && heapF[l] < heapF[m]) m = l;
          if (r < len && heapF[r] < heapF[m]) m = r;
          if (m === k) break;
          [heapF[m], heapF[k]] = [heapF[k], heapF[m]];
          [heapI[m], heapI[k]] = [heapI[k], heapI[m]];
          k = m;
        }
      }
      return topI;
    };

    gen[startI] = generation;
    g[startI] = 0;
    from[startI] = -1;
    push(heur(startI), startI);
    let expanded = 0;
    while (heapF.length) {
      const i = pop();
      if (closed[i] === generation) continue;
      closed[i] = generation;
      if (i === goalI) {
        const path = [];
        for (let c = i; c >= 0; c = from[c]) path.push(c);
        path.reverse();
        return path;
      }
      if (++expanded > this.maxExpand) return null;
      const x = i % cw;
      const y = (i - x) / cw;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const ni = ny * cw + nx;
        if (closed[ni] === generation) continue;
        const step = (d & 1) ? 1.4142 : 1;
        const ng = g[i] + this.cost(ni) * step;
        if (gen[ni] !== generation || ng < g[ni]) {
          gen[ni] = generation;
          g[ni] = ng;
          from[ni] = i;
          push(ng + heur(ni), ni);
        }
      }
    }
    return null;
  }
}

/* ---------------- helpers ---------------- */

function dirFromDelta(dx, dy) {
  const sx = Math.sign(dx), sy = Math.sign(dy);
  for (let d = 0; d < 8; d++) if (DX[d] === sx && DY[d] === sy) return d;
  return -1;
}

