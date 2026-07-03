// =====================================================================
// events.js — the day-event scheduler. Weighted-random with a pity
// timer (no droughts, no spam), level-gated introductions, seasonal
// mood weighting. The NEXT day's event is rolled at day end so both
// the restock screen and the day-start board can announce it.
// =====================================================================

import { BAL } from './balance.js';
import { pick } from './juice.js';
import { unlocked } from './progress.js';
import { seasonActive } from './seasons.js';

export function rollNextEvent(state) {
  const defs = BAL.EVENTS.DEFS;
  const eligible = Object.keys(defs).filter(id => unlocked(state, 'event', id));
  if (!eligible.length) return null;

  state.eventPity = state.eventPity || { sinceEvent: 0 };
  const pity = state.eventPity;
  const force = pity.sinceEvent >= BAL.EVENTS.PITY_MAX_DRY;
  if (!force && Math.random() >= BAL.EVENTS.BASE_CHANCE) {
    pity.sinceEvent += 1;
    return null;
  }

  // weighted pick: season mood boosts, yesterday's event nearly muted
  const season = seasonActive(state);
  const sw = (season && BAL.EVENTS.SEASON_WEIGHTS[season]) || {};
  const pool = eligible.map(id => ({
    id, w: (sw[id] || 1) * (id === pity.last ? 0.15 : 1),
  }));
  let r = Math.random() * pool.reduce((a, p) => a + p.w, 0);
  let choice = pool[pool.length - 1].id;
  for (const p of pool) { r -= p.w; if (r <= 0) { choice = p.id; break; } }

  pity.sinceEvent = 0;
  pity.last = choice;

  const ev = { id: choice };
  if (choice === 'shortage') {
    // hit something the shop actually buys — a real forecasting wrinkle
    const targets = [
      ...state.toppings.filter(t => BAL.TOPPINGS[t] && !BAL.TOPPINGS[t].seasonal),
      ...Object.keys(BAL.BASICS),
    ];
    ev.target = pick(targets);
  }
  return ev;
}

export function eventDef(ev) {
  return ev ? BAL.EVENTS.DEFS[ev.id] : null;
}
