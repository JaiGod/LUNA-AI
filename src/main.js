import {
  createSim, tick, save, onChange, emit, wellbeing, eegState, clock, crewById, resetAll, learnLog, bumpSkill, recordIntervention,
  LIMITS, LIGHTING, SKILLS, DRILLS, ATTACKS,
} from './sim.js';
import { makeExecutor } from './tools.js';
import { makeClient, runTurn, directClaude, structured, offlineReply, crisisCheck, friendlyError, MODELS, SYSTEM, CLAUDE_TAKEOVER } from './brain.js';
import { md } from './md.js';
import { createNebula } from './nebula.js';
import { createChatView } from './chatview.js';
import { onUsage, getUsage, resetUsage, fmtTokens, fmtUSD, DASHBOARDS, claudeUsage } from './usage.js';
import { ws, saveWs, onWorkspace, AGENTS, remember, forget, addProject, activeProject, wsContext, wsSignature, routeTask } from './workspace.js';
import { createVision, loadDetector, detectLive, grabFrame, deepScan, faceCheckin, voiceMood, inspectPanel, formCheck, pitchOf } from './vision.js';
import { PROVIDERS, loadSettings, saveSettings, isConnected, testProvider, callProvider, verifyDetections, verifiersOnline, freeChatOrder, onCollab, collab, chromeAvailable } from './orchestrator.js';
import { createCore } from './core.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const sim = createSim();
const vision = createVision();
let settings = loadSettings();
let history = [];          // Claude conversation, append-only
let pendingNotes = [];
let cv = null;            // chat view (sidebar + separate chats per AI)
const claudeSession = {};   // code-execution container reused across turns
const freeHistory = [];    // conversation memory for the free AIs
let rollbackTo = null;
let lastWsSig = '';      // workspace context is re-sent to Claude only when it changes     // events LUNA should know about, sent with the next user message
let busy = false, abortCtl = null;

/* ---------- nebula sky (the LUNA star-projector look) ---------- */
let skyTheme = 'projector';
try { skyTheme = localStorage.getItem('luna-sky') || 'projector'; } catch { /* ignore */ }
const nebula = createNebula($('#stars'), skyTheme);

/* ---------- cognitive core ---------- */
const core = createCore($('#core'));
const SATS = [
  { id: 'claude', label: 'Claude', ai: true, color: '#e8956f' }, { id: 'openai', label: 'OpenAI', ai: true, color: '#10a37f' },
  { id: 'gemini', label: 'Gemini', ai: true, color: '#60a5fa' }, { id: 'meta', label: 'Meta AI', ai: true, color: '#a78bfa' },
  { id: 'groq', label: 'Groq', ai: true, color: '#f97362' }, { id: 'chrome', label: 'Gemini Nano', ai: true, color: '#34d399' }, { id: 'webllm', label: 'WebLLM', ai: true, color: '#fbbf24' }, { id: 'copilot', label: 'Copilot', ai: true, color: '#7c8cff' },
  { id: 'selene', label: 'SELENE', color: '#f472b6' }, { id: 'habitat', label: 'Habitat systems', color: '#38bdf8' }, { id: 'sensors', label: 'Env. sensors', color: '#38bdf8' },
  { id: 'medical', label: 'Medical', color: '#f472b6' }, { id: 'eva', label: 'EVA suits', color: '#94a3b8' }, { id: 'rovers', label: 'Rovers', color: '#94a3b8' },
  { id: 'mission', label: 'Mission control', color: '#93c5fd' }, { id: 'lash', label: 'LASH-Net', color: '#fb923c' },
];
core.setSatellites(SATS.map((s, i) => ({ ...s, angle: (i / SATS.length) * Math.PI * 2 - Math.PI / 2 })));
const TOOL_SAT = { ask_selene: 'selene', get_habitat_status: 'habitat', adjust_habitat: 'habitat', get_forecast: 'sensors', eva_readiness: 'eva', escalate_to_human: 'medical', network_defense: 'lash', run_drill: 'mission', get_vision_detections: 'selene', schedule_event: 'mission', log_entry: 'selene', make_offer: 'selene', play_media: 'habitat', recall_learning: 'mission' };
function flash(id, ms = 1600) { core.setStatus(id, 'busy'); setTimeout(() => refreshCoreStatus(), ms); }
function refreshCoreStatus() {
  for (const id of Object.keys(PROVIDERS)) core.setStatus(id, isConnected(settings, id) && !(id === 'claude' && control === 'luna') ? 'on' : 'off');
  for (const id of ['selene', 'habitat', 'sensors', 'medical', 'eva', 'rovers', 'lash']) core.setStatus(id, 'on');
  core.setStatus('mission', sim.sensors.earth_link === 'up' ? 'on' : 'error');
  // super-brain charge: every connected AI and server connection adds power
  const ais = Object.keys(PROVIDERS).filter((id) => isConnected(settings, id) && !(id === 'claude' && control === 'luna')).length;
  const cOn = isConnected(settings, 'claude') && control !== 'luna';
  const servers = [cOn && settings.claude.web !== false, cOn && settings.claude.web !== false, cOn && settings.claude.code !== false, !!settings.claude.proxy, sim.sensors.earth_link === 'up', true /* SELENE link */].filter(Boolean).length;
  core.setCharge((ais + servers) / (Object.keys(PROVIDERS).length + 6), `${ais} AI · ${servers} servers`);
}
function setMood(m, label) { core.setMood(m); $('#coreState').textContent = `LUNA-X · ${label || m}`; }

/* ---------- timeline + collaboration ---------- */
function timeline(cls, text) {
  const el = document.createElement('div');
  el.className = 'ev ' + cls; el.innerHTML = `<div class="tm">${now()}</div>${esc(text)}`;
  $('#timeline').prepend(el);
  while ($('#timeline').children.length > 60) $('#timeline').lastChild.remove();
}
onCollab((e) => {
  const name = e.provider === 'lunax' ? 'LUNA-X' : PROVIDERS[e.provider]?.name || e.provider;
  const line = document.createElement('div');
  line.textContent = `${now()}  ${name.toUpperCase()} → ${e.text}`;
  line.style.color = e.state === 'error' ? 'var(--red)' : e.state === 'working' ? 'var(--amber)' : 'var(--mut)';
  $('#collab').prepend(line);
  while ($('#collab').children.length > 40) $('#collab').lastChild.remove();
  if (e.state !== 'working') timeline('ai', `${name}: ${e.text}`);
  if (e.provider !== 'lunax') { e.state === 'working' ? core.setStatus(e.provider, 'busy') : e.state === 'error' ? core.setStatus(e.provider, 'error') : refreshCoreStatus(); }
});

function toast(msg) {
  const el = document.createElement('div'); el.className = 'toast'; el.innerHTML = `<p style="margin:0">${esc(msg)}</p>`;
  $('#toasts').append(el); setTimeout(() => el.remove(), 5000);
}

/* ---------- UI hooks used by tools ---------- */
const ui = {
  activity(tier, text) { timeline('t' + tier, text); },
  offer(o) {
    const el = document.createElement('div'); el.className = 'toast';
    el.innerHTML = `<b>LUNA offers ${esc(o.name)}: ${esc(o.offer.replace(/_/g, ' '))}</b><p>${esc(o.message)}</p><div class="row"><button class="btn sm pri">Accept</button><button class="btn sm">Not now</button></div>`;
    const [yes, no] = el.querySelectorAll('button');
    const answer = (ok) => {
      o.status = ok ? 'accepted' : 'declined';
      recordIntervention(sim, o.crew, o.offer, ok);
      pendingNotes.push(`${o.name} ${o.status} the offer "${o.offer}".`);
      timeline('t2', `${o.name} ${o.status} ${o.offer.replace(/_/g, ' ')}`);
      if (ok) { if (o.offer === 'breathing_exercise') breathing(); if (o.offer === 'earth_message') playEarth(o.crew); if (o.offer === 'music') sound('space music'); }
      el.remove(); renderTraining();
    };
    yes.onclick = () => answer(true); no.onclick = () => answer(false);
    $('#toasts').append(el);
    setTimeout(() => el.isConnected && el.remove(), 90000);
  },
  escalate(e) {
    const b = $('#banner');
    b.innerHTML = e.needs_consent
      ? `<h4>LUNA is asking first</h4><p>${esc(e.crew)}, I've noticed some low days. May I let the Chief Medical Officer and the psychologist know, so someone can check in with you?</p><div class="row"><button class="btn sm pri" id="cYes">Yes, tell them</button><button class="btn sm" id="cNo">Not now</button></div>`
      : `<h4>${esc(e.severity)} ALERT · human in the loop</h4><p><b>${esc(e.crew)}</b>: ${esc(e.reason)}</p><p>Simulated: the person is told first, then the Chief Medical Officer and the Commander. No real people were contacted.</p><p><b>If you are in danger in real life, call or text 988 (US), or your local emergency number.</b></p><div class="row"><button class="btn sm" id="cOk">Acknowledge</button></div>`;
    b.style.display = 'block';
    b.querySelectorAll('button').forEach((btn) => btn.onclick = () => {
      if (btn.id === 'cYes' || btn.id === 'cNo') pendingNotes.push(`${e.crew} ${btn.id === 'cYes' ? 'agreed' : 'declined'} to involve the psychologist.`);
      b.style.display = 'none';
    });
  },
  drill(d) { renderDrillScore(d); },
  media(m) {
    if (m.kind === 'breathing') breathing();
    else if (m.kind === 'earth_message') showEarth(m.message);
    else if (m.kind === 'space_music') sound('space music');
    else if (m.kind === 'stop') sound('off');
  },
  network(n) { $('#netLog').insertAdjacentHTML('afterbegin', `<div>${now()}  ${esc(n.action)} → ${esc(n.target)} · ${esc(n.reason)}</div>`); scoreNetwork(n); renderLash(); },
};
const execute = makeExecutor(sim, ui, vision);

