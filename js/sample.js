/** A little built-in scene so the toy has something to draw before you drop a picture. */
export function makeSampleImage() {
  const w = 720, h = 445;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // horizon
  ctx.beginPath();
  ctx.moveTo(30, 330);
  ctx.lineTo(690, 330);
  ctx.stroke();

  // house
  ctx.beginPath();
  ctx.rect(120, 200, 190, 130);
  ctx.moveTo(105, 200);
  ctx.lineTo(215, 110);
  ctx.lineTo(325, 200);
  ctx.closePath();
  ctx.stroke();
  // roof shading, dark door, tree trunk
  ctx.fillStyle = '#8c8c8c';
  ctx.beginPath();
  ctx.moveTo(105, 200); ctx.lineTo(215, 110); ctx.lineTo(325, 200); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#262626';
  ctx.fillRect(190, 260, 50, 70);
  ctx.fillStyle = '#5a5a5a';
  ctx.fillRect(470, 270, 26, 60);
  ctx.fillStyle = '#c4c4c4';
  ctx.beginPath();
  ctx.arc(590, 95, 42, 0, Math.PI * 2);
  ctx.fill();

  // door + windows
  ctx.beginPath();
  ctx.rect(190, 260, 50, 70);
  ctx.rect(140, 225, 36, 32);
  ctx.rect(255, 225, 36, 32);
  ctx.moveTo(158, 225); ctx.lineTo(158, 257);
  ctx.moveTo(140, 241); ctx.lineTo(176, 241);
  ctx.moveTo(273, 225); ctx.lineTo(273, 257);
  ctx.moveTo(255, 241); ctx.lineTo(291, 241);
  ctx.stroke();
  // chimney
  ctx.beginPath();
  ctx.moveTo(265, 150); ctx.lineTo(265, 122); ctx.lineTo(290, 122); ctx.lineTo(290, 170);
  ctx.stroke();

  // sun
  ctx.beginPath();
  ctx.arc(590, 95, 42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(590 + Math.cos(a) * 56, 95 + Math.sin(a) * 56);
    ctx.lineTo(590 + Math.cos(a) * 76, 95 + Math.sin(a) * 76);
    ctx.stroke();
  }
  ctx.lineWidth = 3;

  // tree
  ctx.beginPath();
  ctx.rect(470, 270, 26, 60);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(483, 130);
  ctx.lineTo(430, 215); ctx.lineTo(460, 215);
  ctx.lineTo(420, 275); ctx.lineTo(546, 275);
  ctx.lineTo(506, 215); ctx.lineTo(536, 215);
  ctx.closePath();
  ctx.stroke();

  // clouds
  const cloud = (x, y, s) => {
    ctx.beginPath();
    ctx.arc(x, y, 18 * s, Math.PI * 0.5, Math.PI * 1.5);
    ctx.arc(x + 22 * s, y - 16 * s, 22 * s, Math.PI, Math.PI * 1.85);
    ctx.arc(x + 52 * s, y - 10 * s, 18 * s, Math.PI * 1.2, Math.PI * 1.95);
    ctx.arc(x + 62 * s, y, 16 * s, Math.PI * 1.5, Math.PI * 0.5);
    ctx.closePath();
    ctx.stroke();
  };
  cloud(330, 90, 1);
  cloud(60, 120, 0.8);

  // greeting
  ctx.font = '400 54px Inter, system-ui, sans-serif';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '8px';
  ctx.textAlign = 'center';
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 2;
  ctx.strokeText('HELLO', 360, 405);

  return c;
}
