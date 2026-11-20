// SELENE Vision + SELENE senses.
// Live layer: COCO-SSD runs in the browser on every frame and maps Earth object classes to space classes.
// Deep layer: Claude vision classifies geology, crew, equipment and hazards in a captured frame (structured JSON).
// Frames are sent only when the user presses a scan/check-in button and are never stored.

export const SPACE_CLASSES = {
  geology: ['basalt', 'anorthosite', 'lunar regolith', 'breccia', 'metallic ore deposit', 'ice deposit', 'volcanic glass / volcanic material', 'impact melt', 'cracked terrain', 'dust accumulation zone'],
  human: ['astronaut crew member', 'EVA personnel', 'person without protective equipment'],
  equipment: ['habitat module', 'oxygen tank', 'lunar rover', 'solar panel', 'power system', 'scientific instrument', '3D printer', 'maintenance tool', 'emergency repair kit', 'communications antenna', 'sample container', 'computer / console', 'display panel'],
  hazard: ['structural damage', 'equipment malfunction', 'radiation risk zone', 'pressure leak', 'thermal anomaly', 'dust storm', 'surface instability', 'restricted area', 'sharp debris', 'fire / smoke'],
};

// COCO-SSD class -> [space class, category, typical real height in metres for a distance estimate]
const COCO_MAP = {
  person: ['Astronaut / crew member', 'human', 1.72],
  bottle: ['Oxygen / water canister', 'equipment', 0.25], cup: ['Sample container', 'equipment', 0.1], bowl: ['Sample tray', 'equipment', 0.08],
  scissors: ['Maintenance tool', 'equipment', 0.18], knife: ['Maintenance tool (sharp)', 'hazard', 0.2], fork: ['Maintenance tool', 'equipment', 0.18],
  'cell phone': ['Handheld scientific instrument', 'equipment', 0.15], remote: ['Instrument controller', 'equipment', 0.17],
  laptop: ['Mission console', 'equipment', 0.25], keyboard: ['Console input', 'equipment', 0.04], mouse: ['Console input', 'equipment', 0.04], tv: ['Habitat display panel', 'equipment', 0.6],
  backpack: ['Emergency repair kit', 'equipment', 0.5], suitcase: ['Equipment case', 'equipment', 0.6], handbag: ['Tool pouch', 'equipment', 0.3],
  book: ['Procedure manual', 'equipment', 0.25], clock: ['Mission timer', 'equipment', 0.3], umbrella: ['Antenna / solar array (folded)', 'equipment', 0.9],
  chair: ['Habitat seat', 'equipment', 0.9], couch: ['Crew rest module', 'equipment', 0.85], bed: ['Smart bed', 'equipment', 0.6], 'dining table': ['Work bench', 'equipment', 0.75],
  'potted plant': ['Greenhouse crop', 'equipment', 0.4], vase: ['Sample container', 'equipment', 0.25],
  car: ['Lunar rover', 'equipment', 1.5], truck: ['Lunar rover (cargo)', 'equipment', 2.5], bicycle: ['Personal rover', 'equipment', 1.0], motorcycle: ['Personal rover', 'equipment', 1.1],
  'sports ball': ['Spherical sample', 'geology', 0.2], apple: ['Organic sample (Earth analog)', 'geology', 0.08], orange: ['Organic sample (Earth analog)', 'geology', 0.08], banana: ['Organic sample (Earth analog)', 'geology', 0.04],
  'teddy bear': ['Crew comfort item', 'equipment', 0.3], toothbrush: ['Hygiene kit', 'equipment', 0.19], 'hair drier': ['Heat gun (tool)', 'equipment', 0.2],
  oven: ['Galley heater', 'equipment', 0.6], microwave: ['Galley heater', 'equipment', 0.3], refrigerator: ['Cold storage', 'equipment', 1.7], sink: ['Water recovery station', 'equipment', 0.3],
  'fire hydrant': ['Emergency valve', 'hazard', 0.7], 'stop sign': ['Restricted area marker', 'hazard', 0.75],
};

