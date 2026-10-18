// Animated broadcast backgrounds. Heavy static textures are rendered once into cached
// offscreen canvases; per-frame work is a handful of gradients/paths (cheap at 30fps).
import type { BackgroundId } from '@cricstudio/shared';
import type { RenderCtx } from './draw';

const W = 1920;
const H = 1080;

function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const cache = new Map<string, HTMLCanvasElement>();
function cached(key: string, w: number, h: number, paint: (g: CanvasRenderingContext2D) => void) {
  let c = cache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    paint(c.getContext('2d')!);
    cache.set(key, c);
  }
  return c;
}

/** deterministic 0..1 noise */
const rnd = (i: number) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

function linear(ctx: CanvasRenderingContext2D, stops: [number, string][], x0 = 0, y0 = 0, x1 = 0, y1 = H) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, c);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function vignette(ctx: CanvasRenderingContext2D, a = 0.55) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.05);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/* ---------------- templates ---------------- */

function stadiumNight(rc: RenderCtx, accent: string) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#02040d'],
    [0.55, '#0b1633'],
    [1, '#0d2a1a'],
  ]);
  // floodlight towers with volumetric cones
  const towers = [
    [160, 60],
    [560, 20],
    [W - 560, 20],
    [W - 160, 60],
  ];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  towers.forEach(([x, y], i) => {
    const flick = 0.85 + 0.15 * Math.sin(now / 900 + i * 2.1);
    const tx = W / 2 + (x - W / 2) * 0.2;
    const g = ctx.createLinearGradient(x, y, tx, H);
    g.addColorStop(0, `rgba(220,235,255,${0.32 * flick})`);
    g.addColorStop(1, 'rgba(220,235,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 18, y);
    ctx.lineTo(x + 18, y);
    ctx.lineTo(tx + 420, H);
    ctx.lineTo(tx - 420, H);
    ctx.closePath();
    ctx.fill();
    glow(ctx, x, y, 140, `rgba(255,255,255,${0.55 * flick})`);
    // lamp grid
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
      ctx.fillStyle = `rgba(255,255,240,${0.9 * flick})`;
      ctx.fillRect(x - 30 + c * 13, y - 14 + r * 10, 9, 6);
    }
  });
  ctx.restore();
  // crowd bokeh
  const bokeh = cached('bokeh', W, 420, (g) => {
    for (let i = 0; i < 520; i++) {
      const x = rnd(i) * W;
      const y = 120 + rnd(i + 999) * 300;
      const r = 2 + rnd(i + 77) * 7;
      const hue = rnd(i + 5) > 0.7 ? '255,210,120' : rnd(i + 6) > 0.5 ? '170,200,255' : '255,255,255';
      const gr = g.createRadialGradient(x, y, 0, x, y, r * 2.2);
      gr.addColorStop(0, `rgba(${hue},0.55)`);
      gr.addColorStop(1, `rgba(${hue},0)`);
      g.fillStyle = gr;
      g.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
    }
  });
  ctx.save();
  ctx.globalAlpha = 0.55 + 0.1 * Math.sin(now / 1300);
  ctx.drawImage(bokeh, 0, H - 470);
  ctx.restore();
  // field oval
  const g = ctx.createRadialGradient(W / 2, H + 380, 100, W / 2, H + 380, 1000);
  g.addColorStop(0, 'rgba(52,168,83,0.45)');
  g.addColorStop(1, 'rgba(52,168,83,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H - 520, W, 520);
  glow(ctx, W * 0.5 + Math.sin(now / 4000) * 300, H * 0.35, 700, hexA(accent, 0.16));
  vignette(ctx, 0.5);
}

