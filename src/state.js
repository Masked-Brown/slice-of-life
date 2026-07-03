// =====================================================================
// state.js — central persistent game state + save/load (localStorage).
// Transient per-day data lives in the service scene, never here.
// V3: XP/level spine, stock batches (age + grade) for spoilage,
// prestige scaffolding (lifetime + meta), volumes, loyalty, mastery.
// =====================================================================

import { BAL, ING } from './balance.js';
import { clamp } from './juice.js';

export const SAVE_KEY = 'slice-of-life-save-v1';

export function newGame(muted = false) {
  const state = {
    version: 3,
    phase: 'service',            // 'service' | 'shop' — where Continue resumes
    day: 1,
    money: BAL.ECONOMY.START_MONEY,
    xp: 0,
    level: 1,
    seenUnlocks: {},             // { unlockId: true } — reveal cards fire once
    recentRatings: [],           // last N customer star ratings (rolling window)
    upgrades: { oven: 0, ladle: 0, shaker: 0, tongs: 0, decor: 0, supply: 0,
                proofer: 0, oven2: 0, rail: 0 },
    toppings: ['pepperoni', 'mushroom'],
    sizeL: false,
    sauces: ['tomato'],          // owned sauce variants
    crusts: ['classic'],         // owned crust types
    sides: [],                   // owned side stations ('garlicbread' | 'drinks')
    grades: {},                  // { gradedKey: 'budget'|'standard'|'premium' }
    dials: { sauce: 'light', cheese: 'light' },  // auto-dispenser/hopper calibration
    boosts: { prep: 0, ad: 0 },  // bought for tomorrow; consumed at day start
    tutorialDone: false,
    muted,
    volumes: { music: 0.7, sfx: 1 },
    stats: {
      lifetimeServed: 0, lifetimeEarned: 0,
      lifetimePerfects: 0, perfectStreak: 0, bestPerfectStreak: 0,
      bestDayProfit: 0,
    },
    // prestige scaffolding — never reset by anything in V3
    lifetime: { earned: 0, served: 0, perfects: 0, days: 0, maxLevel: 1 },
    meta: { currency: 0, mult: 1.0 },
    // stock: flat counts are gameplay-authoritative; stockAges carries the
    // FIFO batches (age in days + supplier grade) the spoilage layer needs.
    // V3 code mutates stock ONLY through the helpers below.
    stock: {},
    stockAges: {},
    loyalty: {},                 // { regularKey: { serves } }
    mastery: {},                 // { recipeId: { perfects } }
    eventPity: { sinceEvent: 0 },
    season: null,                // active season id (once the calendar unlocks)
    criticBoost: 0,              // extra customers tomorrow after a rave review
    carriedRestockSpend: 0,      // £ spent restocking for the upcoming day
    milestonesDone: {},          // { milestoneId: true }
    nextDay: null,               // { day, specials, goal, event… } — goals.ensureNextDay
    lastDay: null,               // last session's analytics record (see dayEnd.js)
  };
  for (const g of BAL.GRADED) state.grades[g] = 'standard';
  for (const t of state.toppings) addStock(state, t, BAL.STOCK.START);
  for (const b of Object.keys(BAL.BASICS)) addStock(state, b, BAL.STOCK.START_BASICS);
  return state;
}

export function saveGame(state) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* storage full/blocked */ }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || ![1, 2, 3].includes(s.version)) return null;
    return migrate(s);
  } catch { return null; }
}

