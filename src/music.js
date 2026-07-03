// =====================================================================
// music.js — a generative, cozy background loop. Zero audio files:
// a slow chord pad, a soft walking bass, and sparse pentatonic plucks,
// all scheduled ahead of the clock from the game loop. Moods retune
// the palette: cozy (default) / rush / tense (critic) / festive.
// =====================================================================

import { getAudioContext } from './audio.js';

// chord progressions as semitone offsets from C4 (root, third, fifth, seventh)
const PROGRESSIONS = {
  cozy:    [[0, 4, 7, 11], [-3, 0, 4, 7], [5, 9, 12, 16], [7, 11, 14, 17]],   // Cmaj7 Am7 Fmaj7 G7
  festive: [[0, 4, 7, 12], [5, 9, 12, 17], [7, 11, 14, 19], [0, 4, 7, 12]],   // brighter, rootier
  tense:   [[-3, 0, 4, 7], [-7, -3, 0, 5], [-3, 0, 4, 7], [-5, -1, 2, 7]],    // minor lean
  rush:    [[0, 4, 7, 11], [5, 9, 12, 16], [-3, 0, 4, 7], [7, 11, 14, 17]],
};
// pentatonic pools for the melody plucks (semitones from C5)
const SCALES = {
  cozy:    [0, 2, 4, 7, 9, 12],
  festive: [0, 2, 4, 7, 9, 12, 14],
  tense:   [0, 3, 5, 7, 10, 12],
  rush:    [0, 2, 4, 7, 9, 12],
};
const TEMPO = { cozy: 72, festive: 92, tense: 64, rush: 100 };     // bpm
const DENSITY = { cozy: 0.30, festive: 0.5, tense: 0.18, rush: 0.55 };

const semi = n => 261.63 * Math.pow(2, n / 12);   // C4-based

let ctx = null;
let bus = null;                 // music master gain
let volume = 0.7;
let muted = false;
let mood = 'cozy';
let running = false;
let nextBeat = 0;               // absolute ctx time of the next 8th note
let beatIndex = 0;              // running 8th-note counter

function ensure() {
  if (bus) return true;
  ctx = getAudioContext();
  if (!ctx) return false;
  bus = ctx.createGain();
  bus.gain.value = muted ? 0 : volume * 0.5;
  bus.connect(ctx.destination);
  return true;
}

function pad(freq, t, dur) {
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.value = freq;
  const o2 = ctx.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = freq * 2.003;              // airy detuned octave
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.045, t + dur * 0.3);
  g.gain.setValueAtTime(0.045, t + dur * 0.7);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  const g2 = ctx.createGain();
  g2.gain.value = 0.35;
  o.connect(g);
  o2.connect(g2); g2.connect(g);
  g.connect(bus);
  o.start(t); o.stop(t + dur + 0.1);
  o2.start(t); o2.stop(t + dur + 0.1);
}

function bassNote(freq, t, dur) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq / 2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.09, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(bus);
  o.start(t); o.stop(t + dur + 0.1);
}

function pluck(freq, t) {
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.055, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  o.connect(g); g.connect(bus);
  o.start(t); o.stop(t + 0.6);
}

// festive tambourine tick: a whisper of filtered noise
function shimmer(t) {
  const len = Math.floor(ctx.sampleRate * 0.06);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = 6000;
  const g = ctx.createGain();
  g.gain.value = 0.05;
  src.connect(f); f.connect(g); g.connect(bus);
  src.start(t);
}

export const Music = {

  start() {
    if (!ensure()) return;
    if (running) return;
    running = true;
    nextBeat = ctx.currentTime + 0.1;
    beatIndex = 0;
  },

  setMood(m) {
    if (PROGRESSIONS[m]) mood = m;
  },

  setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (bus) bus.gain.value = muted ? 0 : volume * 0.5;
  },
  get volume() { return volume; },

  setMuted(m) {
    muted = m;
    if (bus) bus.gain.value = m ? 0 : volume * 0.5;
  },

  // called from the game loop: schedule everything due in the next 300ms
  update() {
    if (!running || !ctx || muted) return;
    const eighth = 30 / TEMPO[mood];              // seconds per 8th note
    const prog = PROGRESSIONS[mood];
    const scale = SCALES[mood];
    while (nextBeat < ctx.currentTime + 0.3) {
      const beatsPerChord = 8;                    // one chord per bar of 8ths
      const bar = Math.floor(beatIndex / beatsPerChord);
      const step = beatIndex % beatsPerChord;
      const chord = prog[bar % prog.length];

      if (step === 0) {
        // pad + bass on the bar line
        for (const n of chord) pad(semi(n), nextBeat, eighth * beatsPerChord * 1.05);
        bassNote(semi(chord[0]), nextBeat, eighth * beatsPerChord * 0.9);
      }
      if (step === 4 && mood !== 'tense') {
        bassNote(semi(chord[0] + 7), nextBeat, eighth * 3.5);
      }
      // sparse melody on off-beats
      if (step > 0 && Math.random() < DENSITY[mood]) {
        const n = scale[Math.floor(Math.random() * scale.length)];
        pluck(semi(n + 12), nextBeat + (Math.random() < 0.3 ? eighth * 0.5 : 0));
      }
      if (mood === 'festive' && step % 2 === 1) shimmer(nextBeat);

      nextBeat += eighth;
      beatIndex++;
    }
  },
};