function pitchGreen(rc: RenderCtx) {
  const { ctx, now } = rc;
  const grass = cached('grass', W, H, (g) => {
    const vp = { x: W / 2, y: -900 };
    for (let i = -14; i < 14; i++) {
      g.beginPath();
      g.moveTo(vp.x, vp.y);
      g.lineTo(W / 2 + i * 260, H);
      g.lineTo(W / 2 + (i + 1) * 260, H);
      g.closePath();
      g.fillStyle = i % 2 ? '#14532d' : '#166534';
      g.fill();
    }
    // texture specks
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(0,0,0,${rnd(i) * 0.12})`;
      g.fillRect(rnd(i + 1) * W, rnd(i + 2) * H, 2, 2);
    }
    // pitch strip + creases
    g.save();
    g.translate(W / 2, H);
    const strip = g.createLinearGradient(0, -H, 0, 0);
    strip.addColorStop(0, 'rgba(214,192,140,0)');
    strip.addColorStop(1, 'rgba(214,192,140,0.55)');
    g.fillStyle = strip;
    g.beginPath();
    g.moveTo(-60, -H * 0.85);
    g.lineTo(60, -H * 0.85);
    g.lineTo(260, 0);
    g.lineTo(-260, 0);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(-330, -140);
    g.lineTo(330, -140);
    g.moveTo(-90, -H * 0.72);
    g.lineTo(90, -H * 0.72);
    g.stroke();
    g.restore();
  });
  ctx.drawImage(grass, 0, 0);
  linear(ctx, [
    [0, 'rgba(2,8,4,0.92)'],
    [0.45, 'rgba(2,8,4,0.55)'],
    [1, 'rgba(2,8,4,0.25)'],
  ]);
  // moving sunlight sweep
  const x = ((now / 12) % (W + 1200)) - 600;
  const sw = ctx.createLinearGradient(x - 300, 0, x + 300, 0);
  sw.addColorStop(0, 'rgba(255,255,255,0)');
  sw.addColorStop(0.5, 'rgba(255,255,220,0.07)');
  sw.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sw;
  ctx.fillRect(0, 0, W, H);
  vignette(ctx, 0.6);
}

function constellation(rc: RenderCtx, accent: string) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#020617'],
    [1, '#0b1a3f'],
  ]);
  glow(ctx, W * 0.3, H * 0.3, 800, hexA(accent, 0.18));
  const n = 85;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const sp = 0.004 + rnd(i) * 0.012;
    const x = (rnd(i + 11) * W + Math.sin(now * sp * 0.05 + i) * 120 + now * sp * 2) % W;
    const y = (rnd(i + 23) * H + Math.cos(now * sp * 0.04 + i * 2) * 90) % H;
    pts.push([x, y]);
  }
  ctx.save();
  ctx.lineWidth = 1.2;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = pts[i][0] - pts[j][0];
      const dy = pts[i][1] - pts[j][1];
      const d2 = dx * dx + dy * dy;
      if (d2 < 220 * 220) {
        ctx.strokeStyle = `rgba(147,197,253,${0.28 * (1 - Math.sqrt(d2) / 220)})`;
        ctx.beginPath();
        ctx.moveTo(pts[i][0], pts[i][1]);
        ctx.lineTo(pts[j][0], pts[j][1]);
        ctx.stroke();
      }
    }
  }
  for (const [x, y] of pts) {
    ctx.fillStyle = 'rgba(219,234,254,0.85)';
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  vignette(ctx, 0.45);
}

function hexTech(rc: RenderCtx, accent: string) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#03121c'],
    [1, '#062a3a'],
  ]);
  const R = 46;
  const hw = Math.sqrt(3) * R;
  const grid = cached('hex', W, H, (g) => {
    g.strokeStyle = 'rgba(103,232,249,0.13)';
    g.lineWidth = 1.5;
    for (let row = -1; row < H / (R * 1.5) + 1; row++) {
      for (let col = -1; col < W / hw + 1; col++) {
        const cx = col * hw + (row % 2 ? hw / 2 : 0);
        const cy = row * R * 1.5;
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 6 + (k * Math.PI) / 3;
          const x = cx + R * Math.cos(a);
          const y = cy + R * Math.sin(a);
          if (k) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.closePath();
        g.stroke();
      }
    }
  });
  ctx.drawImage(grid, 0, 0);
  // glowing cells
  const t = Math.floor(now / 140);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) {
    const seed = i * 97 + Math.floor((t + i * 7) / 18);
    const row = Math.floor(rnd(seed) * (H / (R * 1.5)));
    const col = Math.floor(rnd(seed + 1) * (W / hw));
    const phase = ((t + i * 7) % 18) / 18;
    const a = Math.sin(phase * Math.PI) * 0.5;
    const cx = col * hw + (row % 2 ? hw / 2 : 0);
    const cy = row * R * 1.5;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const ang = Math.PI / 6 + (k * Math.PI) / 3;
      ctx.lineTo(cx + (R - 3) * Math.cos(ang), cy + (R - 3) * Math.sin(ang));
    }
    ctx.closePath();
    ctx.fillStyle = hexA(i % 3 ? '#22d3ee' : accent, a);
    ctx.fill();
  }
  ctx.restore();
  // scan line
  const sy = (now / 6) % (H + 200) - 100;
  const sg = ctx.createLinearGradient(0, sy - 80, 0, sy + 80);
  sg.addColorStop(0, 'rgba(34,211,238,0)');
  sg.addColorStop(0.5, 'rgba(34,211,238,0.10)');
  sg.addColorStop(1, 'rgba(34,211,238,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(0, sy - 80, W, 160);
  vignette(ctx, 0.55);
}

function liquidWaves(rc: RenderCtx, accent: string) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#050b1f'],
    [1, '#0b1f4a'],
  ]);
  glow(ctx, W * 0.75, H * 0.2, 700, hexA(accent, 0.22));
  const layers = [
    ['#1e3a8a', 0.55, 0.62],
    [accent, 0.35, 0.7],
    ['#0ea5e9', 0.3, 0.78],
    ['#1d4ed8', 0.6, 0.86],
  ] as const;
  layers.forEach(([c, a, yf], k) => {
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 30) {
      const y = H * yf + Math.sin(x / (220 + k * 40) + now / (1600 - k * 200)) * (40 + k * 8) + Math.sin(x / 90 + now / 700 + k) * 8;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, H * yf - 60, 0, H);
    g.addColorStop(0, hexA(c, a));
    g.addColorStop(1, hexA('#020617', 0.9));
    ctx.fillStyle = g;
    ctx.fill();
  });
  vignette(ctx, 0.35);
}

function prism(rc: RenderCtx, accent: string) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#0f0a1f'],
    [1, '#1a1033'],
  ]);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const cols = [accent, '#ea4335', '#fbbc04', '#34a853', '#a142f4'];
  for (let i = 0; i < 9; i++) {
    const t = now / (9000 + i * 1300);
    const cx = W * rnd(i + 3) + Math.sin(t + i) * 160;
    const cy = H * rnd(i + 9) + Math.cos(t * 1.3 + i) * 120;
    const r = 260 + rnd(i) * 320;
    const rot = t * (i % 2 ? 1 : -1);
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = rot + (k * Math.PI * 2) / 3;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, hexA(cols[i % cols.length], 0.22));
    g.addColorStop(1, hexA(cols[(i + 2) % cols.length], 0.03));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.stroke();
  }
  ctx.restore();
  vignette(ctx, 0.5);
}

function teamClash(rc: RenderCtx) {
  const { ctx, now, match } = rc;
  const a = match?.teams[0]?.color ?? '#1a73e8';
  const b = match?.teams[1]?.color ?? '#ea4335';
  const lift = (c: string) => {
    const n = parseInt(c.replace('#', '').slice(0, 6), 16);
    if (!Number.isFinite(n)) return c;
    const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    return lum < 50 ? '#3b5bdb' : c;
  };
  const ca = lift(a);
  const cb = lift(b);
  ctx.fillStyle = '#05070f';
  ctx.fillRect(0, 0, W, H);
  const off = Math.sin(now / 2600) * 60;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W * 0.56 + off, 0);
  ctx.lineTo(W * 0.44 + off, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.clip();
  linear(ctx, [
    [0, hexA(ca, 0.55)],
    [1, hexA(ca, 0.12)],
  ], 0, 0, W, 0);
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(W * 0.56 + off, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, H);
  ctx.lineTo(W * 0.44 + off, H);
  ctx.closePath();
  ctx.clip();
  linear(ctx, [
    [0, hexA(cb, 0.12)],
    [1, hexA(cb, 0.55)],
  ], 0, 0, W, 0);
  ctx.restore();
  // glowing seam
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 30;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(W * 0.56 + off, 0);
  ctx.lineTo(W * 0.44 + off, H);
  ctx.stroke();
  ctx.restore();
  // watermark abbreviations
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = '#fff';
  ctx.font = '900 360px "Roboto Condensed", Roboto, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(match?.teams[0]?.abbr ?? 'HOME', W * 0.24, H * 0.55);
  ctx.fillText(match?.teams[1]?.abbr ?? 'AWAY', W * 0.76, H * 0.55);
  ctx.restore();
  vignette(ctx, 0.5);
}

function seamLines(rc: RenderCtx) {
  const { ctx, now } = rc;
  const leather = cached('leather', W, H, (g) => {
    const gr = g.createRadialGradient(W * 0.4, H * 0.35, 50, W / 2, H / 2, W * 0.8);
    gr.addColorStop(0, '#7f1d1d');
    gr.addColorStop(1, '#1c0404');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 26000; i++) {
      g.fillStyle = `rgba(0,0,0,${rnd(i) * 0.18})`;
      g.fillRect(rnd(i + 1) * W, rnd(i + 2) * H, 2, 2);
      if (i % 4 === 0) {
        g.fillStyle = `rgba(255,200,200,${rnd(i + 5) * 0.05})`;
        g.fillRect(rnd(i + 3) * W, rnd(i + 4) * H, 1.5, 1.5);
      }
    }
  });
  ctx.drawImage(leather, 0, 0);
  // giant rotating seam
  ctx.save();
  ctx.translate(W * 0.62, H * 0.5);
  ctx.rotate(-0.35 + Math.sin(now / 7000) * 0.08);
  const r = 900;
  for (const off of [-26, 26]) {
    ctx.strokeStyle = 'rgba(245,235,220,0.55)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, r * 0.9, r + off, Math.PI * 1.18, Math.PI * 1.82);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(245,235,220,0.7)';
  ctx.lineWidth = 4;
  const shift = (now / 3000) % 1;
  for (let k = 0; k < 60; k++) {
    const a = Math.PI * 1.18 + ((k + shift) / 60) * Math.PI * 0.64;
    const x1 = Math.cos(a) * (r - 40);
    const y1 = r * 0.9 + Math.sin(a) * (r - 40);
    const x2 = Math.cos(a + 0.01) * (r + 40);
    const y2 = r * 0.9 + Math.sin(a + 0.01) * (r + 40);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.restore();
  // specular shine
  glow(ctx, W * 0.3 + Math.sin(now / 5000) * 200, H * 0.25, 600, 'rgba(255,255,255,0.08)');
  vignette(ctx, 0.6);
}

/* ---------------- cricket broadcast themes ----------------
 * Colour stories inspired by famous tournaments and grounds. Pure shapes and colour —
 * no logos, emblems, trophies or official marks are drawn.
 */

/** a flowing sine ribbon across the frame */
function ribbon(ctx: CanvasRenderingContext2D, y0: number, amp: number, freq: number, phase: number, thick: number, color: string) {
  ctx.beginPath();
  for (let x = 0; x <= W; x += 24) {
    const y = y0 + Math.sin(x * freq + phase) * amp;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let x = W; x >= 0; x -= 24) ctx.lineTo(x, y0 + Math.sin(x * freq + phase) * amp + thick * (0.6 + 0.4 * Math.sin(x * freq * 0.5 + phase * 1.3)));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function star5(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

/** slowly falling confetti / sparkles */
function confetti(ctx: CanvasRenderingContext2D, now: number, n: number, colors: string[], alpha = 0.5, size = 8) {
  ctx.save();
  for (let i = 0; i < n; i++) {
    const x = (rnd(i) * W + Math.sin(now / 1500 + i) * 30) % W;
    const y = ((rnd(i + 50) * H + now / (14 + rnd(i + 9) * 18)) % (H + 40)) - 20;
    ctx.globalAlpha = alpha * (0.4 + 0.6 * rnd(i + 3));
    ctx.fillStyle = colors[i % colors.length];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(now / 600 + i);
    ctx.fillRect(-size / 2, -size / 4, size, size / 2);
    ctx.restore();
  }
  ctx.restore();
}

/** ODI World Cup 2023 colour story: deep indigo with vivid magenta / orange / teal / yellow arc bursts */
function worldCup23(rc: RenderCtx, accent: string) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#1d0c58'],
    [0.6, '#120838'],
    [1, '#07041f'],
  ], 0, 0, W, H);
  const cols = ['#e6007e', '#f7941d', '#00b5ad', '#ffd200', '#7a3cf0'];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ([
    [0, H, -Math.PI / 2],
    [W, 0, Math.PI / 2],
  ] as const).forEach(([cx, cy, a0], k) => {
    for (let i = 0; i < 5; i++) {
      const r = 240 + i * 115 + Math.sin(now / 1800 + i + k * 2) * 16;
      ctx.strokeStyle = hexA(cols[(i + k * 2) % 5], 0.3);
      ctx.lineWidth = 48;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a0 + Math.PI / 2);
      ctx.stroke();
    }
  });
  ctx.restore();
  confetti(ctx, now, 50, cols, 0.35, 10);
  glow(ctx, W / 2, H * 0.4, 700, hexA(accent, 0.14));
  vignette(ctx, 0.45);
}

/** the old hand-operated scoreboard: painted green planks, cream frame, faint number plates */
function lordsScoreboard(rc: RenderCtx) {
  const { ctx, now } = rc;
  const board = cached('lordsBoard', W, H, (g) => {
    g.fillStyle = '#143322';
    g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 120) {
      g.fillStyle = x % 240 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.025)';
      g.fillRect(x, 0, 120, H);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x, 0, 3, H);
    }
    for (let i = 0; i < 1800; i++) {
      g.fillStyle = `rgba(0,0,0,${rnd(i) * 0.12})`;
      g.fillRect(rnd(i + 1) * W, rnd(i + 2) * H, 1 + rnd(i + 3) * 2, 20 + rnd(i + 4) * 120);
    }
    // rows of number plates
    g.font = '700 64px "Roboto Condensed", Roboto, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let r = 0; r < 6; r++)
      for (let c = 0; c < 14; c++) {
        const x = 110 + c * 128;
        const y = 120 + r * 150;
        g.fillStyle = 'rgba(0,0,0,0.28)';
        g.fillRect(x - 46, y - 52, 92, 104);
        if (rnd(r * 31 + c) > 0.45) {
          g.fillStyle = 'rgba(245,238,214,0.07)';
          g.fillText(String(Math.floor(rnd(r * 7 + c * 3) * 10)), x, y + 2);
        }
      }
    // cream double frame
    g.strokeStyle = 'rgba(240,232,205,0.35)';
    g.lineWidth = 8;
    g.strokeRect(30, 30, W - 60, H - 60);
    g.lineWidth = 2;
    g.strokeRect(52, 52, W - 104, H - 104);
  });
  ctx.drawImage(board, 0, 0);
  // afternoon sun drifting across the boards
  glow(ctx, W * (0.3 + 0.2 * Math.sin(now / 9000)), H * 0.2, 900, 'rgba(255,222,160,0.10)');
  vignette(ctx, 0.55);
}

/** T20 league night (IPL-inspired): royal blue & violet with gold stage beams and confetti */
function iplNight(rc: RenderCtx, accent: string) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#0b1a66'],
    [0.55, '#1b0b52'],
    [1, '#05051a'],
  ], 0, 0, W, H);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const beams = ['#ffb300', '#ff6a00', '#ff2d95', '#ffd54f'];
  beams.forEach((c, i) => {
    const bx = W * (0.15 + i * 0.23);
    const a = Math.sin(now / 1400 + i * 1.7) * 0.45;
    const g = ctx.createLinearGradient(bx, H, bx + Math.sin(a) * 900, 0);
    g.addColorStop(0, hexA(c, 0.32));
    g.addColorStop(1, hexA(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(bx - 20, H);
    ctx.lineTo(bx + 20, H);
    ctx.lineTo(bx + Math.sin(a) * 1100 + 220, -50);
    ctx.lineTo(bx + Math.sin(a) * 1100 - 220, -50);
    ctx.closePath();
    ctx.fill();
  });
  ctx.restore();
  confetti(ctx, now, 70, ['#ffd54f', '#ffb300', '#ffffff', '#ff6a00'], 0.45, 9);
  glow(ctx, W / 2, H * 0.45, 650, hexA(accent, 0.12));
  vignette(ctx, 0.45);
}

/** Big Bash-inspired: black stage with fast neon streaks in club-bright colours */
function bblNeon(rc: RenderCtx) {
  const { ctx, now } = rc;
  ctx.fillStyle = '#07070d';
  ctx.fillRect(0, 0, W, H);
  const cols = ['#39ff14', '#ff2fb3', '#ff8c00', '#00e5ff', '#b026ff', '#ffe600'];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let i = 0; i < 34; i++) {
    const speed = 0.25 + rnd(i) * 0.6;
    const len = 260 + rnd(i + 1) * 520;
    const t = ((now * speed) / 4 + rnd(i + 2) * (W + H + len)) % (W + H + len);
    const y0 = rnd(i + 3) * (H + 600) - 300;
    const x = t - len;
    const c = cols[i % cols.length];
    for (const [w, a] of [
      [16, 0.12],
      [5, 0.75],
    ] as const) {
      ctx.strokeStyle = hexA(c, a);
      ctx.lineWidth = w * (0.6 + rnd(i + 4));
      ctx.beginPath();
      ctx.moveTo(x, y0 + x * 0.35);
      ctx.lineTo(x + len, y0 + (x + len) * 0.35);
      ctx.stroke();
    }
  }
  ctx.restore();
  const g = ctx.createLinearGradient(0, H - 260, 0, H);
  g.addColorStop(0, 'rgba(255,47,179,0)');
  g.addColorStop(1, 'rgba(255,47,179,0.22)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H - 260, W, 260);
  vignette(ctx, 0.5);
}

/** Test Championship final mood: midnight navy, slow gold rings, a red-ball glow */
function wtcFinal(rc: RenderCtx) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#06142e'],
    [1, '#0f2a57'],
  ], 0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H * 1.08);
  ctx.rotate(now / 40000);
  for (let i = 0; i < 7; i++) {
    ctx.strokeStyle = `rgba(212,175,55,${0.42 - i * 0.045})`;
    ctx.lineWidth = i % 2 ? 2 : 4;
    ctx.setLineDash(i % 2 ? [6, 14] : []);
    ctx.beginPath();
    ctx.arc(0, 0, 360 + i * 110, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
  // red ball with seam, top right
  const bx = W * 0.86;
  const by = H * 0.2 + Math.sin(now / 3000) * 10;
  glow(ctx, bx, by, 520, 'rgba(200,30,30,0.42)');
  glow(ctx, W * 0.2, H * 0.25, 700, 'rgba(212,175,55,0.10)');
  ctx.strokeStyle = 'rgba(255,240,220,0.25)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(bx - 160, by, 210, -0.7, 0.7);
  ctx.stroke();
  confetti(ctx, now, 30, ['#d4af37', '#f5e6a8'], 0.35, 5);
  vignette(ctx, 0.5);
}

/** Women's World Cup colour story: plum night with flowing teal, pink and violet ribbons */
function womensWc(rc: RenderCtx) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#2a0b3f'],
    [0.6, '#3a0d52'],
    [1, '#0d1033'],
  ], 0, 0, W, H);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const t = now / 2400;
  ribbon(ctx, H * 0.58, 70, 0.0032, t, 120, 'rgba(25,195,184,0.20)');
  ribbon(ctx, H * 0.66, 90, 0.0026, -t * 1.2 + 1, 100, 'rgba(255,79,154,0.20)');
  ribbon(ctx, H * 0.74, 60, 0.004, t * 0.8 + 2, 80, 'rgba(167,110,255,0.20)');
  ctx.restore();
  glow(ctx, W * 0.25, H * 0.3, 600, 'rgba(255,79,154,0.12)');
  glow(ctx, W * 0.8, H * 0.25, 600, 'rgba(25,195,184,0.12)');
  vignette(ctx, 0.45);
}

/** Australia: green & gold sweeping bands with the Southern Cross */
function ausGoldGreen(rc: RenderCtx) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#00331b'],
    [1, '#001a0e'],
  ], 0, 0, W, H);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const t = now / 2600;
  ribbon(ctx, H * 0.62, 80, 0.0025, t, 110, 'rgba(255,205,0,0.20)');
  ribbon(ctx, H * 0.7, 70, 0.003, t * 1.3 + 2, 90, 'rgba(0,132,61,0.35)');
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ([
    [0.8, 0.14, 22],
    [0.88, 0.3, 26],
    [0.74, 0.34, 20],
    [0.83, 0.46, 24],
    [0.8, 0.3, 10],
  ] as const).forEach(([x, y, r], i) => {
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now / 700 + i);
    star5(ctx, W * x, H * y, r);
  });
  ctx.globalAlpha = 1;
  glow(ctx, W * 0.3, H * 0.3, 700, 'rgba(255,205,0,0.10)');
  vignette(ctx, 0.5);
}

/** The Ashes, AUS v ENG: green & gold against navy & red, with drifting embers */
function ashes(rc: RenderCtx) {
  const { ctx, now } = rc;
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, W, H);
  const off = Math.sin(now / 3000) * 40;
  const side = (pts: number[][], stops: [number, string][]) => {
    ctx.save();
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.clip();
    linear(ctx, stops, 0, 0, W, H);
    ctx.restore();
  };
  side([[0, 0], [W * 0.55 + off, 0], [W * 0.45 + off, H], [0, H]], [
    [0, 'rgba(0,132,61,0.75)'],
    [0.45, 'rgba(0,100,50,0.35)'],
    [1, 'rgba(255,205,0,0.25)'],
  ]);
  side([[W * 0.55 + off, 0], [W, 0], [W, H], [W * 0.45 + off, H]], [
    [0, 'rgba(0,0,0,0)'],
    [0.5, 'rgba(200,16,46,0.22)'],
    [1, 'rgba(11,31,75,0.75)'],
  ]);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,240,220,0.6)';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#ffdca8';
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.moveTo(W * 0.55 + off, 0);
  ctx.lineTo(W * 0.45 + off, H);
  ctx.stroke();
  ctx.restore();
  // rising embers / ash
  for (let i = 0; i < 70; i++) {
    const x = (rnd(i) * W + Math.sin(now / 2000 + i) * 40) % W;
    const y = H - ((rnd(i + 20) * H + now / (18 + rnd(i + 7) * 20)) % (H + 30));
    const ember = rnd(i + 11) > 0.7;
    ctx.fillStyle = ember ? `rgba(255,150,60,${0.5 * rnd(i + 4) + 0.2})` : `rgba(200,200,200,${0.25 * rnd(i + 4) + 0.05})`;
    ctx.beginPath();
    ctx.arc(x, y, ember ? 2.5 : 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  vignette(ctx, 0.55);
}

/** Royal Ivory & Gold: deep bronze with ivory pinstripes and an art-deco gold fan */
function royalIvory(rc: RenderCtx) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#1c150b'],
    [1, '#2e2313'],
  ], 0, 0, W, H);
  ctx.fillStyle = 'rgba(255,248,230,0.035)';
  for (let x = 0; x < W; x += 48) ctx.fillRect(x, 0, 1.5, H);
  ctx.save();
  ctx.translate(W / 2, H + 40);
  for (let i = 0; i < 24; i++) {
    const a = Math.PI + (i / 23) * Math.PI;
    const pulse = 0.5 + 0.5 * Math.sin(now / 1200 - i * 0.3);
    ctx.strokeStyle = `rgba(212,175,55,${0.12 + 0.12 * pulse})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 140, Math.sin(a) * 140);
    ctx.lineTo(Math.cos(a) * 760, Math.sin(a) * 760);
    ctx.stroke();
  }
  for (const r of [140, 420, 760]) {
    ctx.strokeStyle = 'rgba(245,232,190,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  glow(ctx, W * (0.5 + 0.3 * Math.sin(now / 7000)), H * 0.25, 800, 'rgba(255,240,205,0.10)');
  vignette(ctx, 0.5);
}

/** Electric Blue Arena: stadium bowl of blue light rings with a travelling pulse */
function electricBlue(rc: RenderCtx) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#010618'],
    [1, '#04154a'],
  ], 0, 0, W, H);
  const cx = W / 2;
  const cy = H * 0.62;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let ring = 0; ring < 6; ring++) {
    const rx = 520 + ring * 170;
    const ry = 150 + ring * 62;
    const dots = 60 + ring * 14;
    for (let i = 0; i < dots; i++) {
      const a = (i / dots) * Math.PI * 2;
      const head = (now / 900 + ring * 0.7) % (Math.PI * 2);
      const d = Math.abs(((a - head + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      const lit = Math.max(0, 1 - d / 0.9);
      ctx.fillStyle = `rgba(0,180,255,${0.25 + 0.7 * lit})`;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 2.5 + lit * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // expanding shock ring
  const p = (now / 2600) % 1;
  ctx.strokeStyle = `rgba(80,200,255,${0.35 * (1 - p)})`;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 300 + p * 1200, 90 + p * 420, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  glow(ctx, cx, cy, 800, 'rgba(0,140,255,0.26)');
  vignette(ctx, 0.5);
}

/** Platinum Pavilion: graphite brushed metal with a slow silver sheen */
function platinumPavilion(rc: RenderCtx) {
  const { ctx, now } = rc;
  const metal = cached('platinum', W, H, (g) => {
    const gr = g.createLinearGradient(0, 0, W, H);
    gr.addColorStop(0, '#15171b');
    gr.addColorStop(1, '#2b2f36');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 2) {
      g.fillStyle = `rgba(255,255,255,${rnd(y) * 0.025})`;
      g.fillRect(0, y, W, 1);
    }
    // pavilion panels: tall framed bays like a members' stand
    g.strokeStyle = 'rgba(220,225,235,0.10)';
    g.lineWidth = 2;
    for (let x = 40; x < W - 40; x += 230) g.strokeRect(x + 14, 90, 202, H - 180);
    g.strokeStyle = 'rgba(220,225,235,0.28)';
    g.strokeRect(40, 40, W - 80, H - 80);
  });
  ctx.drawImage(metal, 0, 0);
  const p = ((now / 7000) % 1) * (W + 1200) - 600;
  const g = ctx.createLinearGradient(p - 400, 0, p + 400, H);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(235,240,250,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  glow(ctx, W * 0.5, H * 0.35, 900, 'rgba(210,220,240,0.12)');
  vignette(ctx, 0.5);
}

/** USA flag colours: navy field with stars, waving red & white stripes */
function usaStars(rc: RenderCtx) {
  const { ctx, now } = rc;
  ctx.fillStyle = '#071733';
  ctx.fillRect(0, 0, W, H);
  const t = now / 2200;
  for (let i = 0; i < 7; i++) ribbon(ctx, 120 + i * 140, 26, 0.0035, t + i * 0.35, 62, i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(178,34,52,0.30)');
  const canton = ctx.createLinearGradient(0, 0, W * 0.45, H * 0.55);
  canton.addColorStop(0, 'rgba(10,31,68,0.95)');
  canton.addColorStop(1, 'rgba(10,31,68,0)');
  ctx.fillStyle = canton;
  ctx.fillRect(0, 0, W * 0.55, H * 0.65);
  ctx.fillStyle = '#ffffff';
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 7; c++) {
      ctx.globalAlpha = (0.18 + 0.12 * Math.sin(now / 800 + r + c)) * (1 - c / 9);
      star5(ctx, 70 + c * 95 + (r % 2) * 47, 70 + r * 80, 16);
    }
  ctx.globalAlpha = 1;
  vignette(ctx, 0.5);
}

/** South Africa: deep green with flowing gold ribbons and thin red & blue accents */
function proteasGreenGold(rc: RenderCtx) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#00301d'],
    [1, '#004d2e'],
  ], 0, 0, W, H);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const t = now / 2500;
  ribbon(ctx, H * 0.55, 80, 0.0028, t, 120, 'rgba(255,182,18,0.22)');
  ribbon(ctx, H * 0.68, 60, 0.0034, -t + 1.5, 14, 'rgba(224,60,49,0.40)');
  ribbon(ctx, H * 0.73, 60, 0.0034, -t + 1.9, 14, 'rgba(40,90,220,0.40)');
  ctx.restore();
  glow(ctx, W * 0.75, H * 0.3, 700, 'rgba(255,182,18,0.12)');
  vignette(ctx, 0.5);
}

/* ---------------- brand-inspired design systems ----------------
 * Colour, type and shape language only. No logos or marks are drawn.
 */

/** AssemblyAI-style warm paper canvas with a live cobalt voice waveform */
function assemblyai(rc: RenderCtx) {
  const { ctx, now } = rc;
  ctx.fillStyle = '#fdfcf8';
  ctx.fillRect(0, 0, W, H);
  const t = now / 9000;
  glow(ctx, W * (0.15 + 0.05 * Math.sin(t)), H * 0.12, 820, 'rgba(57,35,199,0.10)');
  glow(ctx, W * (0.88 + 0.04 * Math.cos(t * 1.2)), H * 0.9, 760, 'rgba(136,123,221,0.14)');
  glow(ctx, W * 0.85, H * 0.15, 520, 'rgba(236,157,146,0.10)');
  // fine paper grid
  ctx.strokeStyle = 'rgba(29,27,22,0.045)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
    ctx.stroke();
  }
  // speech waveform along the bottom edge
  const bars = 96;
  const bw = W / bars;
  for (let i = 0; i < bars; i++) {
    const env = Math.sin((i / bars) * Math.PI);
    const v = 0.35 + 0.65 * Math.abs(Math.sin(now / 420 + i * 0.37) * Math.cos(now / 1300 + i * 0.11));
    const h = 18 + env * v * 120;
    ctx.fillStyle = i % 7 === 0 ? 'rgba(236,157,146,0.35)' : 'rgba(57,35,199,0.16)';
    ctx.beginPath();
    ctx.roundRect(i * bw + bw * 0.25, H - 24 - h, bw * 0.5, h, bw * 0.25);
    ctx.fill();
  }
}

