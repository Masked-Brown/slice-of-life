// =====================================================================
// dev/admin.js — hidden admin/dev panel for fast testing.
//
// Gating: main.js only imports this module when the URL carries
// ?admin=1, and even then the panel attaches nothing to the DOM until
// Ctrl+Shift+A is pressed. A normal shared link never loads this file.
// Every session that loads it calls Telemetry.markDev(), so all events
// from dev sessions are tagged dev:true and filterable downstream.
//
// No gameplay content, no player-facing entry point, no balance edits.
// =====================================================================

import { BAL } from '../balance.js';
import { saveGame, addStock, gbp } from '../state.js';
import { Telemetry } from '../telemetry.js';
import { ShopScene } from '../scenes/shop.js';
import { bankDay } from '../scenes/dayEnd.js';
import { runAutoDay, finishServiceDay, restockForecast } from './autoday.js';

const REFILL_TO = 200;                 // "maxed" stock per ingredient
let game = null;
let panel = null;

function maxLevel() { return BAL.XP.CURVE.length + 1; }

// ---- pure state mutators (exported for the headless test) -----------------

// set level + the matching XP floor, and mark that level's unlocks as seen
// so reveal cards don't queue up a backlog later. The unlock table is pure
// level queries, so content gated at/below `lvl` is available immediately.
export function setLevel(state, lvl) {
  lvl = Math.max(1, Math.min(maxLevel(), Math.round(lvl) || 1));
  let floor = 0;
  for (let i = 0; i < lvl - 1; i++) floor += BAL.XP.CURVE[i];
  state.xp = floor;
  state.level = lvl;
  state.lifetime.maxLevel = Math.max(state.lifetime.maxLevel, lvl);
  for (const u of BAL.UNLOCKS) {
    if (u.level <= lvl) state.seenUnlocks[`${u.kind}:${u.id}:${u.tier || 1}`] = true;
  }
  return lvl;
}

// own the whole catalogue: max level (recipes/events/systems are level
// gates), every topping/sauce/crust/side, every equipment tier. Seasonal
// rotators stay with the calendar — they arrive via syncSeason as usual.
export function unlockEverything(state) {
  setLevel(state, maxLevel());
  for (const key of Object.keys(BAL.UPGRADES)) {
    state.upgrades[key] = BAL.UPGRADES[key].costs.length;
  }
  state.sizeL = true;
  for (const [key, t] of Object.entries(BAL.TOPPINGS)) {
    if (t.seasonal) continue;
    if (!state.toppings.includes(key)) {
      state.toppings.push(key);
      addStock(state, key, BAL.STOCK.NEW_TOPPING_INCLUDED);
    }
  }
  for (const key of Object.keys(BAL.SAUCES)) {
    if (!state.sauces.includes(key)) state.sauces.push(key);
  }
  for (const key of Object.keys(BAL.CRUSTS)) {
    if (!state.crusts.includes(key)) state.crusts.push(key);
  }
  for (const key of Object.keys(BAL.SIDES)) {
    if (!state.sides.includes(key)) {
      state.sides.push(key);
      addStock(state, BAL.SIDES[key].stockKey, 12);
    }
  }
}

// top every stocked ingredient up to REFILL_TO with fresh batches
export function refillAllStock(state) {
  const keys = [
    ...Object.keys(BAL.BASICS),
    ...state.toppings,
    ...state.sides.map(s => BAL.SIDES[s].stockKey),
  ];
  for (const key of keys) {
    const have = state.stock[key] | 0;
    if (have < REFILL_TO) addStock(state, key, REFILL_TO - have);
  }
}

// build the event value Force Next Event writes ({id[, target]} or null)
export function makeForcedEvent(state, id) {
  if (!id || id === 'none') return null;
  const ev = { id };
  if (id === 'shortage') {
    const targets = [
      ...state.toppings.filter(t => BAL.TOPPINGS[t] && !BAL.TOPPINGS[t].seasonal),
      ...Object.keys(BAL.BASICS),
    ];
    ev.target = targets[Math.floor(Math.random() * targets.length)];
  }
  return ev;
}

// ---- panel ------------------------------------------------------------------

export const Admin = {

  init(g) {
    game = g;
    Telemetry.markDev();               // this session's telemetry is dev data
    window.addEventListener('keydown', e => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault();
        this.toggle();
      }
    });
    console.info('[admin] dev panel armed — Ctrl+Shift+A to toggle');
  },

  toggle() {
    if (!panel) build();
    panel.hidden = !panel.hidden;
    if (!panel.hidden) renderStatus();
  },
};

