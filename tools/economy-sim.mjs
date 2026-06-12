// =====================================================================
// economy-sim.mjs — 10-day economy simulation using the REAL ticket
// generation, scoring, goals and milestone logic. Models a player making
// reasonable effort plus a sensible restock policy, and reports whether
// progression still lands at ~one upgrade per day with bonuses as a
// side dish, not the main income.
//
// Run: node tools/economy-sim.mjs [days] [runs]
// =====================================================================

import { BAL, TOPPING_ORDER } from '../src/balance.js';
import { newGame, currentRating, pushRating, customersForDay, unitCost, patienceMult } from '../src/state.js';
import { Score } from '../src/stations/serve.js';
import { Orders } from '../src/stations/order.js';
import { ensureNextDay, checkMilestones, goalProgress } from '../src/goals.js';

const DAYS = Number(process.argv[2] || 10);
const RUNS = Number(process.argv[3] || 5);

// ---- player skill model ("reasonable effort") -----------------------------
const gauss = () => {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// aim for band centre with noise; steadier hands at higher tool tiers
function pourAmount(bandName, toolTier) {
  const [lo, hi] = BAL.SCORE.BANDS[bandName];
  const sigma = (hi - lo) * 0.44 * (1 - 0.08 * toolTier);
  return clamp((lo + hi) / 2 + gauss() * sigma, 0, 100);
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

// sunflower spread → near-perfect spread score, like a tidy player
function placedPieces(type, count, R) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const r = R * 0.72 * Math.sqrt((i + 0.5) / Math.max(count, 1));
    const a = i * 2.39996 + Math.random();
    pts.push({ type, x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
}

// ---- shopping brain ---------------------------------------------------------
// priority order: things that improve play feel/economy first
const BUY_PLAN = [
  ['up', 'oven'], ['up', 'ladle'], ['up', 'tongs'], ['up', 'supply'],
  ['top', 'onion'], ['up', 'decor'], ['up', 'shaker'], ['sizeL'],
  ['top', 'olive'], ['up', 'oven'], ['up', 'supply'], ['up', 'ladle'],
  ['top', 'pepper'], ['up', 'tongs'], ['up', 'decor'], ['top', 'ham'],
  ['up', 'shaker'], ['up', 'oven'], ['up', 'supply'], ['top', 'pineapple'],
  ['up', 'ladle'], ['up', 'tongs'], ['top', 'chilli'], ['up', 'decor'],
  ['up', 'shaker'], ['up', 'supply'],
];

function shop(state, log) {
  let purchases = 0;
  for (const item of BUY_PLAN) {
    if (item[0] === 'up') {
      const key = item[1];
      const u = BAL.UPGRADES[key];
      const tier = state.upgrades[key];
      if (tier >= u.costs.length) continue;
      const cost = u.costs[tier];
      if (item._done) continue;
      if (state.money >= cost && !item._bought) {
        // buy only the next tier this pass
        state.money -= cost;
        state.upgrades[key]++;
        log.push(`${u.name} t${state.upgrades[key]}`);
        purchases++;
        item._bought = true;          // one tier per plan entry
      }
    } else if (item[0] === 'top') {
      const key = item[1];
      if (state.toppings.includes(key)) continue;
      const cost = BAL.TOPPINGS[key].cost;
      if (state.money >= cost) {
        state.money -= cost;
        state.toppings.push(key);
        state.stock[key] = (state.stock[key] | 0) + BAL.STOCK.NEW_TOPPING_INCLUDED;
        log.push(BAL.TOPPINGS[key].label);
        purchases++;
      }
    } else if (item[0] === 'sizeL') {
      if (state.sizeL) continue;
      if (state.money >= BAL.SIZE_L_COST) {
        state.money -= BAL.SIZE_L_COST;
        state.sizeL = true;
        log.push('Size L');
        purchases++;
      }
    }
  }
  for (const item of BUY_PLAN) delete item._bought;
  return purchases;
}

// restock to forecast: last usage ×1.3, +buffer for tomorrow's special
function restock(state) {
  let spend = 0;
  const specials = state.nextDay ? state.nextDay.specials : [];
  for (const t of state.toppings) {
    const lastUsed = state.lastDayUsed ? (state.lastDayUsed[t] || 0) : 10;
    let target = Math.max(16, Math.ceil(lastUsed * 1.7)) + (specials.includes(t) ? 8 : 0);
    const need = Math.max(0, target - (state.stock[t] | 0));
    const cost = need * unitCost(state, t);
    if (cost <= state.money) {
      state.money -= cost;
      state.stock[t] = (state.stock[t] | 0) + need;
      spend += cost;
    } else {
      const afford = Math.floor(state.money / unitCost(state, t));
      state.money -= afford * unitCost(state, t);
      state.stock[t] = (state.stock[t] | 0) + afford;
      spend += afford * unitCost(state, t);
    }
  }
  state.carriedRestockSpend = spend;
  return spend;
}

// ---- one day of service --------------------------------------------------------
function playDay(state) {
  ensureNextDay(state);
  const customers = Orders.generateDay(state);
  const pm = patienceMult(state);

  // svc mirror for the real goalProgress()
  const svc = {
    served: 0, lost: 0, totalCustomers: customers.length, sats: [],
    largeSold: 0, perfectsToday: 0, underPar: 0, usedTypes: new Set(), state,
  };
  const day = {
    sales: 0, tips: 0, bonus: 0, used: {}, stockouts: 0, milestones: [],
    customers: customers.length,
  };

  // discrete-event queue with slot gating, like the real game: customers
  // wait off-screen (no patience drain) until a queue slot frees, then
  // drain only while visibly queued
  const equipTiers = state.upgrades.oven + state.upgrades.ladle + state.upgrades.shaker + state.upgrades.tongs;
  const speedMult = Math.max(0.8, 1 - 0.03 * equipTiers);
  const slots = BAL.QUEUE.BASE_SLOTS + state.upgrades.decor;
  const finishes = [];                       // finish time per processed customer
  let serverFreeAt = 0, t = BAL.DAYS.FIRST_ARRIVAL;
  let idx = -1;

  for (const cust of customers) {
    idx++;
    const arrival = t;
    t += Orders.arrivalGap(state);
    const ticket = cust.ticket;

    const par = BAL.SCORE.PAR_BASE + BAL.SCORE.PAR_PER_TYPE * ticket.toppings.length;
    const elapsed = par * (0.85 + Math.random() * 0.55) * speedMult;

    // enter the visible queue once the customer `slots` ahead has left
    const enter = Math.max(arrival, finishes.length >= slots ? finishes[finishes.length - slots] : 0);
    const start = Math.max(enter, serverFreeAt);
    if (start - enter > BAL.PATIENCE.QUEUE_SECONDS * pm) {
      // stormed out of the visible queue
      svc.lost++;
      pushRating(state, 1);
      if (cust.regular) pushRating(state, 1);
      finishes.push(start);                  // their slot frees when they storm
      continue;
    }
    serverFreeAt = start + elapsed + 7;       // overhead: walk-up, handoff, payout
    finishes.push(serverFreeAt);

    // build the pizza
    const toppings = [];
    for (const w of ticket.toppings) {
      let want = w.count;
      if (Math.random() > 0.85) want += Math.random() < 0.5 ? -1 : 1;
      const avail = Math.min(want, state.stock[w.type] | 0);
      if (avail < w.count) day.stockouts++;
      state.stock[w.type] = (state.stock[w.type] | 0) - avail;
      day.used[w.type] = (day.used[w.type] || 0) + avail;
      if (avail > 0) svc.usedTypes.add(w.type);
      toppings.push(...placedPieces(w.type, avail, BAL.PIZZA.RADIUS[ticket.size]));
    }
    const pizza = {
      // 3% of the time the wrong dough ball gets clicked
      size: Math.random() < 0.03 ? (ticket.size === 'S' ? 'M' : 'S') : ticket.size,
      R: BAL.PIZZA.RADIUS[ticket.size],
      sauceCoverage: pourAmount(ticket.sauce, state.upgrades.ladle),
      cheese: new Array(Math.round(
        pourAmount(ticket.cheese, state.upgrades.shaker) / 100
        * BAL.PIZZA.CHEESE_FULL * BAL.PIZZA.SIZE_FACTOR[ticket.size])),
      toppings,
      bakeZone: bakeOutcome(ticket.bake, state.upgrades.oven),
    };

    const res = Score.scoreOrder({
      pizza, ticket, elapsed, splats: Math.random() < 0.2 ? 1 : 0, state, prepGrace: false,
    });

    // regular bonus (mirror of serve.js)
    if (cust.regular && res.satisfaction >= BAL.REGULARS.SAT_THRESHOLD) {
      res.tip += res.price * BAL.REGULARS.TIP_BONUS_FRAC;
    }

    const total = res.pay + res.tip;
    state.money += total;
    state.stats.lifetimeServed++;
    state.stats.lifetimeEarned += total;
    if (res.perfect) {
      state.stats.lifetimePerfects++;
      state.stats.perfectStreak++;
      state.stats.bestPerfectStreak = Math.max(state.stats.bestPerfectStreak, state.stats.perfectStreak);
      svc.perfectsToday++;
    } else state.stats.perfectStreak = 0;
    pushRating(state, res.stars);
    if (cust.regular) pushRating(state, res.stars);

    svc.served++;
    svc.sats.push(res.satisfaction);
    day.sales += res.pay;
    day.tips += res.tip;
    if (ticket.size === 'L') svc.largeSold++;
    if (elapsed <= par) svc.underPar++;

    // mid-day goal + milestones
    const goal = state.nextDay.goal;
    if (!day.goalHit && !day.goalFailed) {
      const p = goalProgress(goal, svc);
      if (p.failed) day.goalFailed = true;
      else if (p.done) { day.goalHit = true; state.money += goal.reward; day.bonus += goal.reward; }
    }
    for (const def of checkMilestones(state)) {
      state.money += def.reward;
      day.bonus += def.reward;
      day.milestones.push(def.id);
    }
  }

  // settle all-day goal
  if (!day.goalHit && !day.goalFailed) {
    const p = goalProgress(state.nextDay.goal, svc);
    if (p.done) { day.goalHit = true; state.money += state.nextDay.goal.reward; day.bonus += state.nextDay.goal.reward; }
  }

  day.served = svc.served;
  day.lost = svc.lost;
  day.satAvg = svc.sats.length ? svc.sats.reduce((a, b) => a + b, 0) / svc.sats.length : 0;

  // close the books (mirror of dayEnd.js)
  const restockSpend = state.carriedRestockSpend;
  state.carriedRestockSpend = 0;
  const profit = day.sales + day.tips + day.bonus - restockSpend;
  state.stats.bestDayProfit = Math.max(state.stats.bestDayProfit, profit);
  state.lastDayUsed = day.used;
  state.day += 1;
  state.nextDay = null;
  ensureNextDay(state);
  for (const def of checkMilestones(state)) {
    state.money += def.reward;
    day.bonus += def.reward;
    day.milestones.push(def.id);
  }
  day.restockSpend = restockSpend;
  day.profit = profit;
  return day;
}

// ---- run -----------------------------------------------------------------------
function run(verbose) {
  const state = newGame();
  let purchases = 0, totals = { income: 0, bonus: 0, restock: 0, stockouts: 0, lost: 0, served: 0 };
  if (verbose) {
    console.log('day | cust serve lost | sales   tips  bonus | restock | profit | money  | rating | bought');
    console.log('----+-----------------+---------------------+---------+--------+--------+--------+-------');
  }
  for (let d = 1; d <= DAYS; d++) {
    const day = playDay(state);
    const log = [];
    restock(state);                 // stock first — upgrades get the leftovers
    purchases += shop(state, log);
    totals.income += day.sales + day.tips + day.bonus;
    totals.bonus += day.bonus;
    totals.restock += day.restockSpend;
    totals.stockouts += day.stockouts;
    totals.lost += day.lost;
    totals.served += day.served;
    if (verbose) {
      console.log(
        `${String(d).padStart(3)} | ${String(day.customers).padStart(4)} ${String(day.served).padStart(5)} ${String(day.lost).padStart(4)} | ` +
        `${day.sales.toFixed(0).padStart(5)}  ${day.tips.toFixed(0).padStart(4)}  ${String(day.bonus.toFixed(0)).padStart(5)} | ` +
        `${day.restockSpend.toFixed(2).padStart(7)} | ${day.profit.toFixed(0).padStart(6)} | ${state.money.toFixed(0).padStart(6)} | ` +
        `${currentRating(state).toFixed(1).padStart(6)} | ${log.join(', ')}`);
    }
  }
  return { state, purchases, totals };
}

console.log(`=== Slice of Life V2 economy sim — ${DAYS} days ===\n`);
const sample = run(true);
console.log(`\nsample run: ${sample.purchases} purchases in ${DAYS} days (${(sample.purchases / DAYS).toFixed(2)}/day), ` +
  `bonus share ${(sample.totals.bonus / sample.totals.income * 100).toFixed(1)}%, ` +
  `stockout orders ${sample.totals.stockouts}, walk-outs ${sample.totals.lost}/${sample.totals.served + sample.totals.lost}`);

// averaged summary over RUNS
let agg = { purchases: 0, bonusShare: 0, stockouts: 0, lost: 0, money: 0, upgrades: 0, rating: 0 };
for (let i = 0; i < RUNS; i++) {
  const r = run(false);
  agg.purchases += r.purchases;
  agg.bonusShare += r.totals.bonus / r.totals.income;
  agg.stockouts += r.totals.stockouts;
  agg.lost += r.totals.lost;
  agg.money += r.state.money;
  agg.upgrades += Object.values(r.state.upgrades).reduce((a, b) => a + b, 0);
  agg.rating += currentRating(r.state);
}
console.log(`\n=== averages over ${RUNS} runs ===`);
console.log(`purchases/day:     ${(agg.purchases / RUNS / DAYS).toFixed(2)}   (target ~1.0–1.3)`);
console.log(`bonus share:       ${(agg.bonusShare / RUNS * 100).toFixed(1)}%  (target ≤ ~20%)`);
console.log(`upgrade tiers:     ${(agg.upgrades / RUNS).toFixed(1)} after day ${DAYS}`);
console.log(`stockout orders:   ${(agg.stockouts / RUNS).toFixed(1)} per ${DAYS} days`);
console.log(`walk-outs:         ${(agg.lost / RUNS).toFixed(1)} per ${DAYS} days`);
console.log(`end money:         £${(agg.money / RUNS).toFixed(0)}`);
console.log(`end rating:        ${(agg.rating / RUNS).toFixed(2)}★`);