/** Fluent-style: deep canvas with a soft "bloom" of translucent petals and acrylic light */
function microsoftFluent(rc: RenderCtx) {
  const { ctx, now } = rc;
  linear(ctx, [
    [0, '#0a0e1c'],
    [1, '#121a33'],
  ], 0, 0, W, H);
  const t = now / 12000;
  ctx.save();
  ctx.translate(W * 0.62, H * 0.58);
  ctx.rotate(Math.sin(t) * 0.08);
  ctx.globalCompositeOperation = 'lighter';
  const petals = ['#0078d4', '#2b88d8', '#6b69d6', '#8764b8', '#00b7c3', '#4f6bed'];
  petals.forEach((c, i) => {
    ctx.save();
    ctx.rotate((i / petals.length) * Math.PI * 1.1 - 0.9);
    const g = ctx.createLinearGradient(0, 0, 820, 0);
    g.addColorStop(0, hexA(c, 0.05));
    g.addColorStop(0.6, hexA(c, 0.26));
    g.addColorStop(1, hexA(c, 0.02));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(380, 0, 460, 150 + 20 * Math.sin(now / 2500 + i), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
  ctx.restore();
  // four soft corner lights in the classic four-colour palette
  glow(ctx, 0, 0, 520, 'rgba(242,80,34,0.10)');
  glow(ctx, W, 0, 520, 'rgba(127,186,0,0.08)');
  glow(ctx, 0, H, 520, 'rgba(0,164,239,0.12)');
  glow(ctx, W, H, 520, 'rgba(255,185,0,0.08)');
  vignette(ctx, 0.35);
}

/** Warm paper: ivory page, fine grain, hand-drawn clay and oat shapes, pencil hairlines */
function claudePaper(rc: RenderCtx) {
  const { ctx, now } = rc;
  const paper = cached('claudePaper', W, H, (g) => {
    g.fillStyle = '#f0eee6';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 40000; i++) {
      g.fillStyle = `rgba(80,60,40,${rnd(i) * 0.035})`;
      g.fillRect(rnd(i + 1) * W, rnd(i + 2) * H, 1.5, 1.5);
    }
    // pencil ruling
    g.strokeStyle = 'rgba(20,20,19,0.05)';
    g.lineWidth = 1;
    for (let y = 60; y < H; y += 60) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
  });
  ctx.drawImage(paper, 0, 0);
  // wobbly organic blobs, like cut paper
  const blob = (cx: number, cy: number, r: number, c: string, seed: number) => {
    ctx.beginPath();
    for (let k = 0; k <= 60; k++) {
      const a = (k / 60) * Math.PI * 2;
      const rr2 = r * (1 + 0.08 * Math.sin(a * 3 + seed + now / 4000) + 0.05 * Math.cos(a * 5 + seed));
      if (k) ctx.lineTo(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2);
      else ctx.moveTo(cx + rr2, cy);
    }
    ctx.closePath();
    ctx.fillStyle = c;
    ctx.fill();
  };
  blob(W * 0.93, H * 0.12, 260, 'rgba(217,119,87,0.16)', 1);
  blob(W * 0.05, H * 0.9, 300, 'rgba(204,190,160,0.30)', 2);
  blob(W * 0.86, H * 0.95, 160, 'rgba(106,155,204,0.12)', 3);
  // a hand-drawn spiral stroke in clay
  ctx.save();
  ctx.translate(W * 0.035, H * 0.62);
  ctx.strokeStyle = 'rgba(217,119,87,0.30)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let k = 0; k < 140; k++) {
    const a = k * 0.18 + now / 6000;
    const rr2 = 6 + k * 0.6;
    if (k) ctx.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2);
    else ctx.moveTo(Math.cos(a) * rr2, Math.sin(a) * rr2);
  }
  ctx.stroke();
  ctx.restore();
}

