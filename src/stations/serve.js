// =====================================================================
// serve.js — scoring + handoff. Pure scoring helpers (Score) plus the
// serve sequence (bell → pizza flies → coins → reaction → next).
// =====================================================================

import { BAL } from '../balance.js';
import { clamp, lerp, Juice, rand } from '../juice.js';
import { Sfx } from '../audio.js';
import { priceMultiplier, pushRating, gbp } from '../state.js';
import { Orders } from './order.js';

const BAKE_ORDER = ['raw', 'light', 'normal', 'well', 'burnt'];

export const Score = {

  // sauce/cheese: % amount vs named band → fraction 0..1
  amountFrac(pct, bandName) {
    const [lo, hi] = BAL.SCORE.BANDS[bandName];
    if (pct >= lo && pct <= hi) return 1;
    const d = pct < lo ? lo - pct : pct - hi;
    return clamp(1 - d / BAL.SCORE.BAND_FALLOFF, 0, 1);
  },

  amountGrade(pct, bandName) {
    const [lo, hi] = BAL.SCORE.BANDS[bandName];
    const m = (hi - lo) * BAL.SCORE.PERFECT_MARGIN;
    if (pct >= lo + m && pct <= hi - m) return 'perfect';
    if (pct >= lo && pct <= hi) return 'good';
    return 'off';
  },

  cheesePct(pizza) {
    const full = BAL.PIZZA.CHEESE_FULL * BAL.PIZZA.SIZE_FACTOR[pizza.size];
    return (pizza.cheese.length / full) * 100;
  },

  // spread 0..1 by quadrant balance for one topping type
  spreadFrac(pizza, type) {
    const pieces = pizza.toppings.filter(t => t.type === type);
    const n = pieces.length;
    if (n < 2) return 1;
    const q = [0, 0, 0, 0];
    for (const p of pieces) q[(p.x >= 0 ? 1 : 0) + (p.y >= 0 ? 2 : 0)]++;
    const maxQ = Math.max(...q);
    let s = 1 - clamp((maxQ / n - 0.25) / 0.75, 0, 1);
    if (n < 4) s = clamp(s + 0.3, 0, 1); // small counts can't spread evenly
    return s;
  },

  toppingsResult(pizza, ticket) {
    const S = BAL.SCORE;
    const wanted = ticket.toppings;
    if (!wanted.length) return { frac: 1, grade: 'perfect', offBy: 0, extras: 0 };
    let sum = 0, offBy = 0, spreadSum = 0;
    for (const w of wanted) {
      const placed = pizza.toppings.filter(t => t.type === w.type).length;
      const off = Math.abs(placed - w.count);
      offBy += off;
      const countFrac = clamp(1 - S.TOPPING_COUNT_PENALTY * off, 0, 1);
      const spread = this.spreadFrac(pizza, w.type);
      spreadSum += spread;
      sum += countFrac * (1 - S.TOPPING_SPREAD_WEIGHT) + spread * S.TOPPING_SPREAD_WEIGHT;
    }
    let frac = sum / wanted.length;
    // toppings that aren't on the ticket at all
    const wantedTypes = new Set(wanted.map(w => w.type));
    const extras = new Set(pizza.toppings.map(t => t.type).filter(t => !wantedTypes.has(t))).size;
    frac = clamp(frac - (extras * S.EXTRA_TYPE_PENALTY) / S.WEIGHTS.toppings, 0, 1);
    const spreadAvg = spreadSum / wanted.length;
    const grade = (offBy === 0 && extras === 0 && spreadAvg > 0.7) ? 'perfect'
      : (offBy <= 1 && extras === 0) ? 'good' : 'off';
    return { frac, grade, offBy, extras };
  },

  bakeResult(zone, wantZone) {
    const d = Math.abs(BAKE_ORDER.indexOf(zone) - BAKE_ORDER.indexOf(wantZone));
    const burnt = zone === 'burnt';
    const frac = burnt ? 0 : d === 0 ? 1 : d === 1 ? BAL.SCORE.BAKE_ADJACENT_CREDIT : 0;
    const grade = burnt ? 'burnt' : d === 0 ? 'perfect' : d === 1 ? 'good' : 'off';
    return { frac, grade, burnt };
  },

  // The whole order → money + satisfaction. `splats` = sauce counter splats.
  scoreOrder({ pizza, ticket, elapsed, splats, state, prepGrace }) {
    const S = BAL.SCORE, W = S.WEIGHTS, E = BAL.ECONOMY;

    const sizeFrac = pizza.size === ticket.size ? 1 : 0;
    const splatPen = Math.min(splats * S.SPLAT_PENALTY, S.SPLAT_PENALTY_MAX);
    const sauceFrac = clamp(this.amountFrac(pizza.sauceCoverage, ticket.sauce) - splatPen / W.sauce, 0, 1);
    const cheeseFrac = this.amountFrac(this.cheesePct(pizza), ticket.cheese);
    const top = this.toppingsResult(pizza, ticket);
    const bake = this.bakeResult(pizza.bakeZone, ticket.bake);

    let accuracy =
      sizeFrac * W.size + sauceFrac * W.sauce + cheeseFrac * W.cheese +
      top.frac * W.toppings + bake.frac * W.bake;

    if (prepGrace) accuracy = Math.min(100, accuracy + S.PREP_GRACE);
    const perfect = accuracy >= 99.5 && !bake.burnt;
    if (bake.burnt) accuracy *= S.BURNT_TOTAL_MULT;

    // speed
    const par = S.PAR_BASE + S.PAR_PER_TYPE * ticket.toppings.length;
    const over = clamp((elapsed - par) / (par * (S.PAR_FAIL_X - 1)), 0, 1);
    const speedK = 1 - over;
    const satisfaction = Math.round(clamp(accuracy * lerp(S.SPEED_FLOOR, 1, speedK), 0, 100));

    // money
    const price = (E.BASE_PRICE[ticket.size] + E.PRICE_PER_TOPPING_TYPE * ticket.toppings.length)
      * priceMultiplier(state);
    const pay = price * lerp(E.SAT_MULT_MIN, E.SAT_MULT_MAX, satisfaction / 100);
    let tipFrac = 0;
    if (satisfaction >= E.TIP_START_SAT) {
      if (satisfaction < E.TIP_KNEE_SAT) {
        tipFrac = E.TIP_KNEE_FRAC * (satisfaction - E.TIP_START_SAT) / (E.TIP_KNEE_SAT - E.TIP_START_SAT);
      } else {
        const k = (satisfaction - E.TIP_KNEE_SAT) / (100 - E.TIP_KNEE_SAT);
        tipFrac = E.TIP_KNEE_FRAC + (E.TIP_MAX_FRAC - E.TIP_KNEE_FRAC) * Math.pow(k, 1.2);
      }
    }
    const tip = price * tipFrac;

    let stars = 1;
    for (const [min, st] of S.STAR_THRESHOLDS) if (satisfaction >= min) { stars = st; break; }

    return {
      accuracy: Math.round(accuracy), satisfaction, perfect, burnt: bake.burnt,
      pay, tip, stars, par,
      breakdown: { sizeFrac, sauceFrac, cheeseFrac, topFrac: top.frac, bakeFrac: bake.frac },
    };
  },
};