/* ---------- AI access ---------- */
let client = null;
// Who is in control: 'team' (LUNA-X with Claude as its brain), 'claude' (Claude takes over), 'luna' (LUNA solo, Claude off)
let control = 'team';
try { control = localStorage.getItem('luna-control-v1') || 'team'; } catch { /* ignore */ }
if (!['team', 'claude', 'luna'].includes(control)) control = 'team';
const claudeOn = () => !!client && control !== 'luna';
function rebuildClient() {
  const c = settings.claude;
  client = isConnected(settings, 'claude') ? makeClient({ apiKey: c.key, proxyUrl: c.proxy }) : null;
  const free = Object.keys(PROVIDERS).filter((id) => id !== 'claude' && isConnected(settings, id));
  $('#pClaude').className = 'pill ' + (client ? 'on' : '');
  $('#pClaude').lastChild.textContent = client && control === 'luna' ? 'Claude: standby' : client ? `Claude: ${(MODELS[c.model]?.label.split(' (')[0] || c.model).replace(/^Claude /, '')}` : 'Claude: off';
  $('#pFree').className = 'pill ' + (free.length ? 'on' : '');
  $('#pFree').lastChild.textContent = `Other AIs: ${free.length}`;
  refreshCoreStatus();
  renderBadges();
  cv?.refresh();
}
// Connected AIs appear in the header; ✓ once a link test has passed this session
const verified = new Set();
function aiLabel(id) { return id === 'claude' ? (MODELS[settings.claude.model]?.label.split(' (')[0] || 'Claude') : PROVIDERS[id].name; }
function renderBadges() {
  const ids = Object.keys(PROVIDERS).filter((id) => isConnected(settings, id));
  // LUNA logo + a linked icon for every connected AI (dual link, triple link…)
  const tags = ['', 'LINKED', 'DUAL LINK', 'TRIPLE LINK', 'QUAD LINK'];
  const standby = (id) => id === 'claude' && control === 'luna';
  $('#linkIcons').innerHTML = ids.map((id) => `<span class="lk ${verified.has(id) && !standby(id) ? '' : 'untested'}" style="--c:${PROVIDERS[id].color}" title="LUNA-X ⟷ ${esc(aiLabel(id))}${verified.has(id) ? ' (link tested ✓)' : ' (not tested yet)'}"><b class="wire"></b><span class="aiico">${AI_ICON[id] || ''}</span></span>`).join('')
    + (control === 'claude' && client ? '<span class="lktag" style="color:#d97757;border-color:#d97757">CLAUDE IN CONTROL</span>'
      : control === 'luna' ? '<span class="lktag">LUNA SOLO</span>'
      : ids.length ? `<span class="lktag">LUNA × ${ids.length > 4 ? ids.length + '-AI LINK' : tags[ids.length]}</span>` : '');
  $('#aiBadges').innerHTML = ids.map((id) => `<span class="aib ${verified.has(id) ? '' : 'untested'}" style="--c:${PROVIDERS[id].color}" data-ai="${id}" title="${esc(PROVIDERS[id].role)}${verified.has(id) ? ' · link tested ✓' : ' · not tested yet (AI Network → Test link)'}"><i></i>${esc(aiLabel(id))}${verified.has(id) ? ' ✓' : ''}</span>`).join('');
}
// Simple original glyphs in each provider's colour (not official logos)
const AI_ICON = {
  claude: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">' + Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; return `<line x1="${(12 + 3 * Math.cos(a)).toFixed(1)}" y1="${(12 + 3 * Math.sin(a)).toFixed(1)}" x2="${(12 + 10 * Math.cos(a)).toFixed(1)}" y2="${(12 + 10 * Math.sin(a)).toFixed(1)}"/>`; }).join('') + '</svg>',
  gemini: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5C12.6 7.4 16.6 11.4 22.5 12 16.6 12.6 12.6 16.6 12 22.5 11.4 16.6 7.4 12.6 1.5 12 7.4 11.4 11.4 7.4 12 1.5Z"/></svg>',
  openai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M12 2.5 20.2 7.2v9.6L12 21.5 3.8 16.8V7.2Z"/><circle cx="12" cy="12" r="3"/></svg>',
  meta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 12c-2.2-3.4-4-5-6-5-2.3 0-3.5 2.5-3.5 5s1.2 5 3.5 5c2 0 3.8-1.6 6-5Zm0 0c2.2-3.4 4-5 6-5 2.3 0 3.5 2.5 3.5 5s-1.2 5-3.5 5c-2 0-3.8-1.6-6-5Z"/></svg>',
  groq: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 1.5 4 13.5h6.5L9.5 22.5 20 9.5h-6.5Z"/></svg>',
  chrome: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2.5v3M15 2.5v3M9 18.5v3M15 18.5v3M2.5 9h3M2.5 15h3M18.5 9h3M18.5 15h3"/></svg>',
  webllm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M12 2.5 21 7.5v9L12 21.5 3 16.5v-9Z"/><path d="M3 7.5 12 12.5 21 7.5M12 12.5v9"/></svg>',
  copilot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13c0-4.4 3.6-8 8-8s8 3.6 8 8v3.5c0 1.4-1.1 2.5-2.5 2.5h-11C5.1 19 4 17.9 4 16.5Z"/><circle cx="9" cy="13.5" r="2"/><circle cx="15" cy="13.5" r="2"/><path d="M12 5V2.5"/></svg>',
};
function setVia(el, id, label) {
  const em = el.querySelector('.who em'), c = PROVIDERS[id]?.color || 'var(--dim)';
  em.innerHTML = `<span class="ico" style="color:${c}">${AI_ICON[id] || ''}</span>${esc(label)}`; em.style.color = c;
}
const JOIN_LINES = {
  claude: 'is connected. I am now LUNA-X’s reasoning brain: conversation, habitat tools, safety review and SELENE deep scans.',
  gemini: 'is connected. I will double-check SELENE Vision detections and chat when Claude is offline.',
  openai: 'is connected. I will add scientific and engineering analysis to SELENE Vision detections.',
  meta: 'is connected. I will handle crew conversation for free and cross-check detections.',
  groq: 'is connected. Fast free Llama is ready for quick checks and conversation.',
  chrome: 'is connected, running on this device with no key. I can chat even without internet.',
  webllm: 'is connected, running on your GPU with no key.',
};
function announceAI(id) {
  if (verified.has(id)) return;
  verified.add(id); renderBadges();
  const text = `${aiLabel(id)} ${JOIN_LINES[id] || 'is connected.'}`;
  const el = addMsg('a', text, '');
  el.classList.add('join'); el.style.setProperty('--c', PROVIDERS[id].color);
  setVia(el, id, `${PROVIDERS[id].name} joined LUNA-X`);
  flash(id, 2500); speak(text);
}
$('#aiBadges').onclick = () => $('#btnConnect').click();
function syncControlUI() {
  document.querySelectorAll('#control button').forEach((b) => { const on = b.dataset.c === control; b.classList.toggle('act', on); b.setAttribute('aria-checked', String(on)); });
}
function setControl(next) {
  if (next === control) return;
  if (next === 'claude' && !client) {
    const el = addMsg('a', 'Claude is not connected yet, so LUNA-X stays in control. Add a Claude key in Connect AI, then Claude can take over.', 'system');
    speak(el.querySelector('.body').textContent); syncControlUI(); return;
  }
  control = next; try { localStorage.setItem('luna-control-v1', control); } catch { /* ignore */ }
  history = []; pendingNotes = []; // a new controller starts a fresh conversation
  syncControlUI(); rebuildClient();
  const free = Object.keys(PROVIDERS).filter((id) => id !== 'claude' && isConnected(settings, id)).map(aiLabel);
  let el, text;
  if (control === 'claude') {
    text = 'Claude here. LUNA-X is switched off, so I have taken over the habitat. I still have all of LUNA’s tools and SELENE’s health data, and the same safety rules.';
    el = addMsg('a', text, ''); el.querySelector('.nm').textContent = 'CLAUDE'; el.querySelector('.nm').style.color = PROVIDERS.claude.color;
    setVia(el, 'claude', 'took over'); flash('claude', 2500);
  } else if (control === 'luna') {
    text = `LUNA-X here. Claude is switched off, so I have taken over with my onboard brain${free.length ? ' and ' + free.join(', ') : ''}. Habitat commands, drills, SELENE readings and network defence all still work.`;
    el = addMsg('a', text, 'LUNA solo');
  } else {
    text = client ? 'LUNA-X and Claude are linked again. Claude is my reasoning brain, and I run the habitat.' : 'LUNA-X is in control.';
    el = addMsg('a', text, 'linked'); if (client) setVia(el, 'claude', 'LUNA-X + ' + aiLabel('claude')); flash('claude', 2500);
  }
  el.classList.add('join'); el.style.setProperty('--c', control === 'luna' ? 'var(--cyan)' : PROVIDERS.claude.color);
  speak(text);
}
/* ---------- Workspace tab: agents, routing, memory, projects ---------- */
function renderWorkspace() {
  $('#agentSel').innerHTML = Object.entries(AGENTS).map(([id, a]) => `<option value="${id}" ${id === ws.agent ? 'selected' : ''}>${a.icon} ${esc(a.name)}</option>`).join('');
  $('#agents').innerHTML = Object.entries(AGENTS).map(([id, a]) => `<div class="agent ${id === ws.agent ? 'act' : ''}" data-agent="${id}" role="button" tabindex="0"><b>${a.icon} ${esc(a.name)}</b><span>${esc(a.blurb)}</span></div>`).join('');
  $('#autoRoute').checked = ws.autoRoute; $('#memOn').checked = ws.memoryOn;
  $('#memList').innerHTML = ws.memory.length ? ws.memory.map((m) => `<div class="mem"><span>${esc(m.text)}</span><small>${esc(m.source)} · ${new Date(m.t).toLocaleDateString()}</small><button data-forget="${m.id}" aria-label="Forget">✕</button></div>`).join('') : '<p class="sub" style="margin:0">Nothing saved yet. Say “remember that …”, or LUNA saves lasting facts as you talk.</p>';
  $('#projSel').innerHTML = ws.projects.map((p) => `<option value="${p.id}" ${p.id === ws.active ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const p = activeProject();
  if (document.activeElement !== $('#projNotes')) $('#projNotes').value = p?.notes || '';
  $('#projLog').innerHTML = p?.log.length ? p.log.slice(-8).reverse().map((l) => `<div>${new Date(l.t).toLocaleDateString()}  ${esc(l.note)}</div>`).join('') : 'No progress logged yet.';
}
function setAgent(id) { if (!AGENTS[id] || id === ws.agent) return; ws.agent = id; saveWs(); toast(`${AGENTS[id].icon} ${AGENTS[id].name} is now active.`); }
$('#agentSel').onchange = (e) => setAgent(e.target.value);
$('#agents').onclick = (e) => { const a = e.target.closest('[data-agent]'); if (a) setAgent(a.dataset.agent); };
$('#autoRoute').onchange = (e) => { ws.autoRoute = e.target.checked; saveWs(); };
$('#memOn').onchange = (e) => { ws.memoryOn = e.target.checked; saveWs(); };
$('#memList').onclick = (e) => { const id = e.target.dataset?.forget; if (id) forget(id); };
$('#memAdd').onclick = () => { if ($('#memNew').value.trim()) { remember($('#memNew').value, 'you'); $('#memNew').value = ''; } };
$('#projSel').onchange = (e) => { ws.active = e.target.value; saveWs(); };
$('#projNew').onclick = () => { const n = prompt('Project name?'); if (n?.trim()) addProject(n.trim()); };
$('#projNotes').onchange = (e) => { const p = activeProject(); if (p) { p.notes = e.target.value.slice(0, 6000); saveWs(); } };
$('#projContinue').onclick = () => send(`Continue my project "${activeProject()?.name}": remind me where we left off and suggest the next steps.`);
$('#projReport').onclick = () => { const topic = prompt('Research topic?', 'Lunar radiation shielding'); if (topic) { setAgent('researcher'); send(`Research ${topic}. Search for strong sources, then give me a report with citations, a 6-slide presentation outline, and a reference list.`); } };
onWorkspace(renderWorkspace);
renderWorkspace();

/* ---------- usage meter ---------- */
function renderUsage() {
  const u = getUsage();
  const ids = Object.keys(PROVIDERS).filter((id) => u.total[id] || isConnected(settings, id));
  const cell = (b, k) => (b?.[k] ? fmtTokens(b[k]) : '0');
  $('#usageTable').innerHTML = '<tr><th>AI</th><th>Requests today</th><th>Tokens today (in / out)</th><th>Requests total</th><th>Tokens total (in / out)</th><th>Web searches</th><th>Est. cost today</th><th>Est. cost total</th><th></th></tr>'
    + (ids.length ? ids.map((id) => { const t = u.total[id], d = u.today[id], free = PROVIDERS[id].free;
      return `<tr><td><span class="ico" style="color:${PROVIDERS[id].color};display:inline-grid;width:14px;vertical-align:-2px">${AI_ICON[id] || ''}</span> ${esc(PROVIDERS[id].name)}</td><td>${d?.requests || 0}</td><td>${cell(d, 'input')} / ${cell(d, 'output')}</td><td>${t?.requests || 0}</td><td>${cell(t, 'input')} / ${cell(t, 'output')}</td><td>${t?.searches || 0}</td><td class="${free ? 'free' : ''}">${free ? 'free' : fmtUSD(d?.cost || 0)}</td><td class="${free ? 'free' : ''}">${free ? 'free' : fmtUSD(t?.cost || 0)}</td><td>${DASHBOARDS[id] ? `<a href="${DASHBOARDS[id]}" target="_blank" rel="noopener">official ↗</a>` : 'on device'}</td></tr>`; }).join('')
    : '<tr><td colspan="9" style="text-align:left">No AI connected yet.</td></tr>');
  $('#usageSince').textContent = 'Counting since ' + new Date(u.since).toLocaleDateString();
  const todayCost = Object.values(u.today).reduce((a, b) => a + (b.cost || 0), 0);
  const todayReq = Object.values(u.today).reduce((a, b) => a + (b.requests || 0), 0);
  $('#pUsage').lastChild.textContent = `Usage: ${fmtUSD(todayCost)} today · ${todayReq} req`;
  $('#pUsage').className = 'pill ' + (todayReq ? 'on' : '');
}
onUsage(renderUsage);
addEventListener('storage', (e) => { if (e.key === 'luna-ai-usage-v1') renderUsage(); });
$('#usageReset').onclick = () => { if (confirm('Reset the usage meter? (This does not change anything at the providers.)')) resetUsage(); };
$('#pUsage').onclick = () => { $('#btnConnect').click(); setTimeout(() => $('#usageTable').scrollIntoView({ behavior: 'smooth', block: 'center' }), 300); };
renderUsage();
$('#control').onclick = (e) => { const c = e.target.dataset?.c; if (c) setControl(c); };
syncControlUI();
const ai = {
  structured: (o) => {
    if (!claudeOn()) throw new Error(client ? 'Claude is switched off (LUNA solo). Switch “In control” back to use SELENE deep scans and check-ins.' : 'Connect Claude in AI Network to use SELENE deep scans and check-ins.');
    flash('claude', 4000);
    return structured({ client, model: settings.claude.model, ...o });
  },
};

/* ---------- chat ---------- */
const QUICK = [
  'Morning status report', 'How is the crew? Ask SELENE', 'Forecast the next 3 days', 'Is Lena ready for an EVA?',
  'Set the quarters to pre-sleep lighting', "I can't sleep", 'Tell me a joke', 'What does SELENE Vision see?',
  'Search the web for the latest Artemis Moon mission news', 'Write Python that plots lunar day vs night temperature', 'Explain how CO₂ scrubbers work, like I am 12',
];
$('#quick').innerHTML = QUICK.map((q) => `<button>${esc(q)}</button>`).join('');
$('#quick').onclick = (e) => { if (e.target.tagName === 'BUTTON') send(e.target.textContent); };

function addMsg(role, text, extra = '') {
  const el = document.createElement('div');
  el.className = 'm ' + role;
  if (role === 'a') el.innerHTML = `<div class="who"><span class="nm">LUNA-X</span> <em>${esc(extra)}</em><button class="say" title="Read this reply out loud" aria-label="Read out loud">🔊</button></div><div class="tools"></div><div class="body"></div>`;
  else el.innerHTML = `<div class="body"></div>`;
  el.querySelector('.body').textContent = text;
  const say = el.querySelector('.say');
  if (say) say.onclick = () => speak(el._raw || el.querySelector('.body').textContent, true);
  $('#msgs').append(el); $('#msgs').scrollTop = 1e9;
  return el;
}
function addRating(el, question) {
  const r = document.createElement('div'); r.className = 'rate';
  r.innerHTML = '<button title="Helpful">👍</button><button title="Not helpful">👎</button><button title="Teach LUNA the right answer">Correct her</button>';
  const [up, down, fix] = r.querySelectorAll('button');
  const skill = guessSkill(question + ' ' + el.querySelector('.body').textContent);
  up.onclick = () => { up.classList.add('on'); down.classList.remove('on'); sim.learning.ratings.push({ t: Date.now(), good: true, skill }); bumpSkill(sim, skill, 1, 'crew rated an answer helpful'); renderTraining(); };
  down.onclick = () => { down.classList.add('on'); up.classList.remove('on'); sim.learning.ratings.push({ t: Date.now(), good: false, skill }); bumpSkill(sim, skill, -2, 'crew rated an answer unhelpful'); renderTraining(); };
  fix.onclick = () => {
    const a = prompt('What should LUNA have said? She will remember it and use it next time.');
    if (!a) return;
    sim.learning.corrections.push({ t: Date.now(), q: question, a, skill });
    bumpSkill(sim, skill, 2, 'correction stored'); learnLog(sim, `Correction stored for "${question.slice(0, 40)}"`);
    pendingNotes.push(`The crew corrected your answer to "${question}". Correct answer: "${a}". Use this from now on.`);
    save(sim); renderTraining(); fix.textContent = 'Learned ✓'; fix.disabled = true;
  };
  el.append(r);
}
function guessSkill(t) {
  t = t.toLowerCase();
  if (/drill|emergenc|leak|fire|radiation|medical/.test(t)) return 'emerg';
  if (/crew|sleep|mood|stress|lonely|feel|wellbeing|selene/.test(t)) return 'crew';
  if (/power|battery|water|food|resource|garden/.test(t)) return 'res';
  if (/forecast|predict|maint|inspect|panel/.test(t)) return 'pred';
  if (/earth|link|call|message|signal/.test(t)) return 'comm';
  return 'hab';
}
// ---- LUNA's voice (browser speech synthesis: free, on device, no key) ----
const VOICE_KEY = 'luna-voice-v1';
let voicePrefs = { on: true, voice: '', rate: 1 };
try { voicePrefs = { ...voicePrefs, ...JSON.parse(localStorage.getItem(VOICE_KEY) || '{}') }; } catch { /* storage blocked */ }
const canSpeak = 'speechSynthesis' in window;
function saveVoice() { try { localStorage.setItem(VOICE_KEY, JSON.stringify(voicePrefs)); } catch { /* ignore */ } }
function pickVoice() {
  const vs = canSpeak ? speechSynthesis.getVoices() : [];
  return vs.find((x) => x.name === voicePrefs.voice)
    || vs.find((x) => /^en/i.test(x.lang) && /female|samantha|zira|aria|jenny|libby|sonia|google uk english female|google us english/i.test(x.name))
    || vs.find((x) => /^en/i.test(x.lang));
}
function fillVoices() {
  if (!canSpeak) return;
  const vs = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
  $('#voicePick').innerHTML = '<option value="">Auto (LUNA)</option>' + vs.map((v) => `<option value="${esc(v.name)}">${esc(v.name.replace(/^Microsoft |^Google /, ''))} · ${esc(v.lang)}</option>`).join('');
  $('#voicePick').value = voicePrefs.voice;
}
function syncVoiceUI() {
  $('#speak').checked = voicePrefs.on;
  $('#voiceRate').value = voicePrefs.rate;
  const b = $('#voiceBtn');
  b.innerHTML = voicePrefs.on ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/></svg>';
  b.classList.toggle('off', !voicePrefs.on);
  b.setAttribute('aria-pressed', String(voicePrefs.on));
  b.setAttribute('aria-label', voicePrefs.on ? 'Voice on' : 'Voice off');
}
function stopSpeaking() { if (canSpeak) speechSynthesis.cancel(); $('#voiceBtn').classList.remove('talking'); }
// force = speak even when auto-speak is off (replay buttons, Test voice)
function speak(text, force = false) {
  if (!canSpeak || (!voicePrefs.on && !force)) return;
  speechSynthesis.cancel();
  const clean = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/[*#_`>|~]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/ppCO₂|CO₂/g, 'C O 2').replace(/O₂/g, 'oxygen').replace(/°C/g, ' degrees').replace(/mSv/g, 'millisieverts')
    .replace(/\s+/g, ' ').trim();
  if (!clean) return;
  // Chrome stops long utterances after ~15 s, so speak sentence-sized chunks
  const chunks = [];
  for (const s of clean.match(/[^.!?]+[.!?]*\s*/g) || [clean]) {
    if (chunks.length && (chunks.at(-1) + s).length < 220) chunks[chunks.length - 1] += s; else chunks.push(s);
  }
  const v = pickVoice();
  chunks.slice(0, 30).forEach((c, i, arr) => {
    const u = new SpeechSynthesisUtterance(c.trim());
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = voicePrefs.rate; u.pitch = 1.05;
    if (i === 0) u.onstart = () => { setMood('speaking'); $('#voiceBtn').classList.add('talking'); };
    if (i === arr.length - 1) u.onend = u.onerror = () => { $('#voiceBtn').classList.remove('talking'); if (!busy) setMood('idle'); };
    speechSynthesis.speak(u);
  });
}
if (canSpeak) {
  fillVoices();
  speechSynthesis.addEventListener?.('voiceschanged', fillVoices);
} else {
  $('#voiceBtn').disabled = true; $('#voiceBtn').title = 'This browser cannot speak (no speech synthesis)';
}
syncVoiceUI();
$('#voiceBtn').onclick = () => {
  if (canSpeak && speechSynthesis.speaking) { stopSpeaking(); return; }
  voicePrefs.on = !voicePrefs.on; saveVoice(); syncVoiceUI();
  if (voicePrefs.on) speak('Voice on. I will read my replies out loud.');
};
$('#speak').onchange = (e) => { voicePrefs.on = e.target.checked; saveVoice(); syncVoiceUI(); if (!voicePrefs.on) stopSpeaking(); };
$('#voicePick').onchange = (e) => { voicePrefs.voice = e.target.value; saveVoice(); };
$('#voiceRate').oninput = (e) => { voicePrefs.rate = +e.target.value; saveVoice(); };
$('#voiceTest').onclick = () => speak('Hello, I am LUNA-X, the habitat AI. SELENE and I are watching over the crew.', true);

