// =====================================================================
// logic-test.mjs — pure-logic assertions over the game modules that run
// headless (no canvas/DOM). Run: node tools/logic-test.mjs
// =====================================================================

import { BAL, TOPPING_ORDER } from '../src/balance.js';
import { newGame, migrate, unitCost, currentRating, levelForXP, xpProgress,
         addStock, consumeStock, refundStock, expireDay, expiringTomorrow, shelfLife } from '../src/state.js';
import { Score } from '../src/stations/serve.js';
import { Orders } from '../src/stations/order.js';
import { ensureNextDay, checkMilestones, metrics, goalProgress } from '../src/goals.js';
import { unlocked, unlockLevel, orderXP, awardXP } from '../src/progress.js';

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
  check('new fields appear', s.upgrades.supply === 0 && s.carriedRestockSpend === 0 && s.version === 3);
  check('boosts survive', s.boosts.ad === 1);
  // V3 additions
  check('basics granted on migration',
    s.stock.dough === BAL.STOCK.START_BASICS && s.stock.cheese === BAL.STOCK.START_BASICS);
  check('stock batches seeded in sync', Object.keys(s.stock).every(k =>
    (s.stockAges[k] || []).reduce((a, b) => a + b.n, 0) === s.stock[k]));
  check('lifetime backfilled', s.lifetime.served === 41 && s.lifetime.days === 5);
  check('XP/level backfilled', s.xp > 0 && s.level >= 2);
  check('meta scaffold present at 1.0', s.meta.mult === 1.0 && s.meta.currency === 0);
  check('grades default standard', BAL.GRADED.every(k => s.grades[k] === 'standard'));
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

// ---- 8b. spoilage & stock batches ----------------------------------------------
console.log('spoilage');
{
  const s = newGame();
  const sync = k => (s.stockAges[k] || []).reduce((a, b) => a + b.n, 0) === (s.stock[k] | 0);

  // FIFO consume: oldest batch drains first
  s.stock.pepperoni = 0; s.stockAges.pepperoni = [];
  addStock(s, 'pepperoni', 10);
  s.stockAges.pepperoni[0].age = 2;              // pretend it's older stock
  addStock(s, 'pepperoni', 10);
  const r = consumeStock(s, 'pepperoni', 12);
  check('consume drains oldest batch first', r.taken === 12
    && s.stockAges.pepperoni.length === 1 && s.stockAges.pepperoni[0].age === 0, JSON.stringify(s.stockAges.pepperoni));
  check('flat count stays in sync after consume', sync('pepperoni'));
  refundStock(s, 'pepperoni', 2);
  check('refund keeps sync', sync('pepperoni') && s.stock.pepperoni === 10);

  // expiry: mushroom keeps 3 days → 3 day-ends, gone on the 3rd
  s.stock.mushroom = 0; s.stockAges.mushroom = [];
  addStock(s, 'mushroom', 8);
  let w1 = expireDay(s), w2 = expireDay(s);
  check('fresh stock survives early day-ends', !w1.mushroom && !w2.mushroom && s.stock.mushroom === 8);
  check('expiring-tomorrow flags the last night', expiringTomorrow(s, 'mushroom') === 8);
  const w3 = expireDay(s);
  check('stock expires at shelf life', w3.mushroom && w3.mushroom.n === 8 && s.stock.mushroom === 0);
  check('waste is valued in £', w3.mushroom.cost > 0
    && Math.abs(w3.mushroom.cost - 8 * unitCost(s, 'mushroom')) < 1e-9);
  check('batches stay in sync after expiry', sync('mushroom'));

  // premium perishables spoil a day sooner
  check('premium shortens shelf life', shelfLife('mushroom', 'premium') === shelfLife('mushroom') - 1);

  // olives outlive mushrooms; pepperoni cured
  check('shelf lives ordered sensibly',
    shelfLife('olive') > shelfLife('mushroom') && shelfLife('pepperoni') > shelfLife('mushroom'));

  // basics exist and start stocked in a new game
  const fresh2 = newGame();
  check('basics stocked from day 1', fresh2.stock.dough === BAL.STOCK.START_BASICS
    && fresh2.stock.sauce === BAL.STOCK.START_BASICS && fresh2.stock.cheese === BAL.STOCK.START_BASICS);
}