/** Monochrome: pure black, a faint dot matrix and one slow moving light */
function xMono(rc: RenderCtx) {
  const { ctx, now } = rc;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  const dots = cached('xDots', W, H, (g) => {
    g.fillStyle = 'rgba(231,233,234,0.09)';
    for (let x = 30; x < W; x += 40) for (let y = 30; y < H; y += 40) g.fillRect(x, y, 2, 2);
  });
  ctx.drawImage(dots, 0, 0);
  glow(ctx, W * (0.5 + 0.35 * Math.sin(now / 8000)), H * (0.4 + 0.2 * Math.cos(now / 9000)), 700, 'rgba(231,233,234,0.06)');
  // one hairline sweeping diagonally
  const p = ((now / 9000) % 1) * (W + H);
  ctx.strokeStyle = 'rgba(231,233,234,0.10)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(p - H, H);
  ctx.lineTo(p, 0);
  ctx.stroke();
}

/* ---------------- photo themes ---------------- */

/**
 * A stadium photo with a slow Ken Burns drift, darkened and colour-washed so cards and
 * white text stay readable over it.
 */
function photo(name: string, wash: string, dark = 0.5) {
  return (rc: RenderCtx) => {
    const { ctx, now } = rc;
    const img = rc.img(`/themes/${name}.jpg`);
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, W, H);
    if (img) {
      const z = 1.06 + 0.04 * Math.sin(now / 24000);
      const dx = Math.sin(now / 31000) * 30;
      const dy = Math.cos(now / 27000) * 16;
      ctx.drawImage(img, (W - W * z) / 2 + dx, (H - H * z) / 2 + dy, W * z, H * z);
    }
    ctx.fillStyle = `rgba(4,8,18,${dark})`;
    ctx.fillRect(0, 0, W, H);
    linear(ctx, [
      [0, hexA(wash, 0.18)],
      [0.55, 'rgba(0,0,0,0)'],
      [1, 'rgba(0,0,0,0.55)'],
    ]);
    vignette(ctx, 0.55);
  };
}

