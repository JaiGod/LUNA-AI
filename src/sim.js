// Simulated habitat, crew (SELENE's data), network and LUNA's learning store.
// Everything here is a simulation for a NASA HUNCH student project. Nothing is a medical device.

export const LIMITS = {
  ppco2_watch: 2.5, ppco2_alert: 3.0,            // mmHg, NASA-STD-3001 V2 6004
  pressure_min: 34.5, pressure_max: 103,          // kPa, NASA-STD-3001 V2 6006
  o2_min: 19.5, o2_max: 23.5,                     // %
  cabin_min: 18.3, cabin_max: 26.7,               // °C ISS cabin band
  career_msv: 600,                                // NASA career radiation limit
  water_goal_ml: 2500, sleep_goal_h: 8, exercise_goal_min: 120, resistive_goal_min: 60,
  tiers: [0.35, 0.55, 0.75],                      // mild / moderate / severe concern scores
};

export const LIGHTING = {
  day: { k: 6500, label: 'Day / phase-shift (6500 K)', color: '#dbeafe' },
  general: { k: 4500, label: 'General (4500 K)', color: '#fef3c7' },
  focus: { k: 5500, label: 'Focus (5500 K)', color: '#e0f2fe' },
  relax: { k: 3000, label: 'Relax (3000 K)', color: '#fde68a' },
  presleep: { k: 2700, label: 'Pre-sleep (2700 K)', color: '#fdba74' },
  night: { k: 1900, label: 'Night (1900 K)', color: '#f97316' },
};
export const SOUNDS = ['off', 'ocean waves', 'rain', 'forest', 'earth birdsong', 'brown noise', 'space music'];
export const MOODS = ['happy', 'calm', 'tired', 'anxious', 'worried', 'sad', 'lonely', 'angry', 'low'];
export const SKILLS = {
  comm: 'Communication', crew: 'Crew support', emerg: 'Emergency response',
  hab: 'Habitat control', res: 'Resource management', pred: 'Predictive maintenance',
};

export const DRILLS = {
  dust: { t: 'Dust storm warning', s: 'hab', steps: ['Exterior particle count climbing.', 'Predicted 36 h; solar output down ~40%.', 'Checking airlock seals and filter load.'] },
  power: { t: 'Power failure', s: 'res', steps: ['Main bus voltage below limit.', 'Fault traced to array string 3.', 'Computing battery runtime at reduced load.'] },
  oxygen: { t: 'Oxygen leak', s: 'emerg', steps: ['Module B pressure falling 0.3 kPa/min.', 'Mapping pressure to locate the leak.', '~41 min to the caution line.'] },
  comms: { t: 'Communication loss', s: 'comm', steps: ['Earth link down for 90 s.', 'Testing backup antenna.', '14 outgoing messages queued.'] },
  medical: { t: 'Medical emergency', s: 'crew', steps: ["A crew member's vitals are outside their own baseline.", 'Person told first, then the Chief Medical Officer.', 'First-aid checklist on nearest screen.'] },
  meteoroid: { t: 'Meteoroid risk', s: 'pred', steps: ['Debris on a possible intercept path.', 'Hull sensors armed on the north wall.', 'Window ~12 min.'] },
  solar_storm: { t: 'Solar particle event', s: 'emerg', steps: ['Proton flux rising fast at the sensors.', 'Storm shelter readiness check.', 'Dose logging switched to per-minute.'] },
};

