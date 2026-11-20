// LUNA-X Workspace: long-term memory, Luna agents, projects, and task routing.
// Everything is stored in this browser (localStorage), never on a server.
const KEY = 'luna-workspace-v1';

export const AGENTS = {
  luna: { name: 'LUNA-X', icon: '🌙', blurb: 'All-round assistant and habitat AI', prompt: '' },
  engineer: {
    name: 'Luna Engineer', icon: '🛠️', blurb: 'CAD, Blender, Arduino and electronics, NASA HUNCH builds',
    prompt: 'Act as Luna Engineer: a hands-on engineering co-pilot for CAD (Fusion 360, Onshape, SolidWorks), Blender modelling and Python scripting, 3D printing, Arduino/ESP32/Raspberry Pi electronics, sensors and wiring, and NASA HUNCH hardware. Give concrete specs, dimensions with units, bills of materials, wiring tables, working code and step-by-step build plans, and point out safety and test steps.',
  },
  researcher: {
    name: 'Luna Researcher', icon: '🔬', blurb: 'Finds sources and papers, summarises, writes reports',
    prompt: 'Act as Luna Researcher: search the web for strong sources (NASA, journals, universities, agencies), read the important pages, and write a structured report: key findings, evidence with citations, disagreements and uncertainty, and a reference list with links. When asked, also produce a slide-by-slide presentation outline. Never invent a source.',
  },
  designer: {
    name: 'Luna Designer', icon: '🎨', blurb: 'Websites, UI/UX, FBLA projects',
    prompt: 'Act as Luna Designer: a UI/UX and web designer for websites, apps, posters and FBLA projects. Give layout structure, type and colour choices with hex values, accessibility (contrast, focus, alt text), and complete working HTML/CSS/JS when asked. Explain design decisions briefly.',
  },
  marketing: {
    name: 'Luna Marketing', icon: '📣', blurb: 'Ads, product pitches, presentation scripts',
    prompt: 'Act as Luna Marketing: write persuasive, honest marketing for a defined audience: ads, slogans, product pitches, elevator pitches, competition presentation scripts with timings, and social posts. Offer two or three variations and a clear call to action. Never make claims the facts do not support.',
  },
};

const DEFAULT_PROJECT = {
  id: 'lunar-base', name: 'Lunar Base (NASA HUNCH · Project ARES)',
  notes: [
    'Parts: Habitat · AI Monitoring (LUNA-X + SELENE) · Smart Bed · Health Suit · Smart Ring · Contact Lens · Luna Glasses.',
    'Links: main site https://jaigod.github.io/LunarSmartAdaptiveHabitat/ · SELENE https://jaigod.github.io/lunar-crew-monitor/ · 3D gallery https://jaigod.github.io/LunarHabitat-3D/ · LUNA-X https://jaigod.github.io/LUNA-AI/',
  ].join('\n'),
  log: [],
};

function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* storage blocked */ }
  s = s && typeof s === 'object' ? s : {};
  return {
    memoryOn: s.memoryOn !== false,
    memory: Array.isArray(s.memory) ? s.memory : [],
    projects: Array.isArray(s.projects) && s.projects.length ? s.projects : [structuredClone(DEFAULT_PROJECT)],
    active: s.active ?? 'lunar-base',
    agent: AGENTS[s.agent] ? s.agent : 'luna',
    autoRoute: s.autoRoute !== false,
  };
}
export const ws = load();
const listeners = new Set();
export function onWorkspace(fn) { listeners.add(fn); }
export function saveWs() {
  try { localStorage.setItem(KEY, JSON.stringify(ws)); } catch { /* ignore */ }
  listeners.forEach((f) => f());
}

/* ---------- memory ---------- */
let nextId = Math.max(0, ...ws.memory.map((m) => m.id || 0)) + 1;
export function remember(text, source = 'you') {
  const t = String(text || '').trim().slice(0, 400);
  if (!t) return null;
  const dup = ws.memory.find((m) => m.text.toLowerCase() === t.toLowerCase());
  if (dup) return dup;
  const m = { id: nextId++, text: t, source, t: Date.now() };
  ws.memory.push(m);
  if (ws.memory.length > 60) ws.memory.splice(0, ws.memory.length - 60);
  saveWs();
  return m;
}
export function forget(idOrText) {
  const before = ws.memory.length;
  const q = String(idOrText).toLowerCase();
  ws.memory = ws.memory.filter((m) => !(String(m.id) === q || m.text.toLowerCase().includes(q)));
  saveWs();
  return before - ws.memory.length;
}

/* ---------- projects ---------- */
export const activeProject = () => ws.projects.find((p) => p.id === ws.active) || null;
export function addProject(name) {
  const id = (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project') + '-' + Date.now().toString(36).slice(-4);
  ws.projects.push({ id, name: name.slice(0, 80), notes: '', log: [] });
  ws.active = id; saveWs();
  return id;
}
export function logProject(note, projectId) {
  const p = ws.projects.find((x) => x.id === (projectId || ws.active)) || activeProject();
  if (!p) return null;
  p.log.push({ t: Date.now(), note: String(note).slice(0, 600) });
  if (p.log.length > 40) p.log.splice(0, p.log.length - 40);
  saveWs();
  return p;
}

/* ---------- context for the AI ---------- */
export function wsContext({ full = true } = {}) {
  const parts = [];
  const a = AGENTS[ws.agent];
  if (a?.prompt) parts.push(`[Active agent: ${a.name}. ${full ? a.prompt : ''}]`);
  if (!full) return parts.join('\n');
  if (ws.memoryOn && ws.memory.length) parts.push(`[Long-term memory about the user (saved earlier; use it when relevant, save new lasting facts with the remember tool): ${ws.memory.map((m) => `#${m.id} ${m.text}`).join(' | ')}]`);
  const p = activeProject();
  if (p) parts.push(`[Active project "${p.name}". Notes: ${p.notes.slice(0, 2500) || 'none yet'}. Recent progress: ${p.log.slice(-8).map((l) => new Date(l.t).toLocaleDateString() + ': ' + l.note).join(' | ') || 'none yet'}. Save meaningful progress with update_project.]`);
  return parts.join('\n');
}
// changes whenever memory, project or agent change, so the full context is re-sent only then
export const wsSignature = () => JSON.stringify([ws.agent, ws.memoryOn, ws.memory.map((m) => m.id), ws.active, activeProject()?.notes, activeProject()?.log.length]);

/* ---------- task routing (which connected AI is best for this task) ---------- */
export function routeTask(text, { hasFiles, connected }) {
  const t = text.toLowerCase();
  const has = (id) => connected.includes(id);
  if (hasFiles) return { id: 'claude', why: 'files and images' };
  if (/habitat|crew|selene|sensor|drill|eva|oxygen|co2|co₂|lash|network attack|forecast|lights?|rover/.test(t)) return { id: 'claude', why: 'habitat tools' };
  if (/\b(code|coding|program|python|javascript|bug|debug|function|script|arduino|html|css|sql|algorithm|math|calculate|solve|equation|proof)\b/.test(t)) return { id: 'claude', why: 'coding and reasoning' };
  if (has('gemini') && /\b(latest|news|today|current|recent|search|look up|find (me )?(sources|info)|who won|price|weather)\b/.test(t)) return { id: 'gemini', why: 'quick research with Google Search (free)' };
  if (has('openai') && /\b(poem|story|lyrics|song|slogan|tagline|ad copy|creative|brainstorm names|joke)\b/.test(t)) return { id: 'openai', why: 'creative writing' };
  return { id: 'claude', why: 'general reasoning' };
}
