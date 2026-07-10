// =====================================================================
// admin-test.mjs — headless assertions over the hidden dev panel's
// state logic (src/dev/): auto-day resolution, day banking, forced
// events, level/unlock/stock mutators, telemetry dev-tagging.
// Run: node tools/admin-test.mjs
// =====================================================================

import { BAL } from '../src/balance.js';
import { newGame, levelForXP } from '../src/state.js';
import { ensureNextDay } from '../src/goals.js';
import { unlocked } from '../src/progress.js';
import { Orders } from '../src/stations/order.js';
import { Telemetry } from '../src/telemetry.js';
import { runAutoDay, restockForecast } from '../src/dev/autoday.js';
import { setLevel, unlockEverything, refillAllStock, makeForcedEvent } from '../src/dev/admin.js';
import { bankDay } from '../src/scenes/dayEnd.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); }
  else { failures++; console.error(`  ✗ ${name} ${detail}`); }
}

// ---- 1. auto-day resolves a full day over the real modules -------------------
console.log('auto day');
{
  const s = newGame();
  const money0 = s.money;
  const stats = runAutoDay(s);
  check('every customer accounted for', stats.served + stats.lost > 0);
  check('the till rang', stats.sales > 0 && s.money > money0);
  check('XP was earned', stats.xpToday > 0 && s.xp > 0);
  check('stock was consumed', s.stock.dough < BAL.STOCK.START_BASICS);
  check('satisfaction is sane', stats.satAvg > 0 && stats.satAvg <= 100);
  check('stats shaped for the receipt',
    'ratingBefore' in stats && 'goalDesc' in stats && 'used' in stats
    && 'toppingRevenue' in stats && stats.day === 1);
  check('day NOT banked by the resolver', s.day === 1 && s.lifetime.days === 0);
}

// ---- 2. bankDay closes the books like the receipt scene ----------------------
console.log('bankDay');
{
  const s = newGame();
  const stats = runAutoDay(s);
  const bank = bankDay(s, stats);
  check('day rolls', s.day === 2 && s.phase === 'shop');
  check('lastDay analytics written', s.lastDay && s.lastDay.day === 1
    && s.lastDay.served === stats.served);
  check('tomorrow planned', s.nextDay && s.nextDay.day === 2);
  check('lifetime day counted', s.lifetime.days === 1);
  check('bank returns receipt inputs',
    'wasteCost' in bank && 'restockSpend' in bank && Array.isArray(bank.lateHits));
}

// ---- 3. a fast-forward stretch stays coherent ---------------------------------
console.log('fast-forward loop');
{
  const s = newGame();
  for (let i = 0; i < 10; i++) {
    const stats = runAutoDay(s);
    bankDay(s, stats);
    restockForecast(s, stats.used);
  }
  check('10 days pass', s.day === 11 && s.lifetime.days === 10);
  check('money stays finite', Number.isFinite(s.money));
  check('level advances with play', s.level >= 2 && s.level === levelForXP(s.xp));
  check('stock counts stay in sync with batches', Object.keys(s.stock).every(k =>
    (s.stockAges[k] || []).reduce((a, b) => a + b.n, 0) === s.stock[k] && s.stock[k] >= 0));
  check('restock money was actually spent', s.lastDay.restockSpend > 0);
}

// ---- 4. forced events override the roll ---------------------------------------
console.log('force next event');
{
  const s = newGame();
  s.devForceEvent = { id: 'rush' };
  const plan = ensureNextDay(s);
  check('forced event lands in the plan', plan.event && plan.event.id === 'rush');
  check('override is consumed', !('devForceEvent' in s));

  // forcing "none" beats even a pity-guaranteed roll
  const s2 = newGame();
  setLevel(s2, 30);                          // all events eligible
  s2.eventPity = { sinceEvent: 99 };         // pity would force one
  s2.devForceEvent = null;
  const plan2 = ensureNextDay(s2);
  check('forced none suppresses the roll', plan2.event === null);

  const s3 = newGame();
  const ev = makeForcedEvent(s3, 'shortage');
  check('shortage gets a real target', ev.id === 'shortage'
    && (s3.toppings.includes(ev.target) || ev.target in BAL.BASICS));
  check('none maps to null', makeForcedEvent(s3, 'none') === null);
}

// ---- 5. set level opens the unlock table immediately ---------------------------
console.log('set level');
{
  const s = newGame();
  setLevel(s, 30);
  check('level and XP agree', s.level === 30 && levelForXP(s.xp) === 30);
  check('whole unlock table open', BAL.UNLOCKS.every(u => unlocked(s, u.kind, u.id, u.tier || 1)));
  check('reveal cards pre-seen', BAL.UNLOCKS.every(u =>
    s.seenUnlocks[`${u.kind}:${u.id}:${u.tier || 1}`]));
  check('clamped to the curve', setLevel(s, 999) === BAL.XP.CURVE.length + 1);
}

// ---- 6. unlock everything owns the catalogue ------------------------------------
console.log('unlock everything');
{
  const s = newGame();
  unlockEverything(s);
  const nonSeasonal = Object.keys(BAL.TOPPINGS).filter(k => !BAL.TOPPINGS[k].seasonal);
  check('all non-seasonal toppings owned', nonSeasonal.every(k => s.toppings.includes(k)));
  check('seasonal rotators left to the calendar',
    s.toppings.every(k => !BAL.TOPPINGS[k] || !BAL.TOPPINGS[k].seasonal));
  check('all sauces/crusts/sides owned',
    Object.keys(BAL.SAUCES).every(k => s.sauces.includes(k))
    && Object.keys(BAL.CRUSTS).every(k => s.crusts.includes(k))
    && Object.keys(BAL.SIDES).every(k => s.sides.includes(k)));
  check('equipment maxed', Object.keys(BAL.UPGRADES).every(k =>
    s.upgrades[k] === BAL.UPGRADES[k].costs.length));
  check('size L owned', s.sizeL);
  check('every non-seasonal recipe makeable', Object.keys(BAL.RECIPES)
    .filter(id => !BAL.RECIPES[id].seasonal)
    .every(id => Orders.availableRecipes(s).includes(id)));
  check('new bins arrive stocked', nonSeasonal.every(k => (s.stock[k] | 0) > 0));
}

// ---- 7. refill all stock ----------------------------------------------------------
console.log('refill stock');
{
  const s = newGame();
  s.stock.pepperoni = 0;
  s.stockAges.pepperoni = [];
  refillAllStock(s);
  const keys = [...Object.keys(BAL.BASICS), ...s.toppings];
  check('everything topped up', keys.every(k => s.stock[k] >= 200));
  check('batches stay in sync', keys.every(k =>
    (s.stockAges[k] || []).reduce((a, b) => a + b.n, 0) === s.stock[k]));
}

// ---- 8. telemetry dev-tagging -------------------------------------------------------
console.log('telemetry dev tag');
{
  Telemetry.log('before_dev', {});
  Telemetry.markDev();
  Telemetry.log('after_dev', {});
  const all = Telemetry.all();
  const before = all.find(e => e.type === 'before_dev');
  const after = all.find(e => e.type === 'after_dev');
  check('pre-dev events untouched', before && !before.dev);
  check('dev sessions tagged', after && after.dev === true);
  check('summary counts dev events', Telemetry.summary().devEvents >= 1);
}

console.log(failures ? `\n${failures} FAILED` : '\nall admin-panel checks passed');
process.exit(failures ? 1 : 0);
