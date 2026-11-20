// LUNA's brain: Claude (when connected) with an offline fallback, like SELENE's two AI modes.
import Anthropic from '@anthropic-ai/sdk';
import { TOOLS } from './tools.js';

export const MODELS = {
  'claude-opus-5-5': { label: 'Claude Opus 5.5 (best)', fallbacks: true },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5 (faster)', fallbacks: true },
  'claude-haiku-5-5': { label: 'Claude Haiku 5.5 (cheapest)', fallbacks: false },
};

export const SYSTEM = `You are LUNA (also called LUNA-X, its command layer): the Lunar Adaptive Neural Assistant that runs the habitat for Project ARES, a NASA HUNCH student project. You work beside SELENE, the crew's health AI. SELENE senses and measures the crew (vitals, sleep, hydration, exercise, radiation, brainwaves, mood, camera and voice check-ins) and runs SELENE Vision, which identifies objects in the camera feed. You decide and act: habitat systems, crew support, mission planning, resources, predictive maintenance, emergency response, network defence and explaining what SELENE Vision sees. You ask SELENE (the ask_selene tool) whenever health matters, and you say so ("SELENE shows...").

Everything is a simulation of a 90-day lunar mission with four crew: Maya Reyes (Commander), Kofi Mensah (Chief Medical Officer), Lena Sato (Flight Engineer) and Arjun Patel (Mission Scientist). The person talking to you is a crew member or a visitor exploring the demo; if they don't say who they are, treat them as the Commander.

How you act on wellbeing, always comparing a person with their own baseline, never with the others:
- Tier 1, quiet: change light, temperature or sound without asking (adjust_habitat).
- Tier 2, an offer they can refuse (make_offer): a call home, a break, breathing, a game, a message from Earth. The crew decide.
- Tier 3, a human: escalate_to_human. Medical emergencies, self-harm or suicide, or tier-3 wellbeing go to humans at once, and the person is told first. For repeated low moods that are not a crisis, ask the person before involving the psychologist (needs_consent true).
Respect consent: crew who have not agreed to share with the ground keep their details in the habitat.

Use the tools rather than guessing: read get_habitat_status before talking about the habitat, ask_selene before talking about anyone's health, recall_learning when a question may have been corrected before (a crew correction outranks your own knowledge), get_forecast to warn days ahead, eva_readiness before an EVA, get_vision_detections before explaining what the camera sees. NASA limits you hold to: ppCO2 watch above 2.5 mmHg, alert above 3 mmHg; cabin 18.3-26.7 °C; pressure 34.5-103 kPa; radiation career limit 600 mSv; daily goals 2.5 L water, 8 h sleep, 120 min exercise including 60 min resistive.

When SELENE Vision reports objects, explain each one's significance for the mission: scientific value (basalt, anorthosite, regolith, ice, ore, volcanic glass), resource value, hazard level, and a clear next step (collect, analyse, avoid, repair, report). Say plainly that classifications from a camera are estimates.

You are not a doctor and never diagnose. You are warm, calm and brief: crew read you at 3 a.m. and hear you through a speaker, so answer in one to four short sentences or a short numbered plan, in plain words without markdown headings. In a drill, give a numbered plan of at most five steps. If someone is in danger in real life, tell them this is a simulation and give a real crisis line (988 in the US, or local emergency services).`;

