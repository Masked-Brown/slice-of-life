// =====================================================================
// oven.js — slide the pizza in, watch the bake meter, pull it at the
// right moment. While baking, nothing else can be done: tension by design.
// =====================================================================

import { BAL } from '../balance.js';
import { clamp, lerp, rand, Juice, Ease, rr } from '../juice.js';
import { Sfx } from '../audio.js';
import { Build } from './build.js';

const OUTLINE = '#4a2e1d';

// layout
export const OVEN = { x: 952, y: 212, w: 286, h: 296 };
const MOUTH = { x: OVEN.x + 30, y: OVEN.y + 96, w: OVEN.w - 60, h: 150 };
const METER = { x: OVEN.x + 8, y: OVEN.y - 44, w: OVEN.w - 16, h: 26 };

const ZONE_NAMES = ['raw', 'light', 'normal', 'well', 'burnt'];
const ZONE_COLORS = { raw: '#e9dcb8', light: '#ecc170', normal: '#cf8a3c', well: '#8d5a25', burnt: '#b03a2a' };

export const Oven = {

  resetDay(svc) {
    svc.oven = {
      has: false, prog: 0, door: 0,      // door 0 closed → 1 open
      chimed: false, urgT: 0, smokeT: 0, glowPulse: 0,
      steamT: 0,
    };
  },

  // zone boundaries 0..1 — oven tier visibly widens light/normal/well
  zones(tier) {
    const Z = BAL.OVEN.ZONES, w = BAL.OVEN.ZONE_WIDEN * tier;
    const raw = Math.max(0.1, Z.raw - w * 1.5);
    const well = Math.min(0.96, Z.well + w * 1.5);
    // interior bounds keep their relative proportions inside [raw, well]
    const span = Z.well - Z.raw;
    const light = raw + (Z.light - Z.raw) / span * (well - raw);
    const normal = raw + (Z.normal - Z.raw) / span * (well - raw);
    return { raw, light, normal, well };
  },

  zoneOf(prog, tier) {
    const z = this.zones(tier);
    if (prog < z.raw) return 'raw';
    if (prog < z.light) return 'light';
    if (prog < z.normal) return 'normal';
    if (prog < z.well) return 'well';
    return 'burnt';
  },

  mouthHit(x, y) {
    return x >= MOUTH.x - 20 && x <= MOUTH.x + MOUTH.w + 20 &&
           y >= MOUTH.y - 30 && y <= MOUTH.y + MOUTH.h + 20;
  },

  ovenHit(x, y) {
    return x >= OVEN.x && x <= OVEN.x + OVEN.w && y >= METER.y && y <= OVEN.y + OVEN.h;
  },

  // pizza enters the oven
  insert(svc) {
    const pz = svc.pizza, ov = svc.oven;
    if (ov.has || !pz) return;
    ov.has = true; ov.prog = 0; ov.chimed = false; ov.urgT = 0; ov.smokeT = 0;
    pz.state = 'oven';
    svc.stage = 'baking';
    Sfx.ovenDoor();
    Juice.tween({ target: ov, to: { door: 1 }, dur: 0.2, ease: Ease.outCubic });
    Juice.tween({
      target: pz, to: { x: MOUTH.x + MOUTH.w / 2, y: MOUTH.y + MOUTH.h / 2 - 2, scale: 0.66 },
      dur: 0.35, ease: Ease.outCubic,
      onDone: () => {
        Sfx.ovenStart();
        // door drops to a low lip so the pizza stays visible while it bakes
        Juice.tween({ target: ov, to: { door: 0.68 }, dur: 0.25, ease: Ease.outCubic });
        svc.onBakeStart();
      },
    });
  },

  pull(svc) {
    const pz = svc.pizza, ov = svc.oven;
    if (!ov.has || !pz) return;
    ov.has = false;
    Sfx.ovenStop();
    Sfx.ovenDoor();
    Sfx.steamHiss();
    const tier = svc.state.upgrades.oven;
    pz.bakeZone = this.zoneOf(ov.prog, tier);
    Juice.tween({ target: ov, to: { door: 1 }, dur: 0.16, ease: Ease.outCubic });
    Juice.steam(pz.x, pz.y - 20, 6);
    if (pz.bakeZone === 'burnt') {
      Juice.shake(7, 0.4);           // the ONLY screen shake in the game
      Juice.smoke(pz.x, pz.y - 10, 14);
    }
    // slide to the pass
    pz.state = 'pass';
    Juice.tween({
      target: pz, to: { x: svc.pass.x, y: svc.pass.y, scale: 0.8 },
      dur: 0.45, ease: Ease.outBack,
      onDone: () => Juice.tween({ target: ov, to: { door: 0 }, dur: 0.3 }),
    });
    svc.onBakeDone();
  },

  update(svc, dt) {
    const ov = svc.oven;
    ov.glowPulse += dt;

    // ambient steam from the oven top
    ov.steamT -= dt;
    if (ov.steamT <= 0) {
      ov.steamT = rand(0.9, 2.2);
      Juice.steam(OVEN.x + rand(40, OVEN.w - 40), OVEN.y + 6, 1);
    }

    if (!ov.has) return;
    const tier = svc.state.upgrades.oven;
    ov.prog = Math.min(1, ov.prog + dt / BAL.OVEN.BAKE_TIME[tier]);
    if (svc.pizza) svc.pizza.bake = ov.prog;

    const z = this.zones(tier);
    const want = svc.ticket ? svc.ticket.bake : 'normal';

    // soft chime when entering the ticket's target zone
    if (!ov.chimed && this.zoneOf(ov.prog, tier) === want) {
      ov.chimed = true;
      Sfx.zoneChime();
      Juice.floatText(METER.x + METER.w / 2, METER.y - 18, 'now!', { color: '#9fe07c', size: 17 });
    }

    // rising urgency ticks near burnt
    const toBurn = z.well - ov.prog;
    if (toBurn < BAL.OVEN.URGENCY_FROM && toBurn > -0.05) {
      ov.urgT -= dt;
      if (ov.urgT <= 0) {
        ov.urgT = lerp(0.12, 0.4, clamp(toBurn / BAL.OVEN.URGENCY_FROM, 0, 1));
        Sfx.urgency();
      }
    }

    // smoking when burnt
    if (ov.prog >= z.well) {
      ov.smokeT -= dt;
      if (ov.smokeT <= 0) {
        ov.smokeT = 0.3;
        Juice.smoke(MOUTH.x + MOUTH.w / 2 + rand(-30, 30), MOUTH.y + 10, 2);
      }
    }
  },

  render(svc, ctx) {
    const ov = svc.oven;
    const tier = svc.state.upgrades.oven;
    const active = svc.stage === 'tooven' || svc.stage === 'baking';

    ctx.save();

    // body
    rr(ctx, OVEN.x, OVEN.y, OVEN.w, OVEN.h, 18);
    ctx.fillStyle = '#7d4a2a'; ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = OUTLINE; ctx.stroke();
    rr(ctx, OVEN.x + 10, OVEN.y + 10, OVEN.w - 20, OVEN.h - 20, 12);
    ctx.fillStyle = '#945c38'; ctx.fill();

    // brick arch detail
    ctx.fillStyle = '#a96b3f';
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.translate(OVEN.x + OVEN.w / 2, MOUTH.y + MOUTH.h / 2);
      ctx.rotate(-Math.PI / 2 + (i - 2.5) * 0.32);
      rr(ctx, -16, -(MOUTH.h / 2 + 40), 32, 30, 5);
      ctx.fill();
      ctx.restore();
    }

    // mouth interior with heat glow
    ctx.save();
    rr(ctx, MOUTH.x, MOUTH.y, MOUTH.w, MOUTH.h, MOUTH.h / 2.4);
    ctx.clip();
    const heat = ov.has ? 1 : 0.45;
    const flick = 0.85 + 0.15 * Math.sin(ov.glowPulse * 9) * Math.sin(ov.glowPulse * 5.3);
    const grad = ctx.createRadialGradient(
      MOUTH.x + MOUTH.w / 2, MOUTH.y + MOUTH.h, 10,
      MOUTH.x + MOUTH.w / 2, MOUTH.y + MOUTH.h * 0.7, MOUTH.w * 0.7);
    grad.addColorStop(0, `rgba(255,${Math.round(150 * flick)},40,${0.95 * heat})`);
    grad.addColorStop(0.55, `rgba(190,70,20,${0.8 * heat})`);
    grad.addColorStop(1, 'rgba(40,16,8,1)');
    ctx.fillStyle = grad;
    ctx.fillRect(MOUTH.x, MOUTH.y, MOUTH.w, MOUTH.h);

    // pizza inside (drawn through the mouth, slightly tinted by heat)
    if (ov.has && svc.pizza) {
      Build.drawPizza(ctx, svc.pizza);
      ctx.fillStyle = `rgba(255,120,30,${0.12 + 0.05 * Math.sin(ov.glowPulse * 7)})`;
      ctx.fillRect(MOUTH.x, MOUTH.y, MOUTH.w, MOUTH.h);
      // heat shimmer lines
      ctx.strokeStyle = 'rgba(255,200,120,0.18)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const sx = MOUTH.x + 40 + i * (MOUTH.w - 80) / 2;
        ctx.beginPath();
        for (let yy = 0; yy <= 30; yy += 5) {
          const px = sx + Math.sin(ov.glowPulse * 6 + yy * 0.4 + i * 2) * 4;
          yy === 0 ? ctx.moveTo(px, MOUTH.y + 14 + yy) : ctx.lineTo(px, MOUTH.y + 14 + yy);
        }
        ctx.stroke();
      }
    }
    ctx.restore();

    // door (slides up when open)
    const doorH = MOUTH.h * (1 - ov.door * 0.92);
    if (doorH > 4) {
      rr(ctx, MOUTH.x - 6, MOUTH.y + MOUTH.h - doorH, MOUTH.w + 12, doorH, 10);
      ctx.fillStyle = '#5d3a22'; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE; ctx.stroke();
      // handle
      rr(ctx, MOUTH.x + MOUTH.w / 2 - 30, MOUTH.y + MOUTH.h - doorH + 10, 60, 9, 5);
      ctx.fillStyle = '#c9a36a'; ctx.fill();
    }

    // mouth rim
    rr(ctx, MOUTH.x, MOUTH.y, MOUTH.w, MOUTH.h, MOUTH.h / 2.4);
    ctx.lineWidth = 5; ctx.strokeStyle = OUTLINE; ctx.stroke();

    // "slide it in" highlight
    if (svc.stage === 'tooven') {
      ctx.globalAlpha = 0.4 + 0.2 * Math.sin(svc.elapsed * 5);
      rr(ctx, MOUTH.x - 8, MOUTH.y - 8, MOUTH.w + 16, MOUTH.h + 16, MOUTH.h / 2);
      ctx.lineWidth = 5; ctx.strokeStyle = '#ffd54a'; ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ---- bake meter ----------------------------------------------------
    if (active || ov.has) this._renderMeter(svc, ctx, tier);

    ctx.restore();
  },

  _renderMeter(svc, ctx, tier) {
    const ov = svc.oven;
    const z = this.zones(tier);
    const want = svc.ticket ? svc.ticket.bake : 'normal';
    const M = METER;

    ctx.save();
    // frame
    rr(ctx, M.x - 4, M.y - 4, M.w + 8, M.h + 8, 9);
    ctx.fillStyle = '#4a2e1d'; ctx.fill();

    // zone bands
    const bounds = [0, z.raw, z.light, z.normal, z.well, 1];
    for (let i = 0; i < 5; i++) {
      const x0 = M.x + bounds[i] * M.w, x1 = M.x + bounds[i + 1] * M.w;
      ctx.fillStyle = ZONE_COLORS[ZONE_NAMES[i]];
      ctx.fillRect(x0, M.y, x1 - x0, M.h);
    }

    // target zone glow
    const wi = ZONE_NAMES.indexOf(want);
    const tx0 = M.x + bounds[wi] * M.w, tx1 = M.x + bounds[wi + 1] * M.w;
    ctx.save();
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(svc.elapsed * 6);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffd54a';
    rr(ctx, tx0 + 1, M.y - 2, tx1 - tx0 - 2, M.h + 4, 5);
    ctx.stroke();
    ctx.restore();

    // needle
    if (ov.has || svc.stage !== 'tooven') {
      const nx = M.x + clamp(ov.prog, 0, 1) * M.w;
      ctx.fillStyle = '#fffbef';
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(nx, M.y + M.h + 3);
      ctx.lineTo(nx - 8, M.y + M.h + 14);
      ctx.lineTo(nx + 8, M.y + M.h + 14);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillRect(nx - 1.5, M.y - 2, 3, M.h + 4);
    }

    // zone labels
    ctx.fillStyle = '#fff6e0';
    ctx.font = '800 10px Trebuchet MS, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const labels = { light: 'LIGHT', normal: 'NORMAL', well: 'WELL', burnt: 'BURNT' };
    for (let i = 1; i < 5; i++) {
      const name = ZONE_NAMES[i];
      const cx = M.x + (bounds[i] + bounds[i + 1]) / 2 * M.w;
      ctx.fillStyle = i === 4 ? '#ffe2dc' : '#fff6e0';
      ctx.fillText(labels[name], cx, M.y + M.h / 2);
    }

    // PULL hint while in the target zone
    if (ov.has && this.zoneOf(ov.prog, tier) === want) {
      ctx.fillStyle = '#9fe07c';
      ctx.font = '900 15px Trebuchet MS, system-ui, sans-serif';
      ctx.fillText('CLICK TO PULL!', M.x + M.w / 2, M.y - 16);
    }
    ctx.restore();
  },
};
