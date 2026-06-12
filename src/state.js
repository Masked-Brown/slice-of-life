// =====================================================================
// state.js — central persistent game state + save/load (localStorage).
// Transient per-day data lives in the service scene, never here.
// =====================================================================

import { BAL } from './balance.js';
import { clamp } from './juice.js';

export const SAVE_KEY = 'slice-of-life-save-v1';

export function newGame(muted = false) {
  return {
    version: 1,
    phase: 'service',            // 'service' | 'shop' — where Continue resumes
    day: 1,
    money: BAL.ECONOMY.START_MONEY,
    recentRatings: [],           // last N customer star ratings (rolling window)
    upgrades: { oven: 0, ladle: 0, shaker: 0, tongs: 0, decor: 0 },
    toppings: ['pepperoni', 'mushroom'],
    sizeL: false,
    boosts: { prep: 0, ad: 0 },  // bought for tomorrow; consumed at day start
    tutorialDone: false,
    muted,
    stats: { lifetimeServed: 0, lifetimeEarned: 0 },
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
    if (!s || s.version !== 1) return null;
    // merge over a fresh state so missing fields never crash older saves
    return { ...newGame(), ...s, upgrades: { ...newGame().upgrades, ...s.upgrades } };
  } catch { return null; }
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

// ---- formatting -----------------------------------------------------------
export function gbp(n) {
  return '£' + n.toFixed(2);
}
