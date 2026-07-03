// =====================================================================
// service.js — the in-day gameplay scene. One continuous counter POV:
// queue strip (top), pinned ticket (left, DOM), stations (center),
// topping bins (bottom), oven (right). Owns the order state machine.
// =====================================================================

import { BAL, ING } from '../balance.js';
import { clamp, lerp, rand, Juice, Ease, rr } from '../juice.js';
import { Sfx } from '../audio.js';
import { currentRating, pushRating, saveGame, gbp, refundStock, addStock } from '../state.js';
import { ensureNextDay, checkMilestones, goalProgress } from '../goals.js';
import { awardXP, celebrateLevelUp, xpFrac } from '../progress.js';
import { syncSeason, seasonActive, seasonDaysLeft } from '../seasons.js';
import { Music } from '../music.js';
import { Telemetry } from '../telemetry.js';
import { Orders } from '../stations/order.js';
import { Build, PIZZA_POS, TRAY, NEXT_BTN, BINS_Y } from '../stations/build.js';
import { Oven, OVEN } from '../stations/oven.js';
import { Serve } from '../stations/serve.js';
import { Sides } from '../stations/sides.js';

const OUTLINE = '#4a2e1d';
const PASS = { x: 794, y: 268 };
const BELL = { x: 918, y: 248, r: 24 };
const RAIL_Y = 170;

const STAGE_RAIL = ['dough', 'sauce', 'cheese', 'toppings', 'bake', 'serve'];
const RAIL_LABEL = { dough: 'DOUGH', sauce: 'SAUCE', cheese: 'CHEESE', toppings: 'TOPPINGS', bake: 'BAKE', serve: 'SERVE' };

// always-on one-liner under the rail — what to do right now
const STAGE_HINT = {
  dough: 'Click the dough size from the ticket',
  sauce: 'Hold over the pizza to pour — release in the gold band',
  cheese: 'Hold to sprinkle — release in the gold band',
  toppings: 'Drag pieces on — match the ×counts on the ticket',
  tooven: 'Slide the pizza into the oven',
  baking: 'Watch the meter — click to pull in the zone!',
  serve: 'Ring the bell!',
};

const TUTORIAL = {
  dough: { text: 'Read the ticket, then click the matching dough ball.', x: 410, y: 320, dir: 'up' },
  sauce: { text: 'Press & HOLD over the pizza to pour sauce. Release inside the gold band on the gauge, then press NEXT.', x: 480, y: 540, dir: 'up' },
  cheese: { text: 'Same again: HOLD to sprinkle cheese, release in the gold band.', x: 480, y: 540, dir: 'up' },
  toppings: { text: 'Drag toppings from the bins. Counts matter! Drag a piece off the pizza to remove it.', x: 560, y: 500, dir: 'down' },
  oven: { text: 'Slide the pizza into the oven, pull it out in the right zone — then ring the bell!', x: 760, y: 560, dir: 'up' },
};

let svc = null;