function build() {
  panel = document.createElement('div');
  panel.id = 'dev-admin-panel';
  panel.hidden = true;
  Object.assign(panel.style, {
    position: 'fixed', top: '12px', right: '12px', zIndex: 9999,
    width: '330px', maxHeight: '86vh', overflowY: 'auto',
    background: 'rgba(24,12,10,0.96)', color: '#f6e7c9',
    border: '2px solid #ff6b52', borderRadius: '10px',
    font: '12px/1.5 ui-monospace, Menlo, Consolas, monospace',
    padding: '12px 14px', pointerEvents: 'auto',
  });
  panel.addEventListener('pointerdown', e => e.stopPropagation());

  const eventOptions = ['none', ...Object.keys(BAL.EVENTS.DEFS)]
    .map(id => `<option value="${id}">${id === 'none' ? '— none —'
      : `${BAL.EVENTS.DEFS[id].icon} ${BAL.EVENTS.DEFS[id].label}`}</option>`).join('');

  const inp = 'width:64px;font:inherit;background:#2c1a14;color:#f6e7c9;border:1px solid #7a4a3a;border-radius:4px;padding:2px 6px';
  const btn = 'cursor:pointer;font:inherit;padding:3px 9px';
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <b style="color:#ff6b52">ADMIN (dev only)</b>
      <span style="cursor:pointer;padding:0 6px" data-act="close">✕</span>
    </div>
    <div id="adm-status" style="color:#cbbda4;margin-bottom:8px"></div>
    <div style="display:grid;gap:7px">
      <div>day <input id="adm-day" type="number" min="1" style="${inp}">
        <button style="${btn}" data-act="set-day">GO</button>
        <span style="color:#cbbda4">→ fresh day start</span></div>
      <div>money <button style="${btn}" data-act="money-100">+£100</button>
        <button style="${btn}" data-act="money-1000">+£1000</button>
        <input id="adm-money" type="number" style="${inp}" placeholder="£">
        <button style="${btn}" data-act="money-custom">ADD</button></div>
      <div>chef level <input id="adm-level" type="number" min="1" max="${maxLevel()}" style="${inp}">
        <button style="${btn}" data-act="set-level">GO</button></div>
      <div><button style="${btn}" data-act="refill">REFILL ALL STOCK</button>
        <button style="${btn}" data-act="unlock-all">UNLOCK EVERYTHING</button></div>
      <div>next event <select id="adm-event" style="${inp};width:150px">${eventOptions}</select>
        <button style="${btn}" data-act="force-event">GO</button></div>
      <div><button style="${btn}" data-act="skip-day">SKIP TO DAY END</button></div>
      <div>fast-forward <input id="adm-ff" type="number" min="1" value="7" style="${inp}"> days
        <button style="${btn}" data-act="ff">GO</button></div>
      <div><button style="${btn}" data-act="dump">DUMP STATE TO CONSOLE</button></div>
    </div>
    <div style="margin-top:9px;color:#8a7a64">telemetry from this session is tagged dev:true</div>`;

  panel.addEventListener('click', e => {
    const act = e.target.dataset && e.target.dataset.act;
    if (!act) return;
    ACTIONS[act]();
    if (act !== 'close') renderStatus();
  });
  document.body.appendChild(panel);
}

function num(id) { return Number(panel.querySelector(id).value); }

const ACTIONS = {
  close: () => { panel.hidden = true; },

  'set-day': () => {
    const n = Math.max(1, Math.round(num('#adm-day')) || 1);
    const state = game.state;
    state.day = n;
    state.phase = 'service';
    state.nextDay = null;              // draw a fresh plan for the new day
    state.criticBoost = 0;
    if (n > 1) state.tutorialDone = true;
    saveGame(state);
    game.setScene('service');          // lands on the day board, no customers yet
  },

  'money-100': () => addMoney(100),
  'money-1000': () => addMoney(1000),
  'money-custom': () => addMoney(num('#adm-money')),

  'set-level': () => {
    setLevel(game.state, num('#adm-level'));
    saveGame(game.state);
    refreshScene();
  },

  refill: () => {
    refillAllStock(game.state);
    saveGame(game.state);
    refreshScene();
  },

  'unlock-all': () => {
    unlockEverything(game.state);
    saveGame(game.state);
    refreshScene();
  },

  'force-event': () => {
    const state = game.state;
    const ev = makeForcedEvent(state, panel.querySelector('#adm-event').value);
    const midService = game.sceneName === 'service' && game._svc && game._svc.dayStarted;
    if (!midService && state.nextDay && state.nextDay.day === state.day) {
      // the upcoming, not-yet-started day is already planned — swap directly
      state.nextDay.event = ev;
      delete state.nextDay.deliveryDone;   // a re-forced delivery pays out again
    } else {
      state.devForceEvent = ev;            // consumed by the next day-plan roll
    }
    saveGame(state);
    refreshScene();
  },

  'skip-day': () => fastForward(1),
  ff: () => fastForward(Math.max(1, Math.round(num('#adm-ff')) || 1)),

  dump: () => {
    console.log('[admin] state @ day %d:\n%s', game.state.day,
      JSON.stringify(game.state, null, 2));
  },
};

function addMoney(n) {
  if (!Number.isFinite(n) || n === 0) return;
  game.state.money += n;
  saveGame(game.state);
  refreshScene();
}

// auto-resolve N days at average performance. Intermediate days are banked
// and restocked headlessly; the final day goes through the real dayEnd
// scene so the receipt/analytics can be inspected.
function fastForward(n) {
  const g = game, state = g.state;
  // day already heading to the receipt — let the queued transition land
  // (g._svc lingers after scene exit, so only trust it while in service)
  if (g.sceneName === 'service' && g._svc && g._svc.dayEndQueued) return;
  for (let i = 0; i < n; i++) {
    let stats;
    if (i === 0 && g.sceneName === 'service' && g._svc && g._svc.dayStarted) {
      stats = finishServiceDay(g._svc);        // keep today's hand-played progress
    } else {
      stats = runAutoDay(state);
    }
    if (i === n - 1) {
      g.setScene('dayEnd', stats);             // banks the day, shows the receipt
    } else {
      bankDay(state, stats);
      restockForecast(state, stats.used);
    }
  }
}

// after a state edit: shop re-renders, a pre-start day board rebuilds,
// mid-service the HUD reads state every frame anyway
function refreshScene() {
  const g = game;
  if (g.sceneName === 'shop') {
    const m = g.dom.shop.querySelector('#shop-money');
    if (m) m.textContent = gbp(g.state.money);
    ShopScene._renderTab(g);
  } else if (g.sceneName === 'service' && g._svc && !g._svc.dayStarted) {
    g.setScene('service');
  }
}

function renderStatus() {
  const s = game.state;
  const el = panel.querySelector('#adm-status');
  el.textContent = `day ${s.day} · L${s.level} · ${gbp(s.money)} · ${s.phase} @ ${game.sceneName}`;
}
