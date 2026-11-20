// Chat view: a clean chat app (sidebar of chats, centred conversation, rounded composer),
// with one chat for LUNA-X and a separate direct chat for every AI. Mission Control is one click away.
import { NEBULA_THEMES } from './nebula.js';

const VIEW_KEY = 'luna-view', CHAT_KEY = 'luna-active-chat', SKY_KEY = 'luna-sky', NAME_KEY = 'luna-username';
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const SUGGEST = {
  luna: [['🌙', 'Morning status report'], ['🩺', 'How is the crew? Ask SELENE'], ['🔎', 'Search the web for the latest Artemis Moon mission news'], ['🛠️', 'Help me design a smart ring sensor for astronauts']],
  any: [['💡', 'Explain how a CO₂ scrubber works, like I am 12'], ['🧮', 'Solve and explain: a rover drives 3.2 km at 0.9 km/h, how long?'], ['💻', 'Write Python that plots lunar day vs night temperature'], ['✍️', 'Write a 30-second pitch for a lunar habitat AI']],
};

export function createChatView(ctx) {
  const { $, esc, PROVIDERS, AI_ICON, isConnected, settings, aiLabel, MODELS } = ctx;
  const app = $('#chatApp');
  const chatCard = document.querySelector('.card.chat');
  const homeOfChat = chatCard.parentElement, chatNext = chatCard.nextSibling;
  const stage = $('#cvStage');
  const chats = { luna: { el: $('#msgs'), hist: null } };
  let active = store.get(CHAT_KEY, 'luna');
  let busy = false;

  /* ---------- chat list ---------- */
  const ids = () => ['luna', ...Object.keys(PROVIDERS)];
  function chatOf(id) {
    if (!chats[id]) {
      const el = document.createElement('div');
      el.className = 'msgs'; el.dataset.chat = id; el.setAttribute('aria-live', 'polite'); el.hidden = true;
      chats.luna.el.after(el);
      chats[id] = { el, hist: [] };
    }
    return chats[id];
  }
  function title(id) { return id === 'luna' ? 'LUNA-X' : id === 'claude' ? aiLabel('claude') : PROVIDERS[id].name; }
  function renderSide() {
    $('#cvChats').innerHTML = ids().map((id) => {
      const on = id === 'luna' || isConnected(settings, id);
      const p = PROVIDERS[id];
      const icon = id === 'luna' ? '<img src="assets/luna-logo.svg" alt="">' : AI_ICON[id] || '';
      const sub = id === 'luna' ? 'All AIs + habitat' : on ? (p.free ? 'connected · free' : 'connected') : 'connect';
      return `<button class="cv-chat ${id === active ? 'act' : ''} ${on ? '' : 'off'}" data-chat="${id}" style="--c:${p?.color || '#38bdf8'}"><span class="cv-ic">${icon}</span><span class="cv-nm">${esc(title(id))}<small>${sub}</small></span>${(chats[id]?.el.querySelector('.m.u')) ? '<i class="dotx"></i>' : ''}</button>`;
    }).join('');
  }

  /* ---------- greeting (empty state) ---------- */
  function renderHero() {
    const c = chatOf(active);
    const empty = !c.el.querySelector('.m.u');
    $('#cvHero').hidden = !empty;
    if (!empty) return;
    const name = store.get(NAME_KEY, '');
    const who = active === 'luna' ? 'LUNA-X' : title(active);
    $('#cvHello').innerHTML = `Hello${name ? ', ' + esc(name) : ''}`;
    $('#cvSub').textContent = active === 'luna'
      ? 'How can LUNA-X help today? I link Claude, Gemini, Llama and SELENE into one brain.'
      : isConnected(settings, active) ? `You're chatting directly with ${who}. No LUNA persona, just ${who}.` : `Connect ${who} in Connect AI to chat with it directly.`;
    const list = active === 'luna' ? SUGGEST.luna : SUGGEST.any;
    $('#cvCards').innerHTML = list.map(([ic, t]) => `<button class="cv-card"><span>${ic}</span>${esc(t)}</button>`).join('');
  }

  function renderTop() {
    const p = PROVIDERS[active];
    $('#cvTitle').innerHTML = `${active === 'luna' ? '<img src="assets/luna-logo.svg" alt="" class="cv-tlogo">' : `<span class="cv-ic" style="--c:${p.color}">${AI_ICON[active] || ''}</span>`}${esc(title(active))}`;
    const sel = $('#cvModel');
    if (active === 'claude' || active === 'luna') {
      sel.hidden = !isConnected(settings, 'claude');
      sel.innerHTML = Object.entries(MODELS).map(([m, x]) => `<option value="${m}" ${m === settings.claude.model ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
    } else sel.hidden = true;
    $('#cvLunaOnly').hidden = active !== 'luna';
    chatCard.classList.toggle('direct', active !== 'luna');
  }

  function show(id) {
    active = id; store.set(CHAT_KEY, id);
    Object.entries(chats).forEach(([k, c]) => { c.el.hidden = k !== id; });
    chatOf(id).el.hidden = false;
    renderSide(); renderTop(); renderHero();
    app.classList.remove('side-open');
    $('#input').placeholder = id === 'luna' ? 'Ask LUNA-X anything…' : `Message ${title(id)}…`;
    $('#input').focus({ preventScroll: true });
  }

  /* ---------- direct chats with one AI ---------- */
  function bubble(id, role, text) {
    const c = chatOf(id);
    const el = document.createElement('div');
    el.className = 'm ' + role;
    const p = PROVIDERS[id];
    if (role === 'a') el.innerHTML = `<div class="who"><span class="nm" style="color:${p.color}">${esc(title(id).toUpperCase())}</span> <em></em><button class="say" title="Read this reply out loud" aria-label="Read out loud">🔊</button></div><div class="tools"></div><div class="body"></div>`;
    else el.innerHTML = '<div class="body"></div>';
    el.querySelector('.body').textContent = text;
    const say = el.querySelector('.say'); if (say) say.onclick = () => ctx.speak(el._raw || el.querySelector('.body').textContent, true);
    c.el.append(el); c.el.scrollTop = 1e9; stage.scrollTop = 1e9;
    return el;
  }

  async function directSend(text, files) {
    const id = active;
    if (busy) return;
    const c = chatOf(id);
    const uel = bubble(id, 'u', text);
    if (files.length) uel.insertAdjacentHTML('beforeend', `<div class="attnote">📎 ${files.map((f) => esc(f.name)).join(', ')}</div>`);
    renderHero(); renderSide();
    const el = bubble(id, 'a', '');
    const body = el.querySelector('.body');
    if (!isConnected(settings, id)) { ctx.finishBody(el, `${title(id)} isn't connected yet. Open **Connect AI**, add a key, and come back. (LUNA-X's chat works without any key.)`); return; }
    if (ctx.crisisCheck(text)) el.insertAdjacentHTML('afterbegin', '<div class="attnote" style="color:var(--red)">If you are in danger, please reach a real person now: call or text 988 (US) or your local emergency number.</div>');
    busy = true; $('#send').disabled = true; ctx.setMood('thinking', `${title(id)} is thinking`); ctx.flash(id, 4000);
    const think = document.createElement('div'); think.className = 'thinking'; think.textContent = `${title(id)} is thinking…`; el.insertBefore(think, body);
    try {
      if (id === 'claude') {
        const blocks = files.map(ctx.claudeBlock);
        const start = c.hist.length;
        c.hist.push({ role: 'user', content: blocks.length ? [...blocks, { type: 'text', text }] : text });
        const cites = new Map(), found = new Map();
        try {
          const res = await ctx.directClaude({
            history: c.hist, session: c.session || (c.session = {}),
            cb: {
              text: (d) => { think.remove(); body.textContent += d; c.el.scrollTop = 1e9; stage.scrollTop = 1e9; },
              server: (name, label, input) => { const q = input?.query || input?.url || ''; el.querySelector('.tools').insertAdjacentHTML('beforeend', `<span class="chip ${/web/.test(name) ? 'web' : 'code'}">${name === 'web_search' ? '🔎' : name === 'web_fetch' ? '🌐' : '⌨'} ${esc(label)}${q ? ': ' + esc(String(q).slice(0, 60)) : ''}</span>`); },
              sources: (l) => l.forEach((s) => cites.set(s.url, s.title)),
              found: (l) => l.forEach((s) => found.set(s.url, s.title)),
            },
          });
          think.remove();
          if (res.refused) { c.hist.length = start; ctx.finishBody(el, "I can't help with that one."); }
          else ctx.finishBody(el, body.textContent.trim(), cites.size ? cites : new Map([...found].slice(0, 5)));
          el.querySelector('.who em').textContent = aiLabel('claude');
        } catch (err) { c.hist.length = start; throw err; }
      } else {
        const textFiles = files.filter((f) => f.kind === 'text');
        const prompt = text + textFiles.map((f) => `\n\nAttached file ${f.name}:\n\`\`\`\n${f.text}\n\`\`\``).join('');
        const bin = files.filter((f) => f.kind !== 'text').map((f) => ({ mime: f.mime, data: f.data }));
        const usable = id === 'gemini' ? bin : bin.filter((f) => f.mime.startsWith('image/'));
        const sources = new Map();
        const system = `You are ${PROVIDERS[id].name}, chatting directly with the user inside the LUNA-X app (a NASA HUNCH student project). Be genuinely helpful on any subject. Use Markdown when it helps. Today is ${new Date().toDateString()}.`;
        const args = { system, text: prompt, files: usable, history: c.hist.slice(-16), maxTokens: 4000, onSources: (l) => l.forEach((s) => sources.set(s.url, s.title)), onProgress: (p) => { think.textContent = `${title(id)}: ${p}`; } };
        let out;
        try { out = await ctx.callProvider(settings, id, { ...args, search: id === 'gemini' && settings.claude.web !== false }); }
        catch (e) { if (id !== 'gemini') throw e; out = await ctx.callProvider(settings, id, args); }
        think.remove();
        if (bin.length && !usable.length) el.querySelector('.tools').insertAdjacentHTML('beforeend', `<span class="chip err">${esc(PROVIDERS[id].name)} can't read that file type here; try Claude or Gemini</span>`);
        if (sources.size) el.querySelector('.tools').insertAdjacentHTML('beforeend', '<span class="chip web">🔎 searched the web (Google)</span>');
        c.hist.push({ role: 'user', text: prompt.slice(0, 8000) }, { role: 'assistant', text: out.trim().slice(0, 8000) });
        ctx.finishBody(el, out.trim(), sources);
        el.querySelector('.who em').textContent = PROVIDERS[id].free ? 'free' : '';
      }
      ctx.speak(el._raw);
    } catch (err) {
      think.remove();
      ctx.finishBody(el, '⚠ ' + (id === 'claude' ? ctx.friendlyError(err) : ctx.providerError(id, err)));
    } finally {
      busy = false; $('#send').disabled = false; ctx.setMood('idle'); renderSide();
    }
  }

  /* ---------- view switching ---------- */
  function setView(v) {
    const cv = v === 'chat';
    document.body.classList.toggle('cv', cv);
    store.set(VIEW_KEY, v);
    if (cv) { $('#cvConv').append(chatCard); show(active); }
    else { homeOfChat.insertBefore(chatCard, chatNext); Object.entries(chats).forEach(([k, c]) => { c.el.hidden = k !== 'luna'; }); chatCard.classList.remove('direct'); $('#input').placeholder = 'Ask LUNA-X anything…'; }
    $('#viewBtn').textContent = cv ? '🛰 Mission Control' : '💬 Chat view';
    window.dispatchEvent(new Event('resize'));
  }

  /* ---------- wiring ---------- */
  $('#cvChats').onclick = (e) => { const b = e.target.closest('[data-chat]'); if (b) show(b.dataset.chat); };
  $('#cvCards').onclick = (e) => { const b = e.target.closest('.cv-card'); if (b) { $('#input').value = b.textContent.replace(/^\S+/, '').trim(); ctx.send(); } };
  $('#cvNew').onclick = () => {
    if (active === 'luna') $('#newChat').click();
    else { const c = chatOf(active); c.hist.length = 0; c.session = {}; c.el.innerHTML = ''; }
    renderHero(); renderSide();
  };
  $('#cvMenu').onclick = () => app.classList.toggle('side-open');
  $('#cvScrim').onclick = () => app.classList.remove('side-open');
  $('#cvMission').onclick = () => setView('mission');
  $('#viewBtn').onclick = () => setView(document.body.classList.contains('cv') ? 'mission' : 'chat');
  $('#cvConnect').onclick = () => { setView('mission'); $('#btnConnect').click(); };
  $('#cvWorkspace').onclick = () => { setView('mission'); $('[data-t=workspace]').click(); $('#t-workspace').scrollIntoView({ behavior: 'smooth' }); };
  $('#cvOpts').onclick = () => chatCard.classList.toggle('show-opts');
  $('#cvModel').onchange = (e) => { settings.claude.model = e.target.value; ctx.saveSettings(settings); ctx.rebuildClient(); renderSide(); renderTop(); };
  $('#cvName').onclick = () => { const n = prompt('What should LUNA-X call you?', store.get(NAME_KEY, '')); if (n != null) { store.set(NAME_KEY, n.trim().slice(0, 40)); renderHero(); } };
  $('#cvSky').innerHTML = Object.entries(NEBULA_THEMES).map(([k, t]) => `<option value="${k}">${t.label} sky</option>`).join('');
  $('#cvSky').value = ctx.nebula.theme;
  $('#cvSky').onchange = (e) => { ctx.nebula.setTheme(e.target.value); store.set(SKY_KEY, e.target.value); };

  setView(store.get(VIEW_KEY, 'chat'));
  return {
    active: () => (document.body.classList.contains('cv') ? active : 'luna'),
    directSend,
    refresh() { renderSide(); renderTop(); renderHero(); },
  };
}
