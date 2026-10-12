/**
 * Mechanical punch sounds synthesized in the browser.
 * Each clock-in sound has a related clock-out sound with a different pitch or rhythm.
 */

/** @typedef {{ at: number, dur: number, gain: number, freq: number, noise?: boolean, q?: number, type?: OscillatorType, slide?: number }} SoundEvent */
/** @typedef {{ id: string, label: string, group: string, events: SoundEvent[] }} PunchSound */

const noise = (at, dur, gain, freq, q = 0.8) => ({ at, noise: true, dur, gain, freq, q });
const tone = (at, freq, dur, gain, type = 'triangle', slide) => ({ at, freq, dur, gain, type, slide });

/** @type {PunchSound[]} */
export const PUNCH_SOUNDS = [
  {
    id: 'time-clock-stamp',
    label: 'Time clock stamp',
    group: 'Time clock',
    events: [
      noise(0, 0.04, 0.5, 980, 0.7),
      tone(0.006, 170, 0.09, 0.42, 'triangle', 72),
      tone(0.01, 2400, 0.018, 0.14, 'square'),
    ],
  },
  {
    id: 'time-clock-release',
    label: 'Time clock release',
    group: 'Time clock',
    events: [
      tone(0, 2900, 0.014, 0.12, 'square'),
      noise(0.016, 0.028, 0.26, 2200, 1.5),
      tone(0.022, 480, 0.06, 0.2, 'triangle', 190),
    ],
  },
  {
    id: 'heavy-stamp',
    label: 'Heavy stamp press',
    group: 'Stamp press',
    events: [
      noise(0, 0.06, 0.62, 420, 0.5),
      tone(0.004, 90, 0.14, 0.5, 'sine', 48),
      tone(0.02, 620, 0.03, 0.1, 'square'),
    ],
  },
  {
    id: 'light-stamp',
    label: 'Light stamp',
    group: 'Stamp press',
    events: [
      noise(0, 0.025, 0.28, 1600, 1.2),
      tone(0.004, 340, 0.05, 0.22, 'triangle', 180),
    ],
  },
  {
    id: 'cash-drawer-open',
    label: 'Cash drawer open',
    group: 'Cash drawer',
    events: [
      tone(0, 880, 0.22, 0.2, 'sine'),
      tone(0, 1760, 0.12, 0.08, 'triangle'),
      noise(0.01, 0.12, 0.22, 700, 0.4),
    ],
  },
  {
    id: 'cash-drawer-shut',
    label: 'Cash drawer shut',
    group: 'Cash drawer',
    events: [
      noise(0, 0.05, 0.4, 500, 0.6),
      tone(0.03, 140, 0.08, 0.35, 'triangle', 70),
      tone(0.04, 1320, 0.04, 0.08, 'square'),
    ],
  },
  {
    id: 'typewriter-key',
    label: 'Typewriter key',
    group: 'Typewriter',
    events: [
      noise(0, 0.012, 0.45, 3200, 2),
      tone(0.008, 180, 0.03, 0.18, 'triangle', 90),
    ],
  },
  {
    id: 'carriage-return',
    label: 'Typewriter carriage',
    group: 'Typewriter',
    events: [
      noise(0, 0.16, 0.22, 900, 0.4),
      tone(0.14, 220, 0.05, 0.3, 'triangle', 80),
      noise(0.15, 0.02, 0.35, 2400, 1.4),
    ],
  },
  {
    id: 'relay-click',
    label: 'Relay click',
    group: 'Relay and solenoid',
    events: [
      tone(0, 1800, 0.008, 0.2, 'square'),
      tone(0.012, 900, 0.01, 0.16, 'square'),
      noise(0.01, 0.012, 0.2, 2500, 2),
    ],
  },
  {
    id: 'relay-release',
    label: 'Relay release',
    group: 'Relay and solenoid',
    events: [
      tone(0, 700, 0.012, 0.16, 'square'),
      noise(0.016, 0.02, 0.18, 1400, 1),
      tone(0.02, 240, 0.04, 0.14, 'triangle', 120),
    ],
  },
  {
    id: 'solenoid',
    label: 'Solenoid clack',
    group: 'Relay and solenoid',
    events: [
      tone(0, 110, 0.07, 0.48, 'square', 60),
      noise(0.004, 0.03, 0.35, 800, 0.6),
    ],
  },
  {
    id: 'solenoid-return',
    label: 'Solenoid return',
    group: 'Relay and solenoid',
    events: [
      tone(0, 260, 0.04, 0.22, 'triangle', 140),
      noise(0.02, 0.02, 0.2, 1800, 1.2),
    ],
  },
  {
    id: 'turnstile',
    label: 'Turnstile clunk',
    group: 'Turnstile and gate',
    events: [
      tone(0, 130, 0.1, 0.4, 'triangle', 70),
      noise(0.02, 0.05, 0.3, 600, 0.5),
      tone(0.06, 420, 0.03, 0.12, 'square'),
    ],
  },
  {
    id: 'turnstile-return',
    label: 'Turnstile return',
    group: 'Turnstile and gate',
    events: [
      noise(0, 0.04, 0.22, 1100, 0.8),
      tone(0.03, 300, 0.06, 0.2, 'triangle', 160),
    ],
  },
  {
    id: 'gate-latch',
    label: 'Gate latch',
    group: 'Turnstile and gate',
    events: [
      noise(0, 0.02, 0.4, 2000, 1.6),
      tone(0.012, 740, 0.08, 0.16, 'sine'),
      tone(0.012, 1480, 0.05, 0.06, 'triangle'),
    ],
  },
  {
    id: 'gate-unlatch',
    label: 'Gate unlatch',
    group: 'Turnstile and gate',
    events: [
      tone(0, 520, 0.04, 0.16, 'triangle', 260),
      noise(0.03, 0.03, 0.24, 1500, 1),
    ],
  },
  {
    id: 'camera-shutter',
    label: 'Camera shutter',
    group: 'Camera',
    events: [
      noise(0, 0.012, 0.4, 2800, 1.8),
      noise(0.03, 0.016, 0.32, 1600, 1.2),
      tone(0.028, 200, 0.03, 0.12, 'triangle'),
    ],
  },
  {
    id: 'film-advance',
    label: 'Film advance',
    group: 'Camera',
    events: [
      noise(0, 0.01, 0.22, 2400, 2),
      noise(0.03, 0.01, 0.22, 2000, 2),
      noise(0.06, 0.01, 0.22, 1700, 2),
      tone(0.09, 180, 0.04, 0.2, 'triangle', 90),
    ],
  },
  {
    id: 'dot-matrix',
    label: 'Dot-matrix tick',
    group: 'Office machines',
    events: [
      noise(0, 0.006, 0.3, 3600, 3),
      noise(0.016, 0.006, 0.3, 3400, 3),
      noise(0.032, 0.006, 0.3, 3200, 3),
      noise(0.048, 0.006, 0.3, 3000, 3),
    ],
  },
  {
    id: 'adding-machine',
    label: 'Adding machine',
    group: 'Office machines',
    events: [
      noise(0, 0.02, 0.35, 1800, 1),
      tone(0.02, 110, 0.06, 0.3, 'triangle', 70),
      tone(0.04, 990, 0.16, 0.12, 'sine'),
    ],
  },
  {
    id: 'stapler',
    label: 'Stapler',
    group: 'Office tools',
    events: [
      noise(0, 0.018, 0.55, 1400, 1.1),
      tone(0.006, 150, 0.05, 0.32, 'triangle', 80),
    ],
  },
  {
    id: 'hole-punch',
    label: 'Hole punch',
    group: 'Office tools',
    events: [
      noise(0, 0.05, 0.5, 700, 0.5),
      tone(0.01, 100, 0.08, 0.36, 'sine', 55),
      noise(0.04, 0.02, 0.2, 2200, 1.4),
    ],
  },
  {
    id: 'card-punch',
    label: 'Card punch',
    group: 'Office machines',
    events: [
      noise(0, 0.015, 0.3, 2000, 1.5),
      noise(0.04, 0.015, 0.3, 1700, 1.5),
      tone(0.07, 160, 0.05, 0.24, 'triangle', 90),
    ],
  },
  {
    id: 'numbering-machine',
    label: 'Numbering machine',
    group: 'Office machines',
    events: [
      tone(0, 140, 0.07, 0.34, 'triangle', 75),
      noise(0.01, 0.03, 0.28, 1200, 0.8),
      tone(0.05, 2100, 0.02, 0.08, 'square'),
    ],
  },
  {
    id: 'paper-cutter',
    label: 'Paper cutter',
    group: 'Office tools',
    events: [
      noise(0, 0.14, 0.2, 2500, 0.6),
      tone(0.12, 180, 0.04, 0.22, 'triangle', 90),
    ],
  },
  {
    id: 'binder-clip',
    label: 'Binder clip',
    group: 'Office tools',
    events: [
      tone(0, 1600, 0.01, 0.18, 'square'),
      noise(0.008, 0.02, 0.3, 2600, 2),
      tone(0.016, 420, 0.04, 0.12, 'triangle'),
    ],
  },
  {
    id: 'vault-bolt',
    label: 'Vault bolt',
    group: 'Locks',
    events: [
      noise(0, 0.1, 0.18, 400, 0.4),
      tone(0.08, 95, 0.1, 0.4, 'triangle', 50),
      tone(0.1, 680, 0.04, 0.1, 'square'),
    ],
  },
  {
    id: 'deadbolt',
    label: 'Deadbolt',
    group: 'Locks',
    events: [
      noise(0, 0.06, 0.24, 600, 0.5),
      tone(0.04, 120, 0.08, 0.34, 'triangle', 70),
    ],
  },
  {
    id: 'key-turn',
    label: 'Key in a lock',
    group: 'Locks',
    events: [
      noise(0, 0.012, 0.2, 2200, 2),
      noise(0.04, 0.012, 0.2, 1900, 2),
      noise(0.08, 0.012, 0.22, 1600, 2),
      tone(0.11, 240, 0.04, 0.16, 'triangle'),
    ],
  },
  {
    id: 'sliding-bolt',
    label: 'Sliding bolt',
    group: 'Locks',
    events: [
      noise(0, 0.12, 0.16, 900, 0.35),
      tone(0.1, 200, 0.05, 0.28, 'triangle', 100),
    ],
  },
  {
    id: 'ratchet',
    label: 'Ratchet',
    group: 'Clockwork',
    events: [
      noise(0, 0.01, 0.28, 1800, 1.6),
      noise(0.028, 0.01, 0.28, 2000, 1.6),
      noise(0.056, 0.01, 0.3, 2300, 1.6),
      tone(0.07, 260, 0.04, 0.14, 'triangle'),
    ],
  },
  {
    id: 'telegraph',
    label: 'Telegraph key',
    group: 'Clockwork',
    events: [
      tone(0, 1400, 0.012, 0.2, 'square'),
      tone(0.05, 1100, 0.012, 0.18, 'square'),
      noise(0, 0.008, 0.15, 3000, 2),
      noise(0.05, 0.008, 0.15, 2800, 2),
    ],
  },
  {
    id: 'desk-bell',
    label: 'Desk bell',
    group: 'Bells',
    events: [
      tone(0, 1568, 0.28, 0.18, 'sine'),
      tone(0, 2350, 0.16, 0.06, 'triangle'),
      noise(0, 0.01, 0.2, 3000, 1),
    ],
  },
  {
    id: 'service-bell',
    label: 'Service bell tap',
    group: 'Bells',
    events: [
      tone(0, 2093, 0.18, 0.14, 'sine'),
      noise(0, 0.008, 0.16, 3400, 2),
      tone(0.02, 1040, 0.08, 0.05, 'triangle'),
    ],
  },
  {
    id: 'clockwork-tick',
    label: 'Clockwork tick',
    group: 'Clockwork',
    events: [
      noise(0, 0.008, 0.32, 2600, 2.4),
      tone(0.004, 880, 0.02, 0.08, 'square'),
    ],
  },
  {
    id: 'clockwork-tock',
    label: 'Clockwork tock',
    group: 'Clockwork',
    events: [
      noise(0, 0.012, 0.28, 900, 1.2),
      tone(0.004, 220, 0.04, 0.2, 'triangle', 140),
    ],
  },
  {
    id: 'gear-tooth',
    label: 'Gear tooth',
    group: 'Clockwork',
    events: [
      tone(0, 640, 0.016, 0.16, 'square'),
      noise(0.006, 0.014, 0.18, 1800, 1.5),
    ],
  },
  {
    id: 'coin-drop',
    label: 'Coin drop',
    group: 'Coins and tickets',
    events: [
      tone(0, 3100, 0.04, 0.1, 'sine'),
      tone(0.03, 1800, 0.05, 0.12, 'sine'),
      tone(0.07, 2400, 0.08, 0.1, 'triangle'),
      noise(0.06, 0.02, 0.12, 2000, 1),
    ],
  },
  {
    id: 'parking-meter',
    label: 'Parking meter',
    group: 'Coins and tickets',
    events: [
      tone(0, 2200, 0.03, 0.1, 'sine'),
      noise(0.04, 0.03, 0.24, 1200, 0.8),
      tone(0.06, 180, 0.05, 0.22, 'triangle', 100),
    ],
  },
  {
    id: 'ticket-punch',
    label: 'Ticket punch',
    group: 'Coins and tickets',
    events: [
      noise(0, 0.03, 0.42, 1100, 0.7),
      tone(0.008, 160, 0.05, 0.28, 'triangle', 90),
      tone(0.02, 1900, 0.015, 0.08, 'square'),
    ],
  },
  {
    id: 'date-stamp',
    label: 'Date stamp',
    group: 'Stamp press',
    events: [
      noise(0, 0.035, 0.32, 800, 0.6),
      tone(0.008, 200, 0.07, 0.28, 'sine', 110),
    ],
  },
  {
    id: 'lever-throw',
    label: 'Lever throw',
    group: 'Levers and switches',
    events: [
      noise(0, 0.05, 0.2, 700, 0.5),
      tone(0.04, 150, 0.08, 0.36, 'triangle', 80),
      noise(0.08, 0.015, 0.25, 2000, 1.4),
    ],
  },
  {
    id: 'lever-return',
    label: 'Lever return',
    group: 'Levers and switches',
    events: [
      tone(0, 360, 0.04, 0.16, 'triangle', 200),
      noise(0.03, 0.03, 0.18, 1400, 0.9),
    ],
  },
  {
    id: 'switch-on',
    label: 'Switch on',
    group: 'Levers and switches',
    events: [
      noise(0, 0.01, 0.4, 2400, 2),
      tone(0.008, 500, 0.03, 0.16, 'square', 200),
    ],
  },
  {
    id: 'switch-off',
    label: 'Switch off',
    group: 'Levers and switches',
    events: [
      tone(0, 240, 0.03, 0.2, 'triangle', 120),
      noise(0.02, 0.016, 0.22, 1600, 1.2),
    ],
  },
  {
    id: 'chain-clank',
    label: 'Chain clank',
    group: 'Levers and switches',
    events: [
      tone(0, 180, 0.06, 0.3, 'triangle'),
      tone(0.04, 260, 0.05, 0.18, 'square'),
      noise(0.02, 0.04, 0.22, 900, 0.7),
    ],
  },
  {
    id: 'brake-lever',
    label: 'Brake lever',
    group: 'Levers and switches',
    events: [
      noise(0, 0.08, 0.16, 1600, 0.5),
      tone(0.06, 130, 0.08, 0.32, 'triangle', 70),
    ],
  },
  {
    id: 'metal-snap',
    label: 'Metal snap',
    group: 'Snaps',
    events: [
      tone(0, 2100, 0.012, 0.16, 'square'),
      noise(0.004, 0.016, 0.28, 3000, 2),
      tone(0.01, 700, 0.04, 0.1, 'sine'),
    ],
  },
  {
    id: 'plastic-click',
    label: 'Plastic click',
    group: 'Snaps',
    events: [
      noise(0, 0.01, 0.34, 1900, 1.4),
      tone(0.006, 480, 0.025, 0.14, 'triangle'),
    ],
  },
  {
    id: 'wooden-thud',
    label: 'Wooden thud',
    group: 'Snaps',
    events: [
      noise(0, 0.04, 0.3, 280, 0.4),
      tone(0.004, 95, 0.1, 0.4, 'sine', 55),
    ],
  },
];

