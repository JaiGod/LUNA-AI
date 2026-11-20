// Animated nebula sky (original, procedural): glowing clouds in magenta, violet and blue
// (or a green aurora), with teal and white stars, like a star projector on the ceiling.
// Used as the page background by LUNA-X and SELENE.
export const NEBULA_THEMES = {
  // the LUNA concept: a star projector's burst of light that turns slowly and shifts colour
  projector: { label: 'LUNA projector', dynamic: true, clouds: [], stars: ['#5ff0d0', '#8fffe0', '#c8fff2', '#ffffff'] },
  nebula: { label: 'Nebula', clouds: ['#ff2fb3', '#c026ff', '#7b2bff', '#3b4bff', '#ff3d7a'], stars: ['#7ff5e8', '#ffffff', '#c4f1ff'] },
  aurora: { label: 'Aurora', clouds: ['#18f59a', '#10d27a', '#20c9a6', '#29d7ff', '#ff7a45'], stars: ['#5ff0d0', '#bfffee', '#ffffff'] },
  cosmic: { label: 'Cosmic', clouds: ['#ff2fb3', '#7b2bff', '#2b6bff', '#14e0b0', '#c026ff'], stars: ['#7ff5e8', '#ffffff', '#ffd1f4'] },
  off: { label: 'Plain', clouds: [], stars: ['#ffffff'] },
};

// Colour cycle of the projector burst: red → green → cyan → blue → violet → back
const CYCLE = [[255, 60, 40], [40, 255, 120], [30, 230, 220], [40, 90, 255], [170, 60, 255]];
function cycleColor(p) {
  const n = CYCLE.length, x = ((p % n) + n) % n, i = Math.floor(x), f = x - i, a = CYCLE[i], b = CYCLE[(i + 1) % n];
  const s = f * f * (3 - 2 * f);
  return a.map((v, k) => Math.round(v + (b[k] - v) * s));
}

