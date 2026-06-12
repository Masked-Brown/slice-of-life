// =====================================================================
// state.js — central persistent game state + save/load (localStorage).
// Transient per-day data lives in the service scene, never here.
// =====================================================================

import { BAL } from './balance.js';
import { clamp } from './juice.js';

export const SAVE_KEY = 'slice-of-life-save-v1';

export function newGame(muted = false) {
  return {
    version: 2,
    phase: 'service',            // 'service' | 'shop' — where Continue resumes
    day: 1,
    money: BAL.ECONOMY.START_MONEY,
    recentRatings: [],           // last N customer star ratings (rolling window)
    upgrades: { oven: 0, ladle: 0, shaker: 0, tongs: 0, decor: 0, supply: 0 },
    toppings: ['pepperoni', 'mushroom'],
    sizeL: false,
    boosts: { prep: 0, ad: 0 },  // bought for tomorrow; consumed at day start
    tutorialDone: false,
    muted,
    stats: {
      lifetimeServed: 0, lifetimeEarned: 0,
      lifetimePerfects: 0, perfectStreak: 0, bestPerfectStreak: 0,
      bestDayProfit: 0,
    },
    // V2: stock & business layer
    stock: { pepperoni: BAL.STOCK.START, mushroom: BAL.STOCK.START },
    carriedRestockSpend: 0,      // £ spent restocking for the upcoming day
    milestonesDone: {},          // { milestoneId: true }
    nextDay: null,               // { day, specials, goal } — filled by goals.ensureNextDay
    lastDay: null,               // last session's analytics record (see dayEnd.js)
  };
}

export function saveGame(state) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* storage full/blocked */ }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || (s.version !== 1 && s.version !== 2)) return null;
    return migrate(s);
  } catch { return null; }
}

// merge over a fresh state so missing fields never crash older saves;
// v1 saves gain stock for every owned topping
export function migrate(s) {
  const fresh = newGame();
  const out = {
    ...fresh, ...s,
    version: 2,
    upgrades: { ...fresh.upgrades, ...s.upgrades },
    stats: { ...fresh.stats, ...s.stats },
    boosts: { ...fresh.boosts, ...s.boosts },
    stock: { ...s.stock },
    milestonesDone: { ...s.milestonesDone },
  };
  for (const t of out.toppings) {
    if (!(t in out.stock)) out.stock[t] = BAL.STOCK.START;
  }
  return out;
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
    + Math.round((rating - BAL.RATING.START) * D.RATING_BONUS_MULT);
  return clamp(n, D.MIN_CUSTOMERS, D.MAX_CUSTOMERS);
}

export function priceMultiplier(state) {
  return 1 + (currentRating(state) - BAL.RATING.START) * BAL.ECONOMY.RATING_PRICE_MULT;
}

export function queueSlots(state) {
  return BAL.QUEUE.BASE_SLOTS + state.upgrades.decor;
}

export function patienceMult(state) {
  return 1 + state.upgrades.decor * BAL.PATIENCE.DECOR_BONUS;
}

// ---- stock helpers -----------------------------------------------------
// £/piece after the supply-deal discount
export function unitCost(state, topping) {
  const disc = BAL.SUPPLY_DISCOUNTS[state.upgrades.supply] || 0;
  return BAL.TOPPINGS[topping].unit * (1 - disc);
}

// ---- formatting -----------------------------------------------------------
export function gbp(n) {
  return '£' + n.toFixed(2);
}
