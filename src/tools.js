// LUNA's tools. Claude decides when to call them; the browser runs them against the simulation.
// Inputs are validated here before anything runs (eager input streaming turns server-side validation off).
import {
  LIMITS, LIGHTING, SOUNDS, MOODS, SKILLS, DRILLS, ATTACKS, NET_ACTIONS,
  wellbeing, eegState, forecast, bestInterventions, crewById, clock, save, emit, learnLog, bumpSkill,
} from './sim.js';

const crewIds = ['reyes', 'mensah', 'sato', 'patel', 'all'];
const roomIds = ['hub', 'quarters', 'galley', 'greenhouse', 'shelter', 'medical', 'exercise', 'systems', 'airlock', 'all'];

const T = (name, description, properties, required = []) => ({
  name, description, eager_input_streaming: true,
  input_schema: { type: 'object', properties, required, additionalProperties: false },
});

export const TOOLS = [
  T('get_habitat_status', 'Read the habitat sensors (cabin air, power, water, radiation, dust, lunar day/night, Earth link), every room, active alerts, the current drill or network incident, and the schedule. Call this before answering anything about the habitat.', {}),
  T('ask_selene', 'Ask SELENE, the crew health AI, for health data. SELENE tracks vitals (HR, HRV, SpO2, BP, temperature), sleep, hydration, exercise countermeasures, radiation dose, EEG state, mood history, camera/voice check-ins, reaction tests and a wellbeing score against each person\'s own baseline with a response tier (0 none, 1 mild, 2 moderate, 3 severe). SELENE also reports what it has learned helps each person. Detail is hidden for crew who have not consented to sharing beyond the habitat.', {
    crew_id: { type: 'string', enum: crewIds, description: "Crew member id, or 'all' for a crew overview" },
    topic: { type: 'string', enum: ['overview', 'vitals', 'sleep', 'hydration', 'exercise', 'radiation', 'brainwaves', 'mood', 'what_helps'] },
  }, ['crew_id', 'topic']),
  T('adjust_habitat', 'Tier 1 (silent) change: set a room\'s lighting mode, temperature setpoint and/or soundscape. Greenhouse 15-30 °C, other rooms 18-26 °C. Lighting modes follow ISS lighting (day 6500 K, general 4500 K, pre-sleep 2700 K) plus focus, relax and night (1900 K).', {
    room: { type: 'string', enum: roomIds },
    lighting: { type: 'string', enum: Object.keys(LIGHTING) },
    temperature_c: { type: 'number' },
    soundscape: { type: 'string', enum: SOUNDS },
    reason: { type: 'string', description: 'Short reason shown in the activity log' },
  }, ['room', 'reason']),
  T('make_offer', 'Tier 2: show a crew member an offer they can accept or decline (a call home, a break, a breathing exercise, a game, quiet time, a workout, a message from Earth). Never act on it without their answer. Their answer trains what LUNA learns works for them.', {
    crew_id: { type: 'string', enum: crewIds.slice(0, 4) },
    offer: { type: 'string', enum: ['call_home', 'crew_break', 'breathing_exercise', 'quiet_time', 'game_night', 'workout', 'earth_message', 'nap', 'talk_to_crewmate', 'music'] },
    message: { type: 'string', description: 'What the crew member reads, one or two warm sentences' },
  }, ['crew_id', 'offer', 'message']),
  T('escalate_to_human', 'Tier 3: alert humans immediately. Use for medical emergencies, any mention of self-harm or suicide, crisis words, or tier-3 wellbeing. Tells the person first, then the Chief Medical Officer and Commander (and the ground psychologist/flight surgeon if the crew member has consented, or always for life-threatening situations). For repeated low moods that are not a crisis, ask the person for permission first by setting needs_consent true.', {
    crew_id: { type: 'string', enum: [...crewIds.slice(0, 4), 'unknown'] },
    severity: { type: 'string', enum: ['RED', 'ORANGE'] },
    reason: { type: 'string' },
    needs_consent: { type: 'boolean' },
  }, ['crew_id', 'severity', 'reason']),
  T('log_entry', 'Log something a crew member reports: water drunk (ml), sleep (hours), exercise or resistive exercise (minutes), or a mood.', {
    crew_id: { type: 'string', enum: crewIds.slice(0, 4) },
    kind: { type: 'string', enum: ['water_ml', 'sleep_h', 'exercise_min', 'resistive_min', 'mood'] },
    value: { type: 'number', description: 'Amount for numeric kinds; ignored for mood' },
    mood: { type: 'string', enum: MOODS },
  }, ['crew_id', 'kind']),
  T('schedule_event', 'Add an event to the habitat schedule (family call, crew-wide break, workout, EVA, maintenance, medical check).', {
    crew_id: { type: 'string', enum: crewIds },
    kind: { type: 'string', enum: ['family_call', 'crew_break', 'workout', 'eva', 'maintenance', 'medical_check', 'meeting'] },
    time: { type: 'string', description: 'Habitat time HH:MM, optionally with a day like "day 38 14:00"' },
    note: { type: 'string' },
  }, ['crew_id', 'kind', 'time']),
  T('get_forecast', 'Predict the next days: battery at lunar night, water, dust, and each crew member\'s projected wellbeing tier so problems are flagged days ahead.', {
    days: { type: 'integer', minimum: 1, maximum: 14 },
  }, ['days']),
  T('eva_readiness', 'Check suit and conditions before an EVA: suit pressure, battery, CO2 scrubber, dust-off cycle, exterior temperature, radiation, solar activity, sun elevation, and the crew member\'s wellbeing tier and reaction-test result.', {
    crew_id: { type: 'string', enum: crewIds.slice(0, 4) },
  }, ['crew_id']),
  T('run_drill', 'Start an emergency drill in the habitat simulation. The crew scores LUNA\'s plan afterwards, which trains LUNA\'s skill areas.', {
    drill: { type: 'string', enum: Object.keys(DRILLS) },
  }, ['drill']),
  T('network_defense', 'LASH-Net: respond to a network incident. Life support sits on its own locked segment that crew devices cannot route to. Actions: isolate_host, block_subnet, rate_limit_uplink, quarantine_sensor, reset_credentials, lock_rover_commands, switch_to_backup_link, freeze_ai_config, alert_commander.', {
    action: { type: 'string', enum: NET_ACTIONS },
    target: { type: 'string', description: 'Host, segment or sensor id' },
    reason: { type: 'string' },
  }, ['action', 'target', 'reason']),
  T('recall_learning', 'Recall what the crew has taught LUNA: corrections to earlier answers, ratings, skill-area scores, drill scores, and which interventions worked for whom. Check this before answering a question the crew may have corrected before.', {
    topic: { type: 'string', description: 'Optional keyword to filter corrections' },
  }),
  T('play_media', 'Play something for the crew: a guided 4-7-8 breathing exercise, a soundscape, space music, or a recorded message from Earth for a crew member.', {
    kind: { type: 'string', enum: ['breathing', 'earth_message', 'space_music', 'stop'] },
    crew_id: { type: 'string', enum: crewIds.slice(0, 4) },
  }, ['kind']),
  T('get_vision_detections', 'Read what SELENE Vision currently sees through the camera or the last scanned image: each object with its space class (geology, human, equipment, hazard), confidence, estimated distance, risk and resource value.', {}),
];

