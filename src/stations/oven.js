// =====================================================================
// oven.js — slide the pizza in, watch the bake meter, pull it at the
// right moment. One slot: baking locks you out (tension by design).
// With the SECOND OVEN (V3 flagship) there are two slots with their own
// meters and alarms — the customer steps aside, the next order starts,
// and late-game rhythm becomes orchestration.
// =====================================================================

import { BAL } from '../balance.js';
import { clamp, lerp, rand, Juice, Ease, rr } from '../juice.js';
import { Sfx } from '../audio.js';
import { Build } from './build.js';

const OUTLINE = '#4a2e1d';

// layout
export const OVEN = { x: 952, y: 212, w: 286, h: 296 };
const MOUTH = { x: OVEN.x + 30, y: OVEN.y + 96, w: OVEN.w - 60, h: 150 };
const METER_H = 26;
const ZONE_NAMES = ['raw', 'light', 'normal', 'well', 'burnt'];
const ZONE_COLORS = { raw: '#e9dcb8', light: '#ecc170', normal: '#cf8a3c', well: '#8d5a25', burnt: '#b03a2a' };

function makeSlot() {
  return {
    has: false, prog: 0, door: 0,      // door 0 closed → 1 open
    chimed: false, urgT: 0, smokeT: 0, alarmed: false,
    pizza: null, ticket: null, cust: null, side: null,
    orderGrades: null, splats: 0,
  };
}

