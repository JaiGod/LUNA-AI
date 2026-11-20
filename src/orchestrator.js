// LUNA-X orchestrator: a registry of AI providers, task routing, and multi-model fusion.
// Claude goes through the Anthropic SDK (brain.js). The other providers use their public REST APIs
// with the user's own key, or run free on the device (Chrome built-in AI, WebLLM).
import { SPACE_CLASSES } from './vision.js';

const SETTINGS_KEY = 'luna-ai-providers-v1';

export const PROVIDERS = {
  claude: { name: 'Claude', org: 'Anthropic', color: '#d97757', free: false, role: 'Commander brain: reasoning, tools, safety review, SELENE deep scan', kind: 'anthropic', keyUrl: 'https://console.anthropic.com/settings/keys' },
  gemini: { name: 'Gemini', org: 'Google', color: '#4f8cff', free: true, role: 'Image verification, sensor fusion, geology check (free tier key)', kind: 'gemini', model: 'gemini-2.5-flash', keyUrl: 'https://aistudio.google.com/apikey' },
  openai: { name: 'OpenAI', org: 'OpenAI', color: '#10a37f', free: false, role: 'Scientific significance, engineering analysis', kind: 'openai', base: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', keyUrl: 'https://platform.openai.com/api-keys' },
  meta: { name: 'Meta Llama', org: 'Meta via OpenRouter', color: '#a78bfa', free: true, role: 'Crew conversation and interaction (free models)', kind: 'openai', base: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-4-maverick:free', keyUrl: 'https://openrouter.ai/keys' },
  groq: { name: 'Groq Llama', org: 'Groq', color: '#f55036', free: true, role: 'Fast free Llama for quick checks', kind: 'openai', base: 'https://api.groq.com/openai/v1', model: 'meta-llama/llama-4-scout-17b-16e-instruct', keyUrl: 'https://console.groq.com/keys' },
  chrome: { name: 'Gemini Nano', org: 'Chrome built-in, on device', color: '#34d399', free: true, role: 'Free offline chat, no key (Chrome only)', kind: 'chrome', nokey: true },
  webllm: { name: 'WebLLM', org: 'Llama on your GPU', color: '#fbbf24', free: true, role: 'Free offline chat, no key (downloads ~1 GB once)', kind: 'webllm', nokey: true, model: 'Llama-3.2-1B-Instruct-q4f16_1-MLC' },
};

export function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { s = {}; }
  for (const id of Object.keys(PROVIDERS)) s[id] = { enabled: false, key: '', model: PROVIDERS[id].model || '', base: PROVIDERS[id].base || '', remember: false, ...(s[id] || {}) };
  s.claude.proxy ??= ''; s.claude.model ||= 'claude-opus-5-5'; s.claude.effort ||= 'low';
  return s;
}
export function saveSettings(s) {
  const out = {};
  for (const [id, v] of Object.entries(s)) out[id] = { ...v, key: v.remember ? v.key : '' };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(out)); } catch { /* ignore */ }
}
export function isConnected(s, id) {
  const p = PROVIDERS[id], v = s[id];
  if (!v?.enabled) return false;
  if (p.nokey) return true;
  if (id === 'claude') return !!(v.key || v.proxy);
  return !!v.key;
}

/* ---------- collaboration stream ---------- */
const listeners = new Set();
export function onCollab(fn) { listeners.add(fn); }
export function collab(provider, text, state = 'done') { for (const fn of listeners) fn({ t: Date.now(), provider, text, state }); }

/* ---------- REST calls ---------- */
const parseJSON = (t) => {
  const m = String(t).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('model did not return JSON');
  return JSON.parse(m[0]);
};

async function geminiCall(cfg, { system, text, images = [], json = false, signal }) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.key },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ role: 'user', parts: [...images.map((b) => ({ inline_data: { mime_type: 'image/jpeg', data: b } })), { text }] }],
      generationConfig: json ? { responseMimeType: 'application/json' } : undefined,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message || `Gemini HTTP ${res.status}`);
  return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

