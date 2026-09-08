/**
 * Flow-following hatching.
 *
 * 1. `computeFlow` builds an edge tangent field from the picture's structure
 *    tensor: at every pixel, the direction that runs *along* the local edges.
 *    Where the picture has no structure, the field settles to horizontal.
 * 2. `flowHatches` traces evenly spaced streamlines through that field
 *    (Jobard & Lefer) in four hierarchical densities, and cuts each streamline
 *    into strokes wherever the picture is dark enough for that streamline's
 *    level. The result is shading that wraps around forms the way a hand
 *    drawn portrait does, instead of running in flat horizontal rows.
 *
 * Pure math, worker-safe.
 */
import { boxBlurR, simplify } from './imageops.js';

/** Edge tangent field (unit vectors) from the structure tensor of the tone map. */
export function computeFlow(tone, w, h) {
  const n = w * h;
  const sm = boxBlurR(tone, w, h, 1);
  const jxx = new Float32Array(n);
  const jyy = new Float32Array(n);
  const jxy = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = sm[i + 1] - sm[i - 1];
      const gy = sm[i + w] - sm[i - w];
      jxx[i] = gx * gx;
      jyy[i] = gy * gy;
      jxy[i] = gx * gy;
    }
  }
  const r = Math.max(3, Math.round(w / 80));
  const bxx = boxBlurR(boxBlurR(jxx, w, h, r), w, h, r);
  const byy = boxBlurR(boxBlurR(jyy, w, h, r), w, h, r);
  const bxy = boxBlurR(boxBlurR(jxy, w, h, r), w, h, r);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += bxx[i] + byy[i];
  mean /= n;
  // A little "vertical gradient" everywhere makes structureless areas hatch horizontally.
  const bias = mean * 0.08 + 1e-9;
  const tx = new Float32Array(n);
  const ty = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = bxx[i];
    const b = byy[i] + bias;
    const c = bxy[i];
    const theta = 0.5 * Math.atan2(2 * c, a - b); // dominant gradient direction
    tx[i] = -Math.sin(theta); // tangent = gradient rotated 90°
    ty[i] = Math.cos(theta);
  }
  return { tx, ty };
}

/**
 * @param {Float32Array} darkness 0..1 per pixel (0 = leave white)
 * @param {{tx:Float32Array, ty:Float32Array}} flow
 * @param {number} pitch streamline spacing at solid black (work px)
 * @returns {Array<Array<{x:number,y:number}>>} strokes
 */
