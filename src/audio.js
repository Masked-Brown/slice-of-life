// =====================================================================
// audio.js — all SFX synthesized with the Web Audio API. Zero assets.
// Short, soft, layered; ±5% pitch variation on repeated sounds.
// =====================================================================

let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;

const MASTER_VOL = 0.32;

function ensure() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_VOL;
    master.connect(ctx.destination);
    // 1s white-noise buffer reused by every noise-based sound
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  } catch { return false; }
}

const vary = f => f * (0.95 + Math.random() * 0.1);
const now = () => ctx.currentTime;

// One-shot oscillator blip: pitch glide f0→f1, quick attack, decay over dur
function blip({ type = 'sine', f0 = 440, f1 = null, dur = 0.1, vol = 0.1, delay = 0, noVary = false }) {
  if (!ctx || muted) return;
  const t0 = now() + delay;
  const o = ctx.createOscillator();
  o.type = type;
  const fa = noVary ? f0 : vary(f0);
  o.frequency.setValueAtTime(fa, t0);
  if (f1 != null) o.frequency.exponentialRampToValueAtTime(Math.max(20, noVary ? f1 : vary(f1)), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

// One-shot filtered noise burst
function noiseHit({ dur = 0.1, vol = 0.1, lp = null, hp = null, delay = 0 }) {
  if (!ctx || muted) return;
  const t0 = now() + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = vary(1);
  let node = src;
  if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
  if (hp) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f; }
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  node.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur + 0.05);
}

// ---- loops ------------------------------------------------------------
let sauceNodes = null;
let ovenNodes = null;

function startLoop(build) {
  if (!ctx || muted) return null;
  return build();
}