async function send(textIn) {
  if (cv && cv.active() !== 'luna' && textIn == null) {
    const files = attachments.splice(0); renderAttachments();
    const t = $('#input').value.trim() || (files.length ? 'Please look at the attached file' + (files.length > 1 ? 's' : '') + '.' : '');
    if (!t) { attachments.unshift(...files); renderAttachments(); return; }
    $('#input').value = '';
    return cv.directSend(t, files);
  }
  const files = textIn == null ? attachments.splice(0) : [];
  renderAttachments();
  const text = (textIn ?? $('#input').value).trim() || (files.length ? 'Please look at the attached file' + (files.length > 1 ? 's' : '') + '.' : '');
  if (!text || busy) { attachments.unshift(...files); renderAttachments(); return; }
  $('#input').value = '';
  const who = crewById(sim, $('#asCrew').value);
  const uel = addMsg('u', text);
  if (files.length) uel.insertAdjacentHTML('beforeend', `<div class="attnote">📎 ${files.map((f) => esc(f.name)).join(', ')}</div>`);
  busy = true; $('#send').disabled = true;

  // Crisis words go to a human right away, offline, before any network call.
  const crisis = crisisCheck(text);
  if (crisis) {
    const r = await execute('escalate_to_human', { crew_id: who.id, severity: crisis.severity, reason: crisis.reason });
    pendingNotes.push(`LUNA's offline safety check already escalated this message to humans: ${r.content}`);
  }

  const el = addMsg('a', '', 'offline');
  if (claudeOn()) setVia(el, 'claude', control === 'claude' ? aiLabel('claude') + ' in control' : 'via ' + aiLabel('claude'));
  if (claudeOn() && control === 'claude') { el.querySelector('.nm').textContent = 'CLAUDE'; el.querySelector('.nm').style.color = PROVIDERS.claude.color; }
  const body = el.querySelector('.body'), tools = el.querySelector('.tools');
  // Auto-routing: with Claude linked, some tasks go to a better-suited connected AI
  let routed = null;
  if (claudeOn() && control === 'team' && ws.autoRoute) {
    const r = routeTask(text, { hasFiles: files.length > 0, connected: freeChatOrder(settings) });
    if (r.id !== 'claude') routed = r;
  }
  try {
    if (claudeOn() && !routed) {
      setMood('thinking');
      const notes = pendingNotes.length ? `[Habitat events since my last message: ${pendingNotes.join(' ')}]\n` : '';
      pendingNotes = [];
      const turnStart = history.length;
      const sig = wsSignature();
      const ctx = turnStart === 0 || sig !== lastWsSig ? wsContext({ full: true }) : wsContext({ full: false });
      lastWsSig = sig;
      const line = `${ctx ? ctx + '\n' : ''}${notes}[${who.name}, ${who.role}, habitat time ${clock(sim)}] ${text}`;
      history.push({ role: 'user', content: files.length ? [...files.map(claudeBlock), { type: 'text', text: line }] : line });
      const startLen = history.length;
      rollbackTo = turnStart;
      const cites = new Map(), found = new Map();
      abortCtl = new AbortController();
      let think = null;
      const res = await runTurn({
        client, model: settings.claude.model, effort: settings.claude.effort, history, execute, signal: abortCtl.signal, system: control === 'claude' ? CLAUDE_TAKEOVER : SYSTEM,
        web: settings.claude.web !== false, code: settings.claude.code !== false, session: claudeSession,
        cb: {
          text: (d) => { if (think) { think.remove(); think = null; } setMood('speaking', 'answering'); body.textContent += d; $('#msgs').scrollTop = 1e9; },
          thinking: (on) => { if (on && !think) { think = document.createElement('div'); think.className = 'thinking'; think.textContent = 'LUNA-X is thinking…'; el.insertBefore(think, body); setMood('thinking'); } },
          toolStart: (name) => { flash(TOOL_SAT[name] || 'habitat'); setMood('thinking', name.replace(/_/g, ' ')); },
          serverStart: (name) => { flash('claude'); setMood('thinking', name === 'web_search' ? 'searching the web' : name === 'web_fetch' ? 'reading a page' : 'running code'); },
          server: (name, label, input) => { const q = input?.query || input?.url || ''; tools.insertAdjacentHTML('beforeend', `<span class="chip ${/web/.test(name) ? 'web' : 'code'}">${name === 'web_search' ? '🔎' : name === 'web_fetch' ? '🌐' : '⌨'} ${esc(label)}${q ? ': ' + esc(String(q).slice(0, 60)) : ''}</span>`); },
          sources: (list) => list.forEach((s) => cites.set(s.url, s.title)),
          found: (list) => list.forEach((s) => found.set(s.url, s.title)),
          toolDone: (name, input, r) => {
            const tier = name === 'adjust_habitat' ? 't1' : name === 'make_offer' ? 't2' : name === 'escalate_to_human' ? 't3' : name === 'ask_selene' ? 'selene' : '';
            const label = name === 'ask_selene' ? `LUNA → SELENE: ${input.topic} (${input.crew_id})` : name.replace(/_/g, ' ');
            tools.insertAdjacentHTML('beforeend', `<span class="chip ${r.is_error ? 'err' : tier}">${esc(label)}</span>`);
          },
        },
      });
      if (think) think.remove();
      if (res.refused) {
        history.length = startLen - 1; // drop the unanswered user turn (tail only; earlier history untouched)
        body.textContent = 'I can\'t help with that one. If someone is in danger, I have alerted the crew and the CMO; in real life call 988 (US) or local emergency services.';
      } else if (res.model && res.model !== settings.claude.model) {
        el.querySelector('.who em').textContent = `${res.model} (fallback)`;
      }
      finishBody(el, body.textContent.trim(), cites.size ? cites : new Map([...found].slice(0, 5)));
      rollbackTo = null;
      collab('claude', 'Reasoning and safety review complete');
    } else {
      let free = freeChatOrder(settings);
      if (routed) { free = [routed.id, ...free.filter((x) => x !== routed.id)]; tools_chip(el, `↪ routed to ${PROVIDERS[routed.id].name}: ${routed.why}`); }
      const memCmd = text.match(/^(?:please )?remember(?: that)?[:,]?\s+(.{3,})$/i);
      const forgetCmd = text.match(/^forget(?: that| about)?\s+(.{2,})$/i);
      // with attachments or a routed task, go straight to an AI; otherwise LUNA's onboard commands run first
      let reply = memCmd ? (remember(memCmd[1]), `Saved to my long-term memory: “${memCmd[1]}”. See it in Workspace.`)
        : forgetCmd && forget(forgetCmd[1]) ? `Forgotten: “${forgetCmd[1]}”.`
        : /^what do you (remember|know about me)/i.test(text) ? (ws.memory.length ? 'Here is what I remember: ' + ws.memory.map((m) => m.text).join('; ') + '.' : 'Nothing yet. Tell me “remember that …”.')
        : (files.length || routed) && free.length ? "I'm in offline mode" : await offlineReply(text, async (n, i) => { flash(TOOL_SAT[n] || 'habitat'); return execute(n, i); });
      let srcs = new Map();
      if (reply.startsWith("I'm in offline mode")) {
        if (free.length) { const r = await freeChat(free, text, who, el, files); reply = r.text; srcs = r.sources; }
        else if (files.length) reply = 'Connect Claude or a free AI (Gemini reads images and PDFs) in Connect AI, and I can read your files.';
      }
      finishBody(el, reply, srcs);
    }
    addRating(el, text);
    speak(el._raw || body.textContent);
  } catch (err) {
    if (err?.name === 'AbortError') body.textContent += ' [stopped]';
    else {
      body.textContent = friendlyError(err);
      if (claudeOn() && !body.textContent.startsWith('Claude rejected')) {
        // link down: answer from the offline brain so the crew is never left without LUNA
        const fallback = await offlineReply(text, execute);
        if (!fallback.startsWith("I'm in offline mode")) addMsg('a', fallback, 'LUNA took over: Claude unreachable');
      }
      // the failed turn is removed from the tail so the next request starts clean
      if (rollbackTo != null) { history.length = rollbackTo; rollbackTo = null; }
    }
  } finally {
    busy = false; $('#send').disabled = false; abortCtl = null;
    if (!speechSynthesis?.speaking) setMood('idle');
  }
}
async function freeChat(order, text, who, el, files = []) {
  const ctx = JSON.stringify({ habitat: JSON.parse((await execute('get_habitat_status', {})).content).sensors, crew: JSON.parse((await execute('ask_selene', { crew_id: 'all', topic: 'overview' })).content).crew, corrections: sim.learning.corrections.slice(-5) });
  const system = `You are LUNA-X, the AI of a simulated lunar habitat (NASA HUNCH student project), working with SELENE, the crew health AI. You are also a complete general assistant: help with any request (questions on any subject, explanations, homework, writing, math, translation, code in any language), giving complete answers at whatever length the task needs, using Markdown (lists, tables, fenced code blocks) when it helps. For habitat and crew chat, be warm and brief (1-4 sentences). You are not a doctor. When web search is available, use it for current information and mention sources. Habitat and crew data: ${ctx}`;
  const wctx = wsContext({ full: true });
  const textFiles = files.filter((f) => f.kind === 'text');
  const prompt = `${who.name}: ${text}` + textFiles.map((f) => `\n\nAttached file ${f.name}:\n\`\`\`\n${f.text}\n\`\`\``).join('');
  const binFiles = files.filter((f) => f.kind !== 'text').map((f) => ({ mime: f.mime, data: f.data }));
  for (const id of order) {
    try {
      collab(id, 'Answering crew conversation…', 'working');
      const usable = id === 'gemini' ? binFiles : binFiles.filter((f) => f.mime.startsWith('image/'));
      if (binFiles.length && !usable.length && order.length > 1) throw new Error(`${PROVIDERS[id].name} can't read that file type here`);
      const sources = new Map();
      const args = { system: wctx ? system + '\n\n' + wctx : system, text: prompt, files: usable, history: freeHistory.slice(-12), maxTokens: 4000, onSources: (l) => l.forEach((s) => sources.set(s.url, s.title)), onProgress: (p) => { el.querySelector('.who em').textContent = `${PROVIDERS[id].name}: ${p}`; } };
      let out;
      try { out = await callProvider(settings, id, { ...args, search: id === 'gemini' && settings.claude.web !== false }); }
      catch (e) { if (id !== 'gemini') throw e; out = await callProvider(settings, id, args); } // retry Gemini without search grounding
      collab(id, 'Answered');
      setVia(el, id, 'via ' + PROVIDERS[id].name + (PROVIDERS[id].free ? ' (free)' : ''));
      if (sources.size) tools_chip(el, '🔎 searched the web (Google)');
      freeHistory.push({ role: 'user', text: prompt.slice(0, 6000) }, { role: 'assistant', text: out.trim().slice(0, 6000) });
      if (freeHistory.length > 24) freeHistory.splice(0, freeHistory.length - 24);
      return { text: out.trim(), sources };
    } catch (e) { collab(id, `Failed: ${e.message}`, 'error'); }
  }
  return { text: 'No connected AI could answer. I still understand the offline commands.', sources: new Map() };
}
function tools_chip(el, label) { el.querySelector('.tools')?.insertAdjacentHTML('beforeend', `<span class="chip web">${esc(label)}</span>`); }
// Render a finished reply as Markdown, keep the raw text for speech, and list sources
function finishBody(el, raw, sources = new Map()) {
  const body = el.querySelector('.body');
  el._raw = raw;
  body.innerHTML = md(raw);
  body.querySelectorAll('pre').forEach((pre) => { const b = document.createElement('button'); b.className = 'copy'; b.textContent = 'Copy'; b.onclick = () => { navigator.clipboard?.writeText(pre.textContent.replace(/^Copy/, '')).then(() => { b.textContent = 'Copied'; }); }; pre.prepend(b); });
  if (sources.size) el.querySelector('.body').insertAdjacentHTML('afterend', `<div class="sources">Sources: ${[...sources].slice(0, 8).map(([u, t]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer" title="${esc(u)}">${esc(t)}</a>`).join('')}</div>`);
}

/* ---------- attachments (images, PDFs, text and code files) ---------- */
let attachments = [];
function claudeBlock(f) {
  if (f.kind === 'image') return { type: 'image', source: { type: 'base64', media_type: f.mime, data: f.data } };
  if (f.kind === 'pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data }, title: f.name };
  return { type: 'document', source: { type: 'text', media_type: 'text/plain', data: f.text }, title: f.name };
}
const readAs = (file, how) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r[how](file); });
async function imageToJpeg(file) {
  const url = await readAs(file, 'readAsDataURL');
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const k = Math.min(1, 1568 / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88);
}
async function addFiles(list) {
  for (const file of list) {
    try {
      if (attachments.length >= 10) { toast('Up to 10 files per message.'); break; }
      if (file.type.startsWith('image/')) { const url = await imageToJpeg(file); attachments.push({ kind: 'image', name: file.name || 'pasted image', mime: 'image/jpeg', data: url.split(',')[1], preview: url }); }
      else if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) { if (file.size > 20e6) { toast(`${file.name} is over 20 MB.`); continue; } const url = await readAs(file, 'readAsDataURL'); attachments.push({ kind: 'pdf', name: file.name, mime: 'application/pdf', data: url.split(',')[1] }); }
      else { if (file.size > 400e3) { toast(`${file.name} is over 400 KB of text.`); continue; } attachments.push({ kind: 'text', name: file.name, mime: 'text/plain', text: await readAs(file, 'readAsText') }); }
    } catch { toast(`Could not read ${file.name}.`); }
  }
  renderAttachments();
}
function renderAttachments() {
  $('#attachList').innerHTML = attachments.map((f, i) => `<span class="att">${f.preview ? `<img src="${f.preview}" alt="">` : `<span class="ext">${f.kind === 'pdf' ? 'PDF' : 'TXT'}</span>`}${esc(f.name.slice(0, 28))}<button data-i="${i}" aria-label="Remove ${esc(f.name)}">✕</button></span>`).join('');
}
$('#attach').onclick = () => $('#fileIn').click();
$('#fileIn').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
$('#attachList').onclick = (e) => { const i = e.target.dataset?.i; if (i != null) { attachments.splice(+i, 1); renderAttachments(); } };
$('#input').addEventListener('paste', (e) => { const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/')); if (imgs.length) { e.preventDefault(); addFiles(imgs); } });
const chatCard = document.querySelector('.card.chat');
chatCard.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
chatCard.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); addFiles([...e.dataTransfer.files]); } });

$('#send').onclick = () => send();
$('#input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
$('#newChat').onclick = () => { abortCtl?.abort(); history = []; pendingNotes = []; claudeSession.container = null; freeHistory.length = 0; lastWsSig = ''; $('#msgs').innerHTML = ''; greet(); };
$('#asCrew').innerHTML = sim.crew.map((c) => `<option value="${c.id}">${esc(c.name)} (${esc(c.role)})</option>`).join('');
function greet() {
  addMsg('a', claudeOn()
    ? `LUNA-X online, connected to ${Object.keys(PROVIDERS).filter((id) => isConnected(settings, id)).map(aiLabel).join(', ')} and SELENE. Mission day ${sim.missionDay}, habitat time ${clock(sim)}. Ask me anything, or try a quick prompt below.`
    : 'LUNA-X online in offline mode. I understand habitat commands now; connect Claude (or a free AI) in “Connect AI” for full conversation, SELENE deep scans and check-ins.', 'system');
}

/* ---------- voice: push-to-talk, wake word, voice log ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, recMode = null; // 'ptt' | 'wake' | 'log'
let logText = '';
function startRec(mode) {
  if (!SR) { alert('Speech recognition needs Chrome or Edge.'); return; }
  stopRec();
  rec = new SR(); recMode = mode; rec.lang = 'en-US'; rec.interimResults = mode !== 'wake'; rec.continuous = mode !== 'ptt';
  rec.onresult = (e) => {
    const res = [...e.results].slice(e.resultIndex);
    const final = res.filter((r) => r.isFinal).map((r) => r[0].transcript).join(' ').trim();
    const interim = res.map((r) => r[0].transcript).join(' ');
    if (mode === 'ptt') { $('#input').value = interim; if (final) { stopRec(); send(final); } }
    if (mode === 'wake' && final) {
      const m = final.match(/\b(?:hey |ok )?(luna(?:[ -]?x)?|selene)\b[,.]?\s*(.*)/i);
      if (m) { const q = m[2] || ''; if (q.length > 2) send(m[1].toLowerCase() === 'selene' ? `(asking SELENE) ${q}` : q); else { setMood('listening'); } }
      if (/\bstart log\b/i.test(final)) { $('[data-t=checkin]').click(); startLog(); }
    }
    if (mode === 'log') {
      if (final) { if (/\bstop log\b/i.test(final)) { logText += ' ' + final.replace(/\bstop log\b.*/i, ''); finishLog(); return; } logText += ' ' + final.replace(/\bstart log\b/i, ''); }
      $('#vlText').textContent = (logText + ' ' + (res.at(-1)?.isFinal ? '' : interim)).trim() || 'Listening…';
    }
  };
  rec.onend = () => { if (recMode === mode && mode !== 'ptt' && rec) try { rec.start(); } catch { /* restarting */ } else if (mode === 'ptt') { $('#mic').classList.remove('live'); setMood('idle'); } };
  rec.onerror = (e) => { if (e.error === 'not-allowed') { alert('Microphone permission was denied.'); stopRec(); } };
  rec.start();
  if (mode === 'ptt') { $('#mic').classList.add('live'); setMood('listening'); }
}
function stopRec() { const r = rec; recMode = null; rec = null; try { r?.stop(); } catch { /* ignore */ } $('#mic').classList.remove('live'); }
$('#mic').onclick = () => (stopSpeaking(), recMode === 'ptt' ? stopRec() : startRec('ptt'));
$('#wake').onchange = (e) => (e.target.checked ? startRec('wake') : stopRec());

/* voice features vs calm baseline */
let audio = null;
async function micMeter() {
  if (audio) return audio;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext(); const src = ctx.createMediaStreamSource(stream); const an = ctx.createAnalyser(); an.fftSize = 2048; src.connect(an);
  audio = { ctx, an, stream, buf: new Float32Array(2048), samples: [] };
  return audio;
}
function sampleVoice(a) { a.an.getFloatTimeDomainData(a.buf); return pitchOf(a.buf, a.ctx.sampleRate); }
function summarize(samples) {
  const voiced = samples.filter((s) => s.pitch > 60 && s.pitch < 400);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const p = voiced.map((s) => s.pitch).sort((a, b) => a - b);
  return {
    pitch_hz: Math.round(mean(p)), pitch_range_hz: p.length ? Math.round(p[Math.floor(p.length * 0.9)] - p[Math.floor(p.length * 0.1)]) : 0,
    loudness: +mean(samples.map((s) => s.rms)).toFixed(3), voiced_share: +(voiced.length / Math.max(1, samples.length)).toFixed(2),
  };
}
let sampler = null;
async function collect(seconds, onTick) {
  const a = await micMeter(); a.samples = [];
  return new Promise((res) => {
    const t0 = Date.now();
    sampler = setInterval(() => {
      a.samples.push(sampleVoice(a)); onTick?.(a.samples.at(-1));
      if (seconds && Date.now() - t0 > seconds * 1000) { clearInterval(sampler); res(summarize(a.samples)); }
    }, 100);
  });
}
const baselineKey = () => 'voiceBase:' + $('#ciCrew').value;
$('#vlBase').onclick = async () => {
  $('#vlText').textContent = 'Recording calm baseline: read something ordinary aloud for 10 seconds…';
  const b = await collect(10, (s) => { $('#vlMeter').textContent = `pitch ${Math.round(s.pitch)} Hz · level ${s.rms.toFixed(3)}`; });
  try { localStorage.setItem(baselineKey(), JSON.stringify(b)); } catch { /* ignore */ }
  $('#vlText').textContent = `Baseline saved: ${b.pitch_hz} Hz average, range ${b.pitch_range_hz} Hz.`;
};
let logging = false;
function startLog() {
  if (logging) return; logging = true; logText = '';
  $('#vlStart').textContent = 'Stop log'; $('#vlText').textContent = 'Listening… say “stop log” when you finish.';
  collect(0, (s) => { $('#vlMeter').textContent = `pitch ${Math.round(s.pitch)} Hz · level ${s.rms.toFixed(3)}`; });
  startRec('log');
}
async function finishLog() {
  if (!logging) return; logging = false; stopRec(); clearInterval(sampler);
  if ($('#wake').checked) startRec('wake');
  $('#vlStart').textContent = 'Start log';
  const feats = summarize(audio?.samples || []);
  let base = null; try { base = JSON.parse(localStorage.getItem(baselineKey()) || 'null'); } catch { /* ignore */ }
  const c = crewById(sim, $('#ciCrew').value);
  base ||= { pitch_hz: c.base.pitch, pitch_range_hz: 60, loudness: 0.05 };
  const vs = { ...feats, baseline: base, pitch_change_pct: base.pitch_hz ? Math.round(((feats.pitch_hz - base.pitch_hz) / base.pitch_hz) * 100) : null, range_change_pct: base.pitch_range_hz ? Math.round(((feats.pitch_range_hz - base.pitch_range_hz) / base.pitch_range_hz) * 100) : null };
  const transcript = logText.trim() || '(no words recognised)';
  $('#ciResult').innerHTML = '<div class="holo">Analysing voice log…</div>';
  try {
    let r;
    if (claudeOn()) r = await voiceMood(ai, transcript, vs);
    else {
      const t = transcript.toLowerCase();
      const m = /hopeless|empty|worthless|give up|pointless/.test(t) ? 'low' : /sad|lonely|miss|homesick|cry/.test(t) ? 'sad' : /anxious|panic|scared|nervous/.test(t) ? 'anxious' : /worr|unsure/.test(t) ? 'worried' : /angry|furious|annoyed/.test(t) ? 'angry' : /tired|exhausted|sleepy/.test(t) ? 'tired' : /happy|great|good|excited/.test(t) ? 'happy' : 'calm';
      r = { mood: m, confidence: 0.5, evidence: ['offline keyword match'], reply: 'Logged. Connect Claude for a fuller reading of your voice log.' };
    }
    c.moods.push({ t: Date.now(), mood: r.mood, src: 'voice log' }); save(sim); emit(sim);
    pendingNotes.push(`${c.name} recorded a voice log. Estimated mood: ${r.mood} (${Math.round(r.confidence * 100)}%). Voice vs baseline: ${JSON.stringify(vs)}. Words: "${transcript.slice(0, 300)}"`);
    $('#ciResult').innerHTML = `<div class="holo"><div class="k">Voice log · ${esc(c.name)}</div><h4>${esc(r.mood.toUpperCase())} · ${Math.round(r.confidence * 100)}%</h4><p style="margin:4px 0">${esc(r.reply)}</p><div class="row" style="font-size:12px;color:var(--mut)">${esc(r.evidence.join(' · '))}</div><div class="mono" style="font-size:11px;color:var(--mut);margin-top:4px">pitch ${vs.pitch_hz} Hz (${vs.pitch_change_pct ?? '?'}% vs baseline) · range ${vs.pitch_range_hz} Hz · level ${vs.loudness}</div></div>`;
    timeline('det', `Voice log ${c.name}: ${r.mood}`);
    if (crisisCheck(transcript)) execute('escalate_to_human', { crew_id: c.id, severity: 'RED', reason: 'Crisis words in a voice log' });
    else if (wellbeing(sim, c).low_mood_repeats_last7 >= 3) execute('escalate_to_human', { crew_id: c.id, severity: 'ORANGE', reason: 'Low moods have repeated this week', needs_consent: true });
  } catch (e) { $('#ciResult').innerHTML = `<div class="note">${esc(friendlyError(e))}</div>`; }
  renderCheckins();
}
$('#vlStart').onclick = () => (logging ? finishLog() : startLog());

/* ---------- camera helpers ---------- */
const cams = {};
async function camOn(videoSel, offSel) {
  const v = $(videoSel);
  if (!v.srcObject) {
    try { v.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 960, height: 720 }, audio: false }); }
    catch { alert('Camera permission was denied or no camera was found.'); return null; }
    await v.play(); cams[videoSel] = v.srcObject;
  }
  $(offSel).hidden = true;
  return v;
}

/* ---------- SELENE Vision ---------- */
let detector = null, liveLoop = false, deepObjects = null, selIdx = -1, visionSrc = null;
const vov = $('#vov'), vg = vov.getContext('2d');
$('#vStart').onclick = async () => {
  const v = await camOn('#vvid', '#voff'); if (!v) return;
  $('#vimg').hidden = true; v.hidden = false; visionSrc = v; deepObjects = null; vision.state.source = 'camera';
  $('#vbadge').textContent = 'SELENE VISION · LOADING DETECTOR';
  try { detector ||= await loadDetector(); } catch (e) { $('#vbadge').textContent = 'LIVE DETECTOR UNAVAILABLE'; timeline('ai', e.message); }
  $('#vbadge').textContent = 'SELENE VISION · LIVE';
  if (!liveLoop) { liveLoop = true; loop(); }
  flash('selene');
};
$('#vFile').onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  const img = $('#vimg'); img.onload = () => { img.hidden = false; $('#vvid').hidden = true; $('#voff').hidden = true; visionSrc = img; deepObjects = null; vision.state.live = []; vision.state.source = 'uploaded image'; $('#vbadge').textContent = 'SELENE VISION · IMAGE'; draw(); };
  img.src = URL.createObjectURL(f);
};
async function loop() {
  while (liveLoop) {
    if (visionSrc?.tagName === 'VIDEO' && detector && $('#vLive').checked && $('[data-t=vision]').classList.contains('act')) {
      try {
        const v = $('#vvid');
        const d = await detectLive(detector, v);
        vision.state.live = d; vision.state.updated = Date.now();
        d.forEach((o) => { if (!lastSeen[o.label] || Date.now() - lastSeen[o.label] > 30000) { timeline('det', `Detected ${o.label} (${Math.round(o.score * 100)}%, ~${o.dist} m)`); } lastSeen[o.label] = Date.now(); });
      } catch { /* frame not ready */ }
    }
    draw();
    await sleep(140);
  }
}
const lastSeen = {};
function srcRect() {
  const box = $('#vcam').getBoundingClientRect();
  const el = visionSrc; if (!el) return null;
  const w = el.videoWidth || el.naturalWidth, h = el.videoHeight || el.naturalHeight; if (!w) return null;
  const k = Math.max(box.width / w, box.height / h); // object-fit: cover
  return { k, ox: (box.width - w * k) / 2, oy: (box.height - h * k) / 2, w, h, bw: box.width, bh: box.height, mirror: el.tagName === 'VIDEO' };
}
function draw() {
  const r = srcRect(); const dpr = devicePixelRatio || 1;
  const box = $('#vcam').getBoundingClientRect();
  vov.width = box.width * dpr; vov.height = box.height * dpr; vg.setTransform(dpr, 0, 0, dpr, 0, 0); vg.clearRect(0, 0, box.width, box.height);
  if (!r) return;
  const col = { geology: '#fbbf24', human: '#34d399', equipment: '#38bdf8', hazard: '#f87171' };
  const card = (x, y, w, h, c, lines, strong) => {
    vg.strokeStyle = c; vg.lineWidth = strong ? 2.4 : 1.6; vg.shadowColor = c; vg.shadowBlur = 10;
    const L = Math.min(18, w / 3, h / 3);
    for (const [px, py, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) { vg.beginPath(); vg.moveTo(px + dx * L, py); vg.lineTo(px, py); vg.lineTo(px, py + dy * L); vg.stroke(); }
    vg.shadowBlur = 0; vg.globalAlpha = 0.25; vg.strokeRect(x, y, w, h); vg.globalAlpha = 1;
    vg.font = '600 11px Inter, sans-serif';
    const tw = Math.max(...lines.map((l) => vg.measureText(l).width)) + 12;
    const ty = y > 18 * lines.length + 4 ? y - 16 * lines.length - 6 : y + h + 4;
    vg.fillStyle = 'rgba(4,8,22,.82)'; vg.fillRect(x, ty, tw, 16 * lines.length + 4);
    vg.fillStyle = c; vg.fillRect(x, ty, 2, 16 * lines.length + 4);
    lines.forEach((l, i) => { vg.fillStyle = i ? '#cbd5e1' : '#fff'; vg.fillText(l, x + 7, ty + 14 + i * 16); });
  };
  const map = (bx, by, bw, bh) => { let x = r.ox + bx * r.k; if (r.mirror) x = r.bw - (x + bw * r.k); return [x, r.oy + by * r.k, bw * r.k, bh * r.k]; };
  if (deepObjects) {
    deepObjects.forEach((o, i) => {
      const [x, y, w, h] = [o.box[0] / 1000 * r.w, o.box[1] / 1000 * r.h, o.box[2] / 1000 * r.w, o.box[3] / 1000 * r.h];
      // deep-scan frames are already mirrored like the preview, so map without mirroring again
      const X = r.ox + x * r.k, Y = r.oy + y * r.k;
      const conf = o.fused_confidence ?? o.confidence;
      card(X, Y, w * r.k, h * r.k, col[o.final_category || o.category] || '#38bdf8', [`${(o.final_label || o.label).toUpperCase()} · ${(conf * 100).toFixed(1)}%`, `${o.distance_m} m · risk ${o.risk} · value ${o.resource_value}${o.verified ? ' · VERIFIED' : ''}`], i === selIdx);
    });
  } else if ($('#vLive').checked) {
    for (const o of vision.state.live) { const [x, y, w, h] = map(...o.bbox); card(x, y, w, h, col[o.category], [`${o.label.toUpperCase()} · ${(o.score * 100).toFixed(1)}%`, `~${o.dist} m · live`]); }
  }
}
$('#vScan').onclick = async () => {
  if (!visionSrc) return alert('Start the camera or upload an image first.');
  const fr = grabFrame(visionSrc);
  $('#vScene').textContent = 'SELENE deep scan in progress…'; $('#vbadge').textContent = 'SELENE · DEEP SCAN';
  collab('claude', 'SELENE deep scan running…', 'working');
  try {
    const r = await deepScan(ai, fr.b64);
    lastFrame = fr;
    if (visionSrc.tagName === 'VIDEO') { $('#vimg').src = fr.url; $('#vimg').hidden = false; $('#vvid').hidden = true; visionSrc = $('#vimg'); await new Promise((ok) => { if ($('#vimg').complete) ok(); else $('#vimg').onload = ok; }); }
    deepObjects = r.objects; selIdx = -1; vision.state.deep = r; vision.state.consensus = null; vision.state.source = 'deep scan';
    $('#vScene').textContent = r.scene;
    collab('claude', `SELENE deep scan: ${r.objects.length} objects classified`);
    r.objects.forEach((o) => timeline('det', `SELENE: ${o.label} (${Math.round(o.confidence * 100)}%, risk ${o.risk})`));
    pendingNotes.push(`SELENE Vision deep scan: ${r.scene} Objects: ${r.objects.map((o) => `${o.label} [${o.category}, ${Math.round(o.confidence * 100)}%, risk ${o.risk}, value ${o.resource_value}]`).join('; ')}.`);
    renderDetections(); draw();
    $('#vbadge').textContent = 'SELENE · SCAN COMPLETE (press Start camera to go live)';
  } catch (e) { $('#vScene').textContent = friendlyError(e); collab('claude', `Deep scan failed: ${e.message}`, 'error'); }
};
let lastFrame = null;
$('#vVerify').onclick = async () => {
  if (!deepObjects?.length || !lastFrame) return alert('Run a SELENE deep scan first.');
  if (!verifiersOnline(settings).length) return alert('Connect at least one other AI (Gemini, OpenAI, Meta Llama via OpenRouter, or Groq) in AI Network. Gemini, OpenRouter and Groq have free keys.');
  collab('lunax', `Routing ${deepObjects.length} detections to ${verifiersOnline(settings).length + 1} models`, 'working');
  const fused = await verifyDetections(settings, lastFrame.b64, deepObjects);
  deepObjects = fused.objects; vision.state.consensus = { models: fused.models, errors: fused.errors, objects: fused.objects.map((o) => ({ label: o.final_label, confidence: o.fused_confidence, agreement: o.agreement, verified: o.verified, votes: o.votes.map((v) => `${v.id}:${v.label}:${Math.round(v.confidence * 100)}%`) })) };
  pendingNotes.push(`LUNA-X fused verification from ${fused.models.join(', ')}: ${vision.state.consensus.objects.map((o) => `${o.label} ${Math.round(o.confidence * 100)}% (${o.agreement})`).join('; ')}.`);
  collab('lunax', 'Mission recommendation ready — select an object');
  renderDetections(); draw();
};
function renderDetections() {
  const list = deepObjects || [];
  $('#vList').innerHTML = list.map((o, i) => `<div class="d ${i === selIdx ? 'sel' : ''}" data-i="${i}">
    <span class="cat ${esc(o.final_category || o.category)}">${esc(o.final_category || o.category)}</span>
    <div><b>${esc(o.final_label || o.label)}</b> <span class="sub" style="margin:0">· ${esc(o.earth_object)} · ${esc(o.details)}</span>
      ${o.votes ? `<div class="votes">${o.votes.map((v) => `<span class="chip">${esc(PROVIDERS[v.id]?.name || v.id)} ${Math.round(v.confidence * 100)}% ${esc(v.label)}</span>`).join('')}</div>` : ''}</div>
    <span class="mono" style="font-size:12px">${((o.fused_confidence ?? o.confidence) * 100).toFixed(1)}%</span></div>`).join('');
}
$('#vList').onclick = (e) => {
  const d = e.target.closest('.d'); if (!d) return;
  selIdx = +d.dataset.i; const o = deepObjects[selIdx]; renderDetections(); draw();
  const conf = ((o.fused_confidence ?? o.confidence) * 100).toFixed(1);
  const dec = $('#decision'); dec.style.display = 'block';
  dec.innerHTML = `<div class="k">${o.verified ? 'LUNA-X verified' : 'SELENE detection'}</div><h4>${esc(o.final_label || o.label)}</h4>
    <div class="row"><span>Match</span><b>${conf}%${o.agreement ? ' · ' + esc(o.agreement) : ''}</b></div>
    <div class="row"><span>Distance</span><b>${esc(o.distance_m)} m</b></div><div class="row"><span>Hazard</span><b>${esc(o.risk)}</b></div><div class="row"><span>Resource value</span><b>${esc(o.resource_value)}</b></div>
    <div class="row"><span>Details</span><b style="text-align:right">${esc(o.details)}</b></div>
    <div class="row" style="margin-top:8px"><button class="btn sm pri" id="decAsk">Ask LUNA-X: significance &amp; action</button><button class="btn sm" id="decX">×</button></div>`;
  $('#decAsk').onclick = () => send(`SELENE Vision detected "${o.final_label || o.label}" (${conf}%, ${o.details}). Explain its significance and the recommended action: collect, analyse, avoid or repair.`);
  $('#decX').onclick = () => { dec.style.display = 'none'; };
};

/* ---------- face check-in ---------- */
$('#ciFace').onclick = async () => {
  const c = crewById(sim, $('#ciCrew').value);
  if (!c.consent.camera) return alert(`${c.name} has turned the camera off.`);
  const v = await camOn('#cvid', '#coff'); if (!v) return;
  await sleep(400);
  const frames = [];
  for (let i = 0; i < 3; i++) {
    for (let s = 10; s > 0; s--) { $('#cbadge').textContent = `CHECK-IN · frame ${i + 1}/3 in ${s}s`; await sleep(1000); }
    frames.push(grabFrame(v, 640).b64);
  }
  $('#cbadge').textContent = 'ANALYSING (frames are not stored)';
  $('#ciResult').innerHTML = '<div class="holo">SELENE is reading the check-in…</div>';
  try {
    const r = await faceCheckin(ai, frames, { name: c.name, selfReport: $('#ciSelf').value });
    const entry = { t: Date.now(), fatigue: r.fatigue, stress: r.stress, mood: r.mood, signals: r.signals, says_fine_but_differs: r.says_fine_but_differs };
    c.checkins.push(entry); if (r.face_visible) c.moods.push({ t: Date.now(), mood: r.mood, src: 'face check-in' }); save(sim); emit(sim);
    pendingNotes.push(`${c.name} did a face check-in: mood ${r.mood}, fatigue ${r.fatigue}, stress ${r.stress}, signals ${r.signals.join(', ')}${r.says_fine_but_differs ? ', says fine but behaviour differs' : ''}.`);
    $('#ciResult').innerHTML = `<div class="holo"><div class="k">Face check-in · ${esc(c.name)}</div><h4>${esc(r.mood.toUpperCase())}</h4><div class="row"><span>Fatigue</span><b>${Math.round(r.fatigue * 100)}%</b></div><div class="row"><span>Stress</span><b>${Math.round(r.stress * 100)}%</b></div><p style="margin:6px 0 2px">${esc(r.summary)}</p><div style="font-size:12px;color:var(--mut)">${esc(r.signals.join(' · '))}${r.says_fine_but_differs ? ' · says fine, but behaviour differs' : ''}</div></div>`;
    timeline('det', `Face check-in ${c.name}: ${r.mood}`);
    const w = wellbeing(sim, c);
    if (w.tier >= 1 && claudeOn()) send(`(SELENE) ${c.name}'s face check-in shows ${r.mood}, fatigue ${Math.round(r.fatigue * 100)}%. Respond with the right tier.`);
  } catch (e) { $('#ciResult').innerHTML = `<div class="note">${esc(friendlyError(e))}</div>`; }
  $('#cbadge').textContent = 'FACE CHECK-IN';
  renderCheckins();
};
function renderCheckins() {
  const c = crewById(sim, $('#ciCrew').value);
  $('#ciHist').innerHTML = [...c.checkins.slice(-4).map((x) => `Face: ${x.mood}, fatigue ${Math.round(x.fatigue * 100)}%, stress ${Math.round(x.stress * 100)}%`), ...c.moods.slice(-5).map((m) => `Mood ${m.mood} (${m.src})`)].map(esc).join('<br>') || 'None yet.';
}