// ---- 8c. variants, crusts, grades, tier pricing ---------------------------------
console.log('variants & grades');
{
  const s = newGame();
  // fresh game: tickets only ever ask for tomato/classic
  let clean = true;
  for (let i = 0; i < 200; i++) {
    const t = Orders.makeTicket(s, []);
    if (t.sauceType !== 'tomato' || t.crust !== 'classic') clean = false;
  }
  check('fresh game tickets stay tomato/classic', clean);

  // once owned, variants appear but the default stays most common
  s.sauces = ['tomato', 'bbq'];
  s.crusts = ['classic', 'thin', 'stuffed'];
  let bbq = 0, thin = 0;
  for (let i = 0; i < 3000; i++) {
    const t = Orders.makeTicket(s, []);
    if (t.sauceType === 'bbq') bbq++;
    if (t.crust === 'thin') thin++;
  }
  check('variants appear once owned', bbq > 500 && thin > 400, `(bbq ${bbq}, thin ${thin})`);
  check('defaults stay most common', bbq < 1500 && thin < 1100);

  // wrong sauce variant guts the sauce credit; wrong crust dents accuracy
  const mkPizza = () => ({
    size: 'M', R: BAL.PIZZA.RADIUS.M, sauceCoverage: 60, sauceType: 'tomato', crust: 'classic',
    cheese: new Array(Math.round(BAL.PIZZA.CHEESE_FULL * 0.6)), toppings: [], bakeZone: 'normal',
  });
  const ticket = { size: 'M', sauce: 'normal', cheese: 'normal', bake: 'normal',
    sauceType: 'bbq', crust: 'classic', toppings: [], special: false };
  const right = Score.scoreOrder({ pizza: { ...mkPizza(), sauceType: 'bbq' }, ticket, elapsed: 20, splats: 0, state: s, prepGrace: false });
  const wrong = Score.scoreOrder({ pizza: mkPizza(), ticket, elapsed: 20, splats: 0, state: s, prepGrace: false });
  check('wrong sauce variant costs accuracy', right.accuracy - wrong.accuracy >= 10,
    `(${right.accuracy} vs ${wrong.accuracy})`);
  const wrongCrust = Score.scoreOrder({ pizza: { ...mkPizza(), sauceType: 'bbq', crust: 'thin' }, ticket, elapsed: 20, splats: 0, state: s, prepGrace: false });
  check('wrong crust costs flat points', right.accuracy - wrongCrust.accuracy === BAL.SCORE.CRUST_WRONG_PENALTY);

  // exotic topping types price higher than commons
  const common = { ...ticket, sauceType: 'tomato', toppings: [{ type: 'onion', count: 4 }] };
  const exotic = { ...ticket, sauceType: 'tomato', toppings: [{ type: 'truffle', count: 4 }] };
  const pc = Score.scoreOrder({ pizza: mkPizza(), ticket: common, elapsed: 20, splats: 0, state: s, prepGrace: false });
  const pe = Score.scoreOrder({ pizza: mkPizza(), ticket: exotic, elapsed: 20, splats: 0, state: s, prepGrace: false });
  check('exotic types charge more', pe.price - pc.price > 1.5, `(Δ£${(pe.price - pc.price).toFixed(2)})`);

  // stuffed crust adds its premium
  const stuffedT = { ...ticket, sauceType: 'tomato', crust: 'stuffed', toppings: [] };
  const ps = Score.scoreOrder({ pizza: { ...mkPizza(), crust: 'stuffed' }, ticket: stuffedT, elapsed: 20, splats: 0, state: s, prepGrace: false });
  const pb = Score.scoreOrder({ pizza: mkPizza(), ticket: { ...ticket, sauceType: 'tomato' }, elapsed: 20, splats: 0, state: s, prepGrace: false });
  check('stuffed crust charges a premium', ps.price > pb.price);

  // grade bonus: premium consumed units lift satisfaction & money
  const bonus = Score.gradeSatBonus({ cheese: { premium: 1 }, pepperoni: { premium: 4 } });
  check('premium grades add satisfaction', bonus === 2 * BAL.GRADES.premium.satBonus
    || bonus === BAL.SCORE.GRADE_BONUS_MAX, `(bonus ${bonus})`);
  const budget = Score.gradeSatBonus({ cheese: { budget: 1 } });
  check('budget grade dings satisfaction', budget === BAL.GRADES.budget.satBonus);
  // an imperfect order (heavy sauce asked, normal poured) so the bonus has room
  const graded = Score.scoreOrder({ pizza: mkPizza(), ticket: { ...ticket, sauceType: 'tomato', sauce: 'heavy' }, elapsed: 20, splats: 0, state: s, prepGrace: false, gradeBonus: 5 });
  check('grade uplift is tracked in money', graded.gradeUplift > 0);

  // every topping in the roster has a shelf life and tier; 18 permanent + 4 seasonal
  const allOk = TOPPING_ORDER.every(k => {
    const t = BAL.TOPPINGS[k];
    return t.shelf >= 1 && ['common', 'premium', 'exotic'].includes(t.tier);
  });
  const permanent = TOPPING_ORDER.filter(k => !BAL.TOPPINGS[k].seasonal);
  const seasonal = TOPPING_ORDER.filter(k => BAL.TOPPINGS[k].seasonal);
  check('all toppings fully defined (18 permanent + 4 seasonal)',
    allOk && permanent.length === 18 && seasonal.length === 4);
}