// =====================================================================
// The serve sequence. Called by service.js when the bell is rung.
// =====================================================================
export const Serve = {

  serveNow(svc) {
    const cust = Orders.front(svc);
    if (!cust || !svc.pizza) return;

    const elapsed = svc.elapsed - (cust.frontAt ?? svc.elapsed);
    const prepGrace = svc.prepLeft > 0;
    if (prepGrace) svc.prepLeft--;

    const res = Score.scoreOrder({
      pizza: svc.pizza, ticket: cust.ticket, elapsed,
      splats: svc.splatCount, state: svc.state, prepGrace,
    });

    Sfx.bell();
    svc.stage = 'handoff';
    Juice.floatText(svc.pass.x, svc.pass.y - 70, 'Order up!', { color: '#fff4d6', size: 20 });

    // pizza flies to the customer
    const pz = svc.pizza;
    pz.state = 'fly';
    Juice.tween({
      target: pz, to: { x: cust.x, y: cust.y + 26, scale: 0.45 },
      dur: 0.45, ease: (t) => t * t * (3 - 2 * t),
      onDone: () => this._payout(svc, cust, res),
    });
  },

  _payout(svc, cust, res) {
    const g = svc.game, state = svc.state;
    svc.pizza = null;

    const total = res.pay + res.tip;
    state.money += total;
    state.stats.lifetimeServed++;
    state.stats.lifetimeEarned += total;
    pushRating(state, res.stars);
    svc.served++;
    svc.sales += res.pay;
    svc.tipsTotal += res.tip;
    svc.sats.push(res.satisfaction);

    // coins burst from the customer and fly to the HUD money counter
    const nCoins = clamp(Math.round(total / 1.6), 4, 14);
    Juice.coinBurst(cust.x, cust.y, g.hudMoneyPos.x, g.hudMoneyPos.y, nCoins, () => Sfx.coin());

    Juice.floatText(cust.x, cust.y - 64, '+' + gbp(res.pay), { color: '#9fe07c', size: 24 });
    if (res.tip >= 0.01) {
      Juice.floatText(cust.x + 46, cust.y - 96, '+' + gbp(res.tip) + ' tip!', { color: '#ffd54a', size: 21 });
      Sfx.tip();
      Juice.sparkle(cust.x + 40, cust.y - 60, 8);
    }
    Juice.floatText(cust.x - 50, cust.y - 96, '★'.repeat(res.stars), { color: '#f5b942', size: 19 });

    // customer reaction
    const mood = res.satisfaction >= 80 ? 'delighted' : res.satisfaction >= 50 ? 'fine' : 'grumpy';
    if (mood === 'grumpy') Sfx.grumpy();

    if (res.perfect) {
      Juice.slowMo(0.15);
      Juice.stamp(640, 330, 'PERFECT PIZZA!', { color: '#ffd54a' });
      Juice.confetti(640, 300, 34);
      Sfx.perfect();
    }

    Orders.dismissFront(svc, mood);
    svc.onOrderDone(res);
  },
};