// merge over a fresh state so missing fields never crash older saves.
// v1 → gains stock for every owned topping (V2 rule, retained);
// v1/v2 → v3: stock batches seeded fresh, basics granted, XP/level
// backfilled so nothing a returning player owns is ever locked.
export function migrate(s) {
  const fromV2 = s.version !== 3;
  const fresh = newGame();
  const out = {
    ...fresh, ...s,
    version: 3,
    upgrades: { ...fresh.upgrades, ...s.upgrades },
    stats: { ...fresh.stats, ...s.stats },
    boosts: { ...fresh.boosts, ...s.boosts },
    volumes: { ...fresh.volumes, ...s.volumes },
    grades: { ...fresh.grades, ...s.grades },
    dials: { ...fresh.dials, ...s.dials },
    lifetime: { ...fresh.lifetime, ...s.lifetime },
    meta: { ...fresh.meta, ...s.meta },
    stock: { ...s.stock },
    stockAges: { ...s.stockAges },
    seenUnlocks: { ...s.seenUnlocks },
    loyalty: { ...s.loyalty },
    mastery: { ...s.mastery },
    eventPity: { ...fresh.eventPity, ...s.eventPity },
    milestonesDone: { ...s.milestonesDone },
    sauces: s.sauces ? [...s.sauces] : [...fresh.sauces],
    crusts: s.crusts ? [...s.crusts] : [...fresh.crusts],
    sides: s.sides ? [...s.sides] : [...fresh.sides],
  };
  // owned toppings always have a stock entry (V1 rule)
  for (const t of out.toppings) {
    if (!(t in out.stock)) out.stock[t] = BAL.STOCK.START;
  }
  if (fromV2) {
    // grant starter basics so a migrated player doesn't open on emergency prices
    for (const b of Object.keys(BAL.BASICS)) {
      out.stock[b] = Math.max(out.stock[b] | 0, BAL.STOCK.START_BASICS);
    }
    // lifetime backfill from what stats already know
    out.lifetime.earned = out.stats.lifetimeEarned;
    out.lifetime.served = out.stats.lifetimeServed;
    out.lifetime.perfects = out.stats.lifetimePerfects;
    out.lifetime.days = Math.max(0, out.day - 1);
    // XP backfill: rough credit for the road already travelled
    out.xp = Math.round(out.stats.lifetimeServed * 8.5 + (out.day - 1) * 15);
    out.level = levelForXP(out.xp);
  }
  // never lock content the player already owns (V2 saves; belt & braces on V3)
  out.level = Math.max(out.level, minLevelForOwned(out));
  out.lifetime.maxLevel = Math.max(out.lifetime.maxLevel, out.level);
  // every stock entry gets batches; missing batch info = one fresh batch
  for (const key of Object.keys(out.stock)) {
    const n = out.stock[key] | 0;
    const batches = out.stockAges[key];
    const batched = (batches || []).reduce((a, b) => a + b.n, 0);
    if (!batches || batched !== n) {
      out.stockAges[key] = n > 0 ? [{ age: 0, n, grade: out.grades[key] || 'standard' }] : [];
    }
  }
  return out;
}

// total XP → level (walks BAL.XP.CURVE; capped at max level)
export function levelForXP(xp) {
  let lvl = 1, rem = xp;
  for (const step of BAL.XP.CURVE) {
    if (rem < step) break;
    rem -= step;
    lvl++;
  }
  return lvl;
}

// XP progress inside the current level: { into, need }
export function xpProgress(state) {
  let rem = state.xp;
  for (let i = 0; i < state.level - 1 && i < BAL.XP.CURVE.length; i++) rem -= BAL.XP.CURVE[i];
  const need = BAL.XP.CURVE[state.level - 1] ?? Infinity;
  return { into: Math.max(0, rem), need };
}

// the minimum level at which everything this save owns is unlocked
// (reads BAL.UNLOCKS defensively — the table lands with the level spine)
export function minLevelForOwned(state) {
  if (!BAL.UNLOCKS) return 1;
  let min = 1;
  for (const u of BAL.UNLOCKS) {
    const owned =
      (u.kind === 'topping' && state.toppings.includes(u.id)) ||
      (u.kind === 'sizeL' && state.sizeL) ||
      (u.kind === 'sauce' && state.sauces.includes(u.id)) ||
      (u.kind === 'crust' && state.crusts.includes(u.id)) ||
      (u.kind === 'side' && state.sides.includes(u.id)) ||
      (u.kind === 'upgradeTier' && (state.upgrades[u.id] | 0) >= (u.tier || 1)) ||
      (u.kind === 'equipment' && (state.upgrades[u.id] | 0) > 0);
    if (owned) min = Math.max(min, u.level);
  }
  return min;
}

export function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}

export function wipeSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

// ---- rating helpers ---------------------------------------------------
export function currentRating(state) {
  const r = state.recentRatings;
  if (!r.length) return BAL.RATING.START;
  return r.reduce((a, b) => a + b, 0) / r.length;
}

export function pushRating(state, stars) {
  state.recentRatings.push(stars);
  while (state.recentRatings.length > BAL.RATING.WINDOW) state.recentRatings.shift();
}

// ---- derived numbers ----------------------------------------------------
export function customersForDay(state) {
  const D = BAL.DAYS;
  const rating = currentRating(state);
  const n = D.BASE_CUSTOMERS
    + (state.day - 1) * D.CUSTOMERS_PER_DAY
    + Math.round((rating - BAL.RATING.START) * D.RATING_BONUS_MULT)
    + (BAL.DECOR.FOOTFALL[state.upgrades.decor] || 0);
  return clamp(n, D.MIN_CUSTOMERS, D.MAX_CUSTOMERS + (BAL.DECOR.FOOTFALL[state.upgrades.decor] || 0));
}

export function priceMultiplier(state) {
  return 1 + (currentRating(state) - BAL.RATING.START) * BAL.ECONOMY.RATING_PRICE_MULT;
}

// decor's queue/patience perks stack over the first three tiers only —
// later tiers earn on charm (tips, footfall) instead
export function queueSlots(state) {
  return BAL.QUEUE.BASE_SLOTS + Math.min(state.upgrades.decor, BAL.DECOR.QUEUE_PATIENCE_TIERS);
}