export const Sfx = {
  init() { ensure(); },
  get ready() { return !!ctx; },

  setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : MASTER_VOL;
    if (m) { this.sauceStop(); this.ovenStop(); }
  },
  get muted() { return muted; },

  // ---- UI ------------------------------------------------------------
  tick() { blip({ type: 'sine', f0: 1800, dur: 0.025, vol: 0.035 }); },
  press() { blip({ type: 'triangle', f0: 150, f1: 95, dur: 0.09, vol: 0.2 }); },

  // ---- stations --------------------------------------------------------
  doughSlap() {
    noiseHit({ dur: 0.13, vol: 0.3, lp: 420 });
    blip({ type: 'sine', f0: 130, f1: 55, dur: 0.16, vol: 0.32 });
  },

  sauceStart() {
    if (sauceNodes || !ctx || muted) return;
    sauceNodes = startLoop(() => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, now());
      g.gain.linearRampToValueAtTime(0.085, now() + 0.12);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 7;
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.03;
      lfo.connect(lfoG); lfoG.connect(g.gain);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(); lfo.start();
      return { src, g, lfo };
    });
  },
  sauceStop() {
    if (!sauceNodes) return;
    const { src, g, lfo } = sauceNodes;
    sauceNodes = null;
    try {
      g.gain.cancelScheduledValues(now());
      g.gain.setValueAtTime(g.gain.value, now());
      g.gain.linearRampToValueAtTime(0, now() + 0.1);
      src.stop(now() + 0.15); lfo.stop(now() + 0.15);
    } catch { /* already stopped */ }
  },

  cheeseTick() { noiseHit({ dur: 0.03, vol: 0.05, hp: 2600 }); },

  // the needle just entered the ticket's band
  bandTick() { blip({ type: 'sine', f0: 990, dur: 0.12, vol: 0.08, noVary: true }); },

  // a topping bin just went low
  warn() {
    blip({ type: 'triangle', f0: 330, f1: 245, dur: 0.16, vol: 0.12 });
    blip({ type: 'triangle', f0: 330, f1: 245, dur: 0.16, vol: 0.1, delay: 0.18 });
  },

  pluck() { blip({ type: 'sine', f0: 340, f1: 230, dur: 0.07, vol: 0.13 }); },
  pat() { noiseHit({ dur: 0.06, vol: 0.12, lp: 950 }); },

  // ---- oven --------------------------------------------------------------
  ovenStart() {
    if (ovenNodes || !ctx || muted) return;
    ovenNodes = startLoop(() => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 200;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, now());
      g.gain.linearRampToValueAtTime(0.07, now() + 0.4);
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 52;
      const og = ctx.createGain(); og.gain.value = 0.035;
      src.connect(f); f.connect(g);
      o.connect(og); og.connect(g);
      g.connect(master);
      src.start(); o.start();
      return { src, g, o };
    });
  },
  ovenStop() {
    if (!ovenNodes) return;
    const { src, g, o } = ovenNodes;
    ovenNodes = null;
    try {
      g.gain.cancelScheduledValues(now());
      g.gain.setValueAtTime(g.gain.value, now());
      g.gain.linearRampToValueAtTime(0, now() + 0.25);
      src.stop(now() + 0.35); o.stop(now() + 0.35);
    } catch { /* already stopped */ }
  },
  ovenDoor() {
    noiseHit({ dur: 0.12, vol: 0.26, lp: 320 });
    blip({ type: 'sine', f0: 85, f1: 50, dur: 0.18, vol: 0.26 });
  },
  steamHiss() { noiseHit({ dur: 0.45, vol: 0.09, hp: 1400 }); },
  zoneChime() {
    blip({ type: 'sine', f0: 988, dur: 0.35, vol: 0.09, noVary: true });
    blip({ type: 'sine', f0: 1319, dur: 0.45, vol: 0.07, delay: 0.07, noVary: true });
  },
  urgency() { blip({ type: 'square', f0: 880, dur: 0.035, vol: 0.05 }); },

  // ---- serving & money ------------------------------------------------------
  bell() {
    blip({ type: 'sine', f0: 1319, dur: 1.1, vol: 0.2, noVary: true });
    blip({ type: 'sine', f0: 2637, dur: 0.5, vol: 0.06, noVary: true });
    noiseHit({ dur: 0.02, vol: 0.08, hp: 3000 });
  },
  coin() {
    const f = vary(1500);
    blip({ type: 'sine', f0: f, dur: 0.07, vol: 0.06, noVary: true });
    blip({ type: 'sine', f0: f * 1.5, dur: 0.09, vol: 0.05, delay: 0.04, noVary: true });
  },
  tip() {
    for (let i = 0; i < 4; i++)
      blip({ type: 'sine', f0: 2100 + Math.random() * 1100, dur: 0.1, vol: 0.045, delay: i * 0.05 });
  },
  perfect() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => blip({ type: 'triangle', f0: f, dur: 0.34, vol: 0.12, delay: i * 0.09, noVary: true }));
    noiseHit({ dur: 0.3, vol: 0.04, hp: 4000, delay: 0.3 });
  },
  grumpy() {
    blip({ type: 'sawtooth', f0: 290, f1: 130, dur: 0.55, vol: 0.085 });
  },
  doorSlam() {
    noiseHit({ dur: 0.16, vol: 0.34, lp: 280 });
    blip({ type: 'sine', f0: 72, f1: 40, dur: 0.22, vol: 0.3 });
  },

  // ---- feedback pops ------------------------------------------------------
  popPerfect() {
    blip({ type: 'sine', f0: 784, dur: 0.16, vol: 0.12, noVary: true });
    blip({ type: 'sine', f0: 1175, dur: 0.26, vol: 0.1, delay: 0.07, noVary: true });
  },
  popGood() { blip({ type: 'sine', f0: 620, f1: 840, dur: 0.13, vol: 0.1 }); },
  popOff() { blip({ type: 'square', f0: 170, f1: 115, dur: 0.16, vol: 0.11 }); },

  // ---- day end / shop ------------------------------------------------------
  tally() { blip({ type: 'square', f0: 1250, dur: 0.022, vol: 0.04 }); },
  chaChing() {
    noiseHit({ dur: 0.08, vol: 0.12, hp: 2200 });
    blip({ type: 'sine', f0: 1245, dur: 0.5, vol: 0.12, delay: 0.06, noVary: true });
    blip({ type: 'sine', f0: 1864, dur: 0.6, vol: 0.09, delay: 0.1, noVary: true });
  },
  starPop() {
    blip({ type: 'sine', f0: 520, f1: 940, dur: 0.08, vol: 0.12 });
    noiseHit({ dur: 0.03, vol: 0.05, hp: 3000 });
  },
  buy() {
    blip({ type: 'sine', f0: 660, dur: 0.09, vol: 0.1, noVary: true });
    blip({ type: 'sine', f0: 880, dur: 0.16, vol: 0.1, delay: 0.07, noVary: true });
  },

  // ---- goals & milestones ---------------------------------------------------
  goalDing() {
    blip({ type: 'sine', f0: 880, dur: 0.18, vol: 0.12, noVary: true });
    blip({ type: 'sine', f0: 1175, dur: 0.3, vol: 0.11, delay: 0.1, noVary: true });
    noiseHit({ dur: 0.06, vol: 0.05, hp: 3500, delay: 0.1 });
  },
  fanfare() {
    const notes = [659, 784, 988, 1319];
    notes.forEach((f, i) => blip({ type: 'triangle', f0: f, dur: 0.3, vol: 0.12, delay: i * 0.08, noVary: true }));
    blip({ type: 'sine', f0: 1568, dur: 0.5, vol: 0.08, delay: 0.34, noVary: true });
    noiseHit({ dur: 0.25, vol: 0.05, hp: 4200, delay: 0.3 });
  },

  // ---- level-up: a rising major arpeggio with a shimmer tail ---------------
  levelUp() {
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((f, i) => {
      blip({ type: 'triangle', f0: f, dur: 0.32, vol: 0.13, delay: i * 0.07, noVary: true });
      blip({ type: 'sine', f0: f * 2, dur: 0.2, vol: 0.04, delay: i * 0.07 + 0.02, noVary: true });
    });
    blip({ type: 'sine', f0: 2093, dur: 0.7, vol: 0.07, delay: 0.4, noVary: true });
    noiseHit({ dur: 0.35, vol: 0.05, hp: 5000, delay: 0.38 });
  },

  // pre-order due warning / oven-slot alarm — gentle but insistent
  alarm() {
    blip({ type: 'square', f0: 1175, dur: 0.09, vol: 0.07, noVary: true });
    blip({ type: 'square', f0: 1175, dur: 0.09, vol: 0.06, delay: 0.14, noVary: true });
  },
};
