// LUNA-X Cognitive Core: a procedurally drawn holographic neural brain on a canvas.
// Beams from AI providers and habitat systems light up only when those links are actually connected/active.

export function createCore(canvas) {
  const g = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, dpr = 1, t = 0, raf = 0;
  const nodes = [], links = [], sparks = [];
  // satellites around the brain: [id, label, angle, ring, color]
  let sats = [];
  const status = {}; // id -> 'off' | 'on' | 'busy' | 'error'
  const pulses = []; // {sat, p, color}
  let mood = 'idle'; // idle | listening | thinking | speaking
  let charge = 0, shown = 0, chargeLabel = ''; // super-brain charge: grows with every AI and server connection

  // Brain seen from the side (front = left): cerebrum, temporal lobe, cerebellum and brainstem.
  // Gyri are drawn as wavy contour lines; neurons sit along them and fire along the folds.
  // cerebrum profile (front = left), normalised units
  const OUTLINE = [[-0.93, 0.1], [-1.0, -0.12], [-0.93, -0.4], [-0.7, -0.6], [-0.36, -0.72], [0.02, -0.74], [0.38, -0.66], [0.68, -0.5], [0.9, -0.27], [0.99, -0.02], [0.93, 0.17],
    [0.76, 0.25], [0.5, 0.22], [0.26, 0.28], [0.06, 0.4], [-0.22, 0.45], [-0.48, 0.39], [-0.64, 0.24], [-0.8, 0.17]];
  function inPoly(x, y, P) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }
  const inCerebrum = (x, y) => inPoly(x, y, OUTLINE);
  const inCerebellum = (x, y) => ((x - 0.62) / 0.3) ** 2 + ((y - 0.39) / 0.16) ** 2 < 1 && !inCerebrum(x, y);
  const curves = [];
  function build() {
    nodes.length = 0; links.length = 0; curves.length = 0;
    const push = (x, y, z, cb) => { nodes.push({ x, y, z, f: Math.random() * 6.28, hemi: z > 0 ? 1 : 0, cb }); return nodes.length - 1; };
    // outline
    const ring = []; const n = OUTLINE.length;
    for (let i = 0; i < n; i++) { const [x0, y0] = OUTLINE[i], [x1, y1] = OUTLINE[(i + 1) % n]; for (let k = 0; k < 6; k++) ring.push(push(x0 + ((x1 - x0) * k) / 6, y0 + ((y1 - y0) * k) / 6, 0, false)); }
    curves.push([...ring, ring[0]]);
    // meandering gyri: random walks that turn slowly, like cortical folds
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let g2 = 0; g2 < 70; g2++) {
      let x, y; do { x = rnd() * 2 - 1; y = rnd() * 1.2 - 0.75; } while (!inCerebrum(x, y));
      let h = rnd() * 6.28, turn = (rnd() - 0.5) * 0.5; const cur = []; const z = rnd() * 1.4 - 0.7;
      for (let s = 0; s < 34; s++) {
        if (!inCerebrum(x, y)) break;
        cur.push(push(x, y, z, false));
        turn += (rnd() - 0.5) * 0.35; turn = Math.max(-0.55, Math.min(0.55, turn)); h += turn;
        x += Math.cos(h) * 0.028; y += Math.sin(h) * 0.028;
      }
      if (cur.length > 3) curves.push(cur);
    }
    // Sylvian fissure and central sulcus
    const line = (pts) => { const c = []; for (let k = 0; k < pts.length - 1; k++) for (let s = 0; s < 8; s++) { const [a, b] = [pts[k], pts[k + 1]]; c.push(push(a[0] + ((b[0] - a[0]) * s) / 8, a[1] + ((b[1] - a[1]) * s) / 8, 0.1, false)); } curves.push(c); };
    line([[-0.62, 0.2], [-0.3, 0.12], [0.05, 0.04], [0.35, -0.08]]);
    line([[0.12, -0.72], [0.06, -0.45], [0.0, -0.2], [-0.05, 0.03]]);
    // cerebellum folia
    for (let k = 0; k < 6; k++) {
      const c = [];
      for (let x = 0.33; x <= 0.92; x += 0.024) { const y = 0.26 + k * 0.045 + 0.01 * Math.sin(x * 70); if (inCerebellum(x, y)) c.push(push(x, y, -0.2, true)); }
      if (c.length > 2) curves.push(c);
    }
    for (const c of curves) for (let i = 1; i < c.length; i++) links.push([c[i - 1], c[i]]);
    // a few cross-connections between neighbouring folds (white-matter tracts)
    for (let k = 0; k < 160; k++) {
      const a = (Math.random() * nodes.length) | 0;
      let best = -1, bd = 1;
      for (let j = 0; j < nodes.length; j += 3) { const d = (nodes[a].x - nodes[j].x) ** 2 + (nodes[a].y - nodes[j].y) ** 2; if (d > 0.004 && d < bd) { bd = d; best = j; } }
      if (best >= 0 && bd < 0.02) links.push([a, best]);
    }
  }
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function setSatellites(list) { sats = list; }

  function frame() {
    t += reduce ? 0 : 0.016;
    g.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H * 0.55, S = Math.min(W * 0.25, H * 0.34);
    const spin = Math.sin(t * 0.25) * 0.28;
    shown += (charge - shown) * 0.04;
    const speed = (mood === 'thinking' ? 3 : mood === 'speaking' ? 2 : mood === 'listening' ? 1.6 : 1) * (1 + shown * 0.8);

    // lunar horizon
    const hg = g.createLinearGradient(0, H * 0.8, 0, H);
    hg.addColorStop(0, 'rgba(148,163,196,.18)'); hg.addColorStop(1, 'rgba(20,28,52,.0)');
    g.fillStyle = hg; g.beginPath(); g.moveTo(0, H); g.quadraticCurveTo(W / 2, H * 0.74, W, H); g.fill();
    g.strokeStyle = 'rgba(56,189,248,.12)'; g.lineWidth = 1;
    for (let i = 1; i < 6; i++) { g.beginPath(); g.ellipse(cx, H * 0.95, W * 0.12 * i, H * 0.025 * i, 0, Math.PI, 2 * Math.PI); g.stroke(); }

    // glow
    const glow = g.createRadialGradient(cx, cy, S * 0.1, cx, cy, S * (1.6 + shown * 0.6));
    glow.addColorStop(0, `rgba(56,189,248,${0.18 + shown * 0.3 + 0.06 * Math.sin(t * 2 * speed)})`); glow.addColorStop(0.5, `rgba(167,139,250,${shown * 0.12})`); glow.addColorStop(1, 'rgba(56,189,248,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);

    // rotating rings (one per AI system)
    const ringIds = sats.filter((s) => s.ai);
    ringIds.forEach((s, i) => {
      const on = status[s.id] && status[s.id] !== 'off';
      g.save(); g.translate(cx, cy); g.rotate(t * (0.15 + i * 0.05) * (i % 2 ? -1 : 1));
      g.strokeStyle = on ? s.color + 'aa' : 'rgba(147,164,200,.12)'; g.lineWidth = on ? 1.6 : 1;
      g.setLineDash([4 + i * 2, 10 + i * 3]);
      g.beginPath(); g.ellipse(0, 0, S * (1.25 + i * 0.09), S * (0.42 + i * 0.05), 0, 0, Math.PI * 2); g.stroke();
      g.restore();
    });
    g.setLineDash([]);

    // project brain nodes with a slow 3D yaw
    const P = nodes.map((n) => {
      const x = n.x * Math.cos(spin) - n.z * 0.35 * Math.sin(spin);
      const z = n.z * Math.cos(spin) + n.x * Math.sin(spin);
      return { x: cx + x * S, y: cy + n.y * S, z, n };
    });
    // brainstem
    g.strokeStyle = 'rgba(125,211,252,.35)'; g.lineWidth = 1;
    for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(cx + (0.22 + k * 0.025) * S, cy + 0.34 * S); g.quadraticCurveTo(cx + (0.3 + k * 0.02) * S, cy + 0.6 * S, cx + (0.26 + k * 0.022) * S, cy + 0.82 * S); g.stroke(); }
    g.lineWidth = 0.9;
    for (const [i, j] of links) {
      const a = P[i], b = P[j];
      const fire = 0.5 + 0.5 * Math.sin(t * 3 * speed + a.n.f);
      g.strokeStyle = `rgba(${a.n.hemi ? '125,211,252' : '196,181,253'},${0.1 + shown * 0.12 + (0.3 + shown * 0.25) * fire * (0.6 + 0.4 * (a.z + 1) / 2)})`;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      const fire = 0.5 + 0.5 * Math.sin(t * 4 * speed + p.n.f * 3);
      if (i % (shown > 0.6 ? 2 : 4) && fire < 0.92 - shown * 0.12) continue; // draw a quarter of the neurons, plus any that are firing
      const r = 0.7 + 1.3 * fire * ((p.z + 1.3) / 2.3);
      g.fillStyle = fire > 0.93 ? '#ffffff' : p.n.hemi ? 'rgba(186,230,253,.9)' : 'rgba(221,214,254,.9)';
      g.beginPath(); g.arc(p.x, p.y, r, 0, 6.283); g.fill();
    }
    // synapse sparks
    if (!reduce && Math.random() < 0.5 * speed && links.length) sparks.push({ l: links[(Math.random() * links.length) | 0], p: 0 });
    for (let k = sparks.length - 1; k >= 0; k--) {
      const s = sparks[k]; s.p += 0.05 * speed;
      if (s.p >= 1) { sparks.splice(k, 1); continue; }
      const a = P[s.l[0]], b = P[s.l[1]];
      g.fillStyle = '#e0f2fe'; g.beginPath(); g.arc(a.x + (b.x - a.x) * s.p, a.y + (b.y - a.y) * s.p, 1.8, 0, 6.283); g.fill();
    }

    // charge ring: how much of LUNA-X's network is connected
    if (shown > 0.01) {
      const rr = S * 1.12;
      g.lineWidth = 3; g.strokeStyle = 'rgba(147,164,200,.12)'; g.beginPath(); g.arc(cx, cy, rr, 0, 6.283); g.stroke();
      const cg = g.createLinearGradient(cx - rr, cy, cx + rr, cy); cg.addColorStop(0, '#38bdf8'); cg.addColorStop(0.5, '#a78bfa'); cg.addColorStop(1, '#f472b6');
      g.strokeStyle = cg; g.lineWidth = 3; g.shadowColor = '#a78bfa'; g.shadowBlur = 8 + shown * 14;
      g.beginPath(); g.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + 6.283 * shown); g.stroke(); g.shadowBlur = 0;
      g.font = `700 ${W < 520 ? 9 : 10.5}px 'JetBrains Mono', monospace`; g.fillStyle = 'rgba(230,241,255,.85)'; g.textAlign = 'right';
      g.fillText(`CHARGE ${Math.round(shown * 100)}%${chargeLabel ? ' · ' + chargeLabel : ''}`, W - 14, H - 14); // corner, clear of the satellites
    }

    // satellites + beams
    const R = Math.min(W * 0.43, S * 1.9);
    sats.forEach((s) => {
      const ang = s.angle + (reduce ? 0 : t * 0.04);
      const sx = cx + Math.cos(ang) * R, sy = Math.max(84, cy + Math.sin(ang) * Math.min(R * 0.6, H * 0.4));
      const st = status[s.id] || 'off';
      const on = st !== 'off';
      if (on) {
        const lg = g.createLinearGradient(sx, sy, cx, cy);
        lg.addColorStop(0, s.color + (st === 'busy' ? 'ff' : '99')); lg.addColorStop(1, s.color + '00');
        g.strokeStyle = lg; g.lineWidth = st === 'busy' ? 2.6 : 1.4;
        g.beginPath(); g.moveTo(sx, sy); g.lineTo(cx, cy); g.stroke();
        if (!reduce && Math.random() < (st === 'busy' ? 0.35 : 0.05)) pulses.push({ s, p: 0, sx, sy });
      }
      g.fillStyle = 'rgba(5,8,22,.85)'; g.strokeStyle = st === 'error' ? '#f87171' : on ? s.color : 'rgba(147,164,200,.35)'; g.lineWidth = 1.4;
      g.beginPath(); g.arc(sx, sy, s.ai ? 7 : 5, 0, 6.283); g.fill(); g.stroke();
      if (on) { g.fillStyle = s.color; g.beginPath(); g.arc(sx, sy, s.ai ? 3 : 2.2, 0, 6.283); g.fill(); }
      g.font = `${s.ai ? 600 : 500} ${W < 520 ? 9.5 : 11}px Inter, system-ui, sans-serif`;
      g.fillStyle = on ? '#e6f1ff' : 'rgba(147,164,200,.6)'; g.textAlign = sx < cx - 4 ? 'right' : sx > cx + 4 ? 'left' : 'center';
      g.fillText(s.label, sx + (sx < cx - 4 ? -11 : sx > cx + 4 ? 11 : 0), sy + 3.5);
    });
    for (let k = pulses.length - 1; k >= 0; k--) {
      const p = pulses[k]; p.p += 0.03;
      if (p.p >= 1) { pulses.splice(k, 1); continue; }
      g.fillStyle = p.s.color; g.beginPath(); g.arc(p.sx + (cx - p.sx) * p.p, p.sy + (cy - p.sy) * p.p, 2.4, 0, 6.283); g.fill();
    }
    raf = requestAnimationFrame(frame);
  }

  build(); resize();
  new ResizeObserver(resize).observe(canvas);
  frame();
  return {
    setSatellites,
    setStatus(id, st) { status[id] = st; },
    setMood(m) { mood = m; },
    setCharge(v, label = '') { charge = Math.max(0, Math.min(1, v)); chargeLabel = label; },
    stop() { cancelAnimationFrame(raf); },
  };
}
