// =====================================================================
// progress.js — the Chef XP / level spine. Pure queries over the
// unlock table, XP awards, and the level-up celebration (jingle,
// badge, NEW UNLOCK reveal card). Scenes call in; balance.js decides.
// =====================================================================

import { BAL } from './balance.js';
import { levelForXP, xpProgress, saveGame, gbp } from './state.js';
import { Juice } from './juice.js';
import { Sfx } from './audio.js';
import { Telemetry } from './telemetry.js';

// ---- unlock queries -------------------------------------------------------
// Anything not in the table is open from level 1.
export function unlockLevel(kind, id, tier = 1) {
  for (const u of BAL.UNLOCKS) {
    if (u.kind === kind && u.id === id && (u.tier || 1) === tier) return u.level;
  }
  return 1;
}

export function unlocked(state, kind, id, tier = 1) {
  return state.level >= unlockLevel(kind, id, tier);
}

export function unlocksForLevel(level) {
  return BAL.UNLOCKS.filter(u => u.level === level);
}

// the next level (> current) that carries at least one unlock — HUD teaser
export function nextUnlockLevel(state) {
  let best = null;
  for (const u of BAL.UNLOCKS) {
    if (u.level > state.level && (best === null || u.level < best)) best = u.level;
  }
  return best;
}

// ---- XP ---------------------------------------------------------------------
// XP for a served order: base + type/size bonuses, scaled hard by accuracy —
// a perfect order pays several times a sloppy one.
export function orderXP(ticket, res) {
  const X = BAL.XP;
  let base = X.BASE + X.PER_TYPE * ticket.toppings.length + (X.SIZE_BONUS[ticket.size] || 0);
  const acc = Math.max(0, Math.min(100, res.accuracy)) / 100;
  let xp = base * (X.ACC_FLOOR + (1 - X.ACC_FLOOR) * Math.pow(acc, X.ACC_CURVE));
  if (res.perfect) xp += X.PERFECT_BONUS;
  return Math.max(1, Math.round(xp));
}

// Award XP; returns { from, to, cash } — cash is the summed level-up bonus
// (already added to state.money). Caller owns the celebration.
export function awardXP(state, amount) {
  const from = state.level;
  state.xp += Math.max(0, Math.round(amount));
  const to = levelForXP(state.xp);
  let cash = 0;
  if (to > from) {
    for (let lvl = from + 1; lvl <= to; lvl++) {
      cash += BAL.XP.LEVEL_CASH_BASE + BAL.XP.LEVEL_CASH_PER * lvl;
    }
    cash *= state.meta ? state.meta.mult : 1;
    state.level = to;
    state.money += cash;
    state.lifetime.maxLevel = Math.max(state.lifetime.maxLevel, to);
    Telemetry.log('levelup', { toLevel: to });
  }
  return { from, to, cash };
}

// ---- the level-up moment ----------------------------------------------------
// Big beat: jingle + stamp, then the NEW UNLOCK reveal card (a DOM overlay in
// #ui-levelup). onDone fires when the player dismisses it. Marks seenUnlocks.
export function celebrateLevelUp(g, lv, onDone = null) {
  const state = g.state;
  Sfx.levelUp();
  Juice.stamp(640, 250, `CHEF LEVEL ${lv.to}!`, { color: '#c99bf0', stroke: '#3d2354', size: 54 });
  Juice.confetti(640, 240, 30);
  Juice.sparkle(640, 250, 14);
  if (lv.cash > 0) {
    Juice.floatText(640, 316, '+' + gbp(lv.cash) + ' bonus', { color: '#9fe07c', size: 24 });
    Juice.coinBurst(640, 280, g.hudMoneyPos.x, g.hudMoneyPos.y, 6, () => Sfx.coin());
  }

  // gather every unlock across the levels gained, unseen ones only
  const fresh = [];
  for (let l = lv.from + 1; l <= lv.to; l++) {
    for (const u of unlocksForLevel(l)) {
      const key = `${u.kind}:${u.id}:${u.tier || 1}`;
      if (!state.seenUnlocks[key]) {
        state.seenUnlocks[key] = true;
        fresh.push(u);
      }
    }
  }
  saveGame(state);

  if (!fresh.length) {
    if (onDone) Juice.tween({ dur: 1.2, onDone });
    return;
  }

  // reveal card — slides in after the stamp has had its beat
  const el = g.dom.levelup;
  const rows = fresh.map(u => `
    <div class="lu-row">
      <div class="lu-tag">${TAGS[u.kind] || 'NEW'}</div>
      <div class="lu-body"><b>${u.label}</b><span>${u.blurb}</span></div>
    </div>`).join('');
  el.innerHTML = `
    <div class="lu-card">
      <div class="lu-badge">★</div>
      <div class="lu-head">CHEF LEVEL ${lv.to}</div>
      <div class="lu-sub">NEW UNLOCK${fresh.length > 1 ? 'S' : ''}</div>
      ${rows}
      <button class="btn btn-big" id="lu-continue">BACK TO THE COUNTER ➜</button>
    </div>`;
  Juice.tween({
    dur: 0.9, onDone: () => {
      el.classList.remove('hidden');
      Sfx.fanfare();
      el.querySelector('#lu-continue').addEventListener('click', () => {
        Sfx.press();
        el.classList.add('hidden');
        el.innerHTML = '';
        if (onDone) onDone();
      });
    },
  });
}

const TAGS = {
  topping: 'TOPPING', sizeL: 'MENU', side: 'STATION', sauce: 'SAUCE',
  crust: 'CRUST', recipe: 'SPECIALTY', upgradeTier: 'EQUIPMENT',
  equipment: 'EQUIPMENT', grades: 'SUPPLY', event: 'EVENT',
  customer: 'CUSTOMERS', modifier: 'ORDERS', halfhalf: 'ORDERS',
  group: 'ORDERS', preorder: 'ORDERS', system: 'NEW SYSTEM',
  capstone: 'CAPSTONE',
};

// HUD helper: current-level progress as a 0..1 fraction
export function xpFrac(state) {
  const { into, need } = xpProgress(state);
  return need === Infinity ? 1 : Math.max(0, Math.min(1, into / need));
}