export const ServiceScene = {

  enter(g) {
    const state = g.state;
    const seasonChange = syncSeason(state);   // the calendar may have turned
    const plan = ensureNextDay(state);        // today's specials + daily goal + event

    // a surprise delivery lands before the shutters go up (once per day)
    if (plan.event && plan.event.id === 'delivery' && !plan.deliveryDone) {
      plan.deliveryDone = true;
      plan.deliveryGifts = [];
      const D = BAL.EVENTS.DEFS.delivery;
      const pool = state.toppings.slice();
      for (let i = 0; i < D.kinds && pool.length; i++) {
        const t = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        const n = D.unitsMin + Math.floor(Math.random() * (D.unitsMax - D.unitsMin + 1));
        addStock(state, t, n);
        plan.deliveryGifts.push({ t, n });
      }
      saveGame(state);
    }

    const evDef = plan.event ? BAL.EVENTS.DEFS[plan.event.id] : null;
    svc = {
      game: g, state,
      elapsed: 0,
      stage: 'idle',
      pizza: null,
      ticket: null,
      held: null,
      splats: [], crumbs: [],
      splatCount: 0,
      customers: [],
      pending: [],                            // filled when the day actually starts
      dayStarted: false,
      arrivalIn: BAL.DAYS.FIRST_ARRIVAL,
      served: 0, lost: 0, sales: 0, tipsTotal: 0, sats: [],
      usage: {}, toppingRevenue: {},          // per-topping analytics for the day
      emergencyCost: 0,                       // corner-shop dashes (basics at zero)
      lowWarned: {}, outWarned: {},           // one stock warning per topping per day
      goal: { ...plan.goal, hit: false, failed: false },
      bonusEarned: 0,                         // goal + milestone cash won today
      xpToday: 0,
      paused: false,                          // level-up card freezes the floor
      largeSold: 0, perfectsToday: 0, underPar: 0, usedTypes: new Set(),
      prepLeft: 0,
      ratingAtStart: currentRating(state),
      orderIndex: 0,
      shownMoney: state.money,
      _moneyTickCD: 0,
      pass: PASS,
      bellPress: false, bellHover: false,
      dayEndQueued: false,
      tutStep: null,
      // station callbacks
      onNewFront: c => this._onNewFront(c),
      onStormOut: (c, wasFront) => this._onStormOut(c, wasFront),
      onDoughDown: size => this._onDoughDown(size),
      onBakeStart: () => this._setTutorial('oven'),
      onBakeDone: (idx, dual) => this._onBakeDone(idx, dual),
      onOrderParkedInOven: slot => this._onOrderParkedInOven(slot),
      canOverlap: () => {
        const front = Orders.front(svc);
        return front && !front.group;          // group builds stay classic
      },
      onOrderDone: (res, opts) => this._onOrderDone(res, opts),
      onXP: (amount, x, y) => this._onXP(amount, x, y),
      onGroupNext: c => this._onGroupNext(c),
      advanceStage: () => this._advanceStage(),
    };
    svc.groupParked = [];
    svc.preorders = [];
    svc.event = plan.event || null;
    svc.eventDrain = evDef && evDef.patienceMult ? 1 / evDef.patienceMult : 1;
    svc.eventPay = (evDef && evDef.payMult) || 1;
    svc.eventReport = null;
    svc.seasonChange = seasonChange;
    svc.totalCustomers = 0;
    g._svc = svc;   // debug/testing handle

    Build.resetForOrder(svc);
    Sides.resetForOrder(svc);
    Oven.resetDay(svc);

    g.dom.hud.classList.remove('hidden');
    g.dom.ticket.classList.add('hidden');
    this._updateHUD(true);
    this._showDayBoard(g, plan);
  },

  // the moment the player hits START DAY: consume boosts, roll the queue
  _startDay() {
    const g = svc.game, state = svc.state;
    svc.prepLeft = state.boosts.prep ? BAL.BOOSTS.PREP_PIZZAS : 0;
    svc.pending = Orders.generateDay(state);
    // accepted phone pre-orders join mid-service at their due points
    svc.preorders = ((state.nextDay && state.nextDay.preorders) || [])
      .filter(o => o.accepted)
      .map(o => ({ ...o, injected: false, done: false, late: false }));
    svc.totalCustomers = svc.pending.length + svc.preorders.length;
    state.boosts = { prep: 0, ad: 0 };
    svc.dayStarted = true;
    g.dom.dayboard.classList.add('hidden');
    Telemetry.log('day_start', { customers: svc.totalCustomers, money: Math.round(state.money) });
    // the soundtrack reads the room
    const moods = { critic: 'tense', inspector: 'tense', rush: 'rush', festival: 'festive' };
    Music.setMood(svc.event ? (moods[svc.event.id] || 'cozy') : 'cozy');
    Juice.stamp(640, 300, `DAY ${state.day} — OPEN!`, { color: '#9fe07c', size: 52 });
    Sfx.bell();
  },

  // ---- day-start board: specials, goal, stock check ----------------------
  _showDayBoard(g, plan) {
    const state = g.state;
    const el = g.dom.dayboard;
    const specialRows = plan.specials.map(t => `
      <div class="db-row">
        <span class="tk-dot" style="background:${BAL.TOPPINGS[t].dot}"></span>
        <b>${BAL.TOPPINGS[t].label}</b>
        <span class="db-note">in demand · +${Math.round(BAL.SPECIALS.PRICE_PREMIUM * 100)}% on those orders</span>
      </div>`).join('');

    const lowAt = k => BAL.BASICS[k] ? BAL.STOCK.LOW_AT_BASICS : BAL.STOCK.LOW_AT;
    const stockKeys = [...Object.keys(BAL.BASICS), ...state.toppings];
    const chips = stockKeys.map(k => {
      const n = state.stock[k] | 0;
      const cls = n === 0 ? 'db-chip-out' : n <= lowAt(k) ? 'db-chip-low' : '';
      return `<span class="db-chip ${cls}">${ING(k).label} ×${n}</span>`;
    }).join('');
    const flagged = stockKeys.filter(k => (state.stock[k] | 0) <= lowAt(k));
    const stockNote = flagged.length
      ? `<div class="db-warn">⚠ Low on ${flagged.map(k => ING(k).label).join(', ')} — restock in the shop!</div>`
      : `<div class="db-ok">Stock looks good ✓</div>`;

    // phone pre-order offers: accept or wave off, right on the board
    const offers = plan.preorders || [];
    const offerRows = offers.map((o, i) => {
      const t = o.ticket;
      const desc = `${t.size} · ${t.toppings.map(w => `${w.count}× ${BAL.TOPPINGS[w.type].label}`).join(', ')}`;
      return `
        <div class="db-row db-po">
          <span class="db-po-desc">📞 <b>${desc}</b><span class="db-note"> · due after customer ${o.dueAfter} · +${Math.round(BAL.PREORDER.PREMIUM * 100)}%</span></span>
          <button class="btn db-po-btn ${o.accepted ? 'db-po-on' : ''}" data-po="${i}">${o.accepted ? '✓ BOOKED' : 'ACCEPT'}</button>
        </div>`;
    }).join('');

    // season banner (once the calendar has unlocked)
    const season = seasonActive(state);
    const sDef = season ? BAL.SEASONS.LIST[season] : null;
    const daysLeft = season ? seasonDaysLeft(state) : 0;
    const change = svc.seasonChange;
    const seasonRow = sDef ? `
      <div class="db-season" style="border-color:${sDef.accent}">
        ${sDef.icon} <b>${sDef.label}</b>
        ${change && change.entered === season
          ? `<span class="db-note"> — new season! ${sDef.toppings.map(t => BAL.TOPPINGS[t].label).join(' & ')} in the bins, ${BAL.RECIPES[sDef.recipe].name} on the menu</span>`
          : `<span class="db-note"> · ${daysLeft} day${daysLeft > 1 ? 's' : ''} left${daysLeft <= 2 ? ' — last chance this year!' : ''}</span>`}
      </div>` : '';

    // event announcement — the board never surprises you
    const ev = plan.event;
    const evDef = ev ? BAL.EVENTS.DEFS[ev.id] : null;
    const evRow = evDef ? `
      <div class="db-section">
        <div class="db-label">TODAY'S EVENT</div>
        <div class="db-event">${evDef.icon} <b>${evDef.label}</b> — ${
          ev.id === 'shortage'
            ? `the market ran dry on <b>${ING(ev.target).label}</b>: tonight's restock costs ×${evDef.priceMult}.`
            : ev.id === 'delivery' && plan.deliveryGifts
              ? `free stock arrived: ${plan.deliveryGifts.map(gft => `${ING(gft.t).label} ×${gft.n}`).join(', ')}. Use it before it turns!`
              : evDef.blurb}
        </div>
      </div>` : '';

    el.innerHTML = `
      <div class="dayboard">
        <div class="db-head">— DAY ${state.day} —</div>
        ${seasonRow}
        ${evRow}
        <div class="db-section">
          <div class="db-label">TODAY'S SPECIAL${plan.specials.length > 1 ? 'S' : ''}</div>
          ${specialRows}
        </div>
        <div class="db-section">
          <div class="db-label">DAILY GOAL</div>
          <div class="db-row"><b>🎯 ${plan.goal.desc}</b><span class="db-reward">+${gbp(plan.goal.reward)}</span></div>
        </div>
        ${offers.length ? `
        <div class="db-section">
          <div class="db-label">PHONE PRE-ORDERS — known tickets, fixed pickup, late delivery stings</div>
          ${offerRows}
        </div>` : ''}
        <div class="db-section">
          <div class="db-label">STOCK CHECK</div>
          <div class="db-chips">${chips}</div>
          ${stockNote}
        </div>
        <div class="db-buttons">
          ${state.day > 1 ? '<button class="btn" id="db-shop">⬅ BACK TO SHOP</button>' : ''}
          <button class="btn btn-big" id="db-start">START DAY ➜</button>
        </div>
      </div>`;
    el.classList.remove('hidden');

    el.querySelectorAll('.db-po-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const o = offers[Number(btn.dataset.po)];
        o.accepted = !o.accepted;
        btn.textContent = o.accepted ? '✓ BOOKED' : 'ACCEPT';
        btn.classList.toggle('db-po-on', o.accepted);
        saveGame(state);
        Sfx.press();
      });
    });

    el.querySelector('#db-start').addEventListener('click', () => {
      Sfx.press();
      this._startDay();
    });
    const shopBtn = el.querySelector('#db-shop');
    if (shopBtn) shopBtn.addEventListener('click', () => {
      Sfx.press();
      g.setScene('shop');
    });
  },

  exit(g) {
    Sfx.sauceStop(); Sfx.ovenStop();
    g.dom.hud.classList.add('hidden');
    g.dom.ticket.classList.add('hidden');
    g.dom.tutorial.classList.add('hidden');
    g.dom.dayboard.classList.add('hidden');
    g.dom.dayboard.innerHTML = '';
    g.dom.preorders.classList.add('hidden');
    g.dom.preorders.innerHTML = '';
    Music.setMood('cozy');
    Juice.clear();
    svc = null;
  },

  // ================= state machine =================

  _onNewFront(c) {
    svc.orderIndex++;
    svc.ticket = c.ticket;
    Build.resetForOrder(svc);
    Sides.resetForOrder(svc);
    svc.stage = 'dough';
    Orders.pinTicket(svc, c);
    Sfx.tick();
    this._setTutorial('dough');
  },

  // group order: next pizza on the same ticket — fresh build, fresh clock
  _onGroupNext(c) {
    svc.ticket = c.ticket;
    c.frontAt = svc.elapsed;       // par time restarts per pizza
    Build.resetForOrder(svc);
    svc.stage = 'dough';
    Orders.pinTicket(svc, c);
    Sfx.tick();
  },

  // accepted pre-orders walk in (front of the line) once their due point passes
  _checkPreorders() {
    if (!svc.preorders.length || !svc.dayStarted) return;
    const doneCount = svc.served + svc.lost;
    for (const o of svc.preorders) {
      if (o.injected || doneCount < o.dueAfter) continue;
      o.injected = true;
      const c = Orders.makePreorderCustomer(svc.state, o);
      svc.pending.unshift(c);
      svc.arrivalIn = Math.min(svc.arrivalIn, 0.4);
      Sfx.alarm();
      Juice.floatText(640, 116, '📞 Pre-order pickup!', { color: '#c9b6f2', size: 22 });
    }
  },

  _onDoughDown(size) {
    const grade = size === svc.ticket.size ? 'perfect' : 'off';
    this._gradePop(grade, PIZZA_POS.x, PIZZA_POS.y - svc.pizza.R - 24);
    svc.stage = 'sauce';
    this._setTutorial('sauce');
  },

  _advanceStage() {
    const grade = Build.evalStage(svc);
    const pz = svc.pizza;
    this._gradePop(grade, PIZZA_POS.x, PIZZA_POS.y - (pz ? pz.R : 100) - 24);
    svc._pouring = false;
    svc._wasInBand = false;        // fresh band tick for the next pour stage
    Sfx.sauceStop();
    // committing a pour stage consumes one unit of its basic (if any poured)
    if (svc.stage === 'sauce') {
      if (pz && pz.sauceCoverage > 0) Build.useBasic(svc, 'sauce');
      svc.stage = 'cheese'; this._setTutorial('cheese');
    } else if (svc.stage === 'cheese') {
      if (pz && pz.cheese.length > 0) Build.useBasic(svc, 'cheese');
      svc.stage = 'toppings'; this._setTutorial('toppings');
    } else if (svc.stage === 'toppings') { svc.stage = 'tooven'; this._setTutorial('oven'); }
  },

  _onBakeDone(idx, dual) {
    const po = svc.passOrder;
    const pz = po ? po.pizza : svc.pizza;
    const ticket = po && po.ticket ? po.ticket : svc.ticket;
    if (pz && ticket) {
      const order = ['raw', 'light', 'normal', 'well', 'burnt'];
      const grade = pz.bakeZone === 'burnt' ? 'burnt'
        : pz.bakeZone === ticket.bake ? 'perfect'
        : Math.abs(order.indexOf(pz.bakeZone) - order.indexOf(ticket.bake)) === 1 ? 'good' : 'off';
      if (grade === 'burnt') {
        Juice.floatText(PASS.x, PASS.y - 70, 'BURNT!', { color: '#ff6b52', size: 30 });
        Sfx.popOff();
      } else {
        this._gradePop(grade, PASS.x, PASS.y - 70);
      }
    }
    // single oven: classic lockstep. Dual: only a mid-group bake pauses us.
    if (!dual || svc.stage === 'baking') svc.stage = 'serve';
  },

  // dual oven: the order steps into the oven and its customer steps aside —
  // the counter frees up for whoever's next
  _onOrderParkedInOven(slot) {
    const front = Orders.front(svc);
    if (front) {
      slot.cust = front;
      Orders.sendToWaiting(svc, front);
    }
    Orders.unpinTicket(svc);
    svc.ticket = null;
    svc.stage = 'idle';
    Build.resetForOrder(svc);
    Sides.resetForOrder(svc);
  },

  _onOrderDone(res, opts = {}) {
    // daily-goal + milestone bookkeeping
    if (res) {
      const t = opts.ticket || svc.ticket;
      if (t && t.size === 'L') svc.largeSold++;
      if (res.perfect) svc.perfectsToday++;
      if (res.elapsed <= res.par) svc.underPar++;
      for (const k in svc.usage) if (svc.usage[k] > 0) svc.usedTypes.add(k);
      this._checkGoal();
      this._checkMilestones();
    }
    // a waiting customer was served off the pass — the build in progress
    // (someone else's order) carries on untouched
    if (opts.light) {
      this._updateHUD();
      return;
    }
    Orders.unpinTicket(svc);
    svc.ticket = null;
    svc.stage = 'idle';
    Build.resetForOrder(svc);
    Sides.clear(svc);
    svc.groupParked = [];
    this._updateHUD();
  },

  _checkGoal() {
    const goal = svc.goal;
    if (!goal || goal.hit || goal.failed) return;
    const p = goalProgress(goal, svc);
    if (p.failed) { goal.failed = true; return; }
    if (p.done) {
      goal.hit = true;
      svc.state.money += goal.reward;
      svc.bonusEarned += goal.reward;
      Telemetry.log('goal', { id: goal.id });
      const g = svc.game;
      Juice.stamp(640, 270, 'DAILY GOAL!', { color: '#9fe07c', size: 46 });
      Juice.floatText(640, 330, '+' + gbp(goal.reward), { color: '#ffd54a', size: 28 });
      Juice.coinBurst(640, 300, g.hudMoneyPos.x, g.hudMoneyPos.y, 8, () => Sfx.coin());
      Sfx.goalDing();
      this._onXP(BAL.XP.GOAL, 640, 356);
    }
  },

  _checkMilestones() {
    const hit = checkMilestones(svc.state);
    const g = svc.game;
    hit.forEach((def, i) => {
      svc.state.money += def.reward;
      svc.bonusEarned += def.reward;
      Telemetry.log('milestone', { id: def.id });
      Juice.tween({
        dur: 0.01, delay: 0.55 * i,
        onDone: () => {
          Juice.stamp(640, 215, `MILESTONE!`, { color: '#ffd54a', size: 42 });
          Juice.floatText(640, 268, def.label, { color: '#fff6e0', size: 22 });
          Juice.floatText(640, 300, '+' + gbp(def.reward), { color: '#9fe07c', size: 26 });
          Juice.coinBurst(640, 250, g.hudMoneyPos.x, g.hudMoneyPos.y, 10, () => Sfx.coin());
          Juice.confetti(640, 235, 22);
          Sfx.fanfare();
          this._onXP(BAL.XP.MILESTONE, 640, 330);
        },
      });
    });
  },

  // every XP grant flows through here: bank it, float it, catch level-ups
  _onXP(amount, x = 640, y = 330) {
    if (!svc) return;
    svc.xpToday += amount;
    const lv = awardXP(svc.state, amount);
    Juice.floatText(x, y, `+${amount} XP`, { color: '#c99bf0', size: 20 });
    const d = svc.game.dom.hudLevel;
    d.classList.remove('hud-level-hot'); void d.offsetWidth; d.classList.add('hud-level-hot');
    if (lv.to > lv.from) {
      svc.paused = true;                 // freeze the floor for the moment
      const g = svc.game;
      celebrateLevelUp(g, lv, () => { if (g._svc) g._svc.paused = false; });
    }
  },

  _onStormOut(c, wasFront) {
    svc.lost++;
    pushRating(svc.state, 1);
    if (c.regular) pushRating(svc.state, 1);   // letting a regular walk stings double
    if (wasFront) this._abortOrder();
    this._checkGoal();                         // a storm-out sinks 'no walk-outs'
    this._updateHUD();
  },

  // front customer left mid-order → trash the work in progress
  _abortOrder() {
    Sfx.sauceStop();
    // their pizza may be mid-bake (single oven, or a mid-group bake)
    for (const slot of svc.ovens) {
      if (slot.has && slot.ticket === svc.ticket) {
        slot.has = false;
        slot.pizza = null; slot.ticket = null; slot.cust = null; slot.side = null;
        if (!svc.ovens.some(s => s.has)) Sfx.ovenStop();
        Juice.tween({ target: slot, to: { door: 0 }, dur: 0.3 });
      }
    }
    // a pulled-but-unserved pizza on the pass (single mode) goes with them
    if (svc.passOrder && !svc.passOrder.cust) {
      const pp = svc.passOrder.pizza;
      svc.passOrder = null;
      if (pp && pp !== svc.pizza) {
        Juice.killTweensOf(pp);
        Juice.tween({ target: pp, to: { y: 800, scale: 0.4, rot: 1.2 }, dur: 0.5, ease: Ease.inCubic });
      }
    }
    Orders.unpinTicket(svc);
    svc.ticket = null;
    // a held piece goes back in its bin; pieces on the binned pizza are spent
    if (svc.held) {
      refundStock(svc.state, svc.held.type, svc.held.n);
    }
    const pz = svc.pizza;
    if (pz) {
      for (const t of pz.toppings) svc.usage[t.type] = (svc.usage[t.type] || 0) + 1;
      Juice.killTweensOf(pz);
      pz.state = 'fly';
      Juice.tween({
        target: pz, to: { y: 800, scale: 0.5, rot: 1.2 }, dur: 0.5, ease: Ease.inCubic,
        onDone: () => { if (svc.pizza === pz) svc.pizza = null; },
      });
    }
    svc.held = null;
    Sides.clear(svc);
    // parked group pizzas hit the floor with their owner gone
    for (const parked of svc.groupParked) {
      Juice.killTweensOf(parked);
      Juice.tween({
        target: parked, to: { y: 800, rot: 1.4, scale: 0.3 }, dur: 0.5, ease: Ease.inCubic,
      });
    }
    svc.groupParked = [];
    svc.stage = 'idle';
  },

  _gradePop(grade, x, y) {
    const cfg = {
      perfect: { text: 'Perfect!', color: '#9fe07c', sfx: () => Sfx.popPerfect() },
      good: { text: 'Good', color: '#f5b942', sfx: () => Sfx.popGood() },
      off: { text: 'Off…', color: '#ff8a70', sfx: () => Sfx.popOff() },
      burnt: { text: 'BURNT!', color: '#ff6b52', sfx: () => Sfx.popOff() },
    }[grade] || { text: grade, color: '#fff', sfx: () => {} };
    Juice.floatText(x, y, cfg.text, { color: cfg.color, size: 26 });
    cfg.sfx();
  },

  // ================= update =================

  update(g, dt) {
    if (!svc) return;
    // level-up card up: the whole floor holds its breath (patience included)
    if (svc.paused) { this._updateHUD(); return; }
    svc.elapsed += dt;

    Orders.update(svc, dt);
    Build.update(svc, dt);
    Sides.update(svc, dt);
    Oven.update(svc, dt);
    this._checkPreorders();

    // a pre-order at the counter taps their watch as the grace runs out
    const front = Orders.front(svc);
    if (front && front.preorder && !front._graceWarned
        && svc.elapsed - front.frontAt > BAL.PREORDER.GRACE - 6) {
      front._graceWarned = true;
      Sfx.alarm();
      Juice.floatText(front.x, front.y - 112, 'They’re waiting!', { color: '#ff8a70', size: 17 });
    }

    this._updateHUD();
    this._updateCursor(g);
    this._checkDayEnd(g);
  },

  _checkDayEnd(g) {
    if (svc.dayEndQueued || svc.paused) return;
    if (svc.pending.length === 0 && svc.customers.length === 0 && svc.stage === 'idle'
        && (svc.served + svc.lost) >= svc.totalCustomers && svc.totalCustomers > 0) {
      svc.dayEndQueued = true;
      this._checkGoal();           // all-day goals (no walk-outs, 90% sat) settle now
      // events without a mid-day verdict get their report written here
      if (svc.event && !svc.eventReport) {
        const reports = {
          rush: `Rush hour survived — ${svc.served} served at surge prices.`,
          festival: `Festival day! ${svc.served} fed, ${svc.sidesSold || 0} sides gone.`,
          slow: 'A slow, deep morning — big orders, easy tempers.',
          shortage: 'You cooked through the shortage.',
          delivery: 'The surprise delivery got put to work.',
          critic: 'The critic never made it to a table.',
          nonna: 'Nonna watched from the doorway but the queue swallowed her visit.',
          inspector: 'The inspector left without filing — lucky.',
        };
        svc.eventReport = reports[svc.event.id] || null;
      }
      const stats = {
        day: svc.state.day,
        served: svc.served, lost: svc.lost,
        sales: svc.sales, tips: svc.tipsTotal,
        satAvg: svc.sats.length ? svc.sats.reduce((a, b) => a + b, 0) / svc.sats.length : 0,
        ratingBefore: svc.ratingAtStart,
        ratingAfter: currentRating(svc.state),
        used: svc.usage, toppingRevenue: svc.toppingRevenue,
        bonus: svc.bonusEarned,
        emergency: svc.emergencyCost,
        gradeUplift: svc.gradeUplift || 0,
        gradeUnits: svc.gradeUnits || {},
        sideRevenue: svc.sideRevenue || {},
        sidesSold: svc.sidesSold || 0,
        preordersTaken: svc.preorders.length,
        preordersDone: svc.preordersDone || 0,
        preordersLate: svc.preordersLate || 0,
        event: svc.event ? svc.event.id : null,
        eventReport: svc.eventReport,
        xpToday: svc.xpToday,
        goalHit: !!svc.goal.hit,
        goalDesc: svc.goal.desc, goalReward: svc.goal.reward,
      };
      Juice.tween({ dur: 1.1, onDone: () => g.setScene('dayEnd', stats) });
    }
  },

  _updateHUD(force) {
    const g = svc.game, s = svc.state;
    const d = g.dom;

    // money ticks up rather than jumping
    const target = s.money;
    if (Math.abs(svc.shownMoney - target) > 0.005) {
      svc.shownMoney += (target - svc.shownMoney) * 0.12;
      if (Math.abs(svc.shownMoney - target) < 0.05) svc.shownMoney = target;
      svc._moneyTickCD -= 1;
      if (svc._moneyTickCD <= 0) { svc._moneyTickCD = 4; Sfx.tick(); }
      d.hudMoney.classList.add('hud-money-hot');
    } else {
      d.hudMoney.classList.remove('hud-money-hot');
    }

    const moneyTxt = gbp(svc.shownMoney);
    if (force || d.hudMoney.textContent !== moneyTxt) d.hudMoney.textContent = moneyTxt;

    const dayTxt = 'Day ' + s.day;
    if (force || d.hudDay.textContent !== dayTxt) d.hudDay.textContent = dayTxt;

    const progTxt = `Served ${svc.served + svc.lost} / ${svc.totalCustomers}`;
    if (force || d.hudProgress.textContent !== progTxt) d.hudProgress.textContent = progTxt;

    // daily goal pill
    if (svc.goal) {
      const p = goalProgress(svc.goal, svc);
      const goalTxt = svc.goal.hit ? `🎯 ${svc.goal.short} ✓`
        : svc.goal.failed ? `🎯 ${svc.goal.short} ✗`
        : `🎯 ${svc.goal.short} · ${p.prog}/${p.target}`;
      if (force || d.hudGoal.textContent !== goalTxt) {
        d.hudGoal.textContent = goalTxt;
        d.hudGoal.classList.toggle('hud-goal-done', svc.goal.hit);
        d.hudGoal.classList.toggle('hud-goal-failed', svc.goal.failed);
      }
    }

    const rating = currentRating(s);
    d.hudStars.style.width = (rating / 5 * 100) + '%';
    const rTxt = rating.toFixed(1);
    if (force || d.hudRatingNum.textContent !== rTxt) d.hudRatingNum.textContent = rTxt;

    // chef level pill + XP fill
    const lvTxt = 'LV ' + s.level;
    if (force || d.hudLevelNum.textContent !== lvTxt) d.hudLevelNum.textContent = lvTxt;
    d.hudXpFill.style.width = Math.round(xpFrac(s) * 100) + '%';

    // pre-order due strip
    if (svc.preorders.length) {
      const html = svc.preorders.map(o => {
        const t = o.ticket;
        const what = `${t.size} ${t.toppings.map(w => BAL.TOPPINGS[w.type].label).join('/')}`;
        if (o.done) return `<div class="po-pill ${o.late ? 'po-late' : 'po-done'}">📞 ${what} ${o.late ? '· late' : '✓'}</div>`;
        if (o.injected) return `<div class="po-pill po-now">📞 ${what} — HERE NOW!</div>`;
        return `<div class="po-pill">📞 ${what} · after #${o.dueAfter}</div>`;
      }).join('');
      if (d.preorders.innerHTML !== html) d.preorders.innerHTML = html;
      d.preorders.classList.remove('hidden');
    } else {
      d.preorders.classList.add('hidden');
    }
  },

  _updateCursor(g) {
    let cur = 'default';
    if (svc.stage === 'sauce' || svc.stage === 'cheese' || svc.held ||
        (svc.pizza && svc.pizza.state === 'drag')) cur = 'none';
    else if (svc._nextHover || svc._binHover || svc._doughHover || svc.bellHover ||
             (svc.stage === 'baking') || (svc.stage === 'tooven')) cur = 'pointer';
    if (g.canvas.style.cursor !== cur) g.canvas.style.cursor = cur;
  },

  // ================= tutorial (day 1 only) =================

  _setTutorial(step) {
    const g = svc.game;
    if (svc.state.day !== 1 || svc.state.tutorialDone || svc.orderIndex > 1) {
      g.dom.tutorial.classList.add('hidden');
      return;
    }
    svc.tutStep = step;
    const t = TUTORIAL[step];
    if (!t) { g.dom.tutorial.classList.add('hidden'); return; }
    const el = g.dom.tutorial;
    el.innerHTML = `<div class="tut-bubble tut-${t.dir}">${t.text}</div>`;
    el.style.left = t.x + 'px';
    el.style.top = t.y + 'px';
    el.classList.remove('hidden');
  },

  // ================= pointer =================

  onDown(g, x, y) {
    if (!svc || svc.dayEndQueued || svc.paused) return;

    // the bell rings whenever a finished pizza sits on the pass
    if (this._bellActive() && Math.hypot(x - BELL.x, y - BELL.y) < BELL.r + 10) {
      svc.bellPress = true;
      Sfx.press();
      return;
    }
    if (svc.stage === 'baking') {
      if (Oven.ovenHit(x, y) || Oven.mouthHit(x, y)) {
        const idx = Oven.slotAt(svc, x);
        if (svc.ovens[idx] && svc.ovens[idx].has) Oven.pull(svc, idx);
        return;
      }
      return; // while baking nothing else works — the tension IS the timing
    }
    if (svc.stage === 'tooven' && svc.pizza && svc.pizza.state === 'counter'
        && Oven.ovenHit(x, y) && Oven.freeSlot(svc) >= 0) {
      // clicking the oven walks the pizza in (drag also works)
      Juice.tween({
        target: svc.pizza, to: { x: OVEN.x + OVEN.w / 2, y: OVEN.y + OVEN.h * 0.6 },
        dur: 0.25, ease: Ease.outCubic, onDone: () => Oven.insert(svc),
      });
      return;
    }
    // dual oven: pull a done slot any time (the counter keeps working)
    if (Oven.dual(svc) && Oven.ovenHit(x, y)) {
      const idx = Oven.slotAt(svc, x);
      if (svc.ovens[idx] && svc.ovens[idx].has) {
        Oven.pull(svc, idx);
        return;
      }
    }
    if (Sides.onDown(svc, x, y)) return;
    Build.onDown(svc, x, y);
  },

  // bell is live when a pizza waits on the pass (single mode also gates on
  // the classic serve stage so nothing changes for early-game hands)
  _bellActive() {
    if (!svc.passOrder) return false;
    return Oven.dual(svc) || svc.stage === 'serve';
  },

  onMove(g, x, y) {
    if (!svc) return;
    Build.onMove(svc, x, y);

    const overBell = this._bellActive() && Math.hypot(x - BELL.x, y - BELL.y) < BELL.r + 10;
    if (overBell && !svc.bellHover) Sfx.tick();
    svc.bellHover = overBell;

    // dragging the pizza over the oven mouth slides it in
    if (svc.stage === 'tooven' && svc.pizza && svc.pizza.state === 'drag'
        && Oven.mouthHit(x, y) && Oven.freeSlot(svc) >= 0) {
      Oven.insert(svc);
    }
  },

  onUp(g, x, y) {
    if (!svc) return;
    if (svc.bellPress) {
      svc.bellPress = false;
      if (Math.hypot(x - BELL.x, y - BELL.y) < BELL.r + 14 && this._bellActive()) {
        // tutorial completes on the first successful serve
        if (svc.state.day === 1 && !svc.state.tutorialDone) {
          svc.state.tutorialDone = true;
          g.dom.tutorial.classList.add('hidden');
          saveGame(svc.state);
        }
        Serve.serveNow(svc);
      }
      return;
    }
    Sides.onUp(svc);
    Build.onUp(svc, x, y);
  },

  // ================= render =================

  render(g, ctx) {
    if (!svc) return;
    this._renderBackground(g, ctx);
    Orders.render(svc, ctx);
    this._renderCounter(ctx);
    this._renderRail(ctx);
    Oven.render(svc, ctx);
    Sides.render(svc, ctx);
    this._renderPass(ctx);
    for (const parked of svc.groupParked) Build.drawPizza(ctx, parked);
    if (svc.passOrder && svc.passOrder.pizza !== svc.pizza) {
      Build.drawPizza(ctx, svc.passOrder.pizza);
    }
    Build.render(svc, ctx);
    if (svc.stage === 'idle' && svc.customers.length === 0 && svc.pending.length > 0) {
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.2 * Math.sin(svc.elapsed * 2);
      ctx.fillStyle = '#fff6e0';
      ctx.font = '800 20px Trebuchet MS, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Customers incoming…', 640, 100);
      ctx.restore();
    }
  },

  _renderBackground(g, ctx) {
    const tier = svc.state.upgrades.decor;
    const ti = Math.min(tier, 3);           // palette caps; higher tiers add props
    const W = g.W;

    // wall behind the queue — warm two-tone with depth
    const wallColors = ['#e8d5ae', '#f2d9b0', '#f6e0bb', '#fbe7c4'];
    const wallLo = ['#dcc497', '#e6c898', '#eccfa2', '#f1d6ab'];
    const wg = ctx.createLinearGradient(0, 0, 0, 152);
    wg.addColorStop(0, wallColors[ti]);
    wg.addColorStop(1, wallLo[ti]);
    ctx.fillStyle = wg;
    ctx.fillRect(0, 0, W, 152);

    // picture rail
    ctx.fillStyle = 'rgba(74,46,29,0.18)';
    ctx.fillRect(0, 140, W, 4);

    // accent paint band grows fancier with decor tier
    if (tier >= 1) {
      ctx.fillStyle = '#e2725b';
      ctx.fillRect(0, 0, W, 16);
    }
    if (tier >= 3) {
      ctx.fillStyle = '#c9574b';
      for (let x = 0; x < W; x += 36) {
        ctx.beginPath();
        ctx.moveTo(x, 16); ctx.lineTo(x + 18, 34); ctx.lineTo(x + 36, 16);
        ctx.closePath(); ctx.fill();
      }
    }

    ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE;

    // window onto the street: daylight, rooftops, passers-by, the season
    const winSeason = seasonActive(svc.state);
    ctx.save();
    ctx.fillStyle = '#9c6b3c';
    rr(ctx, 96, 26, 168, 104, 10); ctx.fill(); ctx.stroke();
    rr(ctx, 106, 36, 148, 84, 6);
    ctx.save();
    ctx.clip();
    const skyCols = {
      spring: ['#b8dcec', '#e8f2f0'], summer: ['#9ed3f0', '#e0f2fa'],
      spooky: ['#8f86b8', '#d9c2b0'], winter: ['#c2ccdc', '#eef2f7'],
    }[winSeason] || ['#aed7ec', '#dceef7'];
    const sky = ctx.createLinearGradient(0, 36, 0, 120);
    sky.addColorStop(0, skyCols[0]);
    sky.addColorStop(1, skyCols[1]);
    ctx.fillStyle = sky;
    ctx.fillRect(106, 36, 148, 84);
    // sun + drifting cloud
    ctx.fillStyle = winSeason === 'spooky' ? '#f2e3c0' : '#ffe9a8';
    ctx.beginPath(); ctx.arc(232, 54, winSeason === 'summer' ? 15 : 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const cx = 120 + ((svc.elapsed * 3) % 180);
    for (const [dx, r] of [[-14, 8], [0, 11], [14, 8]]) {
      ctx.beginPath(); ctx.arc(cx + dx, 62, r, 0, Math.PI * 2); ctx.fill();
    }
    // rooftop silhouettes
    ctx.fillStyle = winSeason === 'winter' ? '#c8ccd8' : '#b98a64';
    ctx.beginPath();
    ctx.moveTo(106, 120);
    ctx.lineTo(106, 96); ctx.lineTo(130, 84); ctx.lineTo(154, 96);
    ctx.lineTo(154, 104); ctx.lineTo(176, 104); ctx.lineTo(176, 88);
    ctx.lineTo(204, 76); ctx.lineTo(232, 88); ctx.lineTo(232, 120);
    ctx.closePath(); ctx.fill();
    // street life: little silhouettes stroll past on offset cycles
    for (const [period, phase, dir, tone] of [[17, 0, 1, 0.55], [23, 9, -1, 0.4]]) {
      const k = ((svc.elapsed + phase) % period) / 4.4;
      if (k < 1) {
        const wx = dir > 0 ? 100 + k * 160 : 260 - k * 160;
        const bobW = Math.sin(svc.elapsed * 9) * 1.5;
        ctx.fillStyle = `rgba(74,52,38,${tone})`;
        ctx.beginPath(); ctx.arc(wx, 102 + bobW, 5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(wx - 5, 120); ctx.quadraticCurveTo(wx, 104 + bobW, wx + 5, 120);
        ctx.closePath(); ctx.fill();
      }
    }
    // seasonal weather in the glass: petals / snow / a bat
    if (winSeason === 'spring' || winSeason === 'winter') {
      ctx.fillStyle = winSeason === 'spring' ? 'rgba(240,170,200,0.8)' : 'rgba(255,255,255,0.9)';
      for (let i = 0; i < 7; i++) {
        const fx = 112 + ((i * 53.7 + svc.elapsed * (winSeason === 'spring' ? 9 : 6)) % 140);
        const fy = 40 + ((i * 31.3 + svc.elapsed * (12 + i)) % 78);
        ctx.beginPath(); ctx.arc(fx, fy, winSeason === 'spring' ? 2.2 : 1.8, 0, Math.PI * 2); ctx.fill();
      }
    } else if (winSeason === 'spooky') {
      const bk = (svc.elapsed % 11) / 5;
      if (bk < 1) {
        const bx = 110 + bk * 140, by = 52 + Math.sin(bk * 9) * 8;
        const flap = Math.sin(svc.elapsed * 16) * 4;
        ctx.fillStyle = 'rgba(40,30,50,0.8)';
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(bx - 7, by - 5 - flap, bx - 12, by);
        ctx.quadraticCurveTo(bx - 7, by + 1, bx, by + 2);
        ctx.quadraticCurveTo(bx + 7, by + 1, bx + 12, by);
        ctx.quadraticCurveTo(bx + 7, by - 5 - flap, bx, by);
        ctx.fill();
      }
    }
    ctx.restore();
    rr(ctx, 106, 36, 148, 84, 6); ctx.stroke();
    // crossbars
    ctx.fillStyle = '#9c6b3c';
    ctx.fillRect(178, 36, 5, 84);
    ctx.fillRect(106, 74, 148, 5);
    ctx.restore();

    // warm pool of light spilling from the window onto the counter edge
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = '#ffdf9e';
    ctx.beginPath();
    ctx.moveTo(106, 130);
    ctx.lineTo(254, 130);
    ctx.lineTo(300, 176);
    ctx.lineTo(60, 176);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE;

    // hanging menu board (swings a breath on its strings)
    ctx.save();
    ctx.translate(450, 0);
    ctx.rotate(Math.sin(svc.elapsed * 0.9) * 0.012);
    ctx.translate(-450, 0);
    ctx.strokeStyle = '#8a6f4f'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(396, 0); ctx.lineTo(404, 26); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(504, 0); ctx.lineTo(496, 26); ctx.stroke();
    ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE;
    ctx.fillStyle = '#4a3526';
    rr(ctx, 380, 26, 140, 74, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3a2a1e';
    rr(ctx, 388, 34, 124, 58, 5); ctx.fill();
    ctx.fillStyle = '#fdf3dd';
    ctx.font = '900 17px Trebuchet MS, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('M E N U', 450, 50);
    // chalk pizza doodle + squiggles
    ctx.strokeStyle = 'rgba(253,243,221,0.75)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(412, 74, 10, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(404, 67); ctx.lineTo(420, 81); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(430, 70); ctx.lineTo(496, 70); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(430, 80); ctx.lineTo(482, 80); ctx.stroke();
    ctx.restore();

    // wooden shelf above the oven, stacked with supplies
    ctx.save();
    ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE;
    // jars of passata
    for (const jx of [968, 1000]) {
      ctx.fillStyle = '#c23a1c';
      rr(ctx, jx, 92, 24, 34, 5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#8d8d96';
      rr(ctx, jx + 2, 86, 20, 9, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(jx + 4, 98, 5, 22);
    }
    // olive jar
    ctx.fillStyle = '#5d6e3a';
    rr(ctx, 1036, 96, 22, 30, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#8d8d96';
    rr(ctx, 1038, 90, 18, 9, 3); ctx.fill(); ctx.stroke();
    // oil bottle
    ctx.fillStyle = '#d9a429';
    rr(ctx, 1072, 84, 14, 42, 5); ctx.fill(); ctx.stroke();
    rr(ctx, 1075, 72, 8, 14, 3); ctx.fill(); ctx.stroke();
    // flour sack
    ctx.fillStyle = '#efe3c8';
    ctx.beginPath();
    ctx.moveTo(1106, 126);
    ctx.quadraticCurveTo(1102, 92, 1112, 86);
    ctx.quadraticCurveTo(1124, 78, 1138, 86);
    ctx.quadraticCurveTo(1148, 92, 1144, 126);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#a3886a';
    ctx.font = '900 11px Trebuchet MS, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('00', 1125, 110);
    // stack of pizza boxes
    ctx.fillStyle = '#d9b988';
    for (let i = 0; i < 3; i++) {
      rr(ctx, 1166, 110 - i * 13, 58, 12, 3); ctx.fill(); ctx.stroke();
    }
    // the shelf board itself
    ctx.fillStyle = '#8a5a34';
    rr(ctx, 944, 124, 292, 12, 5); ctx.fill(); ctx.stroke();
    // brackets
    ctx.fillStyle = '#6e4226';
    ctx.fillRect(960, 136, 8, 10);
    ctx.fillRect(1212, 136, 8, 10);
    ctx.restore();

    // string lights from decor tier 2
    if (tier >= 2) {
      ctx.save();
      ctx.strokeStyle = 'rgba(74,46,29,0.5)'; ctx.lineWidth = 2.5;
      for (let seg = 0; seg < 3; seg++) {
        const x0 = 280 + seg * 230, x1 = x0 + 230;
        ctx.beginPath();
        ctx.moveTo(x0, 8);
        ctx.quadraticCurveTo((x0 + x1) / 2, 34, x1, 8);
        ctx.stroke();
        for (let i = 1; i < 6; i++) {
          const t = i / 6;
          const lx = lerp(x0, x1, t);
          const ly = 8 + 2 * (34 - 8) * t * (1 - t) + 5;
          const tw = 0.7 + 0.3 * Math.sin(svc.elapsed * 2 + seg * 2 + i);
          ctx.fillStyle = `rgba(255,213,74,${0.55 + 0.45 * tw})`;
          ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
      ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE;
    }

    // door (far left) — where customers come and go
    ctx.fillStyle = '#8a5a34';
    rr(ctx, 6, 18, 64, 134, 8);
    ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE; ctx.stroke();
    ctx.fillStyle = '#b3d4e8';
    rr(ctx, 14, 28, 48, 56, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8c46a';
    ctx.beginPath(); ctx.arc(60, 102, 4, 0, Math.PI * 2); ctx.fill();

    // decor: plants & art
    if (tier >= 2) {
      this._drawPlant(ctx, 116, 134);
      ctx.fillStyle = '#9c6b3c';
      rr(ctx, 580, 30, 70, 52, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f6e7c9';
      rr(ctx, 586, 36, 58, 40, 4); ctx.fill();
      ctx.fillStyle = '#e2725b';
      ctx.beginPath(); ctx.arc(615, 56, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f7d774';
      ctx.beginPath(); ctx.arc(615, 56, 8, 0, Math.PI * 2); ctx.fill();
    }
    if (tier >= 3) this._drawPlant(ctx, 905, 134);

    // tier 4+: the gallery wall — extra frames, warmer light
    if (tier >= 4) {
      ctx.save();
      ctx.lineWidth = 3.5; ctx.strokeStyle = OUTLINE;
      for (const [fx, fy, fw, fh, art] of [[700, 34, 52, 40, '#7bbf5e'], [770, 44, 40, 34, '#5da9d6'], [826, 30, 46, 44, '#d678c0']]) {
        ctx.fillStyle = '#9c6b3c';
        rr(ctx, fx, fy, fw, fh, 5); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#f6e7c9';
        rr(ctx, fx + 5, fy + 5, fw - 10, fh - 10, 3); ctx.fill();
        ctx.fillStyle = art;
        ctx.beginPath(); ctx.arc(fx + fw / 2, fy + fh / 2, Math.min(fw, fh) * 0.22, 0, Math.PI * 2); ctx.fill();
      }
      // warm wash over the whole wall
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = '#ffb84d';
      ctx.fillRect(0, 0, W, 152);
      ctx.restore();
    }
    // seasonal dressing: a bunting garland in the season's colour; festival
    // days double up with party flags
    const season = seasonActive(svc.state);
    const festival = svc.event && svc.event.id === 'festival';
    if (season || festival) {
      const accent = festival ? '#e2725b' : BAL.SEASONS.LIST[season].accent;
      ctx.save();
      ctx.strokeStyle = 'rgba(74,46,29,0.45)';
      ctx.lineWidth = 2;
      for (let seg = 0; seg < 4; seg++) {
        const x0 = 40 + seg * 310, x1 = x0 + 300;
        ctx.beginPath();
        ctx.moveTo(x0, 4);
        ctx.quadraticCurveTo((x0 + x1) / 2, 26, x1, 4);
        ctx.stroke();
        for (let i = 1; i < 8; i++) {
          const k = i / 8;
          const fx = lerp(x0, x1, k);
          const fy = 4 + 2 * 22 * k * (1 - k) + 3;
          ctx.fillStyle = festival && i % 2 ? '#f5b942' : accent;
          ctx.beginPath();
          ctx.moveTo(fx - 6, fy); ctx.lineTo(fx + 6, fy); ctx.lineTo(fx, fy + 11);
          ctx.closePath(); ctx.fill();
        }
      }
      ctx.restore();
      ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE;
    }

    // tier 6: the landmark — a little chandelier and a brass plaque
    if (tier >= 6) {
      ctx.save();
      ctx.strokeStyle = '#8a6f4f'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(650, 0); ctx.lineTo(650, 22); ctx.stroke();
      ctx.lineWidth = 3.5; ctx.strokeStyle = OUTLINE;
      ctx.fillStyle = '#c9a227';
      ctx.beginPath(); ctx.arc(650, 34, 13, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      for (const dx of [-16, 0, 16]) {
        const tw = 0.6 + 0.4 * Math.sin(svc.elapsed * 3 + dx);
        ctx.fillStyle = `rgba(255,222,120,${0.5 + 0.5 * tw})`;
        ctx.beginPath(); ctx.arc(650 + dx, 40, 4.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#c9a227';
      rr(ctx, 292, 96, 66, 26, 5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#4a2e1d';
      ctx.font = '900 9px Trebuchet MS, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('EST. DAY 1', 325, 109);
      ctx.restore();
    }
  },

  _drawPlant(ctx, x, y) {
    ctx.save();
    ctx.fillStyle = '#7bbf5e';
    for (const [dx, dy, r] of [[-10, -26, 12], [8, -30, 11], [0, -42, 12], [-2, -22, 10]]) {
      ctx.beginPath(); ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.lineWidth = 3.5; ctx.strokeStyle = OUTLINE;
    ctx.fillStyle = '#c96f4a';
    ctx.beginPath();
    ctx.moveTo(x - 16, y - 14); ctx.lineTo(x + 16, y - 14);
    ctx.lineTo(x + 11, y + 12); ctx.lineTo(x - 11, y + 12);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  },

  _renderCounter(ctx) {
    const tier = svc.state.upgrades.decor;
    // counter front edge (the divider between queue and workspace)
    ctx.fillStyle = tier >= 3 ? '#b5764a' : '#a96b35';
    ctx.fillRect(0, 152, BAL.W, 26);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(0, 172, BAL.W, 6);
    // worktop
    const top = ctx.createLinearGradient(0, 178, 0, BAL.H);
    top.addColorStop(0, tier >= 3 ? '#d6975c' : '#c98a4b');
    top.addColorStop(1, tier >= 3 ? '#c4854c' : '#b67a3e');
    ctx.fillStyle = top;
    ctx.fillRect(0, 178, BAL.W, BAL.H - 178);
    // subtle wood grain
    ctx.strokeStyle = 'rgba(74,46,29,0.12)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      const y = 220 + i * 74;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(320, y + 12, 760, y - 10, BAL.W, y + 6);
      ctx.stroke();
    }
    if (tier >= 1) { // tile splash along the counter edge
      ctx.fillStyle = '#fdf3dd';
      for (let x = 0; x < BAL.W; x += 42) {
        rr(ctx, x + 3, 181, 36, 14, 4); ctx.fill();
      }
    }
    if (tier >= 5) { // terrazzo flecks + brass edge strip
      ctx.save();
      for (let i = 0; i < 60; i++) {
        const fx = (i * 137.3) % BAL.W;
        const fy = 210 + (i * 83.7) % (BAL.H - 240);
        ctx.fillStyle = ['rgba(253,243,221,0.25)', 'rgba(226,114,91,0.2)', 'rgba(93,169,214,0.16)'][i % 3];
        ctx.beginPath(); ctx.arc(fx, fy, 2.5 + (i % 3), 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#c9a227';
      ctx.fillRect(0, 176, BAL.W, 3);
      ctx.restore();
    }
  },

  _renderRail(ctx) {
    const map = { doughdrop: 'dough', tooven: 'bake', baking: 'bake', handoff: 'serve', idle: null };
    const cur = map[svc.stage] !== undefined ? map[svc.stage] : svc.stage;
    ctx.save();
    ctx.font = '900 13px Trebuchet MS, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let x = 330;
    for (const stg of STAGE_RAIL) {
      const label = RAIL_LABEL[stg];
      const w = ctx.measureText(label).width + 22;
      const active = stg === cur;
      if (active) {
        const bounce = 1 + 0.05 * Math.sin(svc.elapsed * 6);
        ctx.save();
        ctx.translate(x + w / 2, RAIL_Y - 5);
        ctx.scale(bounce, bounce);
        rr(ctx, -w / 2, -12, w, 24, 12);
        ctx.fillStyle = '#e2725b'; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = OUTLINE; ctx.stroke();
        ctx.fillStyle = '#fff6e8';
        ctx.fillText(label, 0, 1);
        ctx.restore();
      } else {
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = '#4a2e1d';
        ctx.fillText(label, x + w / 2, RAIL_Y - 4);
        ctx.globalAlpha = 1;
      }
      x += w + 14;
    }

    // what-to-do hint for the current stage
    const hint = STAGE_HINT[svc.stage];
    if (hint) {
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = '#fff6e0';
      ctx.font = '800 13.5px Trebuchet MS, system-ui, sans-serif';
      ctx.fillText(hint, 640, RAIL_Y + 20);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  },

  _renderPass(ctx) {
    // pass shelf
    ctx.save();
    rr(ctx, PASS.x - 92, PASS.y + 38, 184, 16, 8);
    ctx.fillStyle = '#8d8d96'; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE; ctx.stroke();

    // bell
    const hot = this._bellActive();
    const press = svc.bellPress ? 0.9 : 1;
    const hov = svc.bellHover && !svc.bellPress ? 1.08 : 1;
    ctx.translate(BELL.x, BELL.y);
    ctx.scale(press * hov, press * hov);
    if (hot) {
      ctx.globalAlpha = 0.4 + 0.25 * Math.sin(svc.elapsed * 7);
      ctx.beginPath(); ctx.arc(0, 6, BELL.r + 10, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd54a'; ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = hot ? '#f3c84e' : '#cfae52';
    ctx.beginPath(); ctx.arc(0, 8, BELL.r, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE; ctx.stroke();
    ctx.fillStyle = '#9b7e35';
    rr(ctx, -BELL.r - 6, 8, BELL.r * 2 + 12, 8, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff3c9';
    ctx.beginPath(); ctx.arc(-7, -4, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = OUTLINE;
    ctx.beginPath(); ctx.arc(0, -16, 4, 0, Math.PI * 2); ctx.fill();
    if (hot) {
      ctx.fillStyle = '#4a2e1d';
      ctx.font = '900 13px Trebuchet MS, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SERVE!', 0, 36);
    }
    ctx.restore();
  },
};