export function patienceMult(state) {
  return 1 + Math.min(state.upgrades.decor, BAL.DECOR.QUEUE_PATIENCE_TIERS) * BAL.PATIENCE.DECOR_BONUS;
}

// tip multiplier from decor charm (+ the golden bell capstone at L30)
export function tipMult(state) {
  let m = 1 + (BAL.DECOR.TIP_FRAC[state.upgrades.decor] || 0);
  if (state.level >= 30) m += BAL.CAPSTONE_TIP_BONUS;
  return m;
}

// =====================================================================
// STOCK — the only writers of state.stock / state.stockAges.
// Batches are FIFO: oldest first. `stock[key]` stays the flat count the
// whole UI reads; these helpers keep it in sync with the batch list.
// =====================================================================

// £/unit after supply discount; graded keys also carry their grade's cost.
// A supply-shortage event triples tonight's price for its target.
export function unitCost(state, key, grade = null) {
  const def = ING(key);
  if (!def) return 0;
  const disc = BAL.SUPPLY_DISCOUNTS[state.upgrades.supply] || 0;
  const g = BAL.GRADED.includes(key) ? (grade || state.grades[key] || 'standard') : 'standard';
  let cost = def.unit * (1 - disc) * BAL.GRADES[g].costMult;
  const ev = state.nextDay && state.nextDay.event;
  if (ev && ev.id === 'shortage' && ev.target === key) {
    cost *= BAL.EVENTS.DEFS.shortage.priceMult;
  }
  return cost;
}

// how many days a batch of `key` at `grade` keeps
export function shelfLife(key, grade = 'standard') {
  const def = ING(key);
  if (!def || def.shelf == null) return Infinity;
  return Math.max(1, def.shelf + (BAL.GRADES[grade] ? BAL.GRADES[grade].shelfDelta : 0));
}

function batches(state, key) {
  return state.stockAges[key] || (state.stockAges[key] = []);
}

export function addStock(state, key, n, grade = null) {
  if (n <= 0) return;
  const g = BAL.GRADED.includes(key) ? (grade || state.grades[key] || 'standard') : 'standard';
  const list = batches(state, key);
  // merge with an existing age-0 batch of the same grade
  const fresh = list.find(b => b.age === 0 && b.grade === g);
  if (fresh) fresh.n += n;
  else list.push({ age: 0, n, grade: g });
  state.stock[key] = (state.stock[key] | 0) + n;
}

// consume oldest-first; returns { taken, grades: {grade: count} }
export function consumeStock(state, key, n) {
  const list = batches(state, key);
  const grades = {};
  let left = n;
  while (left > 0 && list.length) {
    const b = list[0];
    const take = Math.min(b.n, left);
    b.n -= take;
    left -= take;
    grades[b.grade] = (grades[b.grade] || 0) + take;
    if (b.n <= 0) list.shift();
  }
  const taken = n - left;
  state.stock[key] = Math.max(0, (state.stock[key] | 0) - taken);
  return { taken, grades };
}

// a piece going back in the bin — returns to the oldest batch (FIFO round-trip)
export function refundStock(state, key, n = 1) {
  if (n <= 0) return;
  const list = batches(state, key);
  if (list.length) list[0].n += n;
  else list.push({ age: 0, n, grade: state.grades[key] || 'standard' });
  state.stock[key] = (state.stock[key] | 0) + n;
}

// age every batch a day; bin the expired ones. Returns the waste report:
// { key: { n, cost } } valued at what those units cost at today's prices.
export function expireDay(state) {
  const waste = {};
  for (const key of Object.keys(state.stockAges)) {
    const list = state.stockAges[key];
    if (!list || !list.length) continue;
    let lost = 0, lostCost = 0;
    for (const b of list) {
      b.age += 1;
      if (b.age >= shelfLife(key, b.grade)) {
        lost += b.n;
        lostCost += b.n * unitCost(state, key, b.grade);
        b.n = 0;
      }
    }
    state.stockAges[key] = list.filter(b => b.n > 0);
    if (lost > 0) {
      state.stock[key] = Math.max(0, (state.stock[key] | 0) - lost);
      waste[key] = { n: lost, cost: lostCost };
    }
  }
  return waste;
}

// units of `key` that will expire at the NEXT day-end (restock screen hint)
export function expiringTomorrow(state, key) {
  const list = state.stockAges[key];
  if (!list) return 0;
  let n = 0;
  for (const b of list) if (b.age + 1 >= shelfLife(key, b.grade)) n += b.n;
  return n;
}

// ---- formatting -----------------------------------------------------------
export function gbp(n) {
  return '£' + n.toFixed(2);
}
