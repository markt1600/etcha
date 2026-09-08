/**
 * The Etch A Sketch itself: a canvas "screen", two knobs, and a stylus that
 * follows a path in real time. The knob angles are a pure function of the
 * stylus position, exactly like the real toy:
 *   left knob  ↔ horizontal (clockwise moves right)
 *   right knob ↔ vertical   (clockwise moves up)
 */
export class EtchASketch {
  constructor({ canvas, leftKnob, rightKnob, toy, width, height, onProgress, onDone }) {
    this.canvas = canvas;
    this.leftKnob = leftKnob;
    this.rightKnob = rightKnob;
    this.toy = toy;
    this.width = width;
    this.height = height;
    this.onProgress = onProgress || (() => {});
    this.onDone = onDone || (() => {});

    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(width * this.dpr);
    canvas.height = Math.round(height * this.dpr);
    this.ctx = canvas.getContext('2d');
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.blank = this._makeBlankScreen();

    // One full knob turn moves the stylus this many screen px.
    this.pxPerTurn = 110;
    this.pos = { x: width / 2, y: height / 2 };
    this.speed = 600; // px / s
    this.hideTravel = false;
    this.lineWidth = 1.9;
    this.lineColor = '#3f3f42';

    this.points = null;
    this.cum = null;
    this.total = 0;
    this.progress = 0;
    this.segIdx = 0;
    this.playing = false;
    this.done = false;
    this.dirty = false;
    this._raf = 0;
    this._last = 0;
    this._shaking = null;

    this.ctx.drawImage(this.blank, 0, 0, width, height);
    this._updateKnobs();
  }

  /** Load a path (array of {x, y, travel}) starting from the current stylus position. */
  setPath(path) {
    this.pause();
    const pts = [{ x: this.pos.x, y: this.pos.y, travel: true }];
    for (const p of path) pts.push(p);
    const cum = new Float64Array(pts.length);
    let turnsX = 0, turnsY = 0, drawn = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      const len = Math.hypot(dx, dy);
      cum[i] = cum[i - 1] + len;
      turnsX += Math.abs(dx);
      turnsY += Math.abs(dy);
      if (!pts[i].travel) drawn += len;
    }
    this.points = pts;
    this.cum = cum;
    this.total = cum[pts.length - 1];
    this.progress = 0;
    this.segIdx = 0;
    this.done = false;
    this.stats = {
      length: this.total,
      drawnLength: drawn,
      turns: (turnsX + turnsY) / this.pxPerTurn,
    };
    this.onProgress(0, this.total / this.speed);
  }

  get hasPath() {
    return !!this.points && this.points.length > 1;
  }

  setSpeed(pxPerSec) {
    this.speed = pxPerSec;
  }

  play() {
    if (!this.hasPath || this.done || this.playing) return;
    this.playing = true;
    this._last = performance.now();
    this._raf = requestAnimationFrame((t) => this._tick(t));
  }

  pause() {
    this.playing = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Shake the toy and fade the screen back to blank. Resolves when done. */
  shake() {
    if (this._shaking) return this._shaking;
    this.pause();
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduce ? 250 : 750;
    this.toy.classList.remove('shaking');
    // restart the CSS animation
    void this.toy.offsetWidth;
    if (!reduce) this.toy.classList.add('shaking');

    const ctx = this.ctx;
    const startT = performance.now();
    this._shaking = new Promise((resolve) => {
      const step = (now) => {
        const t = Math.min(1, (now - startT) / duration);
        ctx.save();
        // Aluminium powder re-coats the glass: progressively cover the drawing.
        ctx.globalAlpha = 0.12 + t * 0.25;
        ctx.drawImage(this.blank, 0, 0, this.width, this.height);
        ctx.restore();
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          ctx.drawImage(this.blank, 0, 0, this.width, this.height);
          this.toy.classList.remove('shaking');
          this.dirty = false;
          this._shaking = null;
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
    return this._shaking;
  }

  /* ---------------- internals ---------------- */

  _tick(now) {
    if (!this.playing) return;
    const dt = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;
    this._advance(this.speed * dt);
    if (this.done) {
      this.playing = false;
      this._raf = 0;
      this.onDone();
      return;
    }
    this._raf = requestAnimationFrame((t) => this._tick(t));
  }

  _advance(distance) {
    const pts = this.points;
    const cum = this.cum;
    const ctx = this.ctx;
    const target = Math.min(this.total, this.progress + distance);

    ctx.save();
    ctx.lineWidth = this.lineWidth;
    ctx.strokeStyle = this.lineColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(this.pos.x, this.pos.y);

    let idx = this.segIdx;
    let pos = this.pos;
    const last = pts.length - 1;
    // Complete every segment that ends before the target distance.
    while (idx < last && cum[idx + 1] <= target) {
      idx++;
      const p = pts[idx];
      if (p.travel && this.hideTravel) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
      pos = p;
    }
    // Partial progress along the current segment.
    if (idx < last) {
      const a = pts[idx];
      const b = pts[idx + 1];
      const segLen = cum[idx + 1] - cum[idx];
      const t = segLen > 0 ? (target - cum[idx]) / segLen : 1;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      if (b.travel && this.hideTravel) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      pos = { x, y };
    }
    ctx.stroke();
    ctx.restore();

    this.pos = { x: pos.x, y: pos.y };
    this.segIdx = idx;
    this.progress = target;
    this.dirty = true;
    this._updateKnobs();

    const remaining = (this.total - target) / this.speed;
    this.onProgress(this.total > 0 ? target / this.total : 1, remaining);
    if (target >= this.total) this.done = true;
  }

  _updateKnobs() {
    const degPerPx = 360 / this.pxPerTurn;
    const l = this.pos.x * degPerPx;
    const r = -this.pos.y * degPerPx;
    this.leftKnob.style.transform = `rotate(${l.toFixed(2)}deg)`;
    this.rightKnob.style.transform = `rotate(${r.toFixed(2)}deg)`;
  }

  /** The silvery aluminium-powder screen, with a little grain. */
  _makeBlankScreen() {
    const c = document.createElement('canvas');
    const w = this.canvas.width;
    const h = this.canvas.height;
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.7);
    g.addColorStop(0, '#d6d5d0');
    g.addColorStop(0.7, '#c9c8c3');
    g.addColorStop(1, '#b9b8b2');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
}
