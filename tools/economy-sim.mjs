// =====================================================================
// economy-sim.mjs — V3 economy simulation over the REAL game modules:
// ticket generation, scoring, XP/levels, unlock gating, stock batches
// with spoilage, grades, events, seasons, sides, specialties, groups,
// pre-orders, loyalty, mastery, and automation effects.
//
// Models a "reasonable effort" player: aims for band centres with
// noise, restocks to a forecast, buys the next unlocked thing it can
// afford, switches key grades to premium once volume justifies it.
//
// Run: node tools/economy-sim.mjs [days] [runs]
// =====================================================================

import { BAL, TOPPING_ORDER, ING } from '../src/balance.js';
import {
  newGame, currentRating, pushRating, unitCost, patienceMult, tipMult,
  addStock, consumeStock, expireDay, levelForXP,
} from '../src/state.js';
import { Score } from '../src/stations/serve.js';
import { Orders } from '../src/stations/order.js';
import { ensureNextDay, checkMilestones, goalProgress } from '../src/goals.js';
import { unlocked, unlockLevel, awardXP, orderXP, recordLoyalty, loyaltyTier, recordMastery, masteryStars } from '../src/progress.js';
import { syncSeason } from '../src/seasons.js';

const DAYS = Number(process.argv[2] || 30);
const RUNS = Number(process.argv[3] || 6);