/* ---------- Wellness Dock ---------- */
// reaction test
let pvtState = null;
const pvtEl = $('#pvt');
function pvtHit() {
  if (!pvtState) { pvtState = { n: 0, times: [], lapses: 0 }; pvtNext(); return; }
  if (pvtState.go) { const ms = Math.round(performance.now() - pvtState.go); pvtState.times.push(ms); if (ms > 500) pvtState.lapses++; pvtState.go = 0; pvtEl.className = 'pvt'; pvtEl.textContent = ms + ' ms'; pvtState.n++; pvtState.n >= 10 ? pvtFinish() : pvtNext(); }
  else if (pvtState.timer) { pvtEl.textContent = 'Too early!'; pvtState.falseStarts = (pvtState.falseStarts || 0) + 1; }
}
function pvtNext() { pvtEl.textContent = 'Wait…'; pvtState.timer = setTimeout(() => { pvtState.timer = 0; pvtState.go = performance.now(); pvtEl.className = 'pvt go'; pvtEl.textContent = 'NOW'; }, 2000 + Math.random() * 4000); }
function pvtFinish() {
  const c = crewById(sim, $('#asCrew').value);
  const t = pvtState.times; const mean = Math.round(t.reduce((a, b) => a + b, 0) / t.length);
  const r = { t: Date.now(), mean_ms: mean, fastest_ms: Math.min(...t), lapses: pvtState.lapses, false_starts: pvtState.falseStarts || 0 };
  c.pvt.push(r); save(sim);
  $('#pvtOut').textContent = `${c.name}: mean ${mean} ms · fastest ${r.fastest_ms} ms · lapses ${r.lapses} · false starts ${r.false_starts}${mean > 400 ? ' — slower than usual; LUNA will flag EVAs' : ''}`;
  pendingNotes.push(`${c.name} did the reaction test: mean ${mean} ms, ${r.lapses} lapses.`);
  timeline(mean > 400 ? 't2' : 't1', `Reaction test ${c.name}: ${mean} ms`);
  pvtState = null; pvtEl.textContent = 'Again';
}
pvtEl.onclick = pvtHit; pvtEl.onkeydown = (e) => { if (e.code === 'Space') { e.preventDefault(); pvtHit(); } };