// ---- 8d. specialties, sides, decor buffs -----------------------------------------
console.log('specialties & sides & decor');
{
  const s = newGame();
  check('no recipes available at level 1', Orders.availableRecipes(s).length === 0);
  s.level = 30;
  const starterAvail = Orders.availableRecipes(s);
  check('recipes need owned components', starterAvail.length === 1 && starterAvail[0] === 'doubledouble',
    `(got ${starterAvail.join(',')})`);
  s.toppings = [...TOPPING_ORDER];
  s.sauces = ['tomato', 'bbq', 'white'];
  s.crusts = ['classic', 'thin', 'stuffed'];
  const avail = Orders.availableRecipes(s);
  const permanentRecipes = Object.keys(BAL.RECIPES).filter(id => !BAL.RECIPES[id].seasonal);
  check('all permanent recipes available fully stocked at L30',
    permanentRecipes.every(id => avail.includes(id)), `(${avail.length})`);
  // recipe builds only reference real content
  const sane = Object.values(BAL.RECIPES).every(r =>
    r.build.toppings.every(t => BAL.TOPPINGS[t.type])
    && BAL.SAUCES[r.build.sauceType] && BAL.CRUSTS[r.build.crust]);
  check('recipe builds reference real content', sane);

  // specialty premium lands in the price
  const t = Orders.recipeTicket(s, 'meatfeast');
  const pz = { size: t.size, R: BAL.PIZZA.RADIUS[t.size], sauceCoverage: 60, sauceType: t.sauceType,
    crust: t.crust, cheese: new Array(60), toppings: [], bakeZone: t.bake };
  const spec = Score.scoreOrder({ pizza: pz, ticket: t, elapsed: 20, splats: 0, state: s, prepGrace: false });
  const plain = Score.scoreOrder({ pizza: pz, ticket: { ...t, specialty: null }, elapsed: 20, splats: 0, state: s, prepGrace: false });
  const wantP = 1 + BAL.RECIPES.meatfeast.premium;
  check('specialty charges its premium', Math.abs(spec.price / plain.price - wantP) < 1e-9);

  // sides: missing side dents satisfaction via satAdjust
  const missing = Score.scoreOrder({ pizza: pz, ticket: t, elapsed: 20, splats: 0, state: s, prepGrace: false, satAdjust: BAL.SIDE_SAT.MISSING });
  check('missing side dents satisfaction', spec.satisfaction - missing.satisfaction >= 4);

  // decor: queue/patience cap at 3 tiers, then charm buffs take over
  const d = newGame();
  d.upgrades.decor = 6;
  const dBase = newGame(); dBase.upgrades.decor = 3;
  const { queueSlots, patienceMult, tipMult, customersForDay } = await import('../src/state.js');
  check('queue slots cap at decor 3', queueSlots(d) === queueSlots(dBase));
  check('patience caps at decor 3', patienceMult(d) === patienceMult(dBase));
  check('high decor buffs tips', tipMult(d) > tipMult(dBase));
  check('high decor adds footfall', customersForDay(d) > customersForDay(dBase));
  check('golden bell adds tips at L30', (() => { const g2 = newGame(); g2.level = 30; return tipMult(g2) > 1; })());
}