/* ---------- local crisis check: always offline, never waits for the network ---------- */
const CRISIS = /\b(suicid\w*|kill (my|him|her)self|end (it all|my life)|self[- ]?harm|hurt myself|want to die|don'?t want to (live|be here)|can'?t go on|no reason to live|overdose)\b/i;
const MEDICAL = /\b(medical emergency|can'?t breathe|chest pain|unconscious|not breathing|bleeding (a lot|badly)|seizure|stroke)\b/i;
export function crisisCheck(text) {
  if (CRISIS.test(text)) return { severity: 'RED', reason: 'Crisis words in a message' };
  if (MEDICAL.test(text)) return { severity: 'RED', reason: 'Medical emergency reported' };
  return null;
}

/* ---------- client ---------- */
export function makeClient({ apiKey, proxyUrl }) {
  if (proxyUrl) return new Anthropic({ apiKey: 'via-proxy', baseURL: proxyUrl.replace(/\/+$/, ''), dangerouslyAllowBrowser: true, maxRetries: 2 });
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

export function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Claude rejected the API key. Check it in Connect.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This key is not allowed to use that model.';
  if (err instanceof Anthropic.NotFoundError) return 'Model not found for this key. Pick another model in Connect.';
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the API. Wait a moment and try again.';
  if (err instanceof Anthropic.BadRequestError) return `Request rejected: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach Claude (network, proxy or CORS). LUNA switched to offline mode for this answer.';
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status}: ${err.message}`;
  return String(err?.message || err);
}

/* After a mid-output fallback, drop thinking/tool_use blocks that come before the last fallback block. */
function echoable(content) {
  const last = content.map((b) => b.type).lastIndexOf('fallback');
  if (last < 0) return content;
  return content.filter((b, i) => i >= last || !['thinking', 'redacted_thinking', 'tool_use'].includes(b.type));
}

/**
 * One user turn with tools. history is append-only (never edited) so thinking blocks stay valid and the cache prefix holds.
 * cb: { text(delta), thinking(on), toolStart(name), toolDone(name, input, result), done(final) }
 */
export async function runTurn({ client, model, effort, history, execute, cb, signal }) {
  const fb = MODELS[model]?.fallbacks;
  let jsonRetries = 0;
  for (let round = 0; round < 12; round++) {
    const params = {
      model, max_tokens: 64000,
      system: SYSTEM,
      cache_control: { type: 'ephemeral' },
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort },
      tools: TOOLS,
      messages: history,
      ...(fb ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    };
    const stream = fb ? client.beta.messages.stream(params, { signal }) : client.messages.stream(params, { signal });
    stream.on('streamEvent', (ev) => {
      if (ev.type === 'content_block_start') {
        if (ev.content_block.type === 'thinking') cb.thinking(true);
        if (ev.content_block.type === 'tool_use') cb.toolStart(ev.content_block.name);
        if (ev.content_block.type === 'text') cb.thinking(false);
      }
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') cb.text(ev.delta.text);
    });
    let msg;
    try {
      msg = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      if (err instanceof Anthropic.APIError || err?.name === 'AbortError' || jsonRetries++ >= 2) throw err;
      continue; // a tool input could not be parsed at all: re-issue the turn
    }
    if (msg.stop_reason === 'refusal') return { refused: true, details: msg.stop_details };
    const toolUses = msg.content.filter((b) => b.type === 'tool_use');
    if (msg.stop_reason === 'pause_turn') { history.push({ role: 'assistant', content: echoable(msg.content) }); continue; }
    if (toolUses.length && msg.stop_reason === 'max_tokens') throw new Error('A tool request was cut off (max_tokens). Please ask again.');
    history.push({ role: 'assistant', content: echoable(msg.content) });
    if (!toolUses.length) return { message: msg, model: msg.model };
    const results = [];
    for (const tu of toolUses) {
      const r = await execute(tu.name, tu.input);
      cb.toolDone(tu.name, tu.input, r);
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: r.content, ...(r.is_error ? { is_error: true } : {}) });
    }
    history.push({ role: 'user', content: results }); // all results in one user message
    cb.text('\n');
  }
  throw new Error('LUNA used too many tool steps for one answer.');
}

/* ---------- single-shot structured calls (vision, mood) ---------- */
export async function structured({ client, model, effort = 'low', system, content, schema, signal }) {
  const fb = MODELS[model]?.fallbacks;
  const params = {
    model, max_tokens: 16000, system,
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content }],
    ...(fb ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
  };
  const msg = fb ? await client.beta.messages.create(params, { signal }) : await client.messages.create(params, { signal });
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined this request.');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