const DEEP_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['scene', 'objects'],
  properties: {
    scene: { type: 'string', description: 'One sentence describing the scene as SELENE sees it' },
    objects: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['label', 'category', 'earth_object', 'confidence', 'box', 'distance_m', 'risk', 'resource_value', 'details'],
        properties: {
          label: { type: 'string', description: 'Space class, e.g. "Basalt sample", "EVA personnel", "Oxygen tank", "Pressure leak"' },
          category: { type: 'string', enum: ['geology', 'human', 'equipment', 'hazard'] },
          earth_object: { type: 'string', description: 'What the object literally is in the image (e.g. "grey rock", "apple", "screwdriver")' },
          confidence: { type: 'number', description: '0 to 1' },
          box: { type: 'array', items: { type: 'integer' }, description: '[x, y, width, height] in 0-1000 image coordinates' },
          distance_m: { type: 'number', description: 'Estimated distance from the camera in metres' },
          risk: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
          resource_value: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
          details: { type: 'string', description: 'Key properties, e.g. "Iron content: high; vesicular texture" or "Helmet visor down"' },
        },
      },
    },
  },
};

const DEEP_SYSTEM = `You are SELENE Vision, the perception engine of a lunar habitat (a NASA HUNCH student project demo). Identify every notable object in the image and classify it into the space taxonomy below, as if the scene were on the Moon. Real Earth objects are mapped to their nearest space analog (a grey stone becomes a rock sample with its likely type, a person becomes crew or EVA personnel, a wrench becomes a maintenance tool, a water bottle an oxygen or water canister) and you record what it literally is in earth_object. Be honest about uncertainty in confidence; rock types from a photo are estimates. Note safety compliance for people (helmet, gloves, visible fatigue) in details, and hazards such as damage, leaks, smoke, sharp debris or unstable surfaces. Taxonomy: ${JSON.stringify(SPACE_CLASSES)}`;

export function createVision() {
  const state = { live: [], deep: null, consensus: null, source: 'none', updated: 0 };
  return {
    state,
    snapshot() {
      return {
        source: state.source,
        live_detections: state.live.map((d) => ({ label: d.label, category: d.category, confidence: +d.score.toFixed(2), distance_m: d.dist, earth_object: d.coco })),
        deep_scan: state.deep,
        multi_model_consensus: state.consensus,
        note: state.source === 'none' ? 'Camera is off and nothing has been scanned yet.' : 'Camera classifications are estimates.',
      };
    },
  };
}

/* ---------- live detector (COCO-SSD, on device) ---------- */
let modelPromise;
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
}
export function loadDetector() {
  modelPromise ||= (async () => {
    await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
    await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js');
    return window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
  })();
  return modelPromise;
}
export async function detectLive(model, video) {
  const preds = await model.detect(video, 12, 0.45);
  const H = video.videoHeight || 480;
  const focal = H / (2 * Math.tan((55 * Math.PI) / 360)); // ~55° vertical field of view
  return preds.map((p) => {
    const [label, category, realH] = COCO_MAP[p.class] || [`Unclassified object (${p.class})`, 'equipment', 0.3];
    const dist = Math.max(0.2, Math.round(((realH * focal) / Math.max(8, p.bbox[3])) * 10) / 10);
    return { label, category, coco: p.class, score: p.score, bbox: p.bbox, dist };
  });
}

/* ---------- frames ---------- */
export function grabFrame(source, maxSide = 1024) {
  const w = source.videoWidth || source.naturalWidth || source.width, h = source.videoHeight || source.naturalHeight || source.height;
  const k = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext('2d');
  if (source.tagName === 'VIDEO') { g.translate(c.width, 0); g.scale(-1, 1); } // match the mirrored preview
  g.drawImage(source, 0, 0, c.width, c.height);
  return { b64: c.toDataURL('image/jpeg', 0.85).split(',')[1], w: c.width, h: c.height, url: c.toDataURL('image/jpeg', 0.7) };
}
const img = (b64) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } });

/* ---------- Claude-powered senses ---------- */
export async function deepScan(ai, frameB64) {
  return ai.structured({
    system: DEEP_SYSTEM, schema: DEEP_SCHEMA, effort: 'medium',
    content: [img(frameB64), { type: 'text', text: 'Scan this frame. List up to 12 objects.' }],
  });
}