export function flowHatches(darkness, flow, w, h, pitch, onProgress = () => {}) {
  const { tx, ty } = flow;
  const rng = mulberry32(1234567);

  // Hierarchical levels: each adds streamlines halfway between the previous
  // ones, and draws them only where the picture is dark enough for its band.
  const levels = [
    { sep: pitch * 8, band: [0, 0.125] },
    { sep: pitch * 4, band: [0.125, 0.25] },
    { sep: pitch * 2, band: [0.25, 0.5] },
    { sep: pitch, band: [0.5, 1] },
  ];

  // --- spatial hash of every streamline point
  const cell = pitch;
  const gw = Math.ceil(w / cell) + 1;
  const gh = Math.ceil(h / cell) + 1;
  const head = new Int32Array(gw * gh).fill(-1);
  let px = new Float32Array(1 << 16);
  let py = new Float32Array(1 << 16);
  let pline = new Int32Array(1 << 16);
  let ppos = new Float32Array(1 << 16);
  let pnext = new Int32Array(1 << 16);
  let count = 0;
  const grow = () => {
    const cap = px.length * 2;
    const g = (arr, T) => { const b = new T(cap); b.set(arr); return b; };
    px = g(px, Float32Array); py = g(py, Float32Array); pline = g(pline, Int32Array);
    ppos = g(ppos, Float32Array); pnext = g(pnext, Int32Array);
  };
  const insert = (x, y, line, pos) => {
    if (count >= px.length) grow();
    const k = ((y / cell) | 0) * gw + ((x / cell) | 0);
    px[count] = x; py[count] = y; pline[count] = line; ppos[count] = pos;
    pnext[count] = head[k];
    head[k] = count++;
  };
  /** Is any point within radius r of (x, y)? Own points closer than `ownSkip` along the line are ignored. */
  const crowded = (x, y, r, line, pos, ownSkip) => {
    const r2 = r * r;
    const x0 = Math.max(0, ((x - r) / cell) | 0), x1 = Math.min(gw - 1, ((x + r) / cell) | 0);
    const y0 = Math.max(0, ((y - r) / cell) | 0), y1 = Math.min(gh - 1, ((y + r) / cell) | 0);
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        for (let i = head[gy * gw + gx]; i >= 0; i = pnext[i]) {
          const dx = px[i] - x, dy = py[i] - y;
          if (dx * dx + dy * dy >= r2) continue;
          if (pline[i] === line && Math.abs(ppos[i] - pos) < ownSkip) continue;
          return true;
        }
      }
    }
    return false;
  };

  const strokes = [];
  let lineId = 0;
  const maxSteps = 500;

  const march = (sx, sy, sign, line, dtest) => {
    const pts = [];
    let x = sx, y = sy;
    let i0 = (sy | 0) * w + (sx | 0);
    let dx = sign * tx[i0], dy = sign * ty[i0];
    let blank = 0;
    const ownSkip = 2 * dtest + 2;
    for (let s = 1; s <= maxSteps; s++) {
      const i = (y | 0) * w + (x | 0);
      let vx = tx[i], vy = ty[i];
      const dot = vx * dx + vy * dy;
      if (dot < 0) { vx = -vx; vy = -vy; }
      if (Math.abs(dot) < 0.5) break; // sharper than 60°: stop rather than kink
      // ease direction changes so lines stay smooth
      dx = 0.6 * dx + vx; dy = 0.6 * dy + vy;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      x += dx; y += dy;
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) break;
      const pos = sign * s;
      if (crowded(x, y, dtest, line, pos, ownSkip)) break;
      const ii = (y | 0) * w + (x | 0);
      if (darkness[ii] <= 0) { if (++blank > 10) break; } else blank = 0;
      pts.push({ x, y, d: darkness[ii] });
      insert(x, y, line, pos);
    }
    // Trim the blank tail so lines don't poke into the highlights.
    while (pts.length && pts[pts.length - 1].d <= 0) pts.pop();
    return pts;
  };

  const emitStrokes = (pts, thr) => {
    let run = [];
    let gap = 0;
    const flush = () => {
      if (run.length >= 3) strokes.push(simplify(run, 0.35));
      run = [];
    };
    for (const p of pts) {
      if (p.d > thr) {
        run.push({ x: p.x, y: p.y });
        gap = 0;
      } else if (run.length) {
        if (++gap > 2) { flush(); gap = 0; }
        else run.push({ x: p.x, y: p.y });
      }
    }
    flush();
  };

  for (let lv = 0; lv < levels.length; lv++) {
    const { sep, band } = levels[lv];
    const dtest = sep * 0.5;
    const queue = [];
    let qi = 0;
    const tryTrace = (sx, sy) => {
      if (sx < 1 || sy < 1 || sx >= w - 1 || sy >= h - 1) return;
      const i = (sy | 0) * w + (sx | 0);
      if (darkness[i] <= 0) return;
      if (crowded(sx, sy, sep * 0.9, -1, 0, 0)) return;
      const line = lineId++;
      const fwd = march(sx, sy, 1, line, dtest);
      const bwd = march(sx, sy, -1, line, dtest);
      insert(sx, sy, line, 0);
      const pts = bwd.reverse();
      pts.push({ x: sx, y: sy, d: darkness[i] });
      for (const p of fwd) pts.push(p);
      if (pts.length < 3) return;
      const thr = band[0] + (band[1] - band[0]) * rng() + 0.01;
      emitStrokes(pts, thr);
      // Seed candidates on both sides, spaced along the line.
      const every = Math.max(2, Math.round(sep));
      for (let k = 0; k < pts.length; k += every) {
        const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
        let nx = -(b.y - a.y), ny = b.x - a.x;
        const l = Math.hypot(nx, ny) || 1;
        nx = nx / l * sep; ny = ny / l * sep;
        queue.push(pts[k].x + nx, pts[k].y + ny, pts[k].x - nx, pts[k].y - ny);
      }
    };
    const lattice = Math.max(2, Math.round(sep));
    let rowsDone = 0;
    const rowsTotal = Math.ceil(h / lattice);
    for (let y = lattice / 2; y < h; y += lattice) {
      for (let x = lattice / 2; x < w; x += lattice) {
        tryTrace(x, y);
        while (qi < queue.length) {
          const sx = queue[qi++], sy = queue[qi++];
          tryTrace(sx, sy);
        }
        if (queue.length > 400000) { queue.length = 0; qi = 0; }
      }
      rowsDone++;
      if ((rowsDone & 7) === 0) onProgress((lv + rowsDone / rowsTotal) / levels.length);
    }
  }
  onProgress(1);
  return strokes;
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
