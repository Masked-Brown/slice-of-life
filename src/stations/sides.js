// =====================================================================
// sides.js — garlic bread & drinks: quick, high-margin add-ons that
// reuse the game's core learned skill (hold, watch the band, release).
// One side in flight per order, prepared any time before the bell.
// =====================================================================

import { BAL, ING } from '../balance.js';
import { clamp, Juice, Ease, rr } from '../juice.js';
import { Sfx } from '../audio.js';
import { consumeStock, refundStock } from '../state.js';

const OUTLINE = '#4a2e1d';
export const BENCH = { x: 956, y: 520, w: 284, h: 76 };
const GAUGE = { x: BENCH.x - 30, y: BENCH.y + 4, w: 14, h: 66 };

export const Sides = {

  resetForOrder(svc) {
    svc.side = null;             // { key, state, fill, frac, toastT, holding }
  },

  // ticket wants a side and the player owns the station
  wanted(svc) {
    const t = svc.ticket;
    return t && t.side && svc.state.sides.includes(t.side) ? t.side : null;
  },

  _start(svc, key) {
    const def = BAL.SIDES[key];
    const stockKey = def.stockKey;
    const r = consumeStock(svc.state, stockKey, 1);
    if (r.taken < 1) {
      Juice.floatText(BENCH.x + BENCH.w / 2, BENCH.y - 26,
        `Out of ${ING(stockKey).label.toLowerCase()}!`, { color: '#ff8a70', size: 16 });
      Sfx.popOff();
      return;
    }
    svc.usage[stockKey] = (svc.usage[stockKey] || 0) + 1;
    svc.side = { key, state: 'filling', fill: 0, frac: 0, toastT: 0, holding: true };
    Sfx.pluck();
    if (key === 'garlicbread') Sfx.pat();
  },

  update(svc, dt) {
    const s = svc.side;
    if (!s) return;
    if (s.state === 'filling' && s.holding) {
      s.fill = clamp(s.fill + BAL.SIDE_RATE * 100 * dt, 0, 112);
      const [lo, hi] = BAL.SIDE_BAND;
      const inBand = s.fill >= lo && s.fill <= hi;
      if (inBand && !s._wasIn) Sfx.bandTick();
      s._wasIn = inBand;
      if (svc.side.key === 'drinks' && Math.random() < dt * 8) {
        Juice.steam(BENCH.x + 214 + (Math.random() * 12 - 6), BENCH.y + 18, 1);
      }
    }
    if (s.state === 'toasting') {
      s.toastT += dt;
      if (Math.random() < dt * 2.5) Juice.steam(BENCH.x + 70, BENCH.y + 6, 1);
      if (s.toastT >= BAL.SIDES.garlicbread.toastTime) {
        s.state = 'ready';
        Sfx.zoneChime();
        Juice.floatText(BENCH.x + BENCH.w / 2, BENCH.y - 22, 'Side ready!', { color: '#9fe07c', size: 17 });
        Juice.sparkle(BENCH.x + 70, BENCH.y + 22, 6);
      }
    }
  },

  // band accuracy → 0..1 quality (linear falloff outside the band)
  _fracFor(fill) {
    const [lo, hi] = BAL.SIDE_BAND;
    if (fill >= lo && fill <= hi) return 1;
    const d = fill < lo ? lo - fill : fill - hi;
    return clamp(1 - d / 25, 0, 1);
  },

  onDown(svc, x, y) {
    const want = this.wanted(svc);
    if (!want) return false;
    const over = x >= BENCH.x - 44 && x <= BENCH.x + BENCH.w + 8
      && y >= BENCH.y - 14 && y <= BENCH.y + BENCH.h + 12;
    if (!over) return false;
    if (!svc.side) {
      this._start(svc, want);
      return true;
    }
    if (svc.side.state === 'filling') {
      svc.side.holding = true;
      if (svc.side.key === 'drinks') Sfx.sauceStart();
      return true;
    }
    return true;   // ready/toasting: clicks are absorbed, nothing to do
  },

  onUp(svc) {
    const s = svc.side;
    if (!s || s.state !== 'filling' || !s.holding) return;
    s.holding = false;
    if (s.key === 'drinks') Sfx.sauceStop();
    if (s.fill <= 2) return;                   // barely touched — keep filling later
    s.frac = this._fracFor(s.fill);
    if (s.key === 'garlicbread') {
      s.state = 'toasting';
      Sfx.ovenDoor();
    } else {
      s.state = 'ready';
      Sfx.zoneChime();
      Juice.floatText(BENCH.x + BENCH.w / 2, BENCH.y - 22, 'Side ready!', { color: '#9fe07c', size: 17 });
    }
  },

  // order finished (served or aborted) — an unused ready side is lost;
  // an unstarted one never consumed stock, so nothing to do
  clear(svc) {
    svc.side = null;
  },

  render(svc, ctx) {
    if (!svc.state.sides.length) return;
    const want = this.wanted(svc);
    const s = svc.side;

    ctx.save();
    ctx.globalAlpha = want ? 1 : 0.65;

    // bench top
    rr(ctx, BENCH.x, BENCH.y, BENCH.w, BENCH.h, 10);
    ctx.fillStyle = '#9c6b3c'; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE; ctx.stroke();
    rr(ctx, BENCH.x + 6, BENCH.y + 6, BENCH.w - 12, BENCH.h - 12, 7);
    ctx.fillStyle = '#b98350'; ctx.fill();

    // toaster (garlic bread) on the left half
    if (svc.state.sides.includes('garlicbread')) {
      const toasting = s && s.key === 'garlicbread' && s.state === 'toasting';
      rr(ctx, BENCH.x + 22, BENCH.y + 14, 96, 46, 9);
      ctx.fillStyle = toasting ? '#c9574b' : '#aab4bd';
      ctx.fill(); ctx.lineWidth = 3.5; ctx.strokeStyle = OUTLINE; ctx.stroke();
      rr(ctx, BENCH.x + 32, BENCH.y + 20, 76, 12, 4);
      ctx.fillStyle = '#3a2a1e'; ctx.fill();
      if (toasting) {
        const k = clamp(s.toastT / BAL.SIDES.garlicbread.toastTime, 0, 1);
        ctx.fillStyle = '#ffd54a';
        rr(ctx, BENCH.x + 32, BENCH.y + 44, 76 * k, 7, 3); ctx.fill();
      }
      // bread poking out while buttering/toasting/ready
      if (s && s.key === 'garlicbread') {
        const bready = s.state === 'ready';
        ctx.fillStyle = bready ? '#e8b25f' : '#f0d9a8';
        rr(ctx, BENCH.x + 40, BENCH.y + (s.state === 'toasting' ? 16 : 6), 60, 14, 6);
        ctx.fill(); ctx.stroke();
        if (s.state === 'filling') {
          // butter sheen grows with fill
          ctx.fillStyle = `rgba(247,222,107,${0.25 + 0.6 * clamp(s.fill / 100, 0, 1)})`;
          rr(ctx, BENCH.x + 42, BENCH.y + 8, 56 * clamp(s.fill / 100, 0, 1), 10, 5); ctx.fill();
        }
      }
    }

    // drinks glass on the right half
    if (svc.state.sides.includes('drinks')) {
      const gx = BENCH.x + 196, gy = BENCH.y + 12;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      rr(ctx, gx, gy, 36, 50, 5); ctx.fill();
      ctx.lineWidth = 3.5; ctx.strokeStyle = OUTLINE; ctx.stroke();
      const fillK = s && s.key === 'drinks' ? clamp(s.fill / 100, 0, 1) : 0;
      if (fillK > 0) {
        ctx.fillStyle = '#e78742';
        rr(ctx, gx + 3, gy + 50 - 44 * fillK, 30, 44 * fillK, 4); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        for (let i = 0; i < 4; i++) {
          const bx = gx + 8 + (i * 9) % 22;
          const by = gy + 48 - (44 * fillK) * ((i * 0.31 + svc.elapsed * 0.7) % 1);
          ctx.beginPath(); ctx.arc(bx, by, 2, 0, Math.PI * 2); ctx.fill();
        }
      }
      // the fill line
      const [lo, hi] = BAL.SIDE_BAND;
      const ly = gy + 50 - 44 * ((lo + hi) / 200);
      ctx.strokeStyle = '#ffd54a'; ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(gx - 4, ly); ctx.lineTo(gx + 40, ly); ctx.stroke();
      ctx.setLineDash([]);
    }

    // label / prompt
    ctx.fillStyle = '#fff6e0';
    ctx.font = '900 11px Trebuchet MS, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const label = !want ? 'SIDES'
      : !s ? `+ ${BAL.SIDES[want].name} — click to start!`
      : s.state === 'filling' ? BAL.SIDES[s.key].verb + ' — hold!'
      : s.state === 'toasting' ? 'Toasting…'
      : '✓ ready to serve';
    ctx.fillText(label, BENCH.x + BENCH.w / 2, BENCH.y + BENCH.h + 12);

    // wanted glow
    if (want && (!s || s.state !== 'ready')) {
      ctx.globalAlpha = 0.4 + 0.2 * Math.sin(svc.elapsed * 5);
      rr(ctx, BENCH.x - 5, BENCH.y - 5, BENCH.w + 10, BENCH.h + 10, 13);
      ctx.lineWidth = 4; ctx.strokeStyle = '#ffd54a'; ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // fill gauge while filling
    if (s && s.state === 'filling') {
      const [lo, hi] = BAL.SIDE_BAND;
      const yFor = p => GAUGE.y + GAUGE.h - clamp(p, 0, 112) / 112 * GAUGE.h;
      rr(ctx, GAUGE.x - 3, GAUGE.y - 3, GAUGE.w + 6, GAUGE.h + 6, 6);
      ctx.fillStyle = '#4a2e1d'; ctx.fill();
      ctx.fillStyle = '#2e1d12';
      ctx.fillRect(GAUGE.x, GAUGE.y, GAUGE.w, GAUGE.h);
      const inBand = s.fill >= lo && s.fill <= hi;
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(svc.elapsed * 6);
      ctx.lineWidth = 3;
      ctx.strokeStyle = inBand ? '#9fe07c' : '#ffd54a';
      rr(ctx, GAUGE.x - 1.5, yFor(hi) - 1.5, GAUGE.w + 3, yFor(lo) - yFor(hi) + 3, 4);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = inBand ? '#9fe07c' : '#fffbef';
      ctx.fillRect(GAUGE.x, yFor(s.fill), GAUGE.w, GAUGE.y + GAUGE.h - yFor(s.fill));
    }

    ctx.restore();
  },
};