// ---- 8e. advanced orders: modifiers, half-and-half, groups, pre-orders ----------
console.log('advanced orders');
{
  const s = newGame();
  s.level = 30;

  // modifier bands override the named band
  const noCheeseT = { size: 'M', sauce: 'normal', cheese: 'heavy', bake: 'normal', modifier: 'nocheese', toppings: [] };
  const band = Score.bandOf(noCheeseT, 'cheese');
  check('nocheese overrides the cheese band', band[0] === 0 && band[1] <= 10);
  check('zero cheese is perfect under nocheese', Score.amountGrade(0, band) !== 'off'
    && Score.amountFrac(0, band) === 1);
  check('normal cheese amount fails under nocheese', Score.amountFrac(60, band) === 0);

  // half-and-half: side placement is the whole test
  const halfT = {
    size: 'M', sauce: 'normal', cheese: 'normal', bake: 'normal', half: true,
    toppings: [{ type: 'pepperoni', count: 4 }, { type: 'mushroom', count: 4 }],
    halves: { L: [{ type: 'pepperoni', count: 4 }], R: [{ type: 'mushroom', count: 4 }] },
  };
  const mkPieces = (correct) => {
    const p = [];
    for (let i = 0; i < 4; i++) p.push({ type: 'pepperoni', x: correct ? -30 - i : 30 + i, y: i * 8 - 12 });
    for (let i = 0; i < 4; i++) p.push({ type: 'mushroom', x: correct ? 30 + i : -30 - i, y: i * 8 - 12 });
    return p;
  };
  const right = Score.halfResult({ toppings: mkPieces(true) }, halfT);
  const swapped = Score.halfResult({ toppings: mkPieces(false) }, halfT);
  check('correct halves score perfect', right.grade === 'perfect' && right.frac === 1);
  check('swapped halves collapse the score', swapped.frac < 0.4, `(frac ${swapped.frac.toFixed(2)})`);

  // groups appear once unlocked, never for regulars, with scaled patience
  s.toppings = ['pepperoni', 'mushroom'];
  s.nextDay = null; ensureNextDay(s);
  let groups = 0, groupOnRegular = 0, three = 0;
  for (let i = 0; i < 400; i++) {
    for (const c of Orders.generateDay(s)) {
      if (c.group) {
        groups++;
        if (c.regular) groupOnRegular++;
        if (c.group.tickets.length === 3) three++;
        if (Math.abs(c.drainScale - 1 / BAL.GROUP.PATIENCE_MULT) > 1e-9) groupOnRegular += 100;
      }
    }
  }
  check('group orders roll at L30', groups > 0, `(${groups})`);
  check('groups never land on regulars, patience scaled', groupOnRegular === 0);
  check('three-pizza groups exist', three > 0);

  // pre-order offers roll into the next-day plan at L30
  let offers = 0;
  for (let i = 0; i < 60; i++) {
    s.nextDay = null;
    const plan = ensureNextDay(s);
    offers += (plan.preorders || []).length;
    if ((plan.preorders || []).some(o => !o.ticket.preorder || o.accepted)) offers = -1e9;
  }
  check('pre-order offers roll, flagged, unaccepted', offers > 60, `(${offers})`);
  const low = newGame();
  low.nextDay = null;
  check('no pre-orders before the unlock', (ensureNextDay(low).preorders || []).length === 0);

  // pre-order premium in the price
  const pt = { size: 'M', sauce: 'normal', cheese: 'normal', bake: 'normal', toppings: [], preorder: true };
  const pz2 = { size: 'M', R: BAL.PIZZA.RADIUS.M, sauceCoverage: 60, cheese: new Array(60), toppings: [], bakeZone: 'normal' };
  const pres = Score.scoreOrder({ pizza: pz2, ticket: pt, elapsed: 20, splats: 0, state: s, prepGrace: false });
  const norm = Score.scoreOrder({ pizza: pz2, ticket: { ...pt, preorder: false }, elapsed: 20, splats: 0, state: s, prepGrace: false });
  check('pre-orders pay the premium', Math.abs(pres.price / norm.price - (1 + BAL.PREORDER.PREMIUM)) < 1e-9);
}