/* ---------- validation ---------- */
function validate(tool, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'input must be an object';
  const { properties, required } = tool.input_schema;
  for (const k of required) if (input[k] === undefined) return `missing "${k}"`;
  for (const [k, v] of Object.entries(input)) {
    const p = properties[k];
    if (!p) return `unknown field "${k}"`;
    if (p.type === 'string' && typeof v !== 'string') return `"${k}" must be a string`;
    if ((p.type === 'number' || p.type === 'integer') && (typeof v !== 'number' || !Number.isFinite(v))) return `"${k}" must be a number`;
    if (p.type === 'integer' && !Number.isInteger(v)) return `"${k}" must be an integer`;
    if (p.type === 'boolean' && typeof v !== 'boolean') return `"${k}" must be true or false`;
    if (p.enum && !p.enum.includes(v)) return `"${k}" must be one of ${p.enum.join(', ')}`;
    if (p.minimum !== undefined && v < p.minimum) return `"${k}" below ${p.minimum}`;
    if (p.maximum !== undefined && v > p.maximum) return `"${k}" above ${p.maximum}`;
  }
  return null;
}

/* ---------- execution ---------- */
// ui hooks: { activity(tier, text), offer(o), escalate(e), drill(d), media(m), network(n) }
export function makeExecutor(sim, ui, vision) {
  const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
  const handlers = {
    get_habitat_status() {
      return {
        habitat_time: clock(sim), mission_day: `${sim.missionDay} of ${sim.missionLength}`,
        sensors: sim.sensors,
        limits: { ppco2_watch_mmhg: LIMITS.ppco2_watch, ppco2_alert_mmhg: LIMITS.ppco2_alert, cabin_band_c: [LIMITS.cabin_min, LIMITS.cabin_max], pressure_kpa: [LIMITS.pressure_min, LIMITS.pressure_max] },
        rooms: sim.rooms.map((r) => ({ ...r, people: sim.crew.filter((c) => c.room === r.id).map((c) => c.name) })),
        alerts: sim.alerts, drill: sim.drill && { drill: sim.drill.t, steps: sim.drill.steps },
        network_incident: sim.incident && { name: sim.incident.name, severity: sim.incident.sev, segment: sim.incident.seg, log: sim.incident.log },
        network_segments: sim.network.segments, schedule: sim.schedule.slice(-10),
      };
    },
    ask_selene({ crew_id, topic }) {
      const list = crew_id === 'all' ? sim.crew : [crewById(sim, crew_id)];
      return {
        source: 'SELENE crew health AI (simulated data, not a medical device)',
        crew: list.map((c) => {
          const w = wellbeing(sim, c);
          const base = { name: c.name, role: c.role, room: c.room, wellbeing_score: w.score, tier: w.tier, consented_ground_sharing: c.consent.share_with_ground };
          if (crew_id === 'all' && topic === 'overview') return { ...base, mood_latest: c.moods.at(-1)?.mood, sleep_h: c.today.sleep_h, eeg: eegState(c.eeg) };
          const d = { ...base };
          if (['overview', 'vitals'].includes(topic)) Object.assign(d, { vitals: c.vitals, baseline: { hr: c.base.hr, hrv_ms: c.base.hrv } });
          if (['overview', 'sleep'].includes(topic)) Object.assign(d, { sleep_h: c.today.sleep_h, sleep_goal_h: LIMITS.sleep_goal_h, sleep_debt_h: w.sleep_debt_h });
          if (['overview', 'hydration'].includes(topic)) Object.assign(d, { water_ml: c.today.water_ml, goal_ml: LIMITS.water_goal_ml });
          if (['overview', 'exercise'].includes(topic)) Object.assign(d, { exercise_min: c.today.exercise_min, resistive_min: c.today.resistive_min, goals: { exercise_min: 120, resistive_min: 60 } });
          if (['overview', 'radiation'].includes(topic)) Object.assign(d, { mission_dose_msv: c.radiation_msv, today_msv: c.radiation_today_msv, career_limit_msv: LIMITS.career_msv });
          if (['overview', 'brainwaves'].includes(topic)) Object.assign(d, { eeg_bands: c.eeg, eeg_state: eegState(c.eeg) });
          if (['overview', 'mood'].includes(topic)) Object.assign(d, { moods_recent: c.moods.slice(-7).map((m) => m.mood), low_mood_repeats_last7: w.low_mood_repeats_last7, last_checkin: c.checkins.at(-1) || null, last_reaction_test: c.pvt.at(-1) || null });
          if (['overview', 'what_helps', 'mood'].includes(topic)) d.what_helps = bestInterventions(sim, c.id);
          return d;
        }),
      };
    },
    adjust_habitat({ room, lighting, temperature_c, soundscape, reason }) {
      const rooms = room === 'all' ? sim.rooms : sim.rooms.filter((r) => r.id === room);
      if (temperature_c !== undefined) {
        const [lo, hi] = room === 'greenhouse' ? [15, 30] : [18, 26];
        if (temperature_c < lo || temperature_c > hi) return { error: `temperature must be ${lo}-${hi} °C for ${room}` };
      }
      for (const r of rooms) {
        if (lighting) r.lighting = lighting;
        if (temperature_c !== undefined) r.setpoint_c = temperature_c;
        if (soundscape) r.sound = soundscape;
      }
      const what = [lighting && `lights ${LIGHTING[lighting].label}`, temperature_c !== undefined && `setpoint ${temperature_c} °C`, soundscape && `sound ${soundscape}`].filter(Boolean).join(', ');
      ui.activity(1, `${room === 'all' ? 'All rooms' : rooms[0]?.name}: ${what || 'no change'} — ${reason}`);
      emit(sim);
      return { ok: true, tier: 1, room, applied: what };
    },
    make_offer({ crew_id, offer, message }) {
      const c = crewById(sim, crew_id);
      const o = { id: Math.random().toString(36).slice(2, 8), crew: c.id, name: c.name, offer, message, t: Date.now(), status: 'pending' };
      sim.offers.unshift(o);
      ui.offer(o);
      ui.activity(2, `Offer to ${c.name}: ${offer.replace(/_/g, ' ')}`);
      return { ok: true, tier: 2, status: 'shown — waiting for the crew member to accept or decline', offer_id: o.id };
    },
    escalate_to_human({ crew_id, severity, reason, needs_consent }) {
      const c = crew_id === 'unknown' ? null : crewById(sim, crew_id);
      const e = { t: Date.now(), crew: c?.name ?? 'Unknown crew member', severity, reason, needs_consent: !!needs_consent };
      sim.escalations.unshift(e);
      ui.escalate(e);
      ui.activity(3, `${needs_consent ? 'Asked permission to involve' : severity + ' alert to'} the CMO and Commander — ${e.crew}: ${reason}`);
      return { ok: true, tier: 3, notified: needs_consent ? ['asked the crew member first'] : ['crew member told first', 'Chief Medical Officer', 'Commander', ...(severity === 'RED' || c?.consent.share_with_ground ? ['ground flight surgeon / psychologist'] : [])], note: 'Simulation: no real people were contacted. Real crisis lines are shown on screen.' };
    },
    log_entry({ crew_id, kind, value, mood }) {
      const c = crewById(sim, crew_id);
      if (kind === 'mood') {
        if (!mood) return { error: 'mood is required when kind is mood' };
        c.moods.push({ t: Date.now(), mood, src: 'luna' });
      } else {
        if (value === undefined || value < 0 || value > 10000) return { error: 'value must be a sensible positive number' };
        if (kind === 'sleep_h') c.today.sleep_h = Math.min(14, value);
        else c.today[kind] = Math.round(c.today[kind] + value);
      }
      save(sim); emit(sim);
      ui.activity(1, `Logged for ${c.name}: ${kind === 'mood' ? 'mood ' + mood : kind.replace('_', ' ') + ' ' + value}`);
      return { ok: true, today: c.today, latest_mood: c.moods.at(-1)?.mood };
    },
    schedule_event({ crew_id, kind, time, note }) {
      const e = { crew: crew_id, kind, time, note: note || '' };
      sim.schedule.push(e); save(sim); emit(sim);
      ui.activity(1, `Scheduled ${kind.replace('_', ' ')} for ${crew_id} at ${time}`);
      return { ok: true, schedule: sim.schedule.slice(-10) };
    },
    get_forecast({ days }) { return forecast(sim, days); },
    eva_readiness({ crew_id }) {
      const c = crewById(sim, crew_id), s = sim.sensors, w = wellbeing(sim, c);
      const suit = { pressure_kpa: 29.6, battery_pct: 92, co2_scrubber_pct: 88, dust_off_cycle: 'complete', seals: 'nominal' };
      const blockers = [];
      if (s.solar_activity !== 'quiet') blockers.push(`solar activity ${s.solar_activity}`);
      if (s.dust_level > 0.5) blockers.push('dust level high');
      if (w.tier >= 2) blockers.push(`crew wellbeing tier ${w.tier}`);
      const pvt = c.pvt.at(-1);
      if (pvt && pvt.mean_ms > 400) blockers.push(`slow reaction test (${pvt.mean_ms} ms)`);
      return { crew: c.name, suit, exterior: { temp_c: s.ext_temp_c, radiation_usv_h: s.radiation_usv_h, solar_activity: s.solar_activity, sun_elevation_deg: s.sun_elevation_deg, dust_level: s.dust_level, phase: s.lunar_phase }, wellbeing_tier: w.tier, last_reaction_test: pvt || 'none — suggest one at the Wellness Dock', go: blockers.length === 0, blockers };
    },
    run_drill({ drill }) {
      const d = DRILLS[drill];
      sim.drill = { id: drill, ...d, started: Date.now() };
      ui.drill(sim.drill);
      ui.activity(3, `DRILL started: ${d.t}`);
      emit(sim);
      return { ok: true, drill: d.t, skill_area: SKILLS[d.s], situation: d.steps, instruction: 'Give the crew a short numbered response plan. The crew will score it 1-5 in the Training tab.' };
    },
    network_defense({ action, target, reason }) {
      const n = { t: Date.now(), action, target, reason };
      sim.network.actions.unshift(n);
      const segs = sim.network.segments;
      if (action === 'block_subnet' && target in segs) segs[target] = 'blocked';
      if (action === 'isolate_host' || action === 'quarantine_sensor') { const seg = sim.incident?.seg; if (seg && seg in segs) segs[seg] = 'contained'; }
      if (action === 'rate_limit_uplink' || action === 'switch_to_backup_link') segs.uplink = 'filtered';
      if (action === 'lock_rover_commands') segs.robotics = 'locked';
      if (action === 'freeze_ai_config') segs.ai_core = 'frozen';
      ui.network(n);
      ui.activity(sim.incident?.sev === 'CRITICAL' ? 3 : 2, `LASH-Net: ${action.replace(/_/g, ' ')} → ${target}`);
      emit(sim);
      return { ok: true, segments: segs, life_support: 'still isolated on its own locked segment', incident: sim.incident?.name ?? 'none' };
    },
    recall_learning({ topic } = {}) {
      const L = sim.learning;
      const q = (topic || '').toLowerCase();
      return {
        corrections: L.corrections.filter((c) => !q || (c.q + ' ' + c.a).toLowerCase().includes(q)).slice(-12),
        skills: Object.fromEntries(Object.entries(L.skills).map(([k, v]) => [SKILLS[k], v])),
        ratings: { good: L.ratings.filter((r) => r.good).length, bad: L.ratings.filter((r) => !r.good).length },
        drill_scores: L.drillScores.slice(-6), network_scores: L.netScores.slice(-6),
        what_helps: Object.fromEntries(sim.crew.map((c) => [c.name, bestInterventions(sim, c.id).slice(0, 3)])),
      };
    },
    play_media({ kind, crew_id }) {
      if (kind === 'earth_message') {
        const c = crew_id ? crewById(sim, crew_id) : null;
        const msgs = sim.earthMessages.filter((m) => !c || m.to === c.id);
        const m = msgs[Math.floor(Math.random() * msgs.length)];
        if (!m) return { error: 'no message from Earth stored for that crew member' };
        ui.media({ kind, message: m });
        return { ok: true, played: m };
      }
      ui.media({ kind });
      return { ok: true, playing: kind };
    },
    get_vision_detections() { return vision.snapshot(); },
  };

  return async function execute(name, input) {
    const tool = byName[name];
    if (!tool) return { content: JSON.stringify({ error: `unknown tool ${name}` }), is_error: true };
    const bad = validate(tool, input);
    if (bad) return { content: JSON.stringify({ INVALID_JSON: JSON.stringify(input), problem: bad }), is_error: true };
    try {
      const out = await handlers[name](input);
      const isErr = !!out?.error;
      return { content: JSON.stringify(out), is_error: isErr };
    } catch (err) {
      return { content: JSON.stringify({ error: String(err?.message || err) }), is_error: true };
    }
  };
}

export { learnLog, bumpSkill };