// breathing
function breathing() {
  const o = $('#overlay'); o.style.display = 'grid';
  $('#overlayBox').innerHTML = '<div class="k">Guided breathing · 4-7-8</div><div class="breath" id="br"></div><h3 id="brT" style="font:700 22px Orbitron">Get comfortable</h3><button class="btn" id="brX">Stop</button>';
  let stop = false; $('#brX').onclick = () => { stop = true; o.style.display = 'none'; };
  (async () => {
    for (let i = 0; i < 4 && !stop; i++) {
      for (const [lbl, s, sc] of [['Breathe in', 4, 1], ['Hold', 7, 1], ['Breathe out', 8, 0.55]]) {
        if (stop) return;
        $('#brT').textContent = `${lbl} · ${s}`; const b = $('#br'); b.style.transitionDuration = s + 's'; b.style.transform = `scale(${sc})`;
        speak(lbl);
        await sleep(s * 1000);
      }
    }
    if (!stop) { $('#brT').textContent = 'Well done.'; await sleep(1500); o.style.display = 'none'; timeline('t1', 'Breathing exercise completed'); }
  })();
}
$('#breathBtn').onclick = breathing;

// Earth messages + call home
function showEarth(m) {
  const o = $('#overlay'); o.style.display = 'grid';
  $('#overlayBox').innerHTML = `<div class="k">Message from Earth</div><h3 style="font:700 20px Orbitron;margin:10px 0">${esc(m.from)}</h3><p style="font-size:17px;line-height:1.6">“${esc(m.text)}”</p><button class="btn" id="eX">Close</button>`;
  $('#eX').onclick = () => { o.style.display = 'none'; };
  speak(`Message from ${m.from}. ${m.text}`);
  timeline('t2', `Message from Earth played for ${m.to}`);
}
function playEarth(crewId) { execute('play_media', { kind: 'earth_message', crew_id: crewId }); }
$('#earthPlay').onclick = () => playEarth($('#asCrew').value);
$('#earthTo').innerHTML = sim.crew.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
$('#earthAdd').onclick = () => {
  const text = $('#earthNew').value.trim(); if (!text) return;
  const to = $('#earthTo').value; sim.earthMessages.push({ from: 'Family', to, text }); save(sim);
  $('#earthNew').value = ''; timeline('t1', `Message from Earth stored for ${to}`);
};
$('#callSend').onclick = async () => {
  const text = $('#callHome').value.trim(); if (!text) return;
  $('#callHome').value = '';
  if (sim.sensors.earth_link !== 'up') { $('#callOut').textContent = 'Earth link down: message queued, will send when the link returns.'; return; }
  $('#callOut').textContent = 'Transmitting… (1.3 s light delay)'; await sleep(1300);
  $('#callOut').textContent = 'Delivered to Earth ✓'; timeline('t1', 'Message sent home');
};

