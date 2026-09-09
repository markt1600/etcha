/**
 * Paints the whole toy, screen contents and knob positions included, onto an
 * offscreen canvas so the drawing can be saved as a picture. Mirrors the
 * proportions used by the CSS in styles.css (a unit `u` is 1% of the toy's width).
 */
export function renderSnapshot({ screenCanvas, pos, pxPerTurn, width = 2000 }) {
  const W = width;
  const H = Math.round(W / 1.28);
  const u = W / 100;
  const pad = 5 * u; // room for the drop shadow
  const out = document.createElement('canvas');
  out.width = W + 2 * pad;
  out.height = H + 2 * pad;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#1b1d22';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(pad, pad);

  const body = () => roundRect(ctx, 0, 0, W, H, 7 * u, 9 * u);

  // --- drop shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, .55)';
  ctx.shadowBlur = 4 * u;
  ctx.shadowOffsetY = 2.5 * u;
  body();
  ctx.fillStyle = '#c8241c';
  ctx.fill();
  ctx.restore();

  // --- red body
  ctx.save();
  body();
  ctx.clip();
  let g = ctx.createLinearGradient(0, 0, W * 0.45, H);
  g.addColorStop(0, '#ef4034');
  g.addColorStop(0.4, '#d42a1f');
  g.addColorStop(1, '#b21b12');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W * 0.25, 0, 0, W * 0.25, 0, W * 0.8);
  g.addColorStop(0, 'rgba(255, 255, 255, .28)');
  g.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W * 0.85, H, 0, W * 0.85, H, W * 0.6);
  g.addColorStop(0, 'rgba(0, 0, 0, .25)');
  g.addColorStop(0.6, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // inset highlight (top) and shadow (bottom)
  g = ctx.createLinearGradient(0, 0, 0, 0.6 * u);
  g.addColorStop(0, 'rgba(255, 255, 255, .45)');
  g.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, 0.6 * u);
  g = ctx.createLinearGradient(0, H - 2 * u, 0, H);
  g.addColorStop(0, 'rgba(60, 0, 0, 0)');
  g.addColorStop(1, 'rgba(60, 0, 0, .45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H - 2 * u, W, 2 * u);
  ctx.restore();
  body();
  ctx.strokeStyle = 'rgba(0, 0, 0, .18)';
  ctx.lineWidth = 0.36 * u;
  ctx.stroke();

  // --- logo
  ctx.save();
  ctx.font = `${3.7 * u}px Lobster, "Brush Script MT", "Segoe Script", cursive`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const logoY = 1.2 * u;
  ctx.shadowColor = 'rgba(0, 0, 0, .35)';
  ctx.shadowBlur = 0.3 * u;
  ctx.shadowOffsetY = 0.25 * u;
  ctx.fillStyle = 'rgba(120, 60, 0, .6)';
  ctx.fillText('Etch A Sketch', W / 2, logoY + 0.12 * u);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = goldGradient(ctx, logoY, logoY + 3.7 * u);
  ctx.fillText('Etch A Sketch', W / 2, logoY);
  ctx.restore();

  // --- screen frame and screen
  const fx = 9 * u;
  const fy = 0.08 * H;
  const sw = 80 * u;
  const sh = sw * 618 / 1000;
  const fw = sw + 2 * u;
  const fh = sh + 2 * u;
  ctx.save();
  roundRect(ctx, fx, fy, fw, fh, 1.6 * u, 1.6 * u);
  ctx.clip();
  g = ctx.createLinearGradient(0, fy, 0, fy + fh);
  g.addColorStop(0, '#7d120c');
  g.addColorStop(0.3, '#a5190f');
  g.addColorStop(1, '#c8271b');
  ctx.fillStyle = g;
  ctx.fillRect(fx, fy, fw, fh);
  g = ctx.createLinearGradient(0, fy, 0, fy + 0.7 * u);
  g.addColorStop(0, 'rgba(0, 0, 0, .55)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(fx, fy, fw, 0.7 * u);
  ctx.restore();

  const sx = fx + u;
  const sy = fy + u;
  ctx.save();
  roundRect(ctx, sx, sy, sw, sh, 0.8 * u, 0.8 * u);
  ctx.clip();
  ctx.fillStyle = '#cfcec9';
  ctx.fillRect(sx, sy, sw, sh);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(screenCanvas, sx, sy, sw, sh);
  // inset shadows
  g = ctx.createLinearGradient(0, sy, 0, sy + 2 * u);
  g.addColorStop(0, 'rgba(0, 0, 0, .45)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(sx, sy, sw, 2 * u);
  for (const [x0, x1] of [[sx, sx + 1.2 * u], [sx + sw, sx + sw - 1.2 * u]]) {
    g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, 'rgba(0, 0, 0, .18)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(Math.min(x0, x1), sy, Math.abs(x1 - x0), sh);
  }
  g = ctx.createLinearGradient(0, sy + sh - 0.4 * u, 0, sy + sh);
  g.addColorStop(0, 'rgba(255, 255, 255, 0)');
  g.addColorStop(1, 'rgba(255, 255, 255, .5)');
  ctx.fillStyle = g;
  ctx.fillRect(sx, sy + sh - 0.4 * u, sw, 0.4 * u);
  // gloss and vignette
  g = ctx.createLinearGradient(sx, sy, sx + sw * 0.6, sy + sh);
  g.addColorStop(0, 'rgba(255, 255, 255, .18)');
  g.addColorStop(0.28, 'rgba(255, 255, 255, .06)');
  g.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(sx, sy, sw, sh);
  g = ctx.createRadialGradient(sx + sw / 2, sy + sh / 2, sh * 0.45, sx + sw / 2, sy + sh / 2, sw * 0.62);
  g.addColorStop(0, 'rgba(0, 0, 0, 0)');
  g.addColorStop(1, 'rgba(0, 0, 0, .14)');
  ctx.fillStyle = g;
  ctx.fillRect(sx, sy, sw, sh);
  ctx.restore();

  // --- knobs
  const kd = 15 * u;
  const ky = 0.766 * H + kd / 2;
  const degPerPx = 360 / pxPerTurn;
  drawKnob(ctx, 5.2 * u + kd / 2, ky, kd / 2, pos.x * degPerPx, u);
  drawKnob(ctx, W - 5.2 * u - kd / 2, ky, kd / 2, -pos.y * degPerPx, u);

  // --- tagline
  ctx.save();
  ctx.font = `700 ${1.5 * u}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${0.35 * 1.5 * u}px`;
  const tagY = 0.845 * H;
  ctx.fillStyle = 'rgba(90, 40, 0, .6)';
  ctx.fillText('MAGIC SCREEN', W / 2 + 0.25 * u, tagY + 0.1 * u);
  ctx.fillStyle = '#f4d271';
  ctx.fillText('MAGIC SCREEN', W / 2 + 0.25 * u, tagY);
  ctx.restore();

  return out;
}

function drawKnob(ctx, cx, cy, r, angleDeg, u) {
  ctx.save();
  // bezel rings and shadow
  ctx.beginPath();
  ctx.arc(cx, cy, r + 0.55 * u, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, .25)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 0.35 * u, 0, Math.PI * 2);
  ctx.fillStyle = '#8f140d';
  ctx.fill();
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, .5)';
  ctx.shadowBlur = 1 * u;
  ctx.shadowOffsetY = 0.6 * u;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#d7d7d2';
  ctx.fill();
  ctx.restore();

  // knob body
  let g = ctx.createRadialGradient(cx - 0.24 * r, cy - 0.4 * r, 0, cx, cy, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.4, '#ecece7');
  g.addColorStop(0.8, '#c9c9c3');
  g.addColorStop(1, '#b1b1ab');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // ridges (rotate with the knob)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((angleDeg * Math.PI) / 180);
  const ticks = 48;
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2;
    ctx.save();
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(0, 0, 0, .22)';
    ctx.fillRect(-r * 0.03, -r, r * 0.06, r * 0.34);
    ctx.fillStyle = 'rgba(255, 255, 255, .35)';
    ctx.fillRect(r * 0.03, -r, r * 0.035, r * 0.34);
    ctx.restore();
  }
  // face
  const fr = 0.7 * r;
  g = ctx.createRadialGradient(-0.2 * fr, -0.36 * fr, 0, 0, 0, fr);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, '#f0f0eb');
  g.addColorStop(1, '#cfcfc9');
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, .25)';
  ctx.shadowBlur = 0.3 * u;
  ctx.shadowOffsetY = 0.1 * u;
  ctx.beginPath();
  ctx.arc(0, 0, fr, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  g = ctx.createLinearGradient(0, -fr, 0, fr);
  g.addColorStop(0, 'rgba(255, 255, 255, .9)');
  g.addColorStop(0.3, 'rgba(255, 255, 255, 0)');
  g.addColorStop(0.8, 'rgba(0, 0, 0, 0)');
  g.addColorStop(1, 'rgba(0, 0, 0, .18)');
  ctx.beginPath();
  ctx.arc(0, 0, fr, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  // inner dimple
  const ir = 0.4 * fr;
  g = ctx.createRadialGradient(-0.1 * ir, -0.3 * ir, 0, 0, 0, ir);
  g.addColorStop(0, '#fafaf7');
  g.addColorStop(1, '#dcdcd6');
  ctx.beginPath();
  ctx.arc(0, 0, ir, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  // indicator mark
  const mw = 0.112 * r;
  const mTop = -fr + 0.06 * 2 * fr;
  const mh = 0.18 * 2 * fr;
  g = ctx.createLinearGradient(0, mTop, 0, mTop + mh);
  g.addColorStop(0, '#8d8d87');
  g.addColorStop(1, '#5f5f5a');
  roundRect(ctx, -mw / 2, mTop, mw, mh, mw * 0.3, mw * 0.3);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

function goldGradient(ctx, y0, y1) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#fff2b0');
  g.addColorStop(0.45, '#f6c84f');
  g.addColorStop(0.55, '#c98d1d');
  g.addColorStop(1, '#f3d26a');
  return g;
}

/** Rounded rectangle path with elliptical corners (rx, ry). */
function roundRect(ctx, x, y, w, h, rx, ry) {
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rx, y);
  ctx.lineTo(x + w - rx, y);
  ctx.ellipse(x + w - rx, y + ry, rx, ry, 0, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - ry);
  ctx.ellipse(x + w - rx, y + h - ry, rx, ry, 0, 0, Math.PI / 2);
  ctx.lineTo(x + rx, y + h);
  ctx.ellipse(x + rx, y + h - ry, rx, ry, 0, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + ry);
  ctx.ellipse(x + rx, y + ry, rx, ry, 0, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}
