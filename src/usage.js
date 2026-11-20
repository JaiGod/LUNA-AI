// Usage meter for every connected AI, counted in this browser from each API response.
// Shared with SELENE (same site, same storage key). Official numbers live in each provider's dashboard.
const KEY = 'luna-ai-usage-v1';

// USD per million tokens. Claude prices from Anthropic's model list; OpenAI gpt-4.1-mini list price.
// Free tiers (Gemini free key, Groq, OpenRouter :free, on-device) cost nothing within their limits.
export const PRICES = {
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6, cacheRead: 0.1, cacheWrite: 0.4 },
};
export const WEB_SEARCH_USD = 0.01; // Claude web search: $10 per 1,000 searches

export const DASHBOARDS = {
  claude: 'https://console.anthropic.com/usage',
  gemini: 'https://aistudio.google.com/usage',
  openai: 'https://platform.openai.com/usage',
  meta: 'https://openrouter.ai/activity',
  groq: 'https://console.groq.com/dashboard/usage',
};

const blank = () => ({ requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0, cost: 0 });
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.total) return s; } catch { /* ignore */ }
  return { since: Date.now(), total: {}, days: {} };
}
let state = load();
const listeners = new Set();
export function onUsage(fn) { listeners.add(fn); }
const today = () => new Date().toISOString().slice(0, 10);

/** u: { input, output, cacheRead, cacheWrite, searches, model } */
export function recordUsage(id, u = {}) {
  state = load(); // pick up anything SELENE recorded in another tab
  const p = PRICES[u.model] || null;
  const cost = p ? ((u.input || 0) * p.in + (u.output || 0) * p.out + (u.cacheRead || 0) * p.cacheRead + (u.cacheWrite || 0) * p.cacheWrite) / 1e6 + (u.searches || 0) * (id === 'claude' ? WEB_SEARCH_USD : 0) : 0;
  const d = today();
  state.days[d] = state.days[d] || {};
  for (const bucket of [state.total, state.days[d]]) {
    const b = (bucket[id] = { ...blank(), ...(bucket[id] || {}) });
    b.requests += 1;
    b.input += u.input || 0; b.output += u.output || 0;
    b.cacheRead += u.cacheRead || 0; b.cacheWrite += u.cacheWrite || 0;
    b.searches += u.searches || 0; b.cost += cost;
  }
  const keep = Object.keys(state.days).sort().slice(-30); // 30 days of history
  state.days = Object.fromEntries(keep.map((k) => [k, state.days[k]]));
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  listeners.forEach((f) => f());
}
export function claudeUsage(id, usage, model) {
  if (!usage) return;
  recordUsage(id, {
    model, input: usage.input_tokens || 0, output: usage.output_tokens || 0,
    cacheRead: usage.cache_read_input_tokens || 0, cacheWrite: usage.cache_creation_input_tokens || 0,
    searches: usage.server_tool_use?.web_search_requests || 0,
  });
}
export function getUsage() { state = load(); return { since: state.since, total: state.total, today: state.days[today()] || {} }; }
export function resetUsage() { state = { since: Date.now(), total: {}, days: {} }; try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } listeners.forEach((f) => f()); }
export const fmtTokens = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));
export const fmtUSD = (n) => (n === 0 ? '$0' : n < 0.01 ? '<$0.01' : '$' + n.toFixed(2));