// workout coach
const EX = ['Squat', 'Push-up', 'Lunge', 'Plank', 'Jumping jack', 'High knees', 'Bicep curl', 'Shoulder press'];
$('#woEx').innerHTML = EX.map((x) => `<option>${x}</option>`).join('');
let reps = 0, woStart = 0;
$('#woRep').onclick = () => { if (!woStart) woStart = Date.now(); reps++; $('#woCount').textContent = `${reps} reps`; };
$('#woForm').onclick = async () => {
  const v = await camOn('#wvid', '#woff'); if (!v) return;
  if (!woStart) woStart = Date.now();
  $('#woCues').textContent = 'Hold your exercise — capturing 3 frames…';
  const frames = []; for (let i = 0; i < 3; i++) { await sleep(1000); frames.push(grabFrame(v, 512).b64); }
  try {
    const r = await formCheck(ai, frames, $('#woEx').value);
    $('#woCues').innerHTML = r.person_visible ? `<b>Form ${r.form_score}/100</b> · ${esc(r.cues.join(' · '))}<br>${esc(r.praise)}` : 'I can\'t see you fully — step back so your whole body is in frame.';
    if (r.form_score >= 90) badge('Perfect form');
    speak(r.person_visible ? `${r.cues.join('. ')}. ${r.praise}` : 'Step back so I can see you.');
  } catch (e) { $('#woCues').textContent = friendlyError(e); }
};
function badge(b) { if (!sim.workouts.badges.includes(b)) { sim.workouts.badges.push(b); timeline('t1', `Badge earned: ${b}`); save(sim); } }
$('#woDone').onclick = () => {
  if (!reps) return alert('Log some reps first.');
  const ex = $('#woEx').value, mins = Math.max(1, Math.round((Date.now() - woStart) / 60000));
  const c = crewById(sim, $('#asCrew').value);
  sim.workouts.log.push({ t: Date.now(), crew: c.id, ex, reps, mins });
  const pbKey = `${c.id}:${ex}`; const pb = sim.workouts.pbs[pbKey] || 0;
  if (reps > pb) { sim.workouts.pbs[pbKey] = reps; badge(`PB: ${ex}`); }
  const total = sim.workouts.log.reduce((s, w) => s + w.reps, 0);
  if (sim.workouts.log.length === 1) badge('First workout'); if (total >= 100) badge('100 reps'); if (sim.workouts.log.length >= 5) badge('5 workouts');
  const resist = ['Squat', 'Push-up', 'Lunge', 'Bicep curl', 'Shoulder press'].includes(ex);
  execute('log_entry', { crew_id: c.id, kind: resist ? 'resistive_min' : 'exercise_min', value: mins });
  $('#woPB').textContent = `${c.name}: ${reps} ${ex} in ${mins} min · PB ${Math.max(pb, reps)} · badges: ${sim.workouts.badges.join(', ')}`;
  reps = 0; woStart = 0; $('#woCount').textContent = '0 reps'; save(sim);
  playEarth(c.id); // finishing a workout plays a message from Earth (Luna Workout Coach)
};

