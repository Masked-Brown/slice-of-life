// =====================================================================
// seasons.js — a rolling 36-day year. Each season subtly reskins the
// shop, lends 1–2 rotating toppings (they cycle back — no FOMO), puts
// one seasonal specialty on the menu, and biases the event weather.
// =====================================================================

import { BAL } from './balance.js';
import { unlocked } from './progress.js';
import { addStock } from './state.js';

export function seasonOf(day) {
  const S = BAL.SEASONS;
  const yearDay = (day - 1) % (S.LENGTH * S.ORDER.length);
  return S.ORDER[Math.floor(yearDay / S.LENGTH)];
}

// null until the calendar unlocks — the early game stays clean
export function seasonActive(state) {
  return unlocked(state, 'system', 'seasons') ? seasonOf(state.day) : null;
}

// days until the season turns (for the board's "last days!" note)
export function seasonDaysLeft(state) {
  const S = BAL.SEASONS;
  const yearDay = (state.day - 1) % (S.LENGTH * S.ORDER.length);
  return S.LENGTH - (yearDay % S.LENGTH);
}

// day-boundary bookkeeping: swap the lent toppings when the season turns.
// Leftover stock of a departing rotator just spoils out naturally.
// Returns { entered, left } when a change happened, else null.
export function syncSeason(state) {
  const now = seasonActive(state);
  if (now === (state.season || null)) return null;
  const left = state.season || null;
  state.toppings = state.toppings.filter(t => {
    const def = BAL.TOPPINGS[t];
    return !def || !def.seasonal || def.seasonal === now;
  });
  if (now) {
    for (const t of BAL.SEASONS.LIST[now].toppings) {
      if (!state.toppings.includes(t)) {
        state.toppings.push(t);
        addStock(state, t, BAL.SEASONS.LENT_STOCK);
      }
    }
  }
  state.season = now;
  return { entered: now, left };
}