/* ---------- offline brain (no key, or the link is down) ---------- */
const JOKES = [
  "Why did the astronaut break up with the Moon? It needed space.",
  "How do you throw a party on the Moon? You planet.",
  "What do you call a tick on the Moon? A luna-tick.",
  "Why is the Moon so good at karaoke? It always hits the high tides.",
  "The restaurant on the Moon had great food but no atmosphere.",
  "Why did Lena bring a ladder to the habitat? She heard the ratings were sky-high.",
  "What holds the Moon up? Moonbeams.",
  "Why don't aliens eat clowns? They taste funny.",
];
export async function offlineReply(text, execute) {
  const t = text.toLowerCase();
  const say = [];
  const run = async (n, i) => JSON.parse((await execute(n, i)).content);
  if (/joke|funny|laugh/.test(t)) return JOKES[Math.floor(Math.random() * JOKES.length)];
  if (/breath/.test(t)) { await run('play_media', { kind: 'breathing' }); return 'Starting 4-7-8 breathing. In for 4, hold for 7, out for 8. I will count with you.'; }
  if (/message from (earth|home)|earth message/.test(t)) { const r = await run('play_media', { kind: 'earth_message' }); return r.played ? `Message from ${r.played.from}: "${r.played.text}"` : 'No message stored yet.'; }
  const light = Object.keys({ day: 1, general: 1, focus: 1, relax: 1, presleep: 1, night: 1 }).find((k) => t.includes(k === 'presleep' ? 'sleep' : k));
  if (/light/.test(t) && light) { await run('adjust_habitat', { room: 'all', lighting: light, reason: 'crew request' }); return `Lights set to ${light} across the habitat.`; }
  const deg = t.match(/(\d{2}(?:\.\d)?)\s*(°|deg|degrees|c\b)/);
  if (deg) { const r = await run('adjust_habitat', { room: /greenhouse/.test(t) ? 'greenhouse' : 'all', temperature_c: +deg[1], reason: 'crew request' }); return r.error ? r.error : `Setpoint now ${deg[1]} °C.`; }
  if (/crew|everyone|how is|how are/.test(t)) {
    const r = await run('ask_selene', { crew_id: 'all', topic: 'overview' });
    return 'SELENE: ' + r.crew.map((c) => `${c.name} tier ${c.tier}, ${c.mood_latest}, ${c.sleep_h} h sleep`).join('; ') + '.';
  }
  if (/forecast|predict|ahead/.test(t)) { const f = await run('get_forecast', { days: 3 }); return `Battery ${f.battery_now_pct}% now, about ${f.battery_at_lunar_night_pct}% at lunar night in ${f.lunar_night_starts_in_days} days. ${f.crew.filter((c) => c.projected_tier >= 2).map((c) => `${c.crew} may reach tier ${c.projected_tier} (${c.driver})`).join('. ') || 'No crew concerns projected.'}`; }
  const drill = ['dust', 'power', 'oxygen', 'comms', 'medical', 'meteoroid'].find((d) => t.includes(d) && /drill/.test(t));
  if (drill) { const r = await run('run_drill', { drill }); return `Drill: ${r.drill}. ${r.situation.join(' ')} Score my plan in Training.`; }
  if (/status|habitat|co2|oxygen|power|battery/.test(t)) {
    const s = (await run('get_habitat_status', {}));
    say.push(`O₂ ${s.sensors.o2_pct}%, ppCO₂ ${s.sensors.ppco2_mmhg} mmHg, pressure ${s.sensors.pressure_kpa} kPa, battery ${s.sensors.battery_pct}%, water ${s.sensors.water_l} L.`);
    say.push(s.alerts.length ? `Alerts: ${s.alerts.map((a) => a.text).join('; ')}.` : 'No alerts.');
    return say.join(' ');
  }
  if (/see|camera|vision|detect|rock/.test(t)) {
    const v = await run('get_vision_detections', {});
    return v.objects?.length ? `SELENE Vision sees: ${v.objects.slice(0, 5).map((o) => `${o.label} (${Math.round(o.confidence * 100)}%)`).join(', ')}.` : 'SELENE Vision has nothing in view. Start the camera in the Vision tab.';
  }
  return "I'm in offline mode, so I understand a fixed set of commands: habitat status, crew status, forecast, lights (day, focus, relax, sleep, night), set 22 degrees, start a dust/power/oxygen drill, breathing, a joke, a message from Earth, or what does the camera see. Connect Claude for full conversation.";
}