/* ---------- soundscapes (generated, no audio files) ---------- */
let snd = null;
function sound(kind) {
  if (snd) { snd.stop(); snd = null; }
  if (!kind || kind === 'off') return;
  const ctx = new AudioContext(); const out = ctx.createGain(); out.gain.value = 0.18; out.connect(ctx.destination);
  const nodes = [];
  if (kind === 'space music') {
    [130.8, 196, 246.9, 329.6].forEach((f, i) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = 0; o.connect(g).connect(out); o.start(); const l = ctx.createOscillator(); l.frequency.value = 0.05 + i * 0.03; const lg = ctx.createGain(); lg.gain.value = 0.12; l.connect(lg).connect(g.gain); l.start(); nodes.push(o, l); });
  } else {
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = kind === 'rain' ? w : (last + 0.02 * w) / 1.02; d[i] = kind === 'rain' ? w * 0.3 : last * 3.5; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = kind === 'rain' ? 'highpass' : 'lowpass'; f.frequency.value = kind === 'rain' ? 1200 : 900;
    const g = ctx.createGain(); g.gain.value = 1; src.connect(f).connect(g).connect(out); src.start(); nodes.push(src);
    if (kind === 'ocean waves') { const l = ctx.createOscillator(); l.frequency.value = 0.12; const lg = ctx.createGain(); lg.gain.value = 0.7; l.connect(lg).connect(g.gain); l.start(); nodes.push(l); }
  }
  snd = { stop: () => { nodes.forEach((n) => { try { n.stop(); } catch { /* ignore */ } }); ctx.close(); } };
}
let lastSound = 'off';
onChange(sim, () => { const s = sim.rooms.find((r) => r.id === 'quarters')?.sound || 'off'; const any = sim.rooms.find((r) => r.sound !== 'off')?.sound || 'off'; const k = s !== 'off' ? s : any; if (k !== lastSound) { lastSound = k; sound(k); } });

/* ---------- Training ---------- */
function renderTraining() {
  const sk = sim.learning.skills;
  $('#skills').innerHTML = Object.entries(SKILLS).map(([k, n]) => `<div class="skill"><span>${n}</span><div class="bar"><i style="width:${sk[k]}%"></i></div><span class="mono">${sk[k]}</span></div>`).join('');
  $('#corr').innerHTML = sim.learning.corrections.slice(-8).reverse().map((c) => `<div>• <b>${esc(c.q.slice(0, 70))}</b> → ${esc(c.a)}</div>`).join('') || 'No corrections yet. Use “Correct her” under any LUNA answer.';
  $('#learnLog').innerHTML = sim.learning.log.slice(0, 14).map((l) => `<div>${new Date(l.t).toLocaleTimeString()}  ${esc(l.text)}</div>`).join('');
}
$('#drills').innerHTML = Object.entries(DRILLS).map(([id, d]) => `<button class="btn" data-d="${id}">${esc(d.t)}</button>`).join('');
$('#drills').onclick = async (e) => {
  const id = e.target.dataset?.d; if (!id) return;
  await execute('run_drill', { drill: id });
  send(`DRILL: ${DRILLS[id].t}. Situation: ${DRILLS[id].steps.join(' ')} Give the crew your response plan.`);
};
function renderDrillScore(d) {
  $('#drillScore').innerHTML = `<div class="holo"><div class="k">Drill running · ${esc(d.t)}</div><p style="margin:4px 0">Score LUNA's plan (trains ${esc(SKILLS[d.s])}):</p><div class="row">${[1, 2, 3, 4, 5].map((n) => `<button class="btn sm" data-s="${n}">${n}</button>`).join('')}<button class="btn sm red" data-s="end">End drill</button></div></div>`;
  $('#drillScore').onclick = (e) => {
    const s = e.target.dataset?.s; if (!s) return;
    if (s !== 'end') { sim.learning.drillScores.push({ drill: d.t, score: +s, t: Date.now() }); bumpSkill(sim, d.s, (+s - 3) * 3, `drill "${d.t}" scored ${s}/5`); pendingNotes.push(`The crew scored your ${d.t} plan ${s}/5.`); }
    sim.drill = null; emit(sim); $('#drillScore').innerHTML = ''; renderTraining(); timeline('t1', `Drill ended${s !== 'end' ? `: scored ${s}/5` : ''}`);
  };
}
$('#inspFile').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const img = new Image(); img.src = URL.createObjectURL(f); await img.decode();
  $('#inspOut').innerHTML = '<div class="holo">Inspecting…</div>';
  try {
    const r = await inspectPanel(ai, grabFrame(img).b64);
    $('#inspOut').innerHTML = `<div class="holo"><div class="k">Predictive maintenance</div><h4>${esc(r.what)} · ${r.condition_score}/100</h4><p style="margin:4px 0">${esc(r.issues.join('; ') || 'No issues found')}</p><div class="row"><span>Action</span><b>${esc(r.action)}</b></div><div class="row"><span>Priority</span><b>${esc(r.priority)}</b></div></div>`;
    bumpSkill(sim, 'pred', 1, 'panel inspected');
    if (r.priority === 'soon' || r.priority === 'urgent') execute('schedule_event', { crew_id: 'sato', kind: 'maintenance', time: r.priority === 'urgent' ? 'now' : 'next shift', note: `${r.what}: ${r.action}` });
    pendingNotes.push(`Panel inspection: ${r.what} scored ${r.condition_score}/100, ${r.priority}: ${r.action}.`);
    renderTraining();
  } catch (err) { $('#inspOut').innerHTML = `<div class="note">${esc(friendlyError(err))}</div>`; }
};
$('#resetAll').onclick = () => { if (confirm('Erase all learning, corrections, logs, schedule and workouts stored in this browser?')) { resetAll(sim); renderTraining(); } };

/* ---------- LASH-Net ---------- */
const CORRECT = { login: ['reset_credentials', 'isolate_host'], malware: ['isolate_host', 'block_subnet'], rover: ['lock_rover_commands'], dos: ['rate_limit_uplink', 'switch_to_backup_link'], sensor: ['quarantine_sensor'], ai: ['freeze_ai_config'] };
const seenAttacks = {};
$('#attacks').innerHTML = Object.entries(ATTACKS).map(([id, a]) => `<button class="btn ${a.sev === 'CRITICAL' ? 'red' : ''}" data-a="${id}">${esc(a.name)}<br><span class="mono" style="font-size:10px;color:var(--mut)">${a.sev}</span></button>`).join('');
$('#attacks').onclick = async (e) => {
  const id = e.target.closest('button')?.dataset.a; if (!id) return;
  const a = ATTACKS[id];
  sim.incident = { id, ...a, t: Date.now(), handled: false };
  sim.network.segments[a.seg] = 'attacked'; emit(sim); renderLash(); flash('lash', 3000);
  timeline(a.sev === 'CRITICAL' ? 't3' : 't2', `LASH-Net attack: ${a.name}`);
  $('#netLog').insertAdjacentHTML('afterbegin', `<div style="color:var(--red)">${now()}  ATTACK ${esc(a.name)} on ${esc(a.seg)}: ${esc(a.log.join(' | '))}</div>`);
  if (claudeOn()) send(`[LASH-Net incident] ${a.name} (${a.sev}) on the ${a.seg} segment. Logs: ${a.log.join('; ')}. Analyse it, judge severity and respond with network_defense.`);
  else {
    for (const act of CORRECT[id]) await execute('network_defense', { action: act, target: a.seg, reason: 'offline playbook' });
    if (a.sev === 'CRITICAL') await execute('network_defense', { action: 'alert_commander', target: a.seg, reason: 'critical incident' });
    addMsg('a', `Offline playbook: ${CORRECT[id].join(', ').replace(/_/g, ' ')} on ${a.seg}. Life support stayed isolated.`, 'offline');
  }
};
function scoreNetwork(n) {
  const inc = sim.incident; if (!inc || inc.handled) return;
  if (CORRECT[inc.id].includes(n.action)) {
    inc.handled = true;
    seenAttacks[inc.id] = (seenAttacks[inc.id] || 0) + 1;
    const pts = Math.max(1, Math.round(6 / seenAttacks[inc.id]));
    sim.learning.netScores.push({ attack: inc.name, score: pts, t: Date.now() });
    bumpSkill(sim, 'emerg', pts, `stopped "${inc.name}" cleanly`);
    $('#netLog').insertAdjacentHTML('afterbegin', `<div style="color:var(--ok)">${now()}  MITIGATED ${esc(inc.name)} (+${pts}; less each repeat)</div>`);
    setTimeout(() => { if (sim.incident === inc) { sim.incident = null; for (const k of Object.keys(sim.network.segments)) if (k !== 'life_support') sim.network.segments[k] = 'normal'; emit(sim); renderLash(); } }, 8000);
    renderTraining();
  }
}
function renderLash() {
  const names = { life_support: 'Life support (VLAN 10)', crew: 'Crew devices (VLAN 20)', science: 'Science (VLAN 30)', robotics: 'Robotics & rovers (VLAN 40)', uplink: 'Earth uplink (DSN)', ai_core: 'AI core (LUNA/SELENE)' };
  $('#segs').innerHTML = Object.entries(sim.network.segments).map(([k, v]) => `<div class="${v}"><b>${names[k]}</b><span class="mono">${v.toUpperCase()}</span></div>`).join('');
}

