// =====================================================================
// dev/autoday.js — average-performance day resolution for the hidden
// admin panel. Dev/testing only: nothing player-facing imports this.
//
// The skill model mirrors tools/economy-sim.mjs (a "reasonable effort"
// player aiming for band centres with noise) but runs against the live
// state and books the same per-order side effects the service scene
// does — money, XP, ratings, loyalty, mastery, goals, milestones,
// per-topping analytics — so a skipped day leaves the save exactly as
// a played day of average quality would.
// =====================================================================

import { BAL } from '../balance.js';
import {
  currentRating, pushRating, unitCost, patienceMult, queueSlots,
  priceMultiplier, customersForDay, addStock, consumeStock,
} from '../state.js';
import { Score } from '../stations/serve.js';
import { Orders } from '../stations/order.js';
import { ensureNextDay, checkMilestones, goalProgress } from '../goals.js';
import { awardXP, orderXP, recordLoyalty, loyaltyTier, recordMastery, unlocked } from '../progress.js';
import { syncSeason } from '../seasons.js';
import { Telemetry } from '../telemetry.js';
import { lerp, clamp } from '../juice.js';

// ---- player skill model ("reasonable effort") -----------------------------
const gauss = () => {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// aim for the ticket band's centre with noise; steadier at higher tiers;
// tier-4 automation lands near-centre by machine
function pourAmount(ticket, which, toolTier) {
  const band = Score.bandOf(ticket, which);
  const [lo, hi] = Array.isArray(band) ? band : BAL.SCORE.BANDS[band];
  if (toolTier >= 4) {
    return clamp((lo + hi) / 2 + gauss() * (hi - lo) * 0.16, 0, 112);
  }
  const sigma = Math.max(3, (hi - lo)) * 0.44 * (1 - 0.08 * Math.min(toolTier, 3));
  return clamp((lo + hi) / 2 + gauss() * sigma, 0, 112);
}

function bakeOutcome(want, ovenTier) {
  const exactP = 0.68 + 0.03 * ovenTier;
  const r = Math.random();
  if (r < exactP) return want;
  if (r < exactP + 0.04) return 'burnt';
  const order = ['raw', 'light', 'normal', 'well'];
  const i = order.indexOf(want);
  const j = clamp(i + (Math.random() < 0.5 ? -1 : 1), 0, order.length - 1);
  return order[j] === want ? order[clamp(i + 1, 0, 3)] : order[j];
}

// sunflower spread; half-and-half pieces land on their side (with slips)
function placedPieces(ticket, avail, R) {
  const pts = [];
  const place = (type, count, side) => {
    for (let i = 0; i < count; i++) {
      const r = R * 0.72 * Math.sqrt((i + 0.5) / Math.max(count, 1));
      const a = i * 2.39996 + Math.random();
      let x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (side) {
        x = Math.abs(x) * (side === 'L' ? -1 : 1);
        if (Math.random() < 0.06) x = -x;
      }
      pts.push({ type, x, y });
    }
  };
  if (ticket.half && ticket.halves) {
    for (const side of ['L', 'R']) {
      for (const w of ticket.halves[side]) place(w.type, avail[w.type] || 0, side);
    }
  } else {
    for (const w of ticket.toppings) place(w.type, avail[w.type] || 0, null);
  }
  return pts;
}

// ---- one order built at average skill --------------------------------------
// Consumes real stock (emergency corner-shop at zero, like the build station)
// and returns the synthetic pizza + the grades the order actually used.
function buildPizza(acc, ticket) {
  const state = acc.state;
  const orderGrades = {};
  for (const b of ['dough', 'sauce', 'cheese']) {
    const r = consumeStock(state, b, 1);
    if (r.taken < 1) {
      const cost = unitCost(state, b) * BAL.STOCK.EMERGENCY_MULT;
      acc.emergencyCost = (acc.emergencyCost || 0) + cost;
      state.money -= cost;
    } else {
      acc.usage[b] = (acc.usage[b] || 0) + 1;
      for (const gk in r.grades) {
        orderGrades[b] = orderGrades[b] || {};
        orderGrades[b][gk] = (orderGrades[b][gk] || 0) + r.grades[gk];
      }
    }
  }
  const avail = {};
  for (const w of ticket.toppings) {
    let want = w.count;
    if (Math.random() > 0.85) want += Math.random() < 0.5 ? -1 : 1;
    const r = consumeStock(state, w.type, Math.max(0, want));
    avail[w.type] = r.taken;
    acc.usage[w.type] = (acc.usage[w.type] || 0) + r.taken;
    if (r.taken > 0) acc.usedTypes.add(w.type);
    for (const gk in r.grades) {
      orderGrades[w.type] = orderGrades[w.type] || {};
      orderGrades[w.type][gk] = (orderGrades[w.type][gk] || 0) + r.grades[gk];
    }
  }
  const pizza = {
    size: Math.random() < (state.upgrades.proofer ? 0.002 : 0.03)
      ? (ticket.size === 'S' ? 'M' : 'S') : ticket.size,
    R: BAL.PIZZA.RADIUS[ticket.size],
    sauceCoverage: pourAmount(ticket, 'sauce', state.upgrades.ladle),
    sauceType: (ticket.sauceType && Math.random() < (state.upgrades.ladle >= 4 ? 1 : 0.94))
      ? ticket.sauceType : 'tomato',
    crust: ticket.crust && Math.random() < 0.96 ? ticket.crust : 'classic',
    cheese: new Array(Math.round(
      pourAmount(ticket, 'cheese', state.upgrades.shaker) / 100
      * BAL.PIZZA.CHEESE_FULL * BAL.PIZZA.SIZE_FACTOR[ticket.size])),
    toppings: placedPieces(ticket, avail, BAL.PIZZA.RADIUS[ticket.size]),
    bakeZone: bakeOutcome(ticket.bake, state.upgrades.oven),
    bake: 0.8, zonesAtPull: null,
  };
  return { pizza, orderGrades };
}

// mid-day goal + milestone settlement, mirroring the service scene's
// _checkGoal/_checkMilestones (rewards, XP) without the celebration
function checkGoalAndMilestones(acc) {
  const state = acc.state;
  const goal = acc.goal;
  if (goal && !goal.hit && !goal.failed) {
    const p = goalProgress(goal, acc);
    if (p.failed) goal.failed = true;
    else if (p.done) {
      goal.hit = true;
      state.money += goal.reward;
      acc.bonusEarned += goal.reward;
      Telemetry.log('goal', { id: goal.id });
      acc.xpToday += BAL.XP.GOAL;
      awardXP(state, BAL.XP.GOAL);
    }
  }
  for (const def of checkMilestones(state)) {
    state.money += def.reward;
    acc.bonusEarned += def.reward;
    Telemetry.log('milestone', { id: def.id });
    acc.xpToday += BAL.XP.MILESTONE;
    awardXP(state, BAL.XP.MILESTONE);
  }
}

// ---- resolve a list of customers at average skill ---------------------------
// `acc` is either the live service scene's svc object (skip mid-day) or a
// fresh accumulator from makeAcc() — both carry the same counter fields.
export function resolveCustomers(acc, customers) {
  const state = acc.state;
  const evDef = acc.event ? BAL.EVENTS.DEFS[acc.event.id] : null;
  const eventPay = (evDef && evDef.payMult) || 1;
  const eventDrain = evDef && evDef.patienceMult ? 1 / evDef.patienceMult : 1;
  const pm = patienceMult(state);
  const E = BAL.ECONOMY;

  // average pace: equipment shaves build time, dual oven overlaps work
  const equipTiers = Math.min(state.upgrades.oven, 3) + Math.min(state.upgrades.ladle, 3)
    + Math.min(state.upgrades.shaker, 3) + Math.min(state.upgrades.tongs, 3);
  let speedMult = Math.max(0.8, 1 - 0.03 * equipTiers);
  if (state.upgrades.proofer) speedMult *= 0.94;
  if (state.upgrades.ladle >= 4) speedMult *= 0.93;
  if (state.upgrades.shaker >= 4) speedMult *= 0.93;
  const overhead = state.upgrades.oven2 ? 3.5 : 7;
  const bakeParallel = state.upgrades.oven2 ? 0.72 : 1;

  const slots = queueSlots(state);
  const finishes = [];
  let serverFreeAt = 0, t = BAL.DAYS.FIRST_ARRIVAL;

  for (const cust of customers) {
    const arrival = t;
    t += Orders.arrivalGap(state);

    const tickets = cust.group ? cust.group.tickets : [cust.ticket];
    const par = BAL.SCORE.PAR_BASE + BAL.SCORE.PAR_PER_TYPE * tickets[0].toppings.length;
    let elapsed = 0;
    for (const tk of tickets) {
      const p = BAL.SCORE.PAR_BASE + BAL.SCORE.PAR_PER_TYPE * tk.toppings.length;
      elapsed += p * (0.85 + Math.random() * 0.55) * speedMult * bakeParallel;
    }

    // queue model: a customer storms out if the wait outruns their patience
    const enter = Math.max(arrival, finishes.length >= slots ? finishes[finishes.length - slots] : 0);
    const start = Math.max(enter, serverFreeAt);
    const patienceBudget = BAL.PATIENCE.QUEUE_SECONDS * pm
      / ((cust.drainScale || 1) * eventDrain);
    if (start - enter > patienceBudget) {
      acc.lost++;
      pushRating(state, 1);
      if (cust.regular) pushRating(state, 1);
      finishes.push(start);
      checkGoalAndMilestones(acc);           // a storm-out sinks 'no walk-outs'
      continue;
    }
    serverFreeAt = start + elapsed + overhead;
    finishes.push(serverFreeAt);

    // build & score each pizza on the ticket
    const results = [];
    let perfectCount = 0;
    for (const tk of tickets) {
      const { pizza, orderGrades } = buildPizza(acc, tk);

      // sides: made most of the time when asked, to a decent line
      let sideSat = 0, sidePay = 0, sideKey = null;
      if (tk.side && Math.random() < 0.92) {
        const S = BAL.SIDES[tk.side];
        const r = consumeStock(state, S.stockKey, 1);
        if (r.taken >= 1) {
          acc.usage[S.stockKey] = (acc.usage[S.stockKey] || 0) + 1;
          const frac = clamp(1 - Math.abs(gauss()) * 0.25, 0, 1);
          sidePay = S.price * (BAL.SIDE_PAY_FLOOR + (1 - BAL.SIDE_PAY_FLOOR) * frac)
            * (state.meta ? state.meta.mult : 1);
          sideSat = frac > 0.9 ? BAL.SIDE_SAT.PERFECT : frac > 0.5 ? 0 : BAL.SIDE_SAT.SLOPPY;
          sideKey = tk.side;
        }
      } else if (tk.side) {
        sideSat = BAL.SIDE_SAT.MISSING;
      }

      // pre-orders: average play is mostly on time, occasionally late
      let lateSat = 0;
      if (cust.preorder && Math.random() < 0.2) lateSat = -6;

      const res = Score.scoreOrder({
        pizza, ticket: tk, elapsed: elapsed / tickets.length,
        splats: Math.random() < 0.2 ? 1 : 0, state, prepGrace: false,
        gradeBonus: Score.gradeSatBonus(orderGrades),
        satAdjust: sideSat + lateSat,
        eventMult: eventPay,
      });
      res.sidePay = sidePay;
      res.sideKey = sideKey;
      res.lateSat = lateSat;
      res.orderGrades = orderGrades;

      // grade analytics — mirror Serve._payout
      acc.gradeUplift = (acc.gradeUplift || 0) + (res.gradeUplift || 0);
      acc.gradeUnits = acc.gradeUnits || {};
      for (const key in orderGrades) {
        const slot = acc.gradeUnits[key] || (acc.gradeUnits[key] = {});
        for (const gk in orderGrades[key]) slot[gk] = (slot[gk] || 0) + orderGrades[key][gk];
      }

      if (tk.specialty) {
        acc.specialtiesToday = (acc.specialtiesToday || 0) + 1;
        state.stats.specialtiesSold = (state.stats.specialtiesSold | 0) + 1;
        if (res.perfect) recordMastery(state, tk.specialty);
      }
      if (res.perfect) perfectCount++;
      results.push(res);
    }

    // combine (groups pay a premium on the lot)
    const prem = cust.group ? 1 + BAL.GROUP.PREMIUM : 1;
    let pay = results.reduce((a, r) => a + r.pay, 0) * prem;
    let tip = results.reduce((a, r) => a + r.tip, 0) * prem;
    const satisfaction = Math.round(results.reduce((a, r) => a + r.satisfaction, 0) / results.length);
    const perfect = results.every(r => r.perfect);
    const sidePayTotal = results.reduce((a, r) => a + (r.sidePay || 0), 0);
    let stars = 1;
    for (const [min, st] of BAL.SCORE.STAR_THRESHOLDS) if (satisfaction >= min) { stars = st; break; }

    // per-topping revenue attribution — mirror Serve._payout
    const satMult = lerp(E.SAT_MULT_MIN, E.SAT_MULT_MAX, satisfaction / 100);
    for (const tk of tickets) {
      for (const w of tk.toppings) {
        const def = BAL.TOPPINGS[w.type];
        const typePrice = E.PRICE_PER_TOPPING_TYPE + (def ? BAL.TIER_PRICE_ADD[def.tier] || 0 : 0);
        acc.toppingRevenue[w.type] = (acc.toppingRevenue[w.type] || 0)
          + typePrice * priceMultiplier(state) * satMult;
      }
    }

    // regulars & loyalty
    if (cust.regular && satisfaction >= BAL.REGULARS.SAT_THRESHOLD) {
      const tier = loyaltyTier(state, cust.regular.key);
      tip += results[0].price * (BAL.REGULARS.TIP_BONUS_FRAC + BAL.LOYALTY.TIP_BONUS[tier]);
      if (satisfaction >= BAL.LOYALTY.SAT_THRESHOLD) {
        recordLoyalty(state, cust.regular.key);
        if (unlocked(state, 'system', 'loyalty')) acc.stampsToday = (acc.stampsToday || 0) + 1;
      }
    }

    // archetype economics
    const arch = cust.archetype ? BAL.ARCHETYPES[cust.archetype] : null;
    if (arch) {
      if (arch.payMult) pay *= arch.payMult;
      if (arch.tipMult) tip *= arch.tipMult;
    }

    // marked visitors settle their verdicts (average day: no splat pile-up,
    // stockouts only if the run genuinely ran dry — approximated as clean)
    let xpExtra = 0;
    if (cust.role === 'critic') {
      const D = BAL.EVENTS.DEFS.critic;
      if (satisfaction >= D.graceSat) {
        state.money += D.reward;
        acc.bonusEarned += D.reward;
        state.criticBoost = D.footfallBoost;
        state.stats.raveReviews = (state.stats.raveReviews | 0) + 1;
        pushRating(state, 5); pushRating(state, 5);
        acc.eventReport = `The critic filed a rave review (+£${D.reward.toFixed(2)}, word spreads for tomorrow).`;
        xpExtra += BAL.XP.CRITIC_A;
      } else if (satisfaction < D.failSat) {
        pushRating(state, 1); pushRating(state, 1);
        acc.eventReport = 'The critic’s write-up was… vivid. The stars felt it.';
      } else {
        acc.eventReport = 'The critic left a measured, forgettable column.';
      }
    } else if (cust.role === 'nonna') {
      const D = BAL.EVENTS.DEFS.nonna;
      if (satisfaction >= D.graceSat) {
        tip *= D.tipMult;
        acc.eventReport = 'Nonna kissed her fingers at the doorway. The tip was absurd.';
        xpExtra += BAL.XP.EVENT;
      } else {
        acc.eventReport = 'Nonna patted your cheek: “next time, more love.” No harm done.';
      }
    } else if (cust.role === 'inspector') {
      const D = BAL.EVENTS.DEFS.inspector;
      if (Math.random() < 0.75) {          // average play mostly keeps it clean
        state.money += D.reward;
        acc.bonusEarned += D.reward;
        acc.eventReport = `Inspection passed — clean counter, full bins (+£${D.reward.toFixed(2)}).`;
        xpExtra += BAL.XP.EVENT;
      } else {
        pushRating(state, 2);
        acc.eventReport = 'Inspection flagged the counter mid-service. Points docked.';
      }
    }

    // the till rings — mirror Serve._payout's banking
    const total = pay + tip + sidePayTotal;
    state.money += total;
    state.stats.lifetimeServed += tickets.length;
    state.stats.lifetimeEarned += total;
    state.lifetime.served += tickets.length;
    state.lifetime.earned += total;
    state.stats.lifetimePerfects += perfectCount;
    state.lifetime.perfects += perfectCount;
    if (perfect) {
      state.stats.perfectStreak++;
      state.stats.bestPerfectStreak = Math.max(state.stats.bestPerfectStreak, state.stats.perfectStreak);
      acc.perfectsToday++;
    } else {
      state.stats.perfectStreak = 0;
    }
    pushRating(state, stars);
    if (cust.regular) pushRating(state, stars);
    if (arch && arch.ratingWeight) {
      for (let i = 1; i < arch.ratingWeight; i++) pushRating(state, stars);
    }

    acc.served++;
    acc.sales += pay;
    acc.tipsTotal += tip;
    acc.sats.push(satisfaction);
    for (const r of results) {
      if (r.sidePay > 0) {
        acc.sideRevenue = acc.sideRevenue || {};
        acc.sideRevenue[r.sideKey] = (acc.sideRevenue[r.sideKey] || 0) + r.sidePay;
        acc.sidesSold = (acc.sidesSold || 0) + 1;
        state.stats.sidesSoldLife = (state.stats.sidesSoldLife | 0) + 1;
      }
    }
    if (tickets.some(tk => tk.size === 'L')) acc.largeSold++;
    if (elapsed <= par) acc.underPar++;

    // pre-order bookkeeping
    if (cust.preorder) {
      cust.preorder.done = true;
      cust.preorder.late = (results[0].lateSat || 0) < 0;
      acc.preordersDone = (acc.preordersDone || 0) + 1;
      if (cust.preorder.late) {
        acc.preordersLate = (acc.preordersLate || 0) + 1;
      } else {
        state.stats.preordersOnTime = (state.stats.preordersOnTime | 0) + 1;
        xpExtra += BAL.XP.PREORDER;
      }
    }

    // chef XP — accuracy is the multiplier, perfection the cherry
    let xp = 0;
    for (let i = 0; i < results.length; i++) xp += orderXP(tickets[i], results[i]);
    if (results.some(r => r.sidePay > 0)) xp += BAL.XP.SIDE_BONUS;
    xp += xpExtra;
    acc.xpToday += xp;
    awardXP(state, xp);

    checkGoalAndMilestones(acc);
  }
}

// ---- fresh accumulator (svc-shaped) for a day resolved outside the scene ----
function makeAcc(state, plan) {
  return {
    state,
    served: 0, lost: 0, sales: 0, tipsTotal: 0, sats: [],
    usage: {}, toppingRevenue: {}, emergencyCost: 0,
    bonusEarned: 0, xpToday: 0,
    largeSold: 0, perfectsToday: 0, underPar: 0, usedTypes: new Set(),
    sidesSold: 0, specialtiesToday: 0, stampsToday: 0,
    sideRevenue: {}, gradeUplift: 0, gradeUnits: {},
    preordersDone: 0, preordersLate: 0, preorders: [],
    goal: { ...plan.goal, hit: false, failed: false },
    totalCustomers: 0,
    event: plan.event || null,
    eventReport: null,
    ratingAtStart: currentRating(state),
  };
}

// ---- the day-end stats object, exactly as the service scene shapes it -------
export function buildStats(acc) {
  const state = acc.state;
  // all-day goals (no walk-outs, 90% sat) settle when the last customer is done
  checkGoalAndMilestones(acc);
  const reports = {
    rush: `Rush hour survived — ${acc.served} served at surge prices.`,
    festival: `Festival day! ${acc.served} fed, ${acc.sidesSold || 0} sides gone.`,
    slow: 'A slow, deep morning — big orders, easy tempers.',
    shortage: 'You cooked through the shortage.',
    delivery: 'The surprise delivery got put to work.',
    critic: 'The critic never made it to a table.',
    nonna: 'Nonna watched from the doorway but the queue swallowed her visit.',
    inspector: 'The inspector left without filing — lucky.',
  };
  return {
    day: state.day,
    served: acc.served, lost: acc.lost,
    sales: acc.sales, tips: acc.tipsTotal,
    satAvg: acc.sats.length ? acc.sats.reduce((a, b) => a + b, 0) / acc.sats.length : 0,
    ratingBefore: acc.ratingAtStart,
    ratingAfter: currentRating(state),
    used: acc.usage, toppingRevenue: acc.toppingRevenue,
    bonus: acc.bonusEarned,
    emergency: acc.emergencyCost,
    gradeUplift: acc.gradeUplift || 0,
    gradeUnits: acc.gradeUnits || {},
    sideRevenue: acc.sideRevenue || {},
    sidesSold: acc.sidesSold || 0,
    preordersTaken: (acc.preorders || []).length,
    preordersDone: acc.preordersDone || 0,
    preordersLate: acc.preordersLate || 0,
    event: acc.event ? acc.event.id : null,
    eventReport: acc.eventReport || (acc.event ? reports[acc.event.id] || null : null),
    xpToday: acc.xpToday,
    goalHit: !!acc.goal.hit,
    goalDesc: acc.goal.desc, goalReward: acc.goal.reward,
  };
}

// ---- one whole day, auto-resolved from the top -------------------------------
// Mirrors ServiceScene.enter + _startDay: season turn, plan, delivery gifts,
// day generation. The average player accepts every phone offer. Returns the
// stats object for bankDay()/the dayEnd scene — the day is NOT banked here.
export function runAutoDay(state) {
  syncSeason(state);
  const plan = ensureNextDay(state);

  // surprise delivery lands before opening (same once-guard as the scene)
  if (plan.event && plan.event.id === 'delivery' && !plan.deliveryDone) {
    plan.deliveryDone = true;
    plan.deliveryGifts = [];
    const D = BAL.EVENTS.DEFS.delivery;
    const pool = state.toppings.slice();
    for (let i = 0; i < D.kinds && pool.length; i++) {
      const tp = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      const n = D.unitsMin + Math.floor(Math.random() * (D.unitsMax - D.unitsMin + 1));
      addStock(state, tp, n);
      plan.deliveryGifts.push({ t: tp, n });
    }
  }

  const offers = plan.preorders || [];
  offers.forEach(o => { o.accepted = true; });

  const customers = Orders.generateDay(state);       // reads boosts.ad first…
  state.boosts = { prep: 0, ad: 0 };                 // …then they're consumed
  for (const o of offers) {
    const c = Orders.makePreorderCustomer(state, o);
    customers.splice(Math.min(o.dueAfter, customers.length), 0, c);
  }

  const acc = makeAcc(state, plan);
  acc.preorders = offers;
  acc.totalCustomers = customers.length;
  Telemetry.log('day_start', { customers: acc.totalCustomers, money: Math.round(state.money) });
  resolveCustomers(acc, customers);
  return buildStats(acc);
}

// ---- finish the day already in progress ---------------------------------------
// Resolves everyone not yet served or lost — the queue, the not-yet-arrived,
// and any phone orders still to land — straight into the live svc counters,
// so work already done by hand this day is kept.
export function finishServiceDay(svc) {
  const state = svc.state;
  const remaining = [
    ...svc.customers.filter(c => c.state !== 'leaving'),
    ...svc.pending,
    ...svc.preorders.filter(o => !o.injected && !o.done)
      .map(o => Orders.makePreorderCustomer(state, o)),
  ];
  resolveCustomers(svc, remaining);
  return buildStats(svc);
}

// ---- forecast restock between fast-forwarded days --------------------------------
// The sim's shelf-aware restocking brain: without it every fast-forwarded day
// after the first would be wall-to-wall stockouts and the stretch would say
// nothing about balance. Spends real money via carriedRestockSpend, exactly
// like the shop's restock tab.
export function restockForecast(state, used = {}) {
  let spend = 0;
  const specials = state.nextDay ? state.nextDay.specials : [];
  const expected = customersForDay(state);
  const buy = (key, target) => {
    const have = state.stock[key] | 0;
    const need = Math.max(0, Math.ceil(target) - have);
    if (!need) return;
    const per = unitCost(state, key);
    const afford = Math.min(need, Math.floor(state.money / Math.max(per, 0.0001)));
    if (afford <= 0) return;
    state.money -= afford * per;
    addStock(state, key, afford);
    spend += afford * per;
  };

  for (const key of state.toppings) {
    const def = BAL.TOPPINGS[key];
    if (!def) continue;
    const u = used[key] || 8;
    let target = Math.max(14, u * 1.7) + (specials.includes(key) ? 12 : 0);
    const ev = state.nextDay && state.nextDay.event;
    if (ev && ev.id === 'shortage' && ev.target === key) target = Math.min(target, u * 0.7);
    if (def.shelf <= 2) target = Math.min(target, u * 1.5 + 5);
    buy(key, target);
  }
  for (const key of Object.keys(BAL.BASICS)) {
    buy(key, expected * 1.2 + 4);
  }
  for (const sideKey of state.sides) {
    const stockKey = BAL.SIDES[sideKey].stockKey;
    buy(stockKey, (used[stockKey] || 3) * 1.3 + 2);
  }
  state.carriedRestockSpend += spend;
  return spend;
}