export const DEFAULT_PUNCH_SOUND_IN = 'time-clock-stamp';
export const DEFAULT_PUNCH_SOUND_OUT = 'time-clock-release';

const byId = new Map(PUNCH_SOUNDS.map((sound) => [sound.id, sound]));

/**
 * A saved choice. Blank means the office has not picked one.
 * `off` is silent.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizePunchSound(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'off') return 'off';
  if (byId.has(value)) return value;
  return '';
}

/**
 * The sound to play. A missing or unknown choice uses the starting sound.
 * @param {unknown} raw
 * @param {string} fallback
 */
export function punchSoundFor(raw, fallback) {
  return normalizePunchSound(raw) || fallback;
}

/** @type {AudioContext | null} */
let audioContext = null;
/** @type {WeakMap<AudioContext, AudioBuffer>} */
const noiseBuffers = new WeakMap();

/**
 * @param {AudioContext} ctx
 */
function sharedNoise(ctx) {
  const cached = noiseBuffers.get(ctx);
  if (cached) return cached;
  const length = Math.floor(ctx.sampleRate * 0.25);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
  noiseBuffers.set(ctx, buffer);
  return buffer;
}

/**
 * @param {AudioContext} ctx
 * @param {SoundEvent[]} events
 */
function renderRecipe(ctx, events) {
  const startAt = ctx.currentTime + 0.02;
  const master = ctx.createGain();
  master.gain.value = 0.85;
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 4800;
  master.connect(lowpass);
  lowpass.connect(ctx.destination);

  for (const event of events) {
    const start = startAt + event.at;
    const dur = Math.max(0.01, event.dur);
    const gain = ctx.createGain();
    const peak = Math.max(0.001, event.gain);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.006, dur / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    gain.connect(master);

    if (event.noise) {
      const source = ctx.createBufferSource();
      source.buffer = sharedNoise(ctx);
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = Math.max(80, event.freq);
      band.Q.value = event.q ?? 0.8;
      source.connect(band);
      band.connect(gain);
      source.start(start);
      source.stop(start + dur + 0.02);
    } else {
      const osc = ctx.createOscillator();
      osc.type = event.type || 'triangle';
      const freq = Math.max(40, event.freq);
      osc.frequency.setValueAtTime(freq, start);
      if (event.slide) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, event.slide), start + dur);
      }
      osc.connect(gain);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    }
  }
}

/**
 * Play one catalog sound. Silent and unknown ids do nothing.
 * @param {unknown} id
 */
export function playPunchSound(id) {
  const key = normalizePunchSound(id);
  const sound = key && key !== 'off' ? byId.get(key) : null;
  if (!sound) return;
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctx) return;
  if (!audioContext) audioContext = new Ctx();
  const ctx = audioContext;
  const start = () => renderRecipe(ctx, sound.events);
  if (ctx.state === 'suspended') {
    ctx.resume().then(start).catch(() => {});
    return;
  }
  start();
}
