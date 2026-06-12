// =====================================================================
// logic-test.mjs — pure-logic assertions over the game modules that run
// headless (no canvas/DOM). Run: node tools/logic-test.mjs
// =====================================================================

import { BAL, TOPPING_ORDER } from '../src/balance.js';
import { newGame, migrate, unitCost, currentRating } from '../src/state.js';
import { Score } from '../src/stations/serve.js';
import { Orders } from '../src/stations/order.js';
import { ensureNextDay, checkMilestones, metrics, goalProgress } from '../src/goals.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); }
  else { failures++; console.error(`  ✗ ${name} ${detail}`); }
}

// ---- 1. save migration ----------------------------------------------------
console.log('migration');
{
  const v1 = {
    version: 1, day: 6, money: 87.5, recentRatings: [4, 5, 3],
    upgrades: { oven: 1, ladle: 0, shaker: 0, tongs: 0, decor: 1 },
    toppings: ['pepperoni', 'mushroom', 'onion'], sizeL: true,
    boosts: { prep: 0, ad: 1 }, tutorialDone: true, muted: false,
    stats: { lifetimeServed: 41, lifetimeEarned: 412 },
  };
  const s = migrate(v1);
  check('v1 save keeps progress', s.day === 6 && s.money === 87.5 && s.stats.lifetimeServed === 41);
  check('owned toppings gain stock', s.stock.onion === BAL.STOCK.START && s.stock.pepperoni === BAL.STOCK.START);
  check('new fields appear', s.upgrades.supply === 0 && s.carriedRestockSpend === 0 && s.version === 2);
  check('boosts survive', s.boosts.ad === 1);
}

// ---- 2. supply discounts -----------------------------------------------------
console.log('supply deals');
{
  const s = newGame();
  const base = unitCost(s, 'pepperoni');
  s.upgrades.supply = 4;
  check('tier 4 halves restock cost', Math.abs(unitCost(s, 'pepperoni') - base * 0.5) < 1e-9);
}

// ---- 3. specials shift demand --------------------------------------------------
console.log('specials');
{
  const s = newGame();
  s.toppings = [...TOPPING_ORDER];
  s.day = 8;
  const freq = (specials) => {
    let pieces = 0;
    for (let i = 0; i < 6000; i++) {
      const t = Orders.makeTicket(s, specials);
      const w = t.toppings.find(w => w.type === 'olive');
      if (w) pieces += w.count;
    }
    return pieces / 6000;
  };
  const ratio = freq(['olive']) / freq([]);
  check('special topping ~2× piece demand', ratio > 1.5 && ratio < 2.6, `(ratio ${ratio.toFixed(2)})`);
  const t = Orders.makeTicket(s, ['olive', 'ham']);
  check('ticket carries special flag', typeof t.special === 'boolean');
}

// ---- 4. special premium in scoring ------------------------------------------------
console.log('special premium');
{
  const s = newGame();
  const mkPizza = (size) => ({
    size, R: BAL.PIZZA.RADIUS[size], sauceCoverage: 60,
    cheese: new Array(Math.round(BAL.PIZZA.CHEESE_FULL * BAL.PIZZA.SIZE_FACTOR[size] * 0.6)),
    toppings: [], bakeZone: 'normal',
  });
  const ticket = { size: 'M', sauce: 'normal', cheese: 'normal', bake: 'normal', toppings: [], special: false };
  const base = Score.scoreOrder({ pizza: mkPizza('M'), ticket, elapsed: 20, splats: 0, state: s, prepGrace: false });
  const prem = Score.scoreOrder({ pizza: mkPizza('M'), ticket: { ...ticket, special: true }, elapsed: 20, splats: 0, state: s, prepGrace: false });
  const want = 1 + BAL.SPECIALS.PRICE_PREMIUM;
  check('+12% on special orders', Math.abs(prem.price / base.price - want) < 1e-9, `(got ${(prem.price / base.price).toFixed(3)})`);
}