export async function faceCheckin(ai, frames, crew) {
  const schema = {
    type: 'object', additionalProperties: false,
    required: ['face_visible', 'fatigue', 'stress', 'mood', 'signals', 'says_fine_but_differs', 'summary'],
    properties: {
      face_visible: { type: 'boolean' },
      fatigue: { type: 'number', description: '0-1' }, stress: { type: 'number', description: '0-1' },
      mood: { type: 'string', enum: ['happy', 'calm', 'tired', 'anxious', 'worried', 'sad', 'lonely', 'angry', 'low'] },
      signals: { type: 'array', items: { type: 'string' }, description: 'Observable cues only: eyelid droop, yawning, smile, frown, gaze, slouch, head drop' },
      says_fine_but_differs: { type: 'boolean' },
      summary: { type: 'string', description: 'One kind sentence to the crew member' },
    },
  };
  return ai.structured({
    system: `You are SELENE, a crew wellbeing AI in a lunar habitat simulation (NASA HUNCH student demo). From a few webcam frames, estimate visible fatigue and stress and a likely mood using observable cues only (eyelids, yawning, smile, frown, gaze, posture, head drop). This is a wellbeing estimate for a school prototype, never a diagnosis. ${crew.name}'s self-report: "${crew.selfReport || 'not given'}". If the face isn't visible, set face_visible false and low values.`,
    schema, effort: 'low',
    content: [...frames.map(img), { type: 'text', text: `30-second check-in for ${crew.name}. ${frames.length} frames, about 10 s apart.` }],
  });
}

export async function voiceMood(ai, transcript, features) {
  const schema = {
    type: 'object', additionalProperties: false, required: ['mood', 'confidence', 'evidence', 'reply'],
    properties: {
      mood: { type: 'string', enum: ['happy', 'calm', 'sad', 'low', 'anxious', 'worried', 'angry', 'tired'] },
      confidence: { type: 'number' },
      evidence: { type: 'array', items: { type: 'string' } },
      reply: { type: 'string', description: 'One or two warm sentences from LUNA' },
    },
  };
  return ai.structured({
    system: 'You are the mood estimator for an astronaut voice log in a lunar habitat simulation (NASA HUNCH student demo). Use the words and how the voice compares with the speaker\'s calm baseline (pitch, loudness, pace, pauses). "low" means possible low-mood signs; it is not a diagnosis. Return the best of 8 moods.',
    schema, effort: 'low',
    content: [{ type: 'text', text: `Transcript: "${transcript}"\nVoice vs calm baseline: ${JSON.stringify(features)}` }],
  });
}

export async function inspectPanel(ai, frameB64) {
  const schema = {
    type: 'object', additionalProperties: false, required: ['what', 'condition_score', 'issues', 'action', 'priority'],
    properties: {
      what: { type: 'string' }, condition_score: { type: 'integer', description: '0 (failed) to 100 (like new)' },
      issues: { type: 'array', items: { type: 'string' } }, action: { type: 'string' },
      priority: { type: 'string', enum: ['none', 'routine', 'soon', 'urgent'] },
    },
  };
  return ai.structured({
    system: 'You are LUNA\'s predictive-maintenance inspector in a lunar habitat simulation (NASA HUNCH student demo). Judge the condition of the panel, hardware or surface in the photo as if it were habitat equipment: dust, scratches, cracks, discoloration, corrosion, loose parts, burn marks. Give one clear maintenance action.',
    schema, effort: 'low',
    content: [img(frameB64), { type: 'text', text: 'Inspect this equipment.' }],
  });
}

export async function formCheck(ai, frames, exercise) {
  const schema = {
    type: 'object', additionalProperties: false, required: ['person_visible', 'form_score', 'cues', 'praise'],
    properties: {
      person_visible: { type: 'boolean' }, form_score: { type: 'integer', description: '0-100' },
      cues: { type: 'array', items: { type: 'string' }, description: 'Up to 3 short coaching cues like "chest up" or "hips are sagging"' },
      praise: { type: 'string' },
    },
  };
  return ai.structured({
    system: 'You are Luna Workout Coach for a lunar crew (NASA HUNCH student demo). Exercise protects muscle and bone in 1/6 g. From the frames, judge form for the named exercise and give short, specific, encouraging cues. Not medical advice.',
    schema, effort: 'low',
    content: [...frames.map(img), { type: 'text', text: `Exercise: ${exercise}. Frames are ~1 s apart.` }],
  });
}

/* ---------- voice features vs baseline (SIM-05) ---------- */
export function pitchOf(buf, rate) {
  let rms = 0; for (const v of buf) rms += v * v; rms = Math.sqrt(rms / buf.length);
  if (rms < 0.01) return { rms, pitch: 0 };
  let best = 0, bestLag = 0;
  for (let lag = Math.floor(rate / 400); lag < Math.floor(rate / 70); lag++) {
    let s = 0; for (let i = 0; i < buf.length - lag; i++) s += buf[i] * buf[i + lag];
    if (s > best) { best = s; bestLag = lag; }
  }
  return { rms, pitch: bestLag ? rate / bestLag : 0 };
}