/* ---------- AI Network (providers) ---------- */
async function renderProviders() {
  const chrome = await chromeAvailable();
  $('#provs').innerHTML = Object.entries(PROVIDERS).map(([id, p]) => {
    const s = settings[id], on = isConnected(settings, id);
    const tag = p.free ? '<span class="free">FREE</span>' : '<span class="paid">PAID KEY</span>';
    let fields = '';
    if (id === 'claude') {
      fields = `<label>API key (sk-ant-…) <a href="${p.keyUrl}" target="_blank" rel="noopener">get one ↗</a></label><input type="password" data-f="key" value="${esc(s.key)}" placeholder="sk-ant-..." autocomplete="off">
        <label>…or a proxy URL that holds the key (see README: Cloudflare Worker)</label><input type="text" data-f="proxy" value="${esc(s.proxy)}" placeholder="https://luna-proxy.yourname.workers.dev">
        <div class="grid g2"><div><label>Model</label><select data-f="model">${Object.entries(MODELS).map(([m, x]) => `<option value="${m}" ${m === s.model ? 'selected' : ''}>${x.label}</option>`).join('')}</select></div>
        <div><label>Effort</label><select data-f="effort">${['low', 'medium', 'high', 'xhigh', 'max'].map((e) => `<option ${e === s.effort ? 'selected' : ''}>${e}</option>`).join('')}</select></div></div>
        <div class="row" style="margin-top:6px"><label style="font-size:12px"><input type="checkbox" data-f="web" ${s.web !== false ? 'checked' : ''}> Web search + read pages</label><label style="font-size:12px"><input type="checkbox" data-f="code" ${s.code !== false ? 'checked' : ''}> Run code</label><span class="sub" style="margin:0;font-size:11px">Web search costs about $10 per 1,000 searches on your key</span></div>`;
    } else if (p.nokey) {
      fields = `<p class="sub" style="margin:6px 0 0">${id === 'chrome' ? `No key. Status in this browser: <b>${esc(chrome)}</b>.` : 'No key. Needs WebGPU; the first use downloads the model (about 1 GB) and caches it.'}</p>${id === 'webllm' ? `<label>Model</label><input type="text" data-f="model" value="${esc(s.model)}">` : ''}`;
    } else {
      fields = `<label>API key <a href="${p.keyUrl}" target="_blank" rel="noopener">get ${p.free ? 'a free' : 'a'} key ↗</a></label><input type="password" data-f="key" value="${esc(s.key)}" autocomplete="off">
        <div class="grid g2"><div><label>Model</label><input type="text" data-f="model" value="${esc(s.model)}"></div>${p.kind === 'openai' ? `<div><label>API base URL</label><input type="text" data-f="base" value="${esc(s.base)}"></div>` : ''}</div>`;
    }
    return `<div class="prov ${on ? 'on' : ''}" data-p="${id}"><h4><i style="background:${p.color}"></i>${esc(p.name)} <span class="sub" style="margin:0;font-weight:400">${esc(p.org)}</span> ${tag}</h4>
      <p class="sub" style="margin:4px 0 0">${esc(p.role)}</p>${fields}
      <div class="row" style="margin-top:8px"><label style="font-size:12px"><input type="checkbox" data-f="enabled" ${s.enabled ? 'checked' : ''}> Enabled</label>
      ${p.nokey ? '' : `<label style="font-size:12px"><input type="checkbox" data-f="remember" ${s.remember ? 'checked' : ''}> Remember key on this device</label>`}
      <button class="btn sm" data-test>Test link</button><span class="mono" data-out style="font-size:11.5px;color:var(--mut)"></span></div></div>`;
  }).join('') + '<p class="sub">Keys are kept in this browser and sent only to their own provider. A key in a public web page can be copied by anyone using that computer, so use a key with a spending limit, or the proxy option for Claude.</p>';
}
$('#provs').addEventListener('change', (e) => {
  const card = e.target.closest('[data-p]'); const f = e.target.dataset.f; if (!card || !f) return;
  const id = card.dataset.p;
  settings[id][f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value.trim();
  if (f === 'proxy' && settings[id].proxy && (/anthropic\.com|claude\.ai/i.test(settings[id].proxy) || !/^https:\/\//.test(settings[id].proxy))) settings[id].proxy = '';
  if ((f === 'key' || f === 'proxy') && settings[id][f]) settings[id].enabled = true;
  saveSettings(settings); rebuildClient();
  if (f !== 'key' && f !== 'proxy') renderProviders(); // keep the key test result visible
});
// Live feedback while a key is typed or pasted: format check and connection status, no re-render (keeps focus)
const KEY_SHAPE = { claude: [/^sk-ant-/, 'Claude keys start with sk-ant-'], gemini: [/^AIza/, 'Gemini keys start with AIza'], meta: [/^sk-or-/, 'OpenRouter keys start with sk-or-'], groq: [/^gsk_/, 'Groq keys start with gsk_'], openai: [/^sk-/, 'OpenAI keys start with sk-'], copilot: [/^(github_pat_|ghp_|gho_)/, 'GitHub tokens start with github_pat_ or ghp_'] };
$('#provs').addEventListener('input', (e) => {
  const card = e.target.closest('[data-p]'); const f = e.target.dataset.f;
  if (!card || (f !== 'key' && f !== 'proxy')) return;
  const id = card.dataset.p, v = e.target.value.trim(), out = card.querySelector('[data-out]');
  settings[id][f] = v;
  if (v) settings[id].enabled = true;
  const box = card.querySelector('input[data-f=enabled]'); if (box) box.checked = settings[id].enabled;
  rebuildClient();
  const shape = KEY_SHAPE[id];
  if (f === 'key' && /^https?:|\.com|\.ai\b/i.test(v)) { settings[id].key = ''; rebuildClient(); out.textContent = '⚠ That is a web link, not a key. Open the “get one” link, create a key, then copy the long code (Claude keys start with sk-ant-) and paste it here.'; out.style.color = 'var(--amber)'; return; }
  if (f === 'proxy' && v && (/anthropic\.com|claude\.ai/i.test(v) || !/^https:\/\//.test(v))) { settings[id].proxy = ''; rebuildClient(); out.textContent = '⚠ Leave this box empty unless you deployed your own Cloudflare Worker (see README). Paste your sk-ant- key in the API key box above.'; out.style.color = 'var(--amber)'; return; }
  if (f === 'key' && v && shape && !shape[0].test(v)) { out.textContent = `⚠ That doesn't look right: ${shape[1]}.`; out.style.color = 'var(--amber, #fbbf24)'; return; }
  if (f === 'key' && /\s/.test(e.target.value.trim())) { out.textContent = '⚠ The key has a space in it; paste it again.'; out.style.color = 'var(--amber, #fbbf24)'; return; }
  out.textContent = v ? 'Key entered. Checking…' : ''; out.style.color = 'var(--mut)';
  clearTimeout(card._t);
  if (v) card._t = setTimeout(() => card.querySelector('[data-test]')?.click(), 900);
});
$('#provs').addEventListener('click', async (e) => {
  if (!e.target.matches('[data-test]')) return;
  const card = e.target.closest('[data-p]'), id = card.dataset.p, out = card.querySelector('[data-out]');
  card.querySelectorAll('input[data-f=key],input[data-f=proxy],input[data-f=model],input[data-f=base]').forEach((i) => { settings[id][i.dataset.f] = i.value.trim(); });
  if (settings[id].proxy && (/anthropic\.com|claude\.ai/i.test(settings[id].proxy) || !/^https:\/\//.test(settings[id].proxy))) { settings[id].proxy = ''; card.querySelector('input[data-f=proxy]').value = ''; }
  if (id === 'claude' && !settings.claude.key && !settings.claude.proxy) { out.textContent = '✗ Paste your Claude API key (starts with sk-ant-) in the API key box first.'; out.style.color = 'var(--red)'; return; }
  settings[id].enabled = true; saveSettings(settings); rebuildClient();
  out.textContent = 'Testing…'; core.setStatus(id, 'busy');
  try {
    const r = await testProvider(settings, id, async () => {
      const m = await client.messages.create({ model: settings.claude.model, max_tokens: 2000, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Reply with exactly: LUNA-X link OK' }] });
      claudeUsage('claude', m.usage, settings.claude.model);
      return m.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    });
    out.textContent = '✓ Connected: ' + r + (settings[id].remember || PROVIDERS[id].nokey ? '' : ' (tick Remember to keep it after a refresh)'); out.style.color = 'var(--ok)'; collab(id, 'Link test passed'); announceAI(id);
  } catch (err) { out.textContent = '✗ ' + (id === 'claude' ? friendlyError(err) : providerError(id, err)); out.style.color = 'var(--red)'; collab(id, 'Link test failed', 'error'); }
  refreshCoreStatus();
});
$('#btnConnect').onclick = () => { $('[data-t=network]').click(); $('#t-network').scrollIntoView({ behavior: 'smooth', block: 'start' }); };

/* ---------- tabs ---------- */
$('#tabs').onclick = (e) => {
  const t = e.target.dataset?.t; if (!t) return;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('act', b.dataset.t === t));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('act', p.id === 't-' + t));
  if (t === 'network') renderProviders();
};

/* ---------- habitat + crew rendering ---------- */
function tile(label, val, unit, cls = '') { return `<div class="tile ${cls}"><div class="l">${label}</div><div class="v">${val}<small>${unit}</small></div></div>`; }
function renderHabitat() {
  const s = sim.sensors;
  $('#sensors').innerHTML = [
    tile('Oxygen', s.o2_pct, '%', s.o2_pct < LIMITS.o2_min ? 'bad' : ''),
    tile('ppCO₂', s.ppco2_mmhg, 'mmHg', s.ppco2_mmhg > 3 ? 'bad' : s.ppco2_mmhg > 2.5 ? 'warn' : ''),
    tile('Pressure', s.pressure_kpa, 'kPa', s.pressure_kpa < 90 ? 'bad' : s.pressure_kpa < 97 ? 'warn' : ''),
    tile('Cabin temp', s.cabin_temp_c, '°C'), tile('Humidity', s.humidity_pct, '%'),
    tile('Battery', s.battery_pct, '%', s.battery_pct < 15 ? 'bad' : s.battery_pct < 30 ? 'warn' : ''),
    tile('Solar / load', `${s.solar_kw}/${s.load_kw}`, 'kW'), tile('Water', s.water_l, 'L'),
    tile('Radiation', s.radiation_usv_h, 'µSv/h', s.radiation_usv_h > 20 ? 'bad' : s.radiation_usv_h > 2 ? 'warn' : ''),
    tile('Dust', Math.round(s.dust_level * 100), '%', s.dust_level > 0.5 ? 'warn' : ''),
    tile('Exterior', s.lunar_phase === 'day' ? s.ext_temp_c : -173, `°C · ${s.lunar_phase}`), tile('Earth link', s.earth_link, `· ${s.link_delay_s} s`, s.earth_link !== 'up' ? 'warn' : ''),
  ].join('');
  $('#rooms').innerHTML = sim.rooms.map((r) => `<tr><td>${esc(r.name)}</td><td class="mono">${r.temp_c}°</td><td class="mono">${r.setpoint_c}°</td><td><span class="sw" style="background:${LIGHTING[r.lighting].color}"></span>${esc(r.lighting)}</td><td>${esc(r.sound)}</td><td>${sim.crew.filter((c) => c.room === r.id).map((c) => esc(c.name.split(' ')[0])).join(', ')}</td></tr>`).join('');
  $('#schedule').innerHTML = sim.schedule.slice(-8).map((e) => `• ${esc(e.time)} — ${esc(e.kind.replace('_', ' '))} (${esc(e.crew)}) ${esc(e.note)}`).join('<br>') || 'Nothing scheduled.';
  $('#pClock').lastChild.textContent = `Day ${sim.missionDay} · ${clock(sim)}`;
  const worst = sim.alerts.find((a) => a.level === 'RED') || sim.alerts.find((a) => a.level === 'ORANGE') || sim.alerts[0];
  $('#pAlerts').className = 'pill ' + (!worst ? 'on' : worst.level === 'RED' ? 'bad' : 'warn');
  $('#pAlerts').lastChild.textContent = worst ? `${sim.alerts.length} alert${sim.alerts.length > 1 ? 's' : ''}: ${worst.text}` : 'No alerts';
}
function renderCrew() {
  $('#crewCards').innerHTML = sim.crew.map((c) => {
    const w = wellbeing(sim, c), v = c.vitals;
    return `<div class="cc"><div class="row" style="justify-content:space-between"><div><h4>${esc(c.name)}</h4><div class="role">${esc(c.role)} · ${esc(sim.rooms.find((r) => r.id === c.room)?.name)}</div></div><span class="tier t${w.tier}">TIER ${w.tier} · ${w.score}</span></div>
      <div class="kv"><div><span>HR</span><b>${v.hr} bpm</b></div><div><span>HRV</span><b>${v.hrv_ms} ms</b></div><div><span>SpO₂</span><b>${v.spo2}%</b></div>
      <div><span>Sleep</span><b>${c.today.sleep_h} h</b></div><div><span>Water</span><b>${c.today.water_ml} ml</b></div><div><span>Exercise</span><b>${c.today.exercise_min}+${c.today.resistive_min} min</b></div>
      <div><span>Dose</span><b>${c.radiation_msv} mSv</b></div><div><span>EEG</span><b>${eegState(c.eeg)}</b></div><div><span>Mood</span><b>${esc(c.moods.at(-1)?.mood || '–')}</b></div></div>
      <div class="row" style="margin-top:8px;font-size:12px;color:var(--mut)"><label><input type="checkbox" data-consent="${c.id}" ${c.consent.share_with_ground ? 'checked' : ''}> Share with ground</label><label><input type="checkbox" data-cam="${c.id}" ${c.consent.camera ? 'checked' : ''}> Camera check-ins</label></div></div>`;
  }).join('');
}
$('#crewCards').addEventListener('change', (e) => {
  const id = e.target.dataset.consent || e.target.dataset.cam; if (!id) return;
  const c = crewById(sim, id);
  if (e.target.dataset.consent) c.consent.share_with_ground = e.target.checked; else c.consent.camera = e.target.checked;
  save(sim); timeline('t1', `${c.name} ${e.target.checked ? 'allowed' : 'stopped'} ${e.target.dataset.consent ? 'sharing with the ground' : 'camera check-ins'}`);
});
$('#ciCrew').innerHTML = $('#asCrew').innerHTML; $('#ciCrew').onchange = renderCheckins;

/* sim events */
$('#evNight').onclick = () => { const s = sim.sensors; s.lunar_phase = s.lunar_phase === 'day' ? 'night' : 'day'; s.sun_elevation_deg = s.lunar_phase === 'day' ? 14 : -5; timeline('t1', `Lunar ${s.lunar_phase} begins`); tick(sim, 0); };
$('#evStorm').onclick = () => { sim.sensors.solar_activity = 'storm'; timeline('t3', 'Solar particle event detected'); tick(sim, 0); };
$('#evCo2').onclick = () => { sim.sensors.ppco2_mmhg = 3.6; timeline('t2', 'CO₂ scrubber fault in Systems'); tick(sim, 0); };
$('#evClear').onclick = () => { Object.assign(sim.sensors, { solar_activity: 'quiet', ppco2_mmhg: 2.1, earth_link: 'up', dust_level: 0.18 }); sim.drill = null; tick(sim, 0); };

/* main loop */
let prevAlertKeys = new Set();
onChange(sim, () => {
  renderHabitat();
  if ($('#t-crew').classList.contains('act')) renderCrew();
  const keys = new Set(sim.alerts.filter((a) => a.level === 'RED' || a.level === 'ORANGE').map((a) => a.text.replace(/[\d.]+/g, '#')));
  const fresh = [...keys].filter((k) => !prevAlertKeys.has(k));
  if (fresh.length) {
    const texts = sim.alerts.filter((a) => fresh.includes(a.text.replace(/[\d.]+/g, '#')));
    texts.forEach((a) => timeline(a.level === 'RED' ? 't3' : 't2', `ALERT ${a.level}: ${a.text}`));
    if ($('#autopilot').checked && claudeOn() && !busy) send(`[Autopilot] New alert(s): ${texts.map((a) => `${a.level} ${a.text}`).join('; ')}. Assess and respond with the right tier.`);
  }
  prevAlertKeys = keys;
});
document.querySelector('[data-t=crew]').addEventListener('click', renderCrew);
let speedV = 1; $('#speed').onchange = (e) => { speedV = +e.target.value; };
setInterval(() => { if (speedV) tick(sim, speedV); }, 1000);

/* ---------- boot ---------- */
rebuildClient();
renderTraining(); renderLash(); renderCheckins(); tick(sim, 0);
greet();
function providerError(id, err) {
  const m = String(err?.message || err);
  if (id === 'copilot' && /Failed to fetch|NetworkError|CORS/i.test(m)) return 'GitHub blocks direct browser calls to GitHub Models. Deploy the LUNA proxy (worker/) and set the Copilot API base URL to https://<your-worker>/github.';
  if (/Failed to fetch/i.test(m)) return `Could not reach ${PROVIDERS[id].name} (network or blocked by the browser).`;
  return m.slice(0, 240);
}
cv = createChatView({ $, esc, PROVIDERS, AI_ICON, isConnected, settings, aiLabel, MODELS, speak, finishBody, crisisCheck, claudeBlock, callProvider, friendlyError, providerError, setMood, flash, send, saveSettings, rebuildClient, nebula,
  directClaude: (o) => directClaude({ client, model: settings.claude.model, web: settings.claude.web !== false, code: settings.claude.code !== false, ...o }) });
setMood('idle');