export function createNebula(canvas, theme = 'projector') {
  const g = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, dpr = 1, layers = [], stars = [], t = 0, raf = 0, last = 0, cur = NEBULA_THEMES[theme] ? theme : 'projector';
  let pc = null, petals = []; // projector: small offscreen canvas + light wisps
  let shooters = [], px = 0, py = 0, tx = 0, ty = 0; // shooting stars and mouse parallax
  if (!reduce) addEventListener('pointermove', (e) => { tx = (e.clientX / innerWidth - 0.5); ty = (e.clientY / innerHeight - 0.5); }, { passive: true });
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  function cloudLayer(colors, count, scale) {
    const c = document.createElement('canvas');
    const w = Math.ceil(W / 3), h = Math.ceil(H / 3); // drawn small, scaled up: soft and fast
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.globalCompositeOperation = 'lighter';
    const cx = w * (0.35 + rnd() * 0.3), cy = h * (0.35 + rnd() * 0.3);
    for (let i = 0; i < count; i++) {
      const col = colors[i % colors.length];
      const ang = rnd() * Math.PI * 2, dist = Math.pow(rnd(), 0.7) * Math.min(w, h) * 0.55 * scale;
      const px = cx + Math.cos(ang) * dist, py = cy + Math.sin(ang) * dist * 0.8;
      const r = Math.min(w, h) * (0.08 + rnd() * 0.22) * scale;
      x.save(); x.translate(px, py); x.rotate(rnd() * Math.PI); x.scale(1.6 + rnd() * 2.4, 0.5 + rnd() * 0.6);
      const gr = x.createRadialGradient(0, 0, 0, 0, 0, r);
      gr.addColorStop(0, col + 'aa'); gr.addColorStop(0.45, col + '44'); gr.addColorStop(1, col + '00');
      x.fillStyle = gr; x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.fill(); x.restore();
    }
    // a few bright cores where clouds overlap
    for (let i = 0; i < 4; i++) {
      const px = cx + (rnd() - 0.5) * w * 0.25, py = cy + (rnd() - 0.5) * h * 0.25, r = Math.min(w, h) * (0.02 + rnd() * 0.04);
      const gr = x.createRadialGradient(px, py, 0, px, py, r);
      gr.addColorStop(0, 'rgba(255,240,255,.55)'); gr.addColorStop(1, 'rgba(255,240,255,0)');
      x.fillStyle = gr; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
    }
    return c;
  }

  function build() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    seed = 7;
    const th = NEBULA_THEMES[cur];
    layers = th.clouds.length ? [cloudLayer(th.clouds, 46, 1), cloudLayer(th.clouds.slice().reverse(), 30, 0.75)] : [];
    if (th.dynamic) {
      pc = document.createElement('canvas'); pc.width = Math.ceil(W / 4); pc.height = Math.ceil(H / 4);
      petals = Array.from({ length: 16 }, (_, i) => ({ a: (i / 16) * Math.PI * 2 + rnd() * 0.4, len: 0.35 + rnd() * 0.75, wid: 0.12 + rnd() * 0.2, ph: rnd() * 6, off: rnd() * 1.6, sp: 0.4 + rnd() * 0.8 }));
    } else pc = null;
    const n = Math.round(Math.min(520, (W * H) / 3200));
    stars = Array.from({ length: n }, () => ({
      x: rnd() * W, y: rnd() * H, r: rnd() < 0.08 ? 1.6 + rnd() * 1.3 : 0.5 + rnd() * 1.1,
      c: th.stars[(rnd() * th.stars.length) | 0], tw: rnd() * Math.PI * 2, sp: 0.6 + rnd() * 1.8,
    }));
  }

  // A glowing burst of light wisps around a bright core, turning slowly and shifting colour.
  function drawProjector() {
    const w = pc.width, h = pc.height, x = pc.getContext('2d'), cx = w / 2, cy = h * 0.52, R = Math.min(w, h) * 0.42;
    x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, w, h);
    x.globalCompositeOperation = 'lighter';
    const base = t / 6; // a full colour cycle takes about 30 seconds
    petals.forEach((p, i) => {
      const [r, gg, b] = cycleColor(base + p.off);
      const ang = p.a + t * 0.05 * (i % 2 ? 1 : -0.6) + Math.sin(t * 0.3 * p.sp + p.ph) * 0.18;
      const len = R * p.len * (0.8 + 0.25 * Math.sin(t * 0.5 * p.sp + p.ph));
      x.save(); x.translate(cx, cy); x.rotate(ang); x.scale(1, p.wid * 2.2);
      const gr = x.createRadialGradient(len * 0.35, 0, 0, len * 0.35, 0, len * 0.75);
      gr.addColorStop(0, `rgba(${r},${gg},${b},.55)`); gr.addColorStop(0.5, `rgba(${r},${gg},${b},.18)`); gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      x.fillStyle = gr; x.beginPath(); x.arc(len * 0.35, 0, len * 0.75, 0, Math.PI * 2); x.fill(); x.restore();
    });
    // soft halo and a bright cyan-white core
    const [hr, hg, hb] = cycleColor(base + 0.8);
    const halo = x.createRadialGradient(cx, cy, 0, cx, cy, R * 0.9);
    halo.addColorStop(0, `rgba(${hr},${hg},${hb},.35)`); halo.addColorStop(1, `rgba(${hr},${hg},${hb},0)`);
    x.fillStyle = halo; x.fillRect(0, 0, w, h);
    const core = x.createRadialGradient(cx, cy, 0, cx, cy, R * 0.22);
    core.addColorStop(0, `rgba(235,255,255,${0.75 + 0.2 * Math.sin(t * 1.3)})`); core.addColorStop(0.4, 'rgba(120,255,240,.35)'); core.addColorStop(1, 'rgba(120,255,240,0)');
    x.fillStyle = core; x.beginPath(); x.arc(cx, cy, R * 0.22, 0, Math.PI * 2); x.fill();
    g.save(); g.globalCompositeOperation = 'lighter'; g.imageSmoothingEnabled = true;
    g.drawImage(pc, 0, 0, W, H);
    g.restore();
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (now - last < 33) return; // ~30 fps is plenty for a sky
    last = now;
    if (!reduce) t += 0.033;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#05030d'; g.fillRect(0, 0, W, H);
    layers.forEach((l, i) => {
      g.save();
      g.globalAlpha = 0.78 + 0.14 * Math.sin(t * (0.25 + i * 0.1) + i);
      g.globalCompositeOperation = 'lighter';
      const dx = Math.sin(t * 0.03 + i) * W * 0.03 * (i ? -1 : 1), dy = Math.cos(t * 0.025 + i) * H * 0.025;
      g.translate(W / 2 + dx, H / 2 + dy); g.rotate(Math.sin(t * 0.01) * 0.05 * (i ? -1 : 1)); g.scale(1.12 + i * 0.1, 1.12 + i * 0.1);
      g.drawImage(l, -W / 2, -H / 2, W, H);
      g.restore();
    });
    if (pc) drawProjector();
    g.globalCompositeOperation = 'source-over';
    // the projector turns, so its stars turn slowly around the burst too
    const rot = pc && !reduce ? t * 0.012 : 0, cx = W / 2, cy = H * 0.52, cr = Math.cos(rot), sr = Math.sin(rot);
    px += (tx - px) * 0.05; py += (ty - py) * 0.05;
    for (const s of stars) {
      const a = 0.45 + 0.55 * Math.abs(Math.sin(t * s.sp + s.tw));
      const depth = s.r * 6; // bigger stars are closer, so they move more
      const dx = s.x - cx, dy = s.y - cy, x = cx + dx * cr - dy * sr - px * depth, y = cy + dx * sr + dy * cr - py * depth;
      g.globalAlpha = a; g.fillStyle = s.c;
      g.beginPath(); g.arc(x, y, s.r, 0, 6.283); g.fill();
      if (s.r > 1.5) { g.globalAlpha = a * 0.25; g.beginPath(); g.arc(x, y, s.r * 3, 0, 6.283); g.fill(); }
    }
    // shooting stars: one every few seconds
    if (!reduce && Math.random() < 0.012 && shooters.length < 2) {
      const ang = Math.PI * (0.12 + Math.random() * 0.18);
      shooters.push({ x: Math.random() * W * 0.8, y: Math.random() * H * 0.4, vx: Math.cos(ang) * 14, vy: Math.sin(ang) * 14, life: 1 });
    }
    for (let k = shooters.length - 1; k >= 0; k--) {
      const m = shooters[k]; m.x += m.vx; m.y += m.vy; m.life -= 0.025;
      if (m.life <= 0) { shooters.splice(k, 1); continue; }
      const gr = g.createLinearGradient(m.x, m.y, m.x - m.vx * 8, m.y - m.vy * 8);
      gr.addColorStop(0, `rgba(220,255,250,${m.life})`); gr.addColorStop(1, 'rgba(120,255,240,0)');
      g.strokeStyle = gr; g.lineWidth = 1.6; g.beginPath(); g.moveTo(m.x, m.y); g.lineTo(m.x - m.vx * 8, m.y - m.vy * 8); g.stroke();
    }
    g.globalAlpha = 1;
  }

  build();
  addEventListener('resize', () => { clearTimeout(build._t); build._t = setTimeout(build, 150); });
  raf = requestAnimationFrame(frame);
  return {
    setTheme(name) { if (NEBULA_THEMES[name]) { cur = name; build(); } },
    get theme() { return cur; },
    stop() { cancelAnimationFrame(raf); },
  };
}
