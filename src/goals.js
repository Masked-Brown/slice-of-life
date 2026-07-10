// =====================================================================
// goals.js — lifetime milestones + rotating daily goals + the next-day
// plan (specials & goal), generated at day end so the player can see
// tomorrow's demand while restocking. Pure logic; scenes do the juice.
// =====================================================================

import { BAL, TOPPING_ORDER } from './balance.js';
import { pick } from './juice.js';
import { currentRating, pushRating } from './state.js';
import { unlocked } from './progress.js';
import { rollNextEvent } from './events.js';
import { Orders } from './stations/order.js';

// ---- next-day plan (specials + daily goal + pre-order offers) --------------
export function ensureNextDay(state) {
  if (state.nextDay && state.nextDay.day === state.day) return state.nextDay;

  const owned = TOPPING_ORDER.filter(t => state.toppings.includes(t));
  const nSpecials = Math.min(owned.length, state.day >= BAL.SPECIALS.TWO_FROM_DAY ? 2 : 1);
  const pool = [...owned];
  const specials = [];
  while (specials.length < nSpecials && pool.length) {
    const t = pick(pool);
    pool.splice(pool.indexOf(t), 1);
    specials.push(t);
  }

  // rotate through whichever goals the player can actually attempt
  const feasible = BAL.DAILY_GOALS.filter(g =>
    (g.needs !== 'sizeL' || state.sizeL) &&
    (g.needs !== 'manyToppings' || state.toppings.length >= BAL.DAILY_GOAL_MANY_TOPPINGS) &&
    (g.needs !== 'sides' || state.sides.length > 0) &&
    (g.needs !== 'recipes' || Orders.availableRecipes(state).length > 0) &&
    (g.needs !== 'loyalty' || unlocked(state, 'system', 'loyalty')));
  const goal = { ...feasible[(state.day - 1) % feasible.length] };

  // phone pre-order offers: known tickets, fixed due points, player's call.
  // Rolled here (the evening before) so the restock screen can see them too.
  const slots = ['preorder1', 'preorder2', 'preorder3']
    .filter(id => unlocked(state, 'preorder', id)).length;
  const preorders = [];
  for (let i = 0; i < slots; i++) {
    if (Math.random() < BAL.PREORDER.OFFER_CHANCE) {
      const ticket = Orders.makeTicket(state, specials);
      ticket.preorder = true;
      preorders.push({ ticket, dueAfter: BAL.PREORDER.DUE_AFTER[i], accepted: false });
    }
  }

  // tomorrow's event (if any) — rolled now so restock can see it coming.
  // The hidden admin panel (src/dev/) can force the outcome once; the
  // override is consumed here and never survives into normal play.
  let event = rollNextEvent(state);
  if (state.devForceEvent !== undefined) {
    event = state.devForceEvent;
    delete state.devForceEvent;
  }

  state.nextDay = { day: state.day, specials, goal, preorders, event };
  return state.nextDay;
}

// ---- milestone metrics ---------------------------------------------------
export function metrics(state) {
  const s = state.stats;
  const loyaltyTiers = Object.values(state.loyalty || {}).map(l => {
    let tier = 0;
    for (const need of BAL.LOYALTY.TIERS) if ((l.stamps | 0) >= need) tier++;
    return tier;
  });
  const masteryStarsTotal = Object.values(state.mastery || {}).reduce((a, m) => {
    let stars = 0;
    for (const need of BAL.MASTERY.STARS_AT) if ((m.perfects | 0) >= need) stars++;
    return a + stars;
  }, 0);
  return {
    served: s.lifetimeServed,
    earned: s.lifetimeEarned,
    // star milestones only count once enough customers have weighed in
    rating: state.recentRatings.length >= BAL.MILESTONE_MIN_RATINGS ? currentRating(state) : 0,
    perfects: s.lifetimePerfects,
    bestStreak: s.bestPerfectStreak,
    upgradesOwned: Object.values(state.upgrades).reduce((a, b) => a + b, 0),
    // seasonal rotators don't count toward permanent-roster milestones
    toppingsOwned: state.toppings.filter(t => BAL.TOPPINGS[t] && !BAL.TOPPINGS[t].seasonal).length,
    bestDayProfit: s.bestDayProfit,
    level: state.level,
    specialtiesSold: s.specialtiesSold | 0,
    sidesSoldLife: s.sidesSoldLife | 0,
    preordersOnTime: s.preordersOnTime | 0,
    eventsSeen: s.eventsSeen | 0,
    zeroWasteDays: s.zeroWasteDays | 0,
    raveReviews: s.raveReviews | 0,
    loyaltyTop: loyaltyTiers.length ? Math.max(...loyaltyTiers) : 0,
    masteryStarsTotal,
  };
}

// Newly hit milestones: marks them done, applies rating bumps, returns the
// list so the caller can pay out and celebrate.
export function checkMilestones(state) {
  const m = metrics(state);
  const hit = [];
  for (const def of BAL.MILESTONES) {
    if (state.milestonesDone[def.id]) continue;
    if ((m[def.stat] ?? 0) >= def.target) {
      state.milestonesDone[def.id] = true;
      for (let i = 0; i < (def.ratingBump || 0); i++) pushRating(state, 5);
      hit.push(def);
    }
  }
  return hit;
}

// ---- daily goal progress ---------------------------------------------------
// Reads the service scene's counters. 'noStorms' and 'sat90' are all-day
// goals: they only complete when the last customer is done.
export function goalProgress(goal, svc) {
  const dayOver = (svc.served + svc.lost) >= svc.totalCustomers && svc.totalCustomers > 0;
  const satAvg = svc.sats.length ? svc.sats.reduce((a, b) => a + b, 0) / svc.sats.length : 0;
  switch (goal.id) {
    case 'noStorms':
      return { prog: svc.served, target: svc.totalCustomers,
               done: dayOver && svc.lost === 0 && svc.served > 0, failed: svc.lost > 0 };
    case 'sat90':
      return { prog: Math.round(satAvg), target: 90,
               done: dayOver && svc.served > 0 && satAvg >= 90, failed: false };
    case 'sellL':
      return { prog: svc.largeSold, target: goal.target, done: svc.largeSold >= goal.target, failed: false };
    case 'perfect2':
      return { prog: svc.perfectsToday, target: goal.target, done: svc.perfectsToday >= goal.target, failed: false };
    case 'useAll':
      return { prog: svc.usedTypes.size, target: svc.state.toppings.length,
               done: svc.usedTypes.size >= svc.state.toppings.length, failed: false };
    case 'fast5':
      return { prog: svc.underPar, target: goal.target, done: svc.underPar >= goal.target, failed: false };
    case 'sides3':
      return { prog: svc.sidesSold || 0, target: goal.target, done: (svc.sidesSold || 0) >= goal.target, failed: false };
    case 'spec2':
      return { prog: svc.specialtiesToday || 0, target: goal.target, done: (svc.specialtiesToday || 0) >= goal.target, failed: false };
    case 'stamps2':
      return { prog: svc.stampsToday || 0, target: goal.target, done: (svc.stampsToday || 0) >= goal.target, failed: false };
    default:
      return { prog: 0, target: 1, done: false, failed: false };
  }
}