// ---- 8f. archetypes, events, seasons ---------------------------------------------
console.log('archetypes & events & seasons');
{
  const { seasonOf, seasonActive, syncSeason } = await import('../src/seasons.js');
  const { rollNextEvent } = await import('../src/events.js');

  // archetypes appear once unlocked, with drain scales
  const s = newGame();
  s.level = 30;
  s.nextDay = null; ensureNextDay(s);
  const kinds = new Set();
  for (let i = 0; i < 300; i++) {
    for (const c of Orders.generateDay(s)) if (c.archetype) kinds.add(c.archetype);
  }
  check('all four archetypes appear at L30', ['impatient', 'easygoing', 'tourist', 'vip'].every(k => kinds.has(k)),
    `(saw ${[...kinds].join(',')})`);
  const low = newGame();
  low.nextDay = null; ensureNextDay(low);
  let anyEarly = false;
  for (let i = 0; i < 100; i++) {
    for (const c of Orders.generateDay(low)) if (c.archetype) anyEarly = true;
  }
  check('no archetypes before their unlock', !anyEarly);

  // event scheduler: nothing before unlocks; pity forces within the window
  const e0 = newGame();
  check('no events before any unlock', rollNextEvent(e0) === null && e0.eventPity.sinceEvent === 0);
  const e1 = newGame();
  e1.level = 30;
  let dry = 0, maxDry = 0, seen = {};
  for (let d = 0; d < 300; d++) {
    const ev = rollNextEvent(e1);
    if (ev) { seen[ev.id] = (seen[ev.id] || 0) + 1; maxDry = Math.max(maxDry, dry); dry = 0; }
    else dry++;
  }
  check('pity timer caps droughts', maxDry <= BAL.EVENTS.PITY_MAX_DRY, `(max dry ${maxDry})`);
  check('all event types roll', Object.keys(BAL.EVENTS.DEFS).every(id => seen[id] > 0),
    `(${Object.keys(seen).length}/8)`);
  const shortages = [];
  for (let i = 0; i < 200; i++) {
    const ev = rollNextEvent(e1);
    if (ev && ev.id === 'shortage') shortages.push(ev.target);
  }
  check('shortages pick a real target', shortages.length > 0 && shortages.every(t =>
    BAL.TOPPINGS[t] || BAL.BASICS[t]));
  // shortage triples tonight's restock price
  const sc = newGame();
  const base = unitCost(sc, 'pepperoni');
  sc.nextDay = { day: 1, event: { id: 'shortage', target: 'pepperoni' } };
  check('shortage triples the unit cost', Math.abs(unitCost(sc, 'pepperoni') / base - 3) < 1e-9);

  // seasons: 36-day loop, rotators swap at the boundary
  check('season cycle loops', seasonOf(1) === 'spring' && seasonOf(10) === 'summer'
    && seasonOf(19) === 'spooky' && seasonOf(28) === 'winter' && seasonOf(37) === 'spring');
  const w = newGame();
  w.level = 30;
  w.day = 10;                                   // summer
  const ch = syncSeason(w);
  check('season lends its topping', ch && ch.entered === 'summer'
    && w.toppings.includes('cherrytomato') && w.stock.cherrytomato === BAL.SEASONS.LENT_STOCK);
  w.day = 19;                                   // spooky
  const ch2 = syncSeason(w);
  check('rotators swap at the boundary', ch2.entered === 'spooky'
    && !w.toppings.includes('cherrytomato') && w.toppings.includes('pumpkin'));
  check('seasons dark before unlock', seasonActive(newGame()) === null);
  // seasonal recipe only in season
  w.toppings.push('onion');
  w.sauces.push('bbq');
  const avail = Orders.availableRecipes(w);
  check('seasonal recipe available in season', avail.includes('jackolantern'));
  check('other seasons’ recipes hidden', !avail.includes('estiva') && !avail.includes('margheritafresca'));
}