export const ATTACKS = {
  login: { name: 'Unauthorised crew login', sev: 'MEDIUM', seg: 'crew', log: ['5 failed logins on crew-laptop-3 in 40 s', 'Login succeeded from an unknown MAC on CREW VLAN 20', 'New device requesting the habitat-control portal'] },
  malware: { name: 'Malware-infected workstation', sev: 'HIGH', seg: 'science', log: ['sci-ws-2 scanning ports 502 (Modbus) and 47808 (BACnet)', 'Outbound beacon every 30 s to an unknown address', 'Scan blocked at the life-support ACL'] },
  rover: { name: 'Rover communication hijack', sev: 'HIGH', seg: 'robotics', log: ['Rover-2 command stream signed with an unknown key', 'Drive command toward the solar array field', 'Telemetry heartbeat jitter 400%'] },
  dos: { name: 'Denial-of-service from Earth', sev: 'HIGH', seg: 'uplink', log: ['DSN uplink traffic at 38x normal', 'Mission-control voice packets dropping', 'Source: spoofed ground-station range'] },
  sensor: { name: 'Fake sensor data injection', sev: 'CRITICAL', seg: 'life_support', log: ['Radiation sensor R-4 reports 0.0 µSv/h during a solar event', 'R-4 values disagree with R-1..R-3 by 6 sigma', 'Packets carry a valid ID but a wrong sequence counter'] },
  ai: { name: 'AI server breach attempt', sev: 'CRITICAL', seg: 'ai_core', log: ['Prompt-injection text found in a maintenance ticket', 'Request to disable crew-alert escalation', 'Privilege escalation attempt on the AI core host'] },
};
export const NET_ACTIONS = ['isolate_host', 'block_subnet', 'rate_limit_uplink', 'quarantine_sensor', 'reset_credentials', 'lock_rover_commands', 'switch_to_backup_link', 'freeze_ai_config', 'alert_commander'];

export const ROOMS = [
  ['hub', 'Core hub'], ['quarters', 'Crew quarters'], ['galley', 'Galley'], ['greenhouse', 'Greenhouse'],
  ['shelter', 'Storm shelter'], ['medical', 'Medical bay'], ['exercise', 'Exercise module'],
  ['systems', 'Systems & ECLSS'], ['airlock', 'Airlock / suitport'],
];

const CREW0 = [
  { id: 'reyes', name: 'Maya Reyes', role: 'Commander', room: 'hub', hr: 66, hrv: 58, sleep_h: 7.1, base: { hr: 64, hrv: 60, pitch: 205 } },
  { id: 'mensah', name: 'Kofi Mensah', role: 'Chief Medical Officer', room: 'medical', hr: 71, hrv: 49, sleep_h: 6.2, base: { hr: 66, hrv: 55, pitch: 118 } },
  { id: 'sato', name: 'Lena Sato', role: 'Flight Engineer', room: 'systems', hr: 78, hrv: 38, sleep_h: 5.4, base: { hr: 68, hrv: 52, pitch: 220 } },
  { id: 'patel', name: 'Arjun Patel', role: 'Mission Scientist', room: 'greenhouse', hr: 62, hrv: 63, sleep_h: 7.6, base: { hr: 61, hrv: 64, pitch: 126 } },
];

const STORE_KEY = 'luna-ai-v1';
const r1 = (x) => Math.round(x * 10) / 10;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const jitter = (x, s) => x + (Math.random() - 0.5) * s;

function freshCrew() {
  return CREW0.map((c, i) => ({
    id: c.id, name: c.name, role: c.role, room: c.room,
    consent: { share_with_ground: i !== 2, camera: true },
    vitals: { hr: c.hr, hrv_ms: c.hrv, spo2: 97 + (i % 2), skin_temp_c: 36.5 + i * 0.1, resp_rate: 14 + i, systolic: 116 + i * 3, diastolic: 74 + i },
    eeg: { delta: 0.18, theta: 0.16 + (i === 2 ? 0.1 : 0), alpha: 0.28 - (i === 2 ? 0.08 : 0), beta: 0.3, gamma: 0.08 },
    today: { sleep_h: c.sleep_h, water_ml: 900 + i * 250, exercise_min: 40 + i * 15, resistive_min: 20 + i * 8 },
    radiation_msv: 41 + i * 3.5, radiation_today_msv: 0.42,
    base: c.base,
    moods: [{ t: Date.now() - 864e5, mood: i === 2 ? 'tired' : 'calm', src: 'seed' }],
    checkins: [],
    pvt: [],
  }));
}

