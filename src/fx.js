// LUNA-X micro-interactions: ripples, magnetic buttons, card tilt and cursor glow,
// a sliding neon tab indicator, count-up habitat numbers, the send "launch", and
// sound-ready UI events. Everything is event-delegated, GPU-friendly (transform/opacity)
// and switched off when the system asks for reduced motion.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(pointer: fine)').matches;

// Sound-ready: other code can listen for these and play a sound. Nothing plays by default.
const ui = (type, el) => window.dispatchEvent(new CustomEvent('luna:ui', { detail: { type, el } }));

const CLICKABLE = '.btn, .iconbtn, .quick button, .cv-card, .cv-chat, .cv-new, .ctl button, .tabs button, .agent, #send';
const TILT = '.tile, .cv-card, .agent, .prov, .holo, .crew > div, .wd, .drill, .aip';
const MAGNET = '.btn.pri, #send, .cv-new, #btnConnect, #viewBtn';

export function initFx() {
  document.documentElement.classList.toggle('fx', !reduce);

  /* ---------- ripple on click ---------- */
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest(CLICKABLE);
    if (!el || el.disabled) return;
    ui('click', el);
    if (reduce) return;
    const r = el.getBoundingClientRect();
    const d = Math.max(r.width, r.height) * 2.2;
    const s = document.createElement('span');
    s.className = 'fx-ripple';
    s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.classList.add('fx-clip');
    el.append(s);
    setTimeout(() => s.remove(), 650);
  }, { passive: true });

  if (!reduce && fine) {
    /* ---------- cursor glow, card tilt, magnetic buttons ---------- */
    let tiltEl = null, magEl = null, raf = 0, last = null;
    const frame = () => {
      raf = 0;
      const e = last; if (!e) return;
      const t = e.target.closest?.(TILT);
      if (tiltEl && tiltEl !== t) { tiltEl.style.transform = ''; tiltEl.classList.remove('fx-hot'); }
      tiltEl = t;
      if (t) {
        const r = t.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        t.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`); t.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
        t.classList.add('fx-hot');
        t.style.transform = `perspective(700px) rotateX(${((0.5 - py) * 4).toFixed(2)}deg) rotateY(${((px - 0.5) * 4).toFixed(2)}deg) translateY(-3px)`;
      }
      const m = e.target.closest?.(MAGNET);
      if (magEl && magEl !== m) magEl.style.translate = '';
      magEl = m;
      if (m && !m.disabled) {
        const r = m.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        m.style.translate = `${(dx * 0.18).toFixed(1)}px ${(dy * 0.25).toFixed(1)}px`;
      }
      document.documentElement.style.setProperty('--cx', e.clientX + 'px');
      document.documentElement.style.setProperty('--cy', e.clientY + 'px');
    };
    document.addEventListener('pointermove', (e) => { last = e; if (!raf) raf = requestAnimationFrame(frame); }, { passive: true });
    document.addEventListener('pointerleave', () => { if (tiltEl) tiltEl.style.transform = ''; if (magEl) magEl.style.translate = ''; });

    /* ---------- hover sounds hook ---------- */
    let lastHover = null;
    document.addEventListener('pointerover', (e) => { const el = e.target.closest(CLICKABLE); if (el && el !== lastHover) { lastHover = el; ui('hover', el); } }, { passive: true });
  }

  /* ---------- sliding neon tab indicator ---------- */
  const tabs = document.getElementById('tabs');
  if (tabs) {
    const bar = document.createElement('span'); bar.className = 'fx-tabbar'; tabs.append(bar);
    const place = () => {
      const a = tabs.querySelector('button.act'); if (!a) return;
      bar.style.width = a.offsetWidth + 'px';
      bar.style.transform = `translateX(${a.offsetLeft}px)`;
    };
    new MutationObserver(place).observe(tabs, { subtree: true, attributes: true, attributeFilter: ['class'] });
    addEventListener('resize', place); setTimeout(place, 100);
  }

  /* ---------- habitat numbers count up on hover ---------- */
  let hoveredTile = null;
  document.addEventListener('pointermove', (e) => { if (!e.target.closest?.('.tile')) hoveredTile = null; }, { passive: true });
  document.addEventListener('pointerenter', (e) => {
    if (!e.target.classList?.contains('tile')) return; // only when the pointer enters the card itself
    // The habitat redraws every simulated minute, and Chrome re-sends "enter" for the redrawn card under a
    // still mouse, so count once per hover of a card (by its label) instead of on every redraw.
    const label = e.target.querySelector('.l')?.textContent || '';
    if (label === hoveredTile) return;
    hoveredTile = label;
    const v = e.target.querySelector('.v');
    if (!v || reduce || v._counting) return;
    const node = v.firstChild; if (!node || node.nodeType !== 3) return;
    const m = node.textContent.match(/^(-?\d+(?:\.\d+)?)(.*)$/s); if (!m) return;
    const target = parseFloat(m[1]), dec = (m[1].split('.')[1] || '').length, rest = m[2];
    v._counting = true;
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.max(0, Math.min(1, (now - t0) / 650)), ease = 1 - Math.pow(1 - k, 3);
      if (!node.isConnected) { v._counting = false; return; } // the habitat re-rendered: stop
      node.textContent = (target * ease).toFixed(dec) + rest;
      if (k < 1) requestAnimationFrame(step); else { node.textContent = m[1] + rest; v._counting = false; }
    };
    requestAnimationFrame(step);
  }, true);

  /* ---------- section fade-in on scroll ---------- */
  if (!reduce && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('fx-in'); io.unobserve(x.target); } }), { threshold: 0.08 });
    document.querySelectorAll('main > section > .card, main > section.card, .timeline').forEach((el) => { el.classList.add('fx-up'); io.observe(el); });
  }
}

// Send button: a short "energy charge" then a rocket launch.
export function launch(btn) {
  if (reduce || !btn) return;
  btn.classList.remove('fx-launch'); void btn.offsetWidth; btn.classList.add('fx-launch');
  setTimeout(() => btn.classList.remove('fx-launch'), 900);
  ui('send', btn);
}