// ---- 8g. automation arc gating ---------------------------------------------------
console.log('automation');
{
  const s = newGame();
  check('tier-4 tools exist and gate late', BAL.UPGRADES.ladle.costs.length === 4
    && unlockLevel('upgradeTier', 'ladle', 4) === 18
    && unlockLevel('upgradeTier', 'shaker', 4) === 22);
  check('new equipment lines gate as equipment',
    unlockLevel('equipment', 'proofer') === 13
    && unlockLevel('equipment', 'oven2') === 25
    && unlockLevel('equipment', 'rail') === 27);
  check('dials default to light (top-up strategy)',
    s.dials.sauce === 'light' && s.dials.cheese === 'light');
  check('pour tables cover tier 4', BAL.POUR.SAUCE_RATE.length >= 5 && BAL.POUR.CHEESE_RATE.length >= 5
    && BAL.POUR.IN_BAND_SLOW.length >= 5);
  // migration keeps dials for old saves
  const m = migrate({ version: 2, day: 3, money: 10, recentRatings: [], upgrades: {},
    toppings: ['pepperoni', 'mushroom'], sizeL: false, boosts: {}, tutorialDone: true,
    muted: false, stats: {}, stock: {} });
  check('migration fills dials', m.dials && m.dials.sauce === 'light');
}

// ---- 8h. loyalty cards & recipe mastery (original systems) ------------------------
console.log('loyalty & mastery');
{
  const { loyaltyTier, recordLoyalty, masteryStars, recordMastery } = await import('../src/progress.js');
  const s = newGame();
  check('loyalty inert before its unlock', recordLoyalty(s, 'marco') === null
    && loyaltyTier(s, 'marco') === 0);
  s.level = 30;
  let tierUps = [];
  for (let i = 0; i < 10; i++) {
    const up = recordLoyalty(s, 'marco');
    if (up) tierUps.push(up);
  }
  check('tiers land at 3/6/10 stamps', tierUps.join(',') === '1,2,3'
    && loyaltyTier(s, 'marco') === 3);

  check('mastery inert before its unlock', (() => {
    const f = newGame(); return recordMastery(f, 'doubledouble') === null;
  })());
  let starUps = [];
  for (let i = 0; i < 15; i++) {
    const up = recordMastery(s, 'meatfeast');
    if (up) starUps.push(up);
  }
  check('stars land at 5/15 perfects', starUps.join(',') === '1,2'
    && masteryStars(s, 'meatfeast') === 2);

  // mastery raises the specialty premium in the price
  s.toppings = [...TOPPING_ORDER];
  const t = Orders.recipeTicket(s, 'meatfeast');
  const pz = { size: t.size, R: BAL.PIZZA.RADIUS[t.size], sauceCoverage: 60, sauceType: t.sauceType,
    crust: t.crust, cheese: new Array(60), toppings: [], bakeZone: t.bake };
  const starred = Score.scoreOrder({ pizza: pz, ticket: t, elapsed: 20, splats: 0, state: s, prepGrace: false });
  const fresh = newGame(); fresh.level = 30;
  const plain = Score.scoreOrder({ pizza: pz, ticket: t, elapsed: 20, splats: 0, state: fresh, prepGrace: false });
  const wantMult = (1 + BAL.RECIPES.meatfeast.premium + 2 * BAL.MASTERY.PREMIUM_PER_STAR)
    / (1 + BAL.RECIPES.meatfeast.premium);
  check('mastery stars raise the premium', Math.abs(starred.price / plain.price - wantMult) < 1e-9);
}