// ---- 5. milestones -----------------------------------------------------------------
console.log('milestones');
{
  const s = newGame();
  s.stats.lifetimeServed = 30; s.stats.lifetimeEarned = 300;
  const first = checkMilestones(s).map(d => d.id);
  check('serve25 + earn250 fire', first.includes('serve25') && first.includes('earn250'));
  check('never fire twice', checkMilestones(s).length === 0);
  s.recentRatings = new Array(6).fill(4);
  check('star milestones gated before 12 ratings', !checkMilestones(s).some(d => d.id.startsWith('stars')));
  s.recentRatings = new Array(12).fill(4);
  const hits = checkMilestones(s).map(d => d.id);
  check('stars3 + stars4 fire at 12×4★', hits.includes('stars3') && hits.includes('stars4'));
  const before = s.recentRatings.length;
  s.stats.lifetimePerfects = 10;
  checkMilestones(s);
  check('ratingBump pushes a 5★', s.recentRatings[s.recentRatings.length - 1] === 5 && s.recentRatings.length === before + 1);
}

// ---- 6. daily goal feasibility -----------------------------------------------------
console.log('daily goals');
{
  const s = newGame();
  let ok = true;
  for (let d = 1; d <= 40; d++) {
    s.day = d; s.nextDay = null;
    const plan = ensureNextDay(s);
    if (plan.goal.id === 'sellL' || plan.goal.id === 'useAll') ok = false;
    if (plan.specials.some(t => !s.toppings.includes(t))) ok = false;
  }
  check('locked goals never offered, specials always owned', ok);
  s.sizeL = true; s.toppings = ['pepperoni', 'mushroom', 'onion', 'olive'];
  const seen = new Set();
  for (let d = 1; d <= 12; d++) { s.day = d; s.nextDay = null; seen.add(ensureNextDay(s).goal.id); }
  check('goal rotation covers the full pool', seen.size === BAL.DAILY_GOALS.length, `(saw ${seen.size})`);

  // all-day goals only settle when the day is over
  const svc = { served: 3, lost: 0, totalCustomers: 6, sats: [95, 95, 95], largeSold: 0,
                perfectsToday: 0, underPar: 0, usedTypes: new Set(), state: s };
  check('noStorms incomplete mid-day', !goalProgress({ id: 'noStorms' }, svc).done);
  svc.served = 6;
  check('noStorms completes at day end', goalProgress({ id: 'noStorms' }, svc).done);
  svc.lost = 1;
  check('a walk-out fails it', goalProgress({ id: 'noStorms' }, svc).failed);
}

// ---- 7. band maths on the V2 bands ----------------------------------------------------
console.log('bands');
{
  check('inside normal band = full credit', Score.amountFrac(60, 'normal') === 1);
  check('grade perfect mid-band', Score.amountGrade(63, 'normal') === 'perfect');
  check('grade good at band edge', Score.amountGrade(51, 'normal') === 'good');
  check('falloff outside band', Score.amountFrac(76 + BAL.SCORE.BAND_FALLOFF, 'normal') === 0);
  check('heavy band reachable at 100%', Score.amountFrac(100, 'heavy') === 1
    && Score.amountGrade(96, 'heavy') === 'perfect');
}

// ---- 8. regulars eligibility ------------------------------------------------------------
console.log('regulars');
{
  const s = newGame();          // only pepperoni + mushroom owned, no size L
  s.nextDay = { day: 1, specials: [], goal: BAL.DAILY_GOALS[0] };
  let bad = 0, seenReg = 0;
  for (let i = 0; i < 300; i++) {
    s.recentRatings = [5, 5, 5, 5, 5];      // pump the regular chance
    for (const c of Orders.generateDay(s)) {
      if (!c.regular) continue;
      seenReg++;
      const def = BAL.REGULARS.LIST[c.regular.key];
      if (def.fav.size === 'L' && !s.sizeL) bad++;
      if (!def.fav.toppings.every(t => s.toppings.includes(t.type))) bad++;
    }
  }
  check('regulars appear', seenReg > 0, `(saw ${seenReg})`);
  check('only eligible regulars (no locked toppings/sizes)', bad === 0, `(${bad} bad)`);
}

console.log(failures === 0 ? '\nALL LOGIC TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