async function openaiCompatCall(cfg, { system, text, images = [], signal }) {
  const content = images.length ? [{ type: 'text', text }, ...images.map((b) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b}` } }))] : text;
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` };
  if (cfg.base.includes('openrouter.ai')) { headers['HTTP-Referer'] = location.origin; headers['X-Title'] = 'LUNA-X AI'; }
  const res = await fetch(`${cfg.base.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST', signal, headers,
    body: JSON.stringify({ model: cfg.model, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content }], max_tokens: 1500 }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
  return j.choices?.[0]?.message?.content || '';
}

/* ---------- free on-device models ---------- */
let chromeSession, webllmEngine;
export async function chromeAvailable() {
  try {
    if (!('LanguageModel' in self)) return 'unavailable';
    return await self.LanguageModel.availability();
  } catch { return 'unavailable'; }
}
async function chromeCall({ system, text }) {
  if (!chromeSession) chromeSession = await self.LanguageModel.create({ initialPrompts: [{ role: 'system', content: system }] });
  return chromeSession.prompt(text);
}
async function webllmCall(cfg, { system, text, onProgress }) {
  if (!webllmEngine) {
    if (!navigator.gpu) throw new Error('WebLLM needs WebGPU (Chrome or Edge on a recent GPU).');
    const webllm = await import(/* @vite-ignore */ 'https://esm.run/@mlc-ai/web-llm@0.2.79');
    webllmEngine = await webllm.CreateMLCEngine(cfg.model, { initProgressCallback: (p) => onProgress?.(p.text) });
  }
  const r = await webllmEngine.chat.completions.create({ messages: [{ role: 'system', content: system }, { role: 'user', content: text }], max_tokens: 400 });
  return r.choices[0].message.content;
}

export async function callProvider(settings, id, args) {
  const p = PROVIDERS[id], cfg = settings[id];
  if (p.kind === 'gemini') return geminiCall(cfg, args);
  if (p.kind === 'openai') return openaiCompatCall(cfg, args);
  if (p.kind === 'chrome') return chromeCall(args);
  if (p.kind === 'webllm') return webllmCall(cfg, args);
  throw new Error('Claude is called through the Anthropic SDK');
}

export async function testProvider(settings, id, claudeTest) {
  if (id === 'claude') return claudeTest();
  if (id === 'chrome') { const a = await chromeAvailable(); if (a === 'unavailable') throw new Error('Not available in this browser (needs a recent desktop Chrome with built-in AI).'); }
  const out = await callProvider(settings, id, { system: 'Reply with exactly: LUNA-X link OK', text: 'Link check' });
  return out.trim().slice(0, 80);
}

/* ---------- multi-model verification + fusion ---------- */
const VERIFY_SYSTEM = `You verify object classifications for SELENE Vision in a lunar habitat simulation (NASA HUNCH student demo). Earth objects map to their nearest space analog. For each numbered object (box is [x,y,w,h] in 0-1000 image coordinates), give your own label from this taxonomy, its category and your confidence 0-1. Taxonomy: ${JSON.stringify(SPACE_CLASSES)}. Answer only with JSON: {"objects":[{"index":0,"label":"...","category":"geology|human|equipment|hazard","confidence":0.0,"note":"short"}]}`;
const VERIFIERS = ['gemini', 'openai', 'meta', 'groq'];

export function verifiersOnline(settings) { return VERIFIERS.filter((id) => isConnected(settings, id)); }

export async function verifyDetections(settings, imageB64, objects, signal) {
  const list = objects.map((o, i) => ({ index: i, selene_label: o.label, box: o.box }));
  const ids = verifiersOnline(settings);
  const results = await Promise.all(ids.map(async (id) => {
    collab(id, 'Verifying SELENE detections…', 'working');
    try {
      const text = await callProvider(settings, id, { system: VERIFY_SYSTEM, text: `Objects: ${JSON.stringify(list)}`, images: [imageB64], json: true, signal });
      const j = parseJSON(text);
      collab(id, `Image verification complete (${j.objects?.length ?? 0} objects)`);
      return { id, objects: Array.isArray(j.objects) ? j.objects : [] };
    } catch (e) {
      collab(id, `Verification failed: ${e.message}`, 'error');
      return { id, error: e.message, objects: [] };
    }
  }));
  return fuse(objects, results);
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\b(sample|deposit|rock|the|a)\b/g, '').trim();
const same = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };

// Confidence-weighted vote per object. Claude's SELENE label is one vote; each verifier is another.
export function fuse(objects, results) {
  const fused = objects.map((o, i) => {
    const votes = [{ id: 'claude', label: o.label, category: o.category, confidence: o.confidence }];
    for (const r of results) {
      const v = r.objects.find((x) => x.index === i);
      if (v && typeof v.confidence === 'number') votes.push({ id: r.id, label: v.label, category: v.category, confidence: Math.max(0, Math.min(1, v.confidence)), note: v.note });
    }
    const groups = [];
    for (const v of votes) { const g = groups.find((x) => same(x.label, v.label)); g ? g.votes.push(v) : groups.push({ label: v.label, category: v.category, votes: [v] }); }
    for (const g of groups) g.weight = g.votes.reduce((s, v) => s + v.confidence, 0);
    groups.sort((a, b) => b.weight - a.weight);
    const top = groups[0];
    const total = votes.reduce((s, v) => s + v.confidence, 0) || 1;
    const agreement = top.votes.length / votes.length;
    const meanConf = top.weight / top.votes.length;
    return {
      ...o, final_label: top.label, final_category: top.category,
      fused_confidence: Math.round(meanConf * agreement * 1000) / 1000,
      share_of_weight: Math.round((top.weight / total) * 100) / 100,
      agreement: `${top.votes.length}/${votes.length} models`,
      votes, verified: votes.length > 1 && agreement >= 0.5,
    };
  });
  const models = ['claude', ...results.filter((r) => !r.error).map((r) => r.id)];
  collab('lunax', `Fused ${fused.length} objects from ${models.length} model${models.length > 1 ? 's' : ''}`);
  return { models, errors: results.filter((r) => r.error).map((r) => ({ provider: r.id, error: r.error })), objects: fused };
}

/* ---------- free chat fallback (no Claude) ---------- */
export function freeChatOrder(settings) {
  return ['gemini', 'meta', 'groq', 'openai', 'chrome', 'webllm'].filter((id) => isConnected(settings, id));
}