const DRAW: Record<BackgroundId, (rc: RenderCtx, accent: string) => void> = {
  stadiumNight,
  pitchGreen,
  constellation,
  hexTech,
  liquidWaves,
  prism,
  teamClash,
  seamLines,
  worldCup23,
  lordsScoreboard,
  iplNight,
  bblNeon,
  wtcFinal,
  womensWc,
  ausGoldGreen,
  ashes,
  royalIvory,
  electricBlue,
  platinumPavilion,
  usaStars,
  proteasGreenGold,
  assemblyai,
  microsoftFluent,
  claudePaper,
  xMono,
  photoFloodlit: photo('floodlit', '#1a3a8a', 0.42),
  photoSunsetOval: photo('sunset-oval', '#8a3a6a', 0.38),
  photoRedSky: photo('red-sky', '#8a1a10', 0.42),
  photoMountain: photo('mountain', '#1a4a8a', 0.5),
  photoRedBall: photo('red-ball', '#3a1a10', 0.5),
  photoRainCovers: photo('rain-covers', '#1a2a4a', 0.5),
  photoBigHit: photo('big-hit', '#3a2a10', 0.6),
  photoGrandstand: photo('grandstand', '#1a3a2a', 0.52),
};

/** Draw the studio's chosen animated background. `tint` lets a scene nudge the accent glow. */
export function drawBackground(rc: RenderCtx, tint?: string) {
  const id = rc.state.brand.background ?? 'stadiumNight';
  (DRAW[id] ?? stadiumNight)(rc, tint ?? rc.accent);
}