// ---- player skill model ("reasonable effort") -----------------------------
const gauss = () => {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// aim for the ticket band's centre with noise; steadier at higher tiers;
// tier-4 automation lands near-centre by machine
function pourAmount(ticket, which, toolTier) {
  const band = Score.bandOf(ticket, which);
  const [lo, hi] = Array.isArray(band) ? band : BAL.SCORE.BANDS[band];
  if (toolTier >= 4) {
    // auto pours to the dial then the player tops up — small, tight error
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
        if (Math.random() < 0.06) x = -x;      // the odd piece slips sides
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

// ---- shopping brain ---------------------------------------------------------
// priorities: core tools → supply → stations → toppings → menu dims → decor.
// Buys what's unlocked and affordable, keeping a restock reserve.
function shop(state, log) {
  let purchases = 0;
  const reserve = 6 + state.day * 0.6;          // keep cash for stock

  const tryBuy = (cost, apply, label) => {
    if (state.money - cost < reserve) return false;
    state.money -= cost;
    apply();
    log.push(label);
    purchases++;
    return true;
  };

  const wants = [];
  // equipment tiers (incl. proofer/oven2/rail as single-tier lines)
  for (const key of Object.keys(BAL.UPGRADES)) {
    const u = BAL.UPGRADES[key];
    const tier = state.upgrades[key];
    if (tier >= u.costs.length) continue;
    const gate = Math.max(unlockLevel('upgradeTier', key, tier + 1),
      tier === 0 ? unlockLevel('equipment', key) : 1);
    if (state.level < gate) continue;
    wants.push({ pr: key === 'oven2' ? 1 : 2 + tier, cost: u.costs[tier],
      label: `${key}${tier + 1}`, apply: () => state.upgrades[key]++ });
  }
  // size L
  if (!state.sizeL && unlocked(state, 'sizeL', 'sizeL')) {
    wants.push({ pr: 2, cost: BAL.SIZE_L_COST, label: 'sizeL', apply: () => { state.sizeL = true; } });
  }
  // side stations
  for (const key of Object.keys(BAL.SIDES)) {
    if (state.sides.includes(key)) continue;
    if (!unlocked(state, 'side', key)) continue;
    wants.push({ pr: 2, cost: BAL.SIDES[key].cost, label: `side:${key}`,
      apply: () => { state.sides.push(key); addStock(state, BAL.SIDES[key].stockKey, 12); } });
  }
  // toppings in unlock order
  for (const key of TOPPING_ORDER) {
    const t = BAL.TOPPINGS[key];
    if (t.cost === 0 || state.toppings.includes(key)) continue;
    if (!unlocked(state, 'topping', key)) continue;
    wants.push({ pr: 3, cost: t.cost, label: key,
      apply: () => { state.toppings.push(key); addStock(state, key, BAL.STOCK.NEW_TOPPING_INCLUDED); } });
  }
  // sauces & crusts
  for (const key of Object.keys(BAL.SAUCES)) {
    if (BAL.SAUCES[key].cost === 0 || state.sauces.includes(key)) continue;
    if (!unlocked(state, 'sauce', key)) continue;
    wants.push({ pr: 4, cost: BAL.SAUCES[key].cost, label: `sauce:${key}`,
      apply: () => state.sauces.push(key) });
  }
  for (const key of Object.keys(BAL.CRUSTS)) {
    if (BAL.CRUSTS[key].cost === 0 || state.crusts.includes(key)) continue;
    if (!unlocked(state, 'crust', key)) continue;
    wants.push({ pr: 4, cost: BAL.CRUSTS[key].cost, label: `crust:${key}`,
      apply: () => state.crusts.push(key) });
  }

  wants.sort((a, b) => a.pr - b.pr || a.cost - b.cost);
  for (const w of wants) tryBuy(w.cost, w.apply, w.label);
  return purchases;
}

// restock to a forecast: yesterday's usage ×1.35 (+special/pre-order buffer),
// shelf-aware so short-lived stock isn't overbought
function restock(state, lastUsed, expectedCustomers) {
  let spend = 0;
  const specials = state.nextDay ? state.nextDay.specials : [];
  const buy = (key, target) => {
    const have = state.stock[key] | 0;
    const need = Math.max(0, Math.ceil(target) - have);
    if (!need) return;
    const cost = need * unitCost(state, key);
    if (cost > state.money) {
      const afford = Math.floor(state.money / unitCost(state, key));
      if (afford > 0) {
        state.money -= afford * unitCost(state, key);
        addStock(state, key, afford);
        spend += afford * unitCost(state, key);
      }
      return;
    }
    state.money -= cost;
    addStock(state, key, need);
    spend += cost;
  };

  for (const key of state.toppings) {
    const def = BAL.TOPPINGS[key];
    if (!def) continue;
    const used = lastUsed[key] || 8;
    let target = Math.max(14, used * 1.7) + (specials.includes(key) ? 12 : 0);
    // a shortage day means buying around the spike
    const ev = state.nextDay && state.nextDay.event;
    if (ev && ev.id === 'shortage' && ev.target === key) target = Math.min(target, used * 0.7);
    // shelf awareness: never hold more than ~2 days of short-lived stock
    if (def.shelf <= 2) target = Math.min(target, used * 1.5 + 5);
    buy(key, target);
  }
  for (const key of Object.keys(BAL.BASICS)) {
    buy(key, expectedCustomers * 1.2 + 4);
  }
  for (const sideKey of state.sides) {
    const stockKey = BAL.SIDES[sideKey].stockKey;
    buy(stockKey, (lastUsed[stockKey] || 3) * 1.3 + 2);
  }
  state.carriedRestockSpend += spend;
  return spend;
}

// ---- one day of service --------------------------------------------------------
function playDay(state, telemetry) {
  syncSeason(state);
  ensureNextDay(state);
  const plan = state.nextDay;
  const evDef = plan.event ? BAL.EVENTS.DEFS[plan.event.id] : null;
  const eventPay = (evDef && evDef.payMult) || 1;
  const eventDrain = evDef && evDef.patienceMult ? 1 / evDef.patienceMult : 1;

  // surprise delivery lands before opening
  if (plan.event && plan.event.id === 'delivery') {
    const D = BAL.EVENTS.DEFS.delivery;
    const pool = state.toppings.slice();
    for (let i = 0; i < D.kinds && pool.length; i++) {
      const t = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      addStock(state, t, D.unitsMin + Math.floor(Math.random() * (D.unitsMax - D.unitsMin + 1)));
    }
  }

  // premium grades once volume and rating justify them (the real decision)
  if (unlocked(state, 'grades', 'grades')) {
    const premiumOn = currentRating(state) >= 4.2 && state.day >= 10;
    for (const k of ['cheese', 'sauce']) state.grades[k] = premiumOn ? 'premium' : 'standard';
  }

  // accept every pre-order offer (they pay +25%)
  const preorders = (plan.preorders || []);
  preorders.forEach(o => { o.accepted = true; });

  const customers = Orders.generateDay(state);
  // pre-orders arrive as extra premium customers
  for (const o of preorders) {
    const c = Orders.makePreorderCustomer(state, o);
    customers.splice(Math.min(o.dueAfter, customers.length), 0, c);
  }

  const pm = patienceMult(state);
  const svc = {
    served: 0, lost: 0, totalCustomers: customers.length, sats: [],
    largeSold: 0, perfectsToday: 0, underPar: 0, usedTypes: new Set(), state,
    sidesSold: 0, specialtiesToday: 0, stampsToday: 0,
  };
  const day = {
    sales: 0, tips: 0, sideRev: 0, bonus: 0, used: {}, stockouts: 0, emergency: 0,
    customers: customers.length, milestones: [], xp: 0, gradeUplift: 0, gradeSpend: 0,
  };

  const equipTiers = Math.min(state.upgrades.oven, 3) + Math.min(state.upgrades.ladle, 3)
    + Math.min(state.upgrades.shaker, 3) + Math.min(state.upgrades.tongs, 3);
  let speedMult = Math.max(0.8, 1 - 0.03 * equipTiers);
  if (state.upgrades.proofer) speedMult *= 0.94;
  if (state.upgrades.ladle >= 4) speedMult *= 0.93;
  if (state.upgrades.shaker >= 4) speedMult *= 0.93;
  const overhead = state.upgrades.oven2 ? 3.5 : 7;    // dual oven overlaps work
  const bakeParallel = state.upgrades.oven2 ? 0.72 : 1;

  const slots = 4 + Math.min(state.upgrades.decor, BAL.DECOR.QUEUE_PATIENCE_TIERS);
  const finishes = [];
  let serverFreeAt = 0, t = BAL.DAYS.FIRST_ARRIVAL;

  const buildPizza = (cust, ticket) => {
    // consume basics (emergency corner-shop at zero)
    const orderGrades = {};
    for (const b of ['dough', 'sauce', 'cheese']) {
      const r = consumeStock(state, b, 1);
      if (r.taken < 1) {
        day.emergency += unitCost(state, b) * BAL.STOCK.EMERGENCY_MULT;
        state.money -= unitCost(state, b) * BAL.STOCK.EMERGENCY_MULT;
      } else {
        day.used[b] = (day.used[b] || 0) + 1;
        for (const gk in r.grades) {
          orderGrades[b] = orderGrades[b] || {};
          orderGrades[b][gk] = (orderGrades[b][gk] || 0) + r.grades[gk];
        }
      }
    }
    // toppings from stock
    const avail = {};
    for (const w of ticket.toppings) {
      let want = w.count;
      if (Math.random() > 0.85) want += Math.random() < 0.5 ? -1 : 1;
      const r = consumeStock(state, w.type, Math.max(0, want));
      avail[w.type] = r.taken;
      if (r.taken < w.count) day.stockouts++;
      day.used[w.type] = (day.used[w.type] || 0) + r.taken;
      if (r.taken > 0) svc.usedTypes.add(w.type);
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
      bakeZone: bakeOutcome(ticket.bake === 'well' || !ticket.modifier ? ticket.bake : ticket.bake, state.upgrades.oven),
      bake: 0.8, zonesAtPull: null,
    };
    return { pizza, orderGrades };
  };

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

    const enter = Math.max(arrival, finishes.length >= slots ? finishes[finishes.length - slots] : 0);
    const start = Math.max(enter, serverFreeAt);
    const patienceBudget = BAL.PATIENCE.QUEUE_SECONDS * pm
      / ((cust.drainScale || 1) * eventDrain);
    if (start - enter > patienceBudget) {
      svc.lost++;
      pushRating(state, 1);
      if (cust.regular) pushRating(state, 1);
      finishes.push(start);
      continue;
    }
    serverFreeAt = start + elapsed + overhead;
    finishes.push(serverFreeAt);

    // build & score each pizza on the ticket
    const results = [];
    for (const tk of tickets) {
      const { pizza, orderGrades } = buildPizza(cust, tk);
      // sides: made most of the time when asked
      let sideSat = 0, sidePay = 0;
      if (tk.side && Math.random() < 0.92) {
        const S = BAL.SIDES[tk.side];
        const r = consumeStock(state, S.stockKey, 1);
        if (r.taken >= 1) {
          day.used[S.stockKey] = (day.used[S.stockKey] || 0) + 1;
          const frac = clamp(1 - Math.abs(gauss()) * 0.25, 0, 1);
          sidePay = S.price * (BAL.SIDE_PAY_FLOOR + (1 - BAL.SIDE_PAY_FLOOR) * frac);
          sideSat = frac > 0.9 ? BAL.SIDE_SAT.PERFECT : frac > 0.5 ? 0 : BAL.SIDE_SAT.SLOPPY;
          svc.sidesSold++;
          state.stats.sidesSoldLife++;
        }
      } else if (tk.side) {
        sideSat = BAL.SIDE_SAT.MISSING;
      }
      let lateSat = 0;
      if (cust.preorder && Math.random() < 0.2) lateSat = -6;   // occasional lateness

      const res = Score.scoreOrder({
        pizza, ticket: tk, elapsed: elapsed / tickets.length,
        splats: Math.random() < 0.2 ? 1 : 0, state, prepGrace: false,
        gradeBonus: Score.gradeSatBonus(orderGrades),
        satAdjust: sideSat + lateSat,
        eventMult: eventPay,
      });
      res.sidePay = sidePay;
      day.gradeUplift += res.gradeUplift || 0;
      for (const key in orderGrades) {
        for (const gk in orderGrades[key]) {
          if (gk === 'standard') continue;
          day.gradeSpend += orderGrades[key][gk]
            * (BAL.GRADES[gk].costMult - 1) * unitCost(state, key, 'standard');
        }
      }
      if (tk.specialty) {
        svc.specialtiesToday++;
        state.stats.specialtiesSold++;
        if (res.perfect) recordMastery(state, tk.specialty);
      }
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

    // regulars & loyalty
    if (cust.regular && satisfaction >= BAL.REGULARS.SAT_THRESHOLD) {
      const tier = loyaltyTier(state, cust.regular.key);
      tip += results[0].price * (BAL.REGULARS.TIP_BONUS_FRAC + BAL.LOYALTY.TIP_BONUS[tier]);
      if (satisfaction >= BAL.LOYALTY.SAT_THRESHOLD) {
        recordLoyalty(state, cust.regular.key);
        if (unlocked(state, 'system', 'loyalty')) svc.stampsToday++;
      }
    }
    // archetypes
    const arch = cust.archetype ? BAL.ARCHETYPES[cust.archetype] : null;
    if (arch) {
      if (arch.payMult) pay *= arch.payMult;
      if (arch.tipMult) tip *= arch.tipMult;
    }
    // marked visitors
    if (cust.role === 'critic') {
      const D = BAL.EVENTS.DEFS.critic;
      if (satisfaction >= D.graceSat) {
        state.money += D.reward; day.bonus += D.reward;
        state.criticBoost = D.footfallBoost;
        state.stats.raveReviews++;
        pushRating(state, 5); pushRating(state, 5);
        day.xpExtra = (day.xpExtra || 0) + BAL.XP.CRITIC_A;
      } else if (satisfaction < D.failSat) {
        pushRating(state, 1); pushRating(state, 1);
      }
    } else if (cust.role === 'nonna') {
      const D = BAL.EVENTS.DEFS.nonna;
      if (satisfaction >= D.graceSat) { tip *= D.tipMult; day.xpExtra = (day.xpExtra || 0) + BAL.XP.EVENT; }
    } else if (cust.role === 'inspector') {
      const D = BAL.EVENTS.DEFS.inspector;
      if (Math.random() < 0.6) { state.money += D.reward; day.bonus += D.reward; }
      else pushRating(state, 2);
    }

    const total = pay + tip + sidePayTotal;
    state.money += total;
    state.stats.lifetimeServed += tickets.length;
    state.stats.lifetimeEarned += total;
    state.lifetime.served += tickets.length;
    state.lifetime.earned += total;
    if (perfect) {
      state.stats.lifetimePerfects += tickets.length;
      state.stats.perfectStreak++;
      state.stats.bestPerfectStreak = Math.max(state.stats.bestPerfectStreak, state.stats.perfectStreak);
      svc.perfectsToday++;
    } else state.stats.perfectStreak = 0;
    pushRating(state, stars);
    if (cust.regular) pushRating(state, stars);
    if (arch && arch.ratingWeight) for (let i = 1; i < arch.ratingWeight; i++) pushRating(state, stars);
    if (cust.preorder && Math.random() < 0.8) state.stats.preordersOnTime++;

    svc.served++;
    svc.sats.push(satisfaction);
    day.sales += pay;
    day.tips += tip;
    day.sideRev += sidePayTotal;
    if (tickets.some(tk => tk.size === 'L')) svc.largeSold++;
    if (elapsed <= par) svc.underPar++;

    // XP per pizza + extras
    let xp = 0;
    for (let i = 0; i < results.length; i++) xp += orderXP(tickets[i], results[i]);
    if (sidePayTotal > 0) xp += BAL.XP.SIDE_BONUS;
    if (day.xpExtra) { xp += day.xpExtra; day.xpExtra = 0; }
    const lv = awardXP(state, xp);
    day.xp += xp;
    if (lv.cash) day.bonus += lv.cash;

    // mid-day goal + milestones
    const goal = plan.goal;
    if (!day.goalHit && !day.goalFailed) {
      const p = goalProgress(goal, svc);
      if (p.failed) day.goalFailed = true;
      else if (p.done) {
        day.goalHit = true;
        state.money += goal.reward; day.bonus += goal.reward;
        const glv = awardXP(state, BAL.XP.GOAL);
        day.xp += BAL.XP.GOAL;
        if (glv.cash) day.bonus += glv.cash;
      }
    }
    for (const def of checkMilestones(state)) {
      state.money += def.reward;
      day.bonus += def.reward;
      day.milestones.push(def.id);
      const mlv = awardXP(state, BAL.XP.MILESTONE);
      day.xp += BAL.XP.MILESTONE;
      if (mlv.cash) day.bonus += mlv.cash;
    }
  }

  // settle all-day goal
  if (!day.goalHit && !day.goalFailed) {
    const p = goalProgress(plan.goal, svc);
    if (p.done) { day.goalHit = true; state.money += plan.goal.reward; day.bonus += plan.goal.reward; }
  }

  day.served = svc.served;
  day.lost = svc.lost;
  day.satAvg = svc.sats.length ? svc.sats.reduce((a, b) => a + b, 0) / svc.sats.length : 0;

  // close the books: spoilage, event counters, day roll
  const waste = expireDay(state);
  day.wasteCost = Object.values(waste).reduce((a, w) => a + w.cost, 0);
  day.wasteN = Object.values(waste).reduce((a, w) => a + w.n, 0);
  if (plan.event) state.stats.eventsSeen++;
  if (day.wasteN === 0 && state.day > 3) state.stats.zeroWasteDays++;

  const restockSpend = state.carriedRestockSpend;
  state.carriedRestockSpend = 0;
  day.restockSpend = restockSpend;
  day.profit = day.sales + day.tips + day.sideRev + day.bonus - restockSpend - day.emergency - day.wasteCost;
  state.stats.bestDayProfit = Math.max(state.stats.bestDayProfit, day.profit);
  state.lifetime.days++;
  state.day += 1;
  state.nextDay = null;
  ensureNextDay(state);
  for (const def of checkMilestones(state)) {
    state.money += def.reward;
    day.bonus += def.reward;
    day.milestones.push(def.id);
  }
  return day;
}

// ---- run -----------------------------------------------------------------------
function run(verbose) {
  const state = newGame();
  let purchases = 0;
  const totals = { income: 0, bonus: 0, restock: 0, waste: 0, stockouts: 0, lost: 0,
    served: 0, sides: 0, gradeUplift: 0, gradeSpend: 0, emergency: 0 };
  const levelDays = {};              // level → first day reached
  const midStockouts = [];           // stockout orders per day, days 10+

  if (verbose) {
    console.log('day | lv | cust srv lost | sales sides bonus | rstock waste | profit | money | ★   | bought');
    console.log('----+----+---------------+-------------------+--------------+--------+-------+-----+-------');
  }
  for (let d = 1; d <= DAYS; d++) {
    const lastUsed = {};
    const day = playDay(state, null);
    Object.assign(lastUsed, day.used);
    const log = [];
    restock(state, day.used, Math.min(16, 5 + state.day));
    purchases += shop(state, log);

    if (!(state.level in levelDays)) levelDays[state.level] = d;
    for (let l = 1; l <= state.level; l++) if (!(l in levelDays)) levelDays[l] = d;
    if (d >= 10) midStockouts.push(day.stockouts);

    totals.income += day.sales + day.tips + day.sideRev + day.bonus;
    totals.bonus += day.bonus;
    totals.restock += day.restockSpend;
    totals.waste += day.wasteCost;
    totals.stockouts += day.stockouts;
    totals.lost += day.lost;
    totals.served += day.served;
    totals.sides += day.sideRev;
    totals.gradeUplift += day.gradeUplift;
    totals.gradeSpend += day.gradeSpend;
    totals.emergency += day.emergency;

    if (verbose) {
      console.log(
        `${String(d).padStart(3)} | ${String(state.level).padStart(2)} | ` +
        `${String(day.customers).padStart(4)} ${String(day.served).padStart(3)} ${String(day.lost).padStart(4)} | ` +
        `${day.sales.toFixed(0).padStart(5)} ${day.sideRev.toFixed(0).padStart(5)} ${day.bonus.toFixed(0).padStart(5)} | ` +
        `${day.restockSpend.toFixed(0).padStart(6)} ${day.wasteCost.toFixed(1).padStart(5)} | ` +
        `${day.profit.toFixed(0).padStart(6)} | ${state.money.toFixed(0).padStart(5)} | ` +
        `${currentRating(state).toFixed(1)} | ${log.slice(0, 4).join(',')}`);
    }
  }
  return { state, purchases, totals, levelDays, midStockouts };
}

console.log(`=== Slice of Life V3 economy sim — ${DAYS} days ===\n`);
const sample = run(true);
console.log(`\nsample: ${sample.purchases} purchases (${(sample.purchases / DAYS).toFixed(2)}/day), ` +
  `level ${sample.state.level}, waste £${sample.totals.waste.toFixed(0)} on £${sample.totals.restock.toFixed(0)} restock ` +
  `(${(sample.totals.waste / Math.max(1, sample.totals.restock) * 100).toFixed(1)}%)`);

// averaged summary over RUNS
const agg = { purchases: 0, bonusShare: 0, wastePct: 0, stockMid: 0, lost: 0, money: 0,
  level: 0, l10: 0, l20: 0, l30: 0, l30n: 0, rating: 0, sideShare: 0, gradeNet: 0, emergency: 0 };
for (let i = 0; i < RUNS; i++) {
  const r = run(false);
  agg.purchases += r.purchases;
  agg.bonusShare += r.totals.bonus / Math.max(1, r.totals.income);
  agg.wastePct += r.totals.waste / Math.max(1, r.totals.restock);
  agg.stockMid += r.midStockouts.length
    ? r.midStockouts.reduce((a, b) => a + b, 0) / r.midStockouts.length : 0;
  agg.lost += r.totals.lost;
  agg.money += r.state.money;
  agg.level += r.state.level;
  agg.l10 += r.levelDays[10] || DAYS + 1;
  agg.l20 += r.levelDays[20] || DAYS + 1;
  if (r.levelDays[30]) { agg.l30 += r.levelDays[30]; agg.l30n++; }
  agg.rating += currentRating(r.state);
  agg.sideShare += r.totals.sides / Math.max(1, r.totals.income);
  agg.gradeNet += r.totals.gradeUplift - r.totals.gradeSpend;
  agg.emergency += r.totals.emergency;
}
const n = RUNS;
console.log(`\n=== averages over ${n} runs of ${DAYS} days ===`);
console.log(`purchases/day:      ${(agg.purchases / n / DAYS).toFixed(2)}    (target ~1 early, stretching later)`);
console.log(`bonus share:        ${(agg.bonusShare / n * 100).toFixed(1)}%   (target ≤ ~20%)`);
console.log(`waste % of restock: ${(agg.wastePct / n * 100).toFixed(1)}%   (target 5–15%)`);
console.log(`stockout orders/day (day 10+): ${(agg.stockMid / n).toFixed(2)}   (target ~1–3)`);
console.log(`walk-outs/run:      ${(agg.lost / n).toFixed(1)}`);
console.log(`end level:          ${(agg.level / n).toFixed(1)}   L10 by day ${(agg.l10 / n).toFixed(1)}, L20 by day ${(agg.l20 / n).toFixed(1)}` +
  (agg.l30n ? `, L30 by day ${(agg.l30 / agg.l30n).toFixed(1)} (${agg.l30n}/${n} runs)` : `, L30 not reached`));
console.log(`side revenue share: ${(agg.sideShare / n * 100).toFixed(1)}%`);
console.log(`grade net (uplift − surcharge): £${(agg.gradeNet / n).toFixed(0)} per run`);
console.log(`emergency spend:    £${(agg.emergency / n).toFixed(0)} per run`);
console.log(`end money:          £${(agg.money / n).toFixed(0)}`);
console.log(`end rating:         ${(agg.rating / n).toFixed(2)}★`);