function freshLearning() {
  return {
    corrections: [],                       // {q, a, skill, t}
    ratings: [],                           // {t, good, skill, text}
    skills: { comm: 62, crew: 58, emerg: 55, hab: 64, res: 60, pred: 52 },
    interventions: {},                     // crewId -> {offerKey: {helped, not}}
    drillScores: [],                       // {drill, score, t}
    netScores: [],                         // {attack, score, t}
    log: [],                               // {t, text}
  };
}

export function createSim() {
  const sim = {
    t0: Date.now(), missionDay: 37, missionLength: 90, minute: 7 * 60 + 10,
    sensors: {
      o2_pct: 20.9, ppco2_mmhg: 2.1, pressure_kpa: 101.2, cabin_temp_c: 22.4, humidity_pct: 44,
      battery_pct: 78, solar_kw: 18.5, load_kw: 11.2, water_l: 1840, water_recovery_pct: 93,
      radiation_usv_h: 0.55, dust_level: 0.18, ext_temp_c: 96, solar_activity: 'quiet', sun_elevation_deg: 14,
      lunar_phase: 'day', earth_link: 'up', link_delay_s: 1.3,
    },
    rooms: ROOMS.map(([id, name]) => ({
      id, name, temp_c: id === 'greenhouse' ? 24 : 22, setpoint_c: id === 'greenhouse' ? 24 : 22,
      lighting: 'general', sound: 'off',
    })),
    crew: freshCrew(),
    alerts: [], tierLog: [], offers: [], schedule: [], escalations: [],
    drill: null, incident: null,
    network: {
      segments: { life_support: 'locked', crew: 'normal', science: 'normal', robotics: 'normal', uplink: 'normal', ai_core: 'normal' },
      actions: [],
    },
    earthMessages: [
      { from: "Reyes family", to: 'reyes', text: "Sofia lost her first tooth today and wants you to know the Moon is officially 'her mom's office'." },
      { from: 'Mensah family', to: 'mensah', text: "The garden tomatoes came in. Ama says the space ones better be bigger." },
      { from: 'Sato family', to: 'sato', text: "Grandma watched the launch replay 14 times. She says sleep more, engineer." },
      { from: 'Patel family', to: 'patel', text: "Dev scored his first goal and dedicated it to 'the scientist on the Moon'." },
    ],
    workouts: { log: [], pbs: {}, badges: [] },
    learning: freshLearning(),
    listeners: new Set(),
  };
  load(sim);
  return sim;
}