export const Oven = {

  resetDay(svc) {
    const dual = svc.state.upgrades.oven2 > 0;
    svc.ovens = dual ? [makeSlot(), makeSlot()] : [makeSlot()];
    svc.passOrder = null;              // { pizza, ticket, cust, side, ... } on the pass
    svc.glowPulse = 0;
    svc.ovenSteamT = 0;
  },

  dual(svc) { return svc.ovens.length > 1; },

  // slot mouth rects (single: the whole mouth; dual: split left/right)
  mouths(svc) {
    if (!this.dual(svc)) return [{ ...MOUTH }];
    const w = (MOUTH.w - 14) / 2;
    return [
      { x: MOUTH.x, y: MOUTH.y, w, h: MOUTH.h },
      { x: MOUTH.x + w + 14, y: MOUTH.y, w, h: MOUTH.h },
    ];
  },

  // zone boundaries 0..1 — oven tier visibly widens light/normal/well
  zones(tier) {
    const Z = BAL.OVEN.ZONES, w = BAL.OVEN.ZONE_WIDEN * tier;
    const raw = Math.max(0.1, Z.raw - w * 1.5);
    const well = Math.min(0.96, Z.well + w * 1.5);
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
    const meterTop = OVEN.y - 44 - (METER_H + 8);   // generous with two meters
    return x >= OVEN.x && x <= OVEN.x + OVEN.w && y >= meterTop && y <= OVEN.y + OVEN.h;
  },

  // which slot a click lands on (dual: split by mouth halves; single: slot 0)
  slotAt(svc, x) {
    if (!this.dual(svc)) return 0;
    return x < MOUTH.x + MOUTH.w / 2 ? 0 : 1;
  },

  freeSlot(svc) {
    return svc.ovens.findIndex(s => !s.has);
  },

  // pizza enters a free slot
  insert(svc) {
    const pz = svc.pizza;
    if (!pz) return;
    const idx = this.freeSlot(svc);
    if (idx < 0) return;
    const slot = svc.ovens[idx];
    const dual = this.dual(svc);
    const mouth = this.mouths(svc)[idx];

    slot.has = true; slot.prog = 0; slot.chimed = false;
    slot.urgT = 0; slot.smokeT = 0; slot.alarmed = false;
    slot.pizza = pz;
    slot.ticket = svc.ticket;
    slot.side = svc.side;
    slot.orderGrades = svc.orderGrades;
    slot.splats = svc.splatCount;
    pz.state = 'oven';

    Sfx.ovenDoor();
    Juice.tween({ target: slot, to: { door: 1 }, dur: 0.2, ease: Ease.outCubic });
    Juice.tween({
      target: pz,
      to: { x: mouth.x + mouth.w / 2, y: mouth.y + mouth.h / 2 - 2, scale: dual ? 0.48 : 0.66 },
      dur: 0.35, ease: Ease.outCubic,
      onDone: () => {
        Sfx.ovenStart();
        // door drops to a low lip so the pizza stays visible while it bakes
        Juice.tween({ target: slot, to: { door: 0.68 }, dur: 0.25, ease: Ease.outCubic });
        svc.onBakeStart();
      },
    });

    if (dual && svc.canOverlap()) {
      // the flagship move: this order steps aside, the counter frees up
      svc.onOrderParkedInOven(slot);
    } else {
      svc.stage = 'baking';
    }
  },

  // pull a slot's pizza to the pass (the pass holds one pizza at a time)
  pull(svc, idx = 0) {
    const slot = svc.ovens[idx];
    if (!slot || !slot.has) return;
    if (svc.passOrder) {
      Juice.floatText(svc.pass.x, svc.pass.y - 60, 'Pass is full — ring the bell!', { color: '#ff9b80', size: 16 });
      Sfx.popOff();
      return;
    }
    const pz = slot.pizza;
    slot.has = false;
    const anyBaking = svc.ovens.some(s => s.has);
    if (!anyBaking) Sfx.ovenStop();
    Sfx.ovenDoor();
    Sfx.steamHiss();
    const tier = svc.state.upgrades.oven;
    pz.bakeZone = this.zoneOf(slot.prog, tier);
    pz.zonesAtPull = this.zones(tier);        // "extra well-done" reads the depth
    Juice.tween({ target: slot, to: { door: 1 }, dur: 0.16, ease: Ease.outCubic });
    Juice.steam(pz.x, pz.y - 20, 6);
    if (pz.bakeZone === 'burnt') {
      Juice.shake(7, 0.4);           // the ONLY screen shake in the game
      Juice.smoke(pz.x, pz.y - 10, 14);
    }
    // slide to the pass
    pz.state = 'pass';
    svc.passOrder = {
      pizza: pz, ticket: slot.ticket, cust: slot.cust, side: slot.side,
      orderGrades: slot.orderGrades, splats: slot.splats,
    };
    slot.pizza = null; slot.ticket = null; slot.cust = null; slot.side = null;
    Juice.tween({
      target: pz, to: { x: svc.pass.x, y: svc.pass.y, scale: 0.8 },
      dur: 0.45, ease: Ease.outBack,
      onDone: () => Juice.tween({ target: slot, to: { door: 0 }, dur: 0.3 }),
    });
    svc.onBakeDone(idx, this.dual(svc));
  },

  update(svc, dt) {
    svc.glowPulse += dt;

    // ambient steam from the oven top
    svc.ovenSteamT -= dt;
    if (svc.ovenSteamT <= 0) {
      svc.ovenSteamT = rand(0.9, 2.2);
      Juice.steam(OVEN.x + rand(40, OVEN.w - 40), OVEN.y + 6, 1);
    }

    const tier = svc.state.upgrades.oven;
    const dual = this.dual(svc);
    svc.ovens.forEach((slot, idx) => {
      if (!slot.has) return;
      const pz = slot.pizza;
      const crustMult = pz && BAL.CRUSTS[pz.crust] ? BAL.CRUSTS[pz.crust].bakeMult : 1;
      slot.prog = Math.min(1, slot.prog + dt / (BAL.OVEN.BAKE_TIME[tier] * crustMult));
      if (pz) pz.bake = slot.prog;

      const z = this.zones(tier);
      const want = slot.ticket ? slot.ticket.bake : 'normal';

      // chime + (dual) alarm when entering this slot's target zone
      if (!slot.chimed && this.zoneOf(slot.prog, tier) === want) {
        slot.chimed = true;
        Sfx.zoneChime();
        if (dual) {
          Sfx.alarm();
          Juice.floatText(OVEN.x + OVEN.w / 2, OVEN.y - 66 - idx * 30,
            `SLOT ${idx + 1} READY!`, { color: '#9fe07c', size: 18 });
        } else {
          Juice.floatText(OVEN.x + OVEN.w / 2, OVEN.y - 62, 'now!', { color: '#9fe07c', size: 17 });
        }
      }

      // rising urgency ticks near burnt
      const toBurn = z.well - slot.prog;
      if (toBurn < BAL.OVEN.URGENCY_FROM && toBurn > -0.05) {
        slot.urgT -= dt;
        if (slot.urgT <= 0) {
          slot.urgT = lerp(0.12, 0.4, clamp(toBurn / BAL.OVEN.URGENCY_FROM, 0, 1));
          Sfx.urgency();
        }
      }

      // smoking when burnt
      if (slot.prog >= z.well) {
        if (!slot.alarmed && dual) { slot.alarmed = true; Sfx.alarm(); Sfx.alarm(); }
        slot.smokeT -= dt;
        if (slot.smokeT <= 0) {
          slot.smokeT = 0.3;
          const mouth = this.mouths(svc)[idx];
          Juice.smoke(mouth.x + mouth.w / 2 + rand(-20, 20), mouth.y + 10, 2);
        }
      }
    });
  },

  render(svc, ctx) {
    const tier = svc.state.upgrades.oven;
    const dual = this.dual(svc);
    const anyHot = svc.ovens.some(s => s.has);
    const active = svc.stage === 'tooven' || svc.stage === 'baking' || anyHot;

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

    // mouths (one wide, or two side by side)
    this.mouths(svc).forEach((mouth, idx) => {
      const slot = svc.ovens[idx];
      ctx.save();
      rr(ctx, mouth.x, mouth.y, mouth.w, mouth.h, mouth.h / 2.4);
      ctx.clip();
      const heat = slot.has ? 1 : 0.45;
      const flick = 0.85 + 0.15 * Math.sin(svc.glowPulse * 9 + idx * 2) * Math.sin(svc.glowPulse * 5.3);
      const grad = ctx.createRadialGradient(
        mouth.x + mouth.w / 2, mouth.y + mouth.h, 10,
        mouth.x + mouth.w / 2, mouth.y + mouth.h * 0.7, mouth.w * 0.7);
      grad.addColorStop(0, `rgba(255,${Math.round(150 * flick)},40,${0.95 * heat})`);
      grad.addColorStop(0.55, `rgba(190,70,20,${0.8 * heat})`);
      grad.addColorStop(1, 'rgba(40,16,8,1)');
      ctx.fillStyle = grad;
      ctx.fillRect(mouth.x, mouth.y, mouth.w, mouth.h);

      if (slot.has && slot.pizza) {
        Build.drawPizza(ctx, slot.pizza);
        ctx.fillStyle = `rgba(255,120,30,${0.12 + 0.05 * Math.sin(svc.glowPulse * 7)})`;
        ctx.fillRect(mouth.x, mouth.y, mouth.w, mouth.h);
        // heat shimmer lines
        ctx.strokeStyle = 'rgba(255,200,120,0.18)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          const sx = mouth.x + mouth.w * 0.2 + i * mouth.w * 0.3;
          ctx.beginPath();
          for (let yy = 0; yy <= 30; yy += 5) {
            const px = sx + Math.sin(svc.glowPulse * 6 + yy * 0.4 + i * 2) * 4;
            yy === 0 ? ctx.moveTo(px, mouth.y + 14 + yy) : ctx.lineTo(px, mouth.y + 14 + yy);
          }
          ctx.stroke();
        }
      }
      ctx.restore();

      // door (slides up when open)
      const doorH = mouth.h * (1 - slot.door * 0.92);
      if (doorH > 4) {
        rr(ctx, mouth.x - 4, mouth.y + mouth.h - doorH, mouth.w + 8, doorH, 10);
        ctx.fillStyle = '#5d3a22'; ctx.fill();
        ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE; ctx.stroke();
        rr(ctx, mouth.x + mouth.w / 2 - 24, mouth.y + mouth.h - doorH + 10, 48, 9, 5);
        ctx.fillStyle = '#c9a36a'; ctx.fill();
      }

      // mouth rim
      rr(ctx, mouth.x, mouth.y, mouth.w, mouth.h, mouth.h / 2.4);
      ctx.lineWidth = 5; ctx.strokeStyle = OUTLINE; ctx.stroke();

      // slot number plate (dual)
      if (dual) {
        ctx.fillStyle = '#c9a36a';
        rr(ctx, mouth.x + mouth.w / 2 - 12, mouth.y - 22, 24, 17, 5);
        ctx.fill();
        ctx.lineWidth = 2.5; ctx.stroke();
        ctx.fillStyle = '#4a2e1d';
        ctx.font = '900 11px Trebuchet MS, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(idx + 1), mouth.x + mouth.w / 2, mouth.y - 13);
      }
    });

    // "slide it in" highlight (a free slot glows while a pizza waits)
    if (svc.stage === 'tooven' && this.freeSlot(svc) >= 0) {
      const mouth = this.mouths(svc)[this.freeSlot(svc)];
      ctx.globalAlpha = 0.4 + 0.2 * Math.sin(svc.elapsed * 5);
      rr(ctx, mouth.x - 8, mouth.y - 8, mouth.w + 16, mouth.h + 16, mouth.h / 2);
      ctx.lineWidth = 5; ctx.strokeStyle = '#ffd54a'; ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ---- bake meters (one per slot, stacked) --------------------------
    svc.ovens.forEach((slot, idx) => {
      if (active || slot.has) this._renderMeter(svc, ctx, tier, slot, idx);
    });

    ctx.restore();
  },

  _renderMeter(svc, ctx, tier, slot, idx) {
    const z = this.zones(tier);
    const want = slot.ticket ? slot.ticket.bake : (svc.ticket ? svc.ticket.bake : 'normal');
    const M = { x: OVEN.x + 8, y: OVEN.y - 44 - idx * (METER_H + 10), w: OVEN.w - 16, h: METER_H };

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

    // target zone glow (only when this slot has a target)
    if (slot.has || svc.stage === 'tooven' || svc.stage === 'baking') {
      const wi = ZONE_NAMES.indexOf(want);
      const tx0 = M.x + bounds[wi] * M.w, tx1 = M.x + bounds[wi + 1] * M.w;
      ctx.save();
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(svc.elapsed * 6);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#ffd54a';
      rr(ctx, tx0 + 1, M.y - 2, tx1 - tx0 - 2, M.h + 4, 5);
      ctx.stroke();
      ctx.restore();
    }

    // needle
    if (slot.has) {
      const nx = M.x + clamp(slot.prog, 0, 1) * M.w;
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
    if (slot.has && this.zoneOf(slot.prog, tier) === want && !svc.passOrder) {
      ctx.fillStyle = '#9fe07c';
      ctx.font = '900 14px Trebuchet MS, system-ui, sans-serif';
      ctx.fillText('CLICK TO PULL!', M.x + M.w / 2, M.y - 14);
    }
    ctx.restore();
  },
};