// ---- 9. XP / level spine ------------------------------------------------------
console.log('xp & levels');
{
  check('level 1 at 0 XP', levelForXP(0) === 1);
  check('level 2 exactly at first step', levelForXP(BAL.XP.CURVE[0]) === 2
    && levelForXP(BAL.XP.CURVE[0] - 1) === 1);
  const total = BAL.XP.CURVE.reduce((a, b) => a + b, 0);
  check('curve caps at level 30', BAL.XP.CURVE.length === 29 && levelForXP(total + 999) === 30);

  const s = newGame();
  const lv = awardXP(s, BAL.XP.CURVE[0] + 5);
  check('awardXP levels up and pays cash', lv.from === 1 && lv.to === 2 && lv.cash > 0 && s.money > 0);
  const p = xpProgress(s);
  check('xpProgress tracks inside the level', p.into === 5 && p.need === BAL.XP.CURVE[1]);

  // accuracy scales order XP hard: perfect ≫ sloppy
  const ticket = { size: 'M', toppings: [{ type: 'pepperoni', count: 5 }] };
  const sloppy = orderXP(ticket, { accuracy: 35, perfect: false });
  const perfect = orderXP(ticket, { accuracy: 100, perfect: true });
  check('perfect order pays ~3×+ the XP of a sloppy one', perfect / sloppy >= 2.5,
    `(${sloppy} vs ${perfect})`);
}

// ---- 10. unlock table -----------------------------------------------------------
console.log('unlock table');
{
  const s = newGame();
  check('starter content open at level 1',
    unlocked(s, 'topping', 'pepperoni') && unlocked(s, 'upgradeTier', 'oven', 1));
  check('onion gated at level 2', !unlocked(s, 'topping', 'onion') && unlockLevel('topping', 'onion') === 2);
  check('size L gated', !unlocked(s, 'sizeL', 'sizeL'));
  s.level = 30;
  check('everything open at level 30', BAL.UNLOCKS.every(u => unlocked(s, u.kind, u.id, u.tier || 1)));
  const levels = BAL.UNLOCKS.map(u => u.level);
  check('table spans levels 2–30', Math.min(...levels) === 2 && Math.max(...levels) === 30);
  // every level from 2..30 carries something early, gaps ≤ 1 until 10
  const set = new Set(levels);
  let earlyGaps = true;
  for (let l = 2; l <= 10; l++) if (!set.has(l)) earlyGaps = false;
  check('no unlock droughts in the early game', earlyGaps);

  // a V2 save owning late content can never see it locked
  const v2 = {
    version: 2, day: 12, money: 50, recentRatings: [4, 4],
    upgrades: { oven: 1, ladle: 0, shaker: 0, tongs: 0, decor: 0, supply: 0 },
    toppings: ['pepperoni', 'mushroom', 'chilli'], sizeL: true,
    boosts: { prep: 0, ad: 0 }, tutorialDone: true, muted: false,
    stats: { lifetimeServed: 20, lifetimeEarned: 200 },
    stock: { pepperoni: 5, mushroom: 5, chilli: 5 },
  };
  const m = migrate(v2);
  check('migration clamps level over owned content',
    m.level >= unlockLevel('topping', 'chilli'), `(level ${m.level})`);
}

console.log(failures === 0 ? '\nALL LOGIC TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
