// =====================================================================
// juice.js — tween utility, particles, screen shake, floating text.
// All transient eye-candy flows through here. No gameplay state.
// =====================================================================

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

// ---- Easing ----------------------------------------------------------
export const Ease = {
  linear: t => t,
  inQuad: t => t * t,
  outQuad: t => t * (2 - t),
  inCubic: t => t * t * t,
  outCubic: t => 1 + Math.pow(t - 1, 3),
  inOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 + 4 * Math.pow(t - 1, 3),
  outBack: t => { const c = 1.70158; const u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; },
  outElastic: t => t === 0 ? 0 : t === 1 ? 1 :
    Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1,
};

// ---- Juice manager ----------------------------------------------------
export const Juice = {
  timeScale: 1,
  _slowT: 0,
  tweens: [],
  particles: [],
  floats: [],
  _shakeT: 0, _shakeDur: 0, _shakeMag: 0,

  // {target?, to?, from?, dur, ease, delay, onUpdate(e, t), onDone}
  tween(opts) {
    const tw = {
      target: opts.target || null,
      to: opts.to || null,
      from: opts.from ? { ...opts.from } : null,
      dur: opts.dur ?? 0.3,
      ease: opts.ease || Ease.outCubic,
      t: -(opts.delay || 0),
      onUpdate: opts.onUpdate || null,
      onDone: opts.onDone || null,
      dead: false,
    };
    if (tw.target && tw.to) {
      tw.from = tw.from || {};
      for (const k in tw.to) if (!(k in tw.from)) tw.from[k] = tw.target[k];
    }
    this.tweens.push(tw);
    return tw;
  },

  kill(tw) { if (tw) tw.dead = true; },
  killTweensOf(target) { for (const tw of this.tweens) if (tw.target === target) tw.dead = true; },

  slowMo(dur = 0.15) { this._slowT = dur; },

  shake(mag = 6, dur = 0.35) { this._shakeMag = mag; this._shakeDur = this._shakeT = dur; },

  shakeOffset() {
    if (this._shakeT <= 0) return { x: 0, y: 0 };
    const k = this._shakeT / this._shakeDur;
    const m = this._shakeMag * k * k;
    return { x: rand(-m, m), y: rand(-m, m) };
  },

  floatText(x, y, text, opts = {}) {
    this.floats.push({
      x, y, text,
      color: opts.color || '#fff',
      stroke: opts.stroke ?? '#3a2415',
      size: opts.size || 22,
      dur: opts.dur || 1.0,
      rise: opts.rise ?? 46,
      age: 0,
      stamp: false,
    });
  },

  // Big centered stamp ("PERFECT PIZZA!") with elastic pop
  stamp(x, y, text, opts = {}) {
    this.floats.push({
      x, y, text,
      color: opts.color || '#ffd54a',
      stroke: opts.stroke ?? '#7a2c12',
      size: opts.size || 56,
      dur: opts.dur || 1.6,
      rise: 0,
      age: 0,
      stamp: true,
      rot: opts.rot ?? -0.08,
    });
  },

  // ---- particle spawners -------------------------------------------
  _spawn(p) {
    if (this.particles.length > 380) this.particles.shift();
    this.particles.push(p);
  },

  flourPuff(x, y, n = 12) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(20, 90);
      this._spawn({ kind: 'soft', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30,
        g: -18, drag: 2.6, life: rand(0.4, 0.8), age: 0, size: rand(4, 10),
        color: '255,248,230', alpha: 0.85, grow: 14 });
    }
  },

  steam(x, y, n = 1) {
    for (let i = 0; i < n; i++) {
      this._spawn({ kind: 'soft', x: x + rand(-8, 8), y, vx: rand(-6, 6), vy: rand(-34, -22),
        g: -10, drag: 0.4, life: rand(1.1, 1.9), age: 0, size: rand(5, 9),
        color: '255,255,255', alpha: 0.4, grow: 16 });
    }
  },

  smoke(x, y, n = 10) {
    for (let i = 0; i < n; i++) {
      this._spawn({ kind: 'soft', x: x + rand(-16, 16), y: y + rand(-8, 8),
        vx: rand(-14, 14), vy: rand(-60, -30), g: -16, drag: 0.8,
        life: rand(0.9, 1.7), age: 0, size: rand(7, 14), color: '60,52,48',
        alpha: 0.6, grow: 22 });
    }
  },

  confetti(x, y, n = 28) {
    const colors = ['#f5b942', '#e2725b', '#7bbf5e', '#5da9d6', '#d678c0'];
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI, 0);
      const s = rand(120, 320);
      this._spawn({ kind: 'rect', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        g: 460, drag: 1.2, life: rand(0.9, 1.6), age: 0,
        w: rand(5, 9), h: rand(8, 13), rot: rand(0, 6), vr: rand(-9, 9),
        colorHex: pick(colors) });
    }
  },

  sparkle(x, y, n = 6) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(30, 110);
      this._spawn({ kind: 'star', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        g: 60, drag: 1.5, life: rand(0.35, 0.7), age: 0, size: rand(3, 6),
        colorHex: '#ffe9a8', rot: rand(0, 6), vr: rand(-6, 6) });
    }
  },

  // coins burst out then home to (tx,ty); onArrive fires per coin
  coinBurst(x, y, tx, ty, n = 8, onArrive = null) {
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI, 0), s = rand(80, 220);
      this._spawn({ kind: 'coin', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        g: 300, drag: 0.6, life: 3, age: 0, size: rand(7, 10),
        tx, ty, homeDelay: rand(0.22, 0.4), homeAcc: 0, onArrive,
        rot: rand(0, 6), vr: rand(-8, 8) });
    }
  },

  splat(x, y, color = '#c23a1c', n = 5) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(20, 70);
      this._spawn({ kind: 'soft', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 20,
        g: 240, drag: 1.2, life: rand(0.25, 0.5), age: 0, size: rand(3, 6),
        color: '194,58,28', alpha: 0.9, grow: 0, colorOverride: color });
    }
  },

  // ---- update / render ------------------------------------------------
  update(rdt) {
    // slow-mo runs on REAL time so it always recovers
    if (this._slowT > 0) { this._slowT -= rdt; this.timeScale = 0.25; }
    else this.timeScale = 1;
    const dt = rdt * this.timeScale;

    if (this._shakeT > 0) this._shakeT -= rdt;

    // tweens
    for (const tw of this.tweens) {
      if (tw.dead) continue;
      tw.t += dt;
      if (tw.t < 0) continue;
      const k = clamp(tw.t / tw.dur, 0, 1);
      const e = tw.ease(k);
      if (tw.target && tw.to) for (const key in tw.to) tw.target[key] = lerp(tw.from[key], tw.to[key], e);
      if (tw.onUpdate) tw.onUpdate(e, k);
      if (k >= 1) { tw.dead = true; if (tw.onDone) tw.onDone(); }
    }
    this.tweens = this.tweens.filter(t => !t.dead);

    // particles
    for (const p of this.particles) {
      p.age += dt;
      if (p.kind === 'coin' && p.age > p.homeDelay) {
        // home toward target with growing acceleration
        p.homeAcc = Math.min(p.homeAcc + dt * 2600, 3200);
        const dx = p.tx - p.x, dy = p.ty - p.y;
        const d = Math.hypot(dx, dy) || 1;
        p.vx += (dx / d) * p.homeAcc * dt;
        p.vy += (dy / d) * p.homeAcc * dt;
        p.vx *= (1 - 1.6 * dt); p.vy *= (1 - 1.6 * dt);
        if (d < 26) { p.age = p.life; if (p.onArrive) p.onArrive(); }
      } else {
        p.vy += (p.g || 0) * dt;
        const dr = 1 - (p.drag || 0) * dt;
        p.vx *= dr; p.vy *= dr;
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.rot != null) p.rot += (p.vr || 0) * dt;
    }
    this.particles = this.particles.filter(p => p.age < p.life);

    // floats
    for (const f of this.floats) f.age += dt;
    this.floats = this.floats.filter(f => f.age < f.dur);
  },

  render(ctx) {
    // particles
    for (const p of this.particles) {
      const k = 1 - p.age / p.life;
      ctx.save();
      if (p.kind === 'soft') {
        const size = p.size + (p.grow || 0) * (p.age / p.life);
        ctx.globalAlpha = (p.alpha ?? 0.8) * k;
        ctx.fillStyle = p.colorOverride || `rgb(${p.color})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'rect') {
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.colorHex;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      } else if (p.kind === 'star') {
        ctx.globalAlpha = k;
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.colorHex;
        drawStar(ctx, 0, 0, p.size);
      } else if (p.kind === 'coin') {
        ctx.translate(p.x, p.y); ctx.rotate(p.rot * 0.3);
        const squish = 0.55 + 0.45 * Math.abs(Math.sin(p.rot));
        ctx.scale(squish, 1);
        ctx.fillStyle = '#f0b93a';
        ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#b07d18'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#ffe9a8';
        ctx.beginPath(); ctx.arc(-p.size * 0.25, -p.size * 0.25, p.size * 0.3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // floating text & stamps
    for (const f of this.floats) {
      const k = f.age / f.dur;
      ctx.save();
      if (f.stamp) {
        const pop = f.age < 0.35 ? Ease.outElastic(f.age / 0.35) : 1;
        const fade = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
        ctx.globalAlpha = fade;
        ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.scale(pop, pop);
        ctx.font = `900 ${f.size}px Trebuchet MS, system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = f.size / 7; ctx.strokeStyle = f.stroke; ctx.lineJoin = 'round';
        ctx.strokeText(f.text, 0, 0);
        ctx.fillStyle = f.color; ctx.fillText(f.text, 0, 0);
      } else {
        const ease = Ease.outCubic(k);
        const y = f.y - f.rise * ease;
        const popIn = f.age < 0.12 ? Ease.outBack(f.age / 0.12) : 1;
        ctx.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
        ctx.translate(f.x, y); ctx.scale(popIn, popIn);
        ctx.font = `900 ${f.size}px Trebuchet MS, system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (f.stroke) { ctx.lineWidth = Math.max(3, f.size / 6); ctx.strokeStyle = f.stroke; ctx.lineJoin = 'round'; ctx.strokeText(f.text, 0, 0); }
        ctx.fillStyle = f.color; ctx.fillText(f.text, 0, 0);
      }
      ctx.restore();
    }
  },

  clear() {
    this.tweens.length = 0;
    this.particles.length = 0;
    this.floats.length = 0;
    this._shakeT = 0; this._slowT = 0; this.timeScale = 1;
  },
};

export function drawStar(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + i * Math.PI / 5;
    const rad = i % 2 === 0 ? r : r * 0.45;
    const px = x + Math.cos(ang) * rad, py = y + Math.sin(ang) * rad;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill();
}

// Rounded-rect path helper used across all canvas drawing
export function rr(ctx, x, y, w, h, r) {
  if (r > w / 2) r = w / 2;
  if (r > h / 2) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