/* ---------- persistence (per-viewer conveniences + learning) ---------- */
export function save(sim) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      learning: sim.learning, schedule: sim.schedule, workouts: sim.workouts, earthMessages: sim.earthMessages,
      crew: sim.crew.map((c) => ({ id: c.id, consent: c.consent, moods: c.moods.slice(-40), checkins: c.checkins.slice(-20), pvt: c.pvt.slice(-20), today: c.today, base: c.base })),
    }));
  } catch { /* storage unavailable: run without persistence */ }
}
function load(sim) {
  let d;
  try { d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { d = null; }
  if (!d) return;
  if (d.learning) sim.learning = { ...freshLearning(), ...d.learning };
  if (Array.isArray(d.schedule)) sim.schedule = d.schedule;
  if (d.workouts) sim.workouts = d.workouts;
  if (Array.isArray(d.earthMessages)) sim.earthMessages = d.earthMessages;
  for (const s of d.crew || []) {
    const c = sim.crew.find((x) => x.id === s.id);
    if (c) Object.assign(c, { consent: s.consent ?? c.consent, moods: s.moods ?? c.moods, checkins: s.checkins ?? [], pvt: s.pvt ?? [], today: s.today ?? c.today, base: s.base ?? c.base });
  }
}
export function resetAll(sim) {
  try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
  sim.learning = freshLearning(); sim.schedule = []; sim.workouts = { log: [], pbs: {}, badges: [] };
  sim.crew = freshCrew(); emit(sim);
}

export function onChange(sim, fn) { sim.listeners.add(fn); }
export function emit(sim) { for (const fn of sim.listeners) fn(sim); }
export function learnLog(sim, text) { sim.learning.log.unshift({ t: Date.now(), text }); sim.learning.log.length = Math.min(sim.learning.log.length, 60); }
export function crewById(sim, id) { return sim.crew.find((c) => c.id === id || c.name.toLowerCase().includes(String(id).toLowerCase())); }
export function clock(sim) { const m = Math.floor(sim.minute) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }

/* ---------- wellbeing scoring (SIM-01/03: compare each person to their own baseline) ---------- */
const NEG = { tired: 0.45, anxious: 0.6, worried: 0.5, sad: 0.6, lonely: 0.55, angry: 0.5, low: 0.8, happy: 0, calm: 0 };
export function wellbeing(sim, c) {
  const hrZ = (c.vitals.hr - c.base.hr) / 6;
  const hrvZ = (c.base.hrv - c.vitals.hrv_ms) / 8;
  const sleepDebt = Math.max(0, LIMITS.sleep_goal_h - c.today.sleep_h) / 3;
  const recent = c.moods.slice(-5);
  const moodScore = recent.length ? recent.reduce((s, m) => s + (NEG[m.mood] ?? 0.3), 0) / recent.length : 0.2;
  const eegDrowsy = clamp((c.eeg.theta - 0.18) / 0.15, 0, 1);
  const lastCheck = c.checkins.at(-1);
  const camStress = lastCheck ? (lastCheck.stress + lastCheck.fatigue) / 2 : 0.2;
  const score = clamp(0.18 * clamp(hrZ / 3, 0, 1) + 0.2 * clamp(hrvZ / 3, 0, 1) + 0.2 * clamp(sleepDebt, 0, 1) + 0.24 * moodScore + 0.08 * eegDrowsy + 0.1 * camStress, 0, 1);
  const tier = score >= LIMITS.tiers[2] ? 3 : score >= LIMITS.tiers[1] ? 2 : score >= LIMITS.tiers[0] ? 1 : 0;
  const lowCount = c.moods.slice(-7).filter((m) => ['sad', 'low', 'lonely'].includes(m.mood)).length;
  return { score: r1(score * 100) / 100, tier, low_mood_repeats_last7: lowCount, sleep_debt_h: r1(Math.max(0, LIMITS.sleep_goal_h - c.today.sleep_h)) };
}
export function eegState(e) {
  if (e.theta + e.delta > 0.45) return 'drowsy';
  if (e.alpha >= 0.28) return 'relaxed';
  if (e.beta + e.gamma > 0.45) return 'high alert';
  return 'focused';
}

/* ---------- alerts ---------- */
function recomputeAlerts(sim) {
  const s = sim.sensors, a = [];
  if (s.ppco2_mmhg > LIMITS.ppco2_alert) a.push({ level: 'RED', text: `ppCO₂ ${s.ppco2_mmhg} mmHg is above the 3 mmHg limit` });
  else if (s.ppco2_mmhg > LIMITS.ppco2_watch) a.push({ level: 'YELLOW', text: `ppCO₂ ${s.ppco2_mmhg} mmHg above the 2.5 mmHg watch line` });
  if (s.o2_pct < LIMITS.o2_min) a.push({ level: 'RED', text: `O₂ ${s.o2_pct}% below ${LIMITS.o2_min}%` });
  if (s.pressure_kpa < 97) a.push({ level: s.pressure_kpa < 90 ? 'RED' : 'ORANGE', text: `Cabin pressure ${s.pressure_kpa} kPa falling` });
  if (s.battery_pct < 30) a.push({ level: s.battery_pct < 15 ? 'RED' : 'ORANGE', text: `Battery ${s.battery_pct}%` });
  if (s.solar_activity !== 'quiet') a.push({ level: s.solar_activity === 'storm' ? 'RED' : 'ORANGE', text: `Solar activity: ${s.solar_activity}` });
  for (const r of sim.rooms) if (r.temp_c < LIMITS.cabin_min || r.temp_c > LIMITS.cabin_max) a.push({ level: 'YELLOW', text: `${r.name} ${r.temp_c} °C outside the cabin band` });
  for (const c of sim.crew) { const w = wellbeing(sim, c); if (w.tier >= 2) a.push({ level: w.tier === 3 ? 'ORANGE' : 'YELLOW', text: `${c.name}: wellbeing tier ${w.tier}` }); }
  if (sim.incident) a.push({ level: sim.incident.sev === 'CRITICAL' ? 'RED' : 'ORANGE', text: `Network: ${sim.incident.name}` });
  if (sim.drill) a.push({ level: 'DRILL', text: `Drill running: ${sim.drill.t}` });
  sim.alerts = a;
}

/* ---------- time step: 1 tick = 1 simulated minute ---------- */
export function tick(sim, minutes = 1) {
  const s = sim.sensors;
  sim.minute += minutes;
  if (sim.minute >= 1440) { sim.minute -= 1440; sim.missionDay = Math.min(sim.missionLength, sim.missionDay + 1); }
  const lightPct = s.lunar_phase === 'day' ? 1 : 0;
  s.solar_kw = r1(clamp(jitter(18.5 * lightPct * (1 - s.dust_level * 0.9), 0.6), 0, 22));
  s.load_kw = r1(clamp(jitter(11 + (sim.drill ? 1.5 : 0), 0.5), 6, 16));
  s.battery_pct = r1(clamp(s.battery_pct + (s.solar_kw - s.load_kw) * 0.012 * minutes, 0, 100));
  s.ppco2_mmhg = r1(clamp(jitter(s.ppco2_mmhg + (2.1 - s.ppco2_mmhg) * 0.05, 0.08), 1.2, 6));
  s.o2_pct = r1(clamp(jitter(s.o2_pct + (20.9 - s.o2_pct) * 0.05, 0.05), 17, 23.5));
  const leak = sim.drill?.id === 'oxygen' ? 0.3 : 0;
  s.pressure_kpa = r1(clamp(s.pressure_kpa - leak * 0.2 + (101.2 - s.pressure_kpa) * (leak ? 0 : 0.08), 80, 103));
  s.humidity_pct = Math.round(clamp(jitter(s.humidity_pct, 1), 30, 65));
  s.water_l = Math.round(s.water_l - 0.35 * minutes * (1 - s.water_recovery_pct / 100) * 4);
  const solar = s.solar_activity === 'storm' ? 38 : s.solar_activity === 'elevated' ? 4 : 0.55;
  s.radiation_usv_h = r1(clamp(jitter(solar, solar * 0.1), 0.2, 80));
  s.dust_level = r1(clamp(s.dust_level + (sim.drill?.id === 'dust' ? 0.02 : -0.003) * minutes, 0.05, 0.95) * 100) / 100;
  for (const r of sim.rooms) {
    const people = sim.crew.filter((c) => c.room === r.id).length;
    r.temp_c = r1(r.temp_c + (r.setpoint_c - r.temp_c) * 0.08 * minutes + people * 0.02 + jitter(0, 0.06));
  }
  s.cabin_temp_c = r1(sim.rooms.reduce((a, r) => a + r.temp_c, 0) / sim.rooms.length);
  for (const c of sim.crew) {
    const v = c.vitals;
    v.hr = Math.round(clamp(jitter(v.hr + (c.base.hr - v.hr) * 0.02, 1.5), 48, 140));
    v.hrv_ms = Math.round(clamp(jitter(v.hrv_ms, 1.2), 15, 110));
    v.spo2 = Math.round(clamp(jitter(v.spo2, 0.4), 90, 100));
    c.radiation_today_msv = r1((c.radiation_today_msv + (c.room === 'shelter' ? 0.15 : 1) * s.radiation_usv_h / 1000 / 60 * minutes * 60) * 100) / 100;
  }
  recomputeAlerts(sim);
  emit(sim);
}

/* ---------- forecasting (SIM-03: warn days ahead) ---------- */
export function forecast(sim, days) {
  const s = sim.sensors;
  const net = s.solar_kw - s.load_kw;
  const nightIn = s.lunar_phase === 'day' ? Math.max(0.5, (s.sun_elevation_deg / 90) * 14) : 0;
  const waterUse = 0.35 * 1440 * (1 - s.water_recovery_pct / 100) * 4 / 1000; // m³-ish → litres/day ≈ 2 L/1000
  const out = {
    horizon_days: days,
    lunar_night_starts_in_days: r1(nightIn),
    battery_now_pct: s.battery_pct,
    battery_trend_pct_per_day: r1(net * 0.012 * 1440),
    battery_at_lunar_night_pct: r1(clamp(s.battery_pct + net * 0.012 * 1440 * Math.min(days, nightIn), 0, 100)),
    water_l_now: s.water_l,
    water_l_in_horizon: Math.round(s.water_l - 1440 * 0.35 * (1 - s.water_recovery_pct / 100) * 4 * days),
    water_l_per_day: r1(waterUse * 1000),
    dust_trend: s.dust_level > 0.4 ? 'rising — solar output will fall' : 'normal',
    crew: sim.crew.map((c) => {
      const w = wellbeing(sim, c);
      const debt = w.sleep_debt_h;
      const drift = debt > 1.5 ? 0.06 : debt > 0.5 ? 0.02 : -0.02;
      const proj = clamp(w.score + drift * days, 0, 1);
      return {
        crew: c.name, score_now: w.score, score_projected: r1(proj * 100) / 100,
        projected_tier: proj >= 0.75 ? 3 : proj >= 0.55 ? 2 : proj >= 0.35 ? 1 : 0,
        driver: debt > 0.5 ? `sleep debt ${debt} h/day` : w.low_mood_repeats_last7 >= 2 ? 'repeated low moods' : 'stable',
      };
    }),
    mission_days_left: sim.missionLength - sim.missionDay,
  };
  return out;
}

/* ---------- learning (SIM-07 bandit + SIM-09 training loop) ---------- */
export function recordIntervention(sim, crewId, key, helped) {
  const m = (sim.learning.interventions[crewId] ||= {});
  const e = (m[key] ||= { helped: 0, not: 0 });
  helped ? e.helped++ : e.not++;
  learnLog(sim, `${crewId}: "${key}" ${helped ? 'helped' : 'did not help'} (now ${e.helped}/${e.helped + e.not})`);
  save(sim);
}
export function bestInterventions(sim, crewId) {
  const m = sim.learning.interventions[crewId] || {};
  return Object.entries(m)
    .map(([k, e]) => ({ intervention: k, helped: e.helped, tried: e.helped + e.not, success_rate: r1((e.helped + 1) / (e.helped + e.not + 2) * 100) / 100 }))
    .sort((a, b) => b.success_rate - a.success_rate);
}
export function bumpSkill(sim, skill, delta, why) {
  const sk = sim.learning.skills;
  if (!(skill in sk)) return;
  sk[skill] = Math.round(clamp(sk[skill] + delta, 0, 100));
  learnLog(sim, `${SKILLS[skill]} ${delta >= 0 ? '+' : ''}${delta} → ${sk[skill]} (${why})`);
  save(sim);
}
