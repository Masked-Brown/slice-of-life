// =====================================================================
// serve.js — scoring + handoff. Pure scoring helpers (Score) plus the
// serve sequence (bell → pizza flies → coins → reaction → next).
// =====================================================================

import { BAL } from '../balance.js';
import { clamp, lerp, Juice, rand } from '../juice.js';
import { Sfx } from '../audio.js';
import { priceMultiplier, pushRating, gbp, tipMult } from '../state.js';
import { orderXP, masteryStars, recordMastery, loyaltyTier, recordLoyalty, unlocked } from '../progress.js';
import { Orders } from './order.js';

const BAKE_ORDER = ['raw', 'light', 'normal', 'well', 'burnt'];

export const Score = {

  // the effective band for a station: modifiers override the named band
  bandOf(ticket, which) {
    if (ticket && ticket.modifier) {
      const m = BAL.MODIFIERS[ticket.modifier];
      if (m && m.band && m.band[which]) return m.band[which];
    }
    return BAL.SCORE.BANDS[ticket ? ticket[which] : 'normal'];
  },

  // sauce/cheese: % amount vs band (name or [lo,hi] override) → fraction 0..1
  amountFrac(pct, band) {
    const [lo, hi] = Array.isArray(band) ? band : BAL.SCORE.BANDS[band];
    if (pct >= lo && pct <= hi) return 1;
    const d = pct < lo ? lo - pct : pct - hi;
    return clamp(1 - d / BAL.SCORE.BAND_FALLOFF, 0, 1);
  },

  amountGrade(pct, band) {
    const [lo, hi] = Array.isArray(band) ? band : BAL.SCORE.BANDS[band];
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

  // half-and-half: each half is judged on its own pieces (x<0 = left).
  // A piece on the wrong side shorts its own half AND reads as an extra
  // on the other — placement is the whole test.
  halfResult(pizza, ticket) {
    const S = BAL.SCORE;
    let sum = 0, n = 0, offBy = 0, extras = 0;
    for (const side of ['L', 'R']) {
      const wants = ticket.halves[side] || [];
      const piecesOn = pizza.toppings.filter(p => (side === 'L' ? p.x < 0 : p.x >= 0));
      const wantTypes = new Set(wants.map(w => w.type));
      for (const w of wants) {
        const placed = piecesOn.filter(p => p.type === w.type).length;
        const off = Math.abs(placed - w.count);
        offBy += off;
        sum += clamp(1 - S.TOPPING_COUNT_PENALTY * off, 0, 1);
        n++;
      }
      extras += new Set(piecesOn.map(p => p.type).filter(t => !wantTypes.has(t))).size;
    }
    let frac = n ? sum / n : 1;
    frac = clamp(frac - (extras * S.EXTRA_TYPE_PENALTY) / S.WEIGHTS.toppings, 0, 1);
    const grade = (offBy === 0 && extras === 0) ? 'perfect'
      : (offBy <= 1 && extras === 0) ? 'good' : 'off';
    return { frac, grade, offBy, extras };
  },

  toppingsResult(pizza, ticket) {
    const S = BAL.SCORE;
    if (ticket.half && ticket.halves) return this.halfResult(pizza, ticket);
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

  // satisfaction bonus from the supplier grades actually consumed this order
  // (majority grade per graded ingredient; premium delights, budget shows)
  gradeSatBonus(orderGrades) {
    if (!orderGrades) return 0;
    let bonus = 0;
    for (const key in orderGrades) {
      if (!BAL.GRADED.includes(key)) continue;
      let top = 'standard', n = 0;
      for (const g in orderGrades[key]) {
        if (orderGrades[key][g] > n) { n = orderGrades[key][g]; top = g; }
      }
      bonus += BAL.GRADES[top].satBonus;
    }
    return clamp(bonus, BAL.SCORE.GRADE_BONUS_MIN, BAL.SCORE.GRADE_BONUS_MAX);
  },

  // The whole order → money + satisfaction. `splats` = sauce counter splats,
  // `gradeBonus` = satisfaction points from supplier grades consumed,
  // `satAdjust` = other satisfaction shifts (sides, event moods),
  // `eventMult` = day-event price multiplier (rush/festival payouts).
  scoreOrder({ pizza, ticket, elapsed, splats, state, prepGrace, gradeBonus = 0, satAdjust = 0, eventMult = 1 }) {
    const S = BAL.SCORE, W = S.WEIGHTS, E = BAL.ECONOMY;

    const sizeFrac = pizza.size === ticket.size ? 1 : 0;
    const splatPen = Math.min(splats * S.SPLAT_PENALTY, S.SPLAT_PENALTY_MAX);
    let sauceFrac = clamp(this.amountFrac(pizza.sauceCoverage, this.bandOf(ticket, 'sauce')) - splatPen / W.sauce, 0, 1);
    // wrong sauce variant: most of the station credit gone
    if (ticket.sauceType && pizza.sauceType && pizza.sauceType !== ticket.sauceType) {
      sauceFrac *= S.WRONG_SAUCE_MULT;
    }
    const cheeseFrac = this.amountFrac(this.cheesePct(pizza), this.bandOf(ticket, 'cheese'));
    const top = this.toppingsResult(pizza, ticket);
    const bake = this.bakeResult(pizza.bakeZone, ticket.bake);
    // "extra well-done": WELL isn't enough — it has to be the deep half
    if (ticket.modifier === 'extrawell' && !bake.burnt && bake.grade === 'perfect'
        && pizza.zonesAtPull != null && pizza.bake != null) {
      const z = pizza.zonesAtPull;
      const deepAt = z.normal + (z.well - z.normal) * BAL.BAKE_DEEP_FRAC;
      if (pizza.bake < deepAt) {
        bake.frac = S.BAKE_ADJACENT_CREDIT;
        bake.grade = 'good';
      }
    }

    let accuracy =
      sizeFrac * W.size + sauceFrac * W.sauce + cheeseFrac * W.cheese +
      top.frac * W.toppings + bake.frac * W.bake;

    if (ticket.crust && pizza.crust && pizza.crust !== ticket.crust) {
      accuracy = Math.max(0, accuracy - S.CRUST_WRONG_PENALTY);
    }
    if (prepGrace) accuracy = Math.min(100, accuracy + S.PREP_GRACE);
    const perfect = accuracy >= 99.5 && !bake.burnt;
    if (bake.burnt) accuracy *= S.BURNT_TOTAL_MULT;

    // speed
    const par = S.PAR_BASE + S.PAR_PER_TYPE * ticket.toppings.length;
    const over = clamp((elapsed - par) / (par * (S.PAR_FAIL_X - 1)), 0, 1);
    const speedK = 1 - over;
    const sat0 = Math.round(clamp(accuracy * lerp(S.SPEED_FLOOR, 1, speedK), 0, 100));
    const sat1 = Math.round(clamp(sat0 + satAdjust, 0, 100));
    const satisfaction = Math.round(clamp(sat1 + gradeBonus, 0, 100));

    // money — meta.mult is the prestige scaffold's single economy touchpoint
    // (1.0 in V3 = no effect); pay, tip and analytics all flow from price.
    // Exotic topping types and fancy crusts charge more.
    const toppingPrice = ticket.toppings.reduce((a, w) => {
      const def = BAL.TOPPINGS[w.type];
      return a + E.PRICE_PER_TOPPING_TYPE + (def ? BAL.TIER_PRICE_ADD[def.tier] || 0 : 0);
    }, 0);
    const crustAdd = ticket.crust && BAL.CRUSTS[ticket.crust] ? BAL.CRUSTS[ticket.crust].priceAdd : 0;
    let price = (E.BASE_PRICE[ticket.size] + toppingPrice + crustAdd)
      * priceMultiplier(state) * (state.meta ? state.meta.mult : 1);
    if (ticket.special) price *= 1 + BAL.SPECIALS.PRICE_PREMIUM;
    // specialty recipes charge their own premium — mastery stars raise it
    if (ticket.specialty && BAL.RECIPES[ticket.specialty]) {
      const stars = masteryStars(state, ticket.specialty);
      price *= 1 + BAL.RECIPES[ticket.specialty].premium
        + stars * BAL.MASTERY.PREMIUM_PER_STAR;
    }
    // phone pre-orders pay ahead for the privilege
    if (ticket.preorder) price *= 1 + BAL.PREORDER.PREMIUM;
    price *= eventMult;

    const tips = tipMult(state);
    const moneyFor = sat => {
      const pay = price * lerp(E.SAT_MULT_MIN, E.SAT_MULT_MAX, sat / 100);
      let tipFrac = 0;
      if (sat >= E.TIP_START_SAT) {
        if (sat < E.TIP_KNEE_SAT) {
          tipFrac = E.TIP_KNEE_FRAC * (sat - E.TIP_START_SAT) / (E.TIP_KNEE_SAT - E.TIP_START_SAT);
        } else {
          const k = (sat - E.TIP_KNEE_SAT) / (100 - E.TIP_KNEE_SAT);
          tipFrac = E.TIP_KNEE_FRAC + (E.TIP_MAX_FRAC - E.TIP_KNEE_FRAC) * Math.pow(k, 1.2);
        }
      }
      return { pay, tip: price * tipFrac * tips };
    };
    const { pay, tip } = moneyFor(satisfaction);
    const base = moneyFor(sat1);
    // what the grade bonus was actually worth, in money — analytics uses this
    const gradeUplift = (pay + tip) - (base.pay + base.tip);

    let stars = 1;
    for (const [min, st] of S.STAR_THRESHOLDS) if (satisfaction >= min) { stars = st; break; }

    return {
      accuracy: Math.round(accuracy), satisfaction, perfect, burnt: bake.burnt,
      pay, tip, stars, par, price, elapsed, gradeUplift,
      breakdown: { sizeFrac, sauceFrac, cheeseFrac, topFrac: top.frac, bakeFrac: bake.frac },
    };
  },
};

// =====================================================================
// The serve sequence. Called by service.js when the bell is rung.
// =====================================================================
export const Serve = {

  serveNow(svc) {
    const po = svc.passOrder;
    if (!po || !po.pizza) return;
    const cust = po.cust || Orders.front(svc);
    if (!cust) return;
    const dual = svc.ovens.length > 1;
    // serving someone at the pickup spot leaves the current build untouched
    const light = !!(po.cust && po.cust.state === 'waiting');
    const pizza = po.pizza;
    const ticket = po.ticket || cust.ticket;

    const elapsed = svc.elapsed - (cust.frontAt ?? svc.elapsed);
    const prepGrace = svc.prepLeft > 0;
    if (prepGrace) svc.prepLeft--;

    // side outcome shifts satisfaction and (if made) earns its own money.
    // With the second oven a side rides along in the order snapshot.
    const sideState = light ? po.side : svc.side;
    let sideSat = 0, sidePay = 0;
    if (ticket.side) {
      const S = BAL.SIDES[ticket.side];
      if (sideState && sideState.state === 'ready') {
        sidePay = S.price * (BAL.SIDE_PAY_FLOOR + (1 - BAL.SIDE_PAY_FLOOR) * sideState.frac)
          * (svc.state.meta ? svc.state.meta.mult : 1);
        sideSat = sideState.frac > 0.9 ? BAL.SIDE_SAT.PERFECT : sideState.frac > 0.5 ? 0 : BAL.SIDE_SAT.SLOPPY;
      } else {
        sideSat = BAL.SIDE_SAT.MISSING;      // ordered, never made — they notice
      }
    }

    // pre-orders expected the kitchen ready — lateness caps their delight
    let lateSat = 0;
    if (cust.preorder) {
      const late = Math.max(0, elapsed - BAL.PREORDER.GRACE);
      lateSat = -Math.min(BAL.PREORDER.LATE_SAT_MAX, late * BAL.PREORDER.LATE_SAT_PER_SEC);
    }

    const res = Score.scoreOrder({
      pizza, ticket, elapsed,
      splats: po.splats != null ? po.splats : svc.splatCount,
      state: svc.state, prepGrace,
      gradeBonus: Score.gradeSatBonus(light ? po.orderGrades : svc.orderGrades),
      satAdjust: sideSat + lateSat,
      eventMult: svc.eventPay || 1,
    });
    res.sidePay = sidePay;
    res.sideKey = ticket.side || null;
    res.sideMade = sidePay > 0;
    res.lateSat = lateSat;
    res.light = light;
    res.ticketServed = ticket;

    // specialty bookkeeping (group pizzas count individually)
    if (ticket.specialty) {
      svc.specialtiesToday = (svc.specialtiesToday || 0) + 1;
      svc.state.stats.specialtiesSold = (svc.state.stats.specialtiesSold | 0) + 1;
    }
    // recipe mastery: every perfect specialty (group pizzas included) counts
    if (ticket.specialty && res.perfect) {
      const starUp = recordMastery(svc.state, ticket.specialty);
      if (starUp) {
        const r = BAL.RECIPES[ticket.specialty];
        Juice.stamp(640, 210, `${r.name} ${'★'.repeat(starUp)}`, { color: '#f5b942', size: 42 });
        Juice.floatText(640, 262, `Mastered — +${Math.round(BAL.MASTERY.PREMIUM_PER_STAR * 100)}% on every one from now on`, { color: '#fff6e0', size: 17 });
        Juice.confetti(640, 230, 20);
        Sfx.fanfare();
      }
    }

    // group orders: park this pizza, pin the next ticket, keep cooking
    if (cust.group && cust.group.idx < cust.group.tickets.length - 1) {
      const grp = cust.group;
      grp.results.push(res);
      Sfx.bell();
      svc.passOrder = null;
      if (svc.pizza === pizza) svc.pizza = null;
      for (const t of pizza.toppings) svc.usage[t.type] = (svc.usage[t.type] || 0) + 1;
      pizza.state = 'parked';
      svc.groupParked = svc.groupParked || [];
      svc.groupParked.push(pizza);
      Juice.floatText(svc.pass.x, svc.pass.y - 70, `Pizza ${grp.idx + 1} down!`, { color: '#fff4d6', size: 20 });
      Juice.tween({
        target: pizza, to: { x: svc.pass.x - 56 + grp.idx * 44, y: svc.pass.y + 14, scale: 0.4 },
        dur: 0.4, ease: (t) => t * t * (3 - 2 * t),
      });
      grp.idx++;
      cust.ticket = grp.tickets[grp.idx];
      svc.onGroupNext(cust);
      return;
    }

    // group finale: fold the parked results in — one payout, one reaction
    if (cust.group) {
      const grp = cust.group;
      const all = [...grp.results, res];
      const prem = 1 + BAL.GROUP.PREMIUM;
      res.pay = all.reduce((a, r) => a + r.pay, 0) * prem;
      res.tip = all.reduce((a, r) => a + r.tip, 0) * prem;
      res.satisfaction = Math.round(all.reduce((a, r) => a + r.satisfaction, 0) / all.length);
      res.perfect = all.every(r => r.perfect);
      res.accuracy = Math.round(all.reduce((a, r) => a + r.accuracy, 0) / all.length);
      let stars = 1;
      for (const [min, st] of BAL.SCORE.STAR_THRESHOLDS) if (res.satisfaction >= min) { stars = st; break; }
      res.stars = stars;
      res.groupTickets = grp.tickets;
      res.groupSize = all.length;
    }

    Sfx.bell();
    if (!light) svc.stage = 'handoff';
    Juice.floatText(svc.pass.x, svc.pass.y - 70, 'Order up!', { color: '#fff4d6', size: 20 });

    // the pass clears; pizza (and any parked group pizzas) fly to the customer
    svc.passOrder = null;
    if (svc.pizza === pizza) svc.pizza = null;
    pizza.state = 'fly';
    if (!light && svc.groupParked && svc.groupParked.length) {
      for (const parked of svc.groupParked) {
        parked.state = 'fly';
        Juice.tween({
          target: parked, to: { x: cust.x, y: cust.y + 26, scale: 0.3 },
          dur: 0.45, ease: (t) => t * t * (3 - 2 * t),
        });
      }
    }
    Juice.tween({
      target: pizza, to: { x: cust.x, y: cust.y + 26, scale: 0.45 },
      dur: 0.45, ease: (t) => t * t * (3 - 2 * t),
      onDone: () => this._payout(svc, cust, res, pizza),
    });
  },

  _payout(svc, cust, res, pz) {
    const g = svc.game, state = svc.state;
    const E = BAL.ECONOMY;

    // analytics: pieces consumed + revenue attributed per topping type
    for (const t of pz.toppings) svc.usage[t.type] = (svc.usage[t.type] || 0) + 1;
    const satMult = lerp(E.SAT_MULT_MIN, E.SAT_MULT_MAX, res.satisfaction / 100);
    for (const ticket of (res.groupTickets || [cust.ticket])) {
      for (const w of ticket.toppings) {
        const def = BAL.TOPPINGS[w.type];
        const typePrice = E.PRICE_PER_TOPPING_TYPE + (def ? BAL.TIER_PRICE_ADD[def.tier] || 0 : 0);
        svc.toppingRevenue[w.type] = (svc.toppingRevenue[w.type] || 0)
          + typePrice * priceMultiplier(state) * satMult;
      }
    }
    // grade bookkeeping for the "is premium worth it?" analytics line
    svc.gradeUplift = (svc.gradeUplift || 0) + (res.gradeUplift || 0);
    if (svc.orderGrades) {
      svc.gradeUnits = svc.gradeUnits || {};
      for (const key in svc.orderGrades) {
        const slot = svc.gradeUnits[key] || (svc.gradeUnits[key] = {});
        for (const g in svc.orderGrades[key]) slot[g] = (slot[g] || 0) + svc.orderGrades[key][g];
      }
    }

    // nailing a regular's order earns a fat extra tip; their word counts
    // double — and stamps their loyalty card (tiers sweeten the tip further)
    const R = BAL.REGULARS;
    if (cust.regular && res.satisfaction >= R.SAT_THRESHOLD) {
      const tier = loyaltyTier(state, cust.regular.key);
      res.tip += res.price * (R.TIP_BONUS_FRAC + BAL.LOYALTY.TIP_BONUS[tier]);
      if (res.satisfaction >= BAL.LOYALTY.SAT_THRESHOLD) {
        const tierUp = recordLoyalty(state, cust.regular.key);
        if (unlocked(state, 'system', 'loyalty')) svc.stampsToday = (svc.stampsToday || 0) + 1;
        const stamps = state.loyalty[cust.regular.key] ? state.loyalty[cust.regular.key].stamps : 0;
        if (tierUp) {
          Juice.stamp(640, 210, `${cust.regular.name.toUpperCase()} — CARD TIER ${tierUp}!`, { color: '#9fe07c', size: 38 });
          Juice.floatText(640, 260, tierUp >= 3
            ? 'Top tier — expect friends in tow'
            : 'Visits more often, tips better', { color: '#fff6e0', size: 17 });
          Juice.confetti(cust.x, cust.y - 40, 18);
          Sfx.fanfare();
        } else if (stamps > 0) {
          Juice.floatText(cust.x, cust.y - 140, `loyalty stamp ✚ (${stamps})`, { color: '#9fe07c', size: 16 });
        }
      }
    }

    // archetype economics: VIPs and tourists pay their way
    const arch = cust.archetype ? BAL.ARCHETYPES[cust.archetype] : null;
    if (arch) {
      if (arch.payMult) res.pay *= arch.payMult;
      if (arch.tipMult) res.tip *= arch.tipMult;
    }

    // ---- marked visitors settle their verdicts here -----------------------
    if (cust.role === 'critic') {
      const D = BAL.EVENTS.DEFS.critic;
      if (res.satisfaction >= D.graceSat) {
        state.money += D.reward;
        svc.bonusEarned += D.reward;
        state.criticBoost = D.footfallBoost;
        state.stats.raveReviews = (state.stats.raveReviews | 0) + 1;
        pushRating(state, 5); pushRating(state, 5);
        svc.eventReport = `The critic filed a rave review (+${gbp(D.reward)}, word spreads for tomorrow).`;
        Juice.stamp(640, 250, 'RAVE REVIEW!', { color: '#9fe07c', size: 48 });
        Juice.confetti(640, 240, 26);
        Sfx.fanfare();
        svc.onXP(BAL.XP.CRITIC_A, cust.x, cust.y - 30);
      } else if (res.satisfaction < D.failSat) {
        pushRating(state, 1); pushRating(state, 1);
        svc.eventReport = 'The critic’s write-up was… vivid. The stars felt it.';
        Juice.stamp(640, 250, 'SCATHING REVIEW…', { color: '#ff8a70', size: 40 });
        Sfx.grumpy();
      } else {
        svc.eventReport = 'The critic left a measured, forgettable column.';
      }
    } else if (cust.role === 'nonna') {
      const D = BAL.EVENTS.DEFS.nonna;
      if (res.satisfaction >= D.graceSat) {
        res.tip *= D.tipMult;
        svc.eventReport = 'Nonna kissed her fingers at the doorway. The tip was absurd.';
        Juice.stamp(640, 250, 'NONNA APPROVES!', { color: '#f5b942', size: 46 });
        Juice.sparkle(cust.x, cust.y - 40, 12);
        Sfx.fanfare();
        svc.onXP(BAL.XP.EVENT, cust.x, cust.y - 30);
      } else {
        svc.eventReport = 'Nonna patted your cheek: “next time, more love.” No harm done.';
      }
    } else if (cust.role === 'inspector') {
      const D = BAL.EVENTS.DEFS.inspector;
      const mess = svc.splats.length;
      const outs = Object.keys(svc.outWarned).length;
      if (mess <= D.maxSplats && outs === 0) {
        state.money += D.reward;
        svc.bonusEarned += D.reward;
        svc.eventReport = `Inspection passed — clean counter, full bins (+${gbp(D.reward)}).`;
        Juice.stamp(640, 250, 'INSPECTION PASSED!', { color: '#9fe07c', size: 42 });
        Sfx.goalDing();
        svc.onXP(BAL.XP.EVENT, cust.x, cust.y - 30);
      } else {
        pushRating(state, 2);
        svc.eventReport = mess > D.maxSplats
          ? 'Inspection flagged the sauce-splattered counter. Points docked.'
          : 'Inspection flagged empty bins mid-service. Points docked.';
        Juice.stamp(640, 250, 'CITATION ISSUED', { color: '#ff8a70', size: 40 });
        Sfx.grumpy();
      }
    }

    // sides ring up alongside the pizza
    if (res.sidePay > 0) {
      svc.sideRevenue = svc.sideRevenue || {};
      svc.sideRevenue[res.sideKey] = (svc.sideRevenue[res.sideKey] || 0) + res.sidePay;
      svc.sidesSold = (svc.sidesSold || 0) + 1;
      state.stats.sidesSoldLife = (state.stats.sidesSoldLife | 0) + 1;
      Juice.floatText(cust.x - 46, cust.y - 118, '+' + gbp(res.sidePay) + ' side', { color: '#8fd0f0', size: 18 });
    }

    const pizzas = res.groupSize || 1;
    const total = res.pay + res.tip + (res.sidePay || 0);
    state.money += total;
    state.stats.lifetimeServed += pizzas;
    state.stats.lifetimeEarned += total;
    state.lifetime.served += pizzas;
    state.lifetime.earned += total;
    if (res.perfect) {
      state.stats.lifetimePerfects++;
      state.lifetime.perfects++;
      state.stats.perfectStreak++;
      state.stats.bestPerfectStreak = Math.max(state.stats.bestPerfectStreak, state.stats.perfectStreak);
    } else {
      state.stats.perfectStreak = 0;
    }
    pushRating(state, res.stars);
    if (cust.regular) pushRating(state, res.stars);
    // a VIP's word carries — their rating lands twice more
    if (arch && arch.ratingWeight) {
      for (let i = 1; i < arch.ratingWeight; i++) pushRating(state, res.stars);
    }
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

    // regulars react personally — bigger delight, deeper disappointment
    if (cust.regular) {
      if (res.satisfaction >= R.SAT_THRESHOLD) {
        Juice.floatText(cust.x, cust.y - 124, `${cust.regular.name} loves it!`, { color: '#9fe07c', size: 20 });
        Juice.sparkle(cust.x, cust.y - 44, 10);
      } else if (res.satisfaction < 50) {
        Juice.floatText(cust.x, cust.y - 124, `${cust.regular.name} is let down…`, { color: '#ff8a70', size: 18 });
      }
    }

    if (res.perfect) {
      Juice.slowMo(0.15);
      Juice.stamp(640, 330, 'PERFECT PIZZA!', { color: '#ffd54a' });
      Juice.confetti(640, 300, 34);
      Sfx.perfect();
    }

    // pre-order bookkeeping: on time or late, the phone line remembers
    if (cust.preorder) {
      cust.preorder.done = true;
      cust.preorder.late = (res.lateSat || 0) < 0;
      svc.preordersDone = (svc.preordersDone || 0) + 1;
      if (cust.preorder.late) {
        svc.preordersLate = (svc.preordersLate || 0) + 1;
      } else {
        state.stats.preordersOnTime = (state.stats.preordersOnTime | 0) + 1;
        svc.onXP(BAL.XP.PREORDER, cust.x, cust.y - 20);
      }
    }

    // chef XP — accuracy is the multiplier, perfection the cherry
    let xp = orderXP(res.ticketServed || cust.ticket, res) * pizzas;
    if (res.sideMade) xp += BAL.XP.SIDE_BONUS;
    svc.onXP(xp, cust.x, cust.y - 40);

    Orders.dismiss(svc, cust, mood);
    svc.onOrderDone(res, { light: res.light, ticket: res.ticketServed });
  },
};
