// =====================================================================
// service.js — the in-day gameplay scene. One continuous counter POV:
// queue strip (top), pinned ticket (left, DOM), stations (center),
// topping bins (bottom), oven (right). Owns the order state machine.
// =====================================================================

import { BAL } from '../balance.js';
import { clamp, lerp, rand, Juice, Ease, rr } from '../juice.js';
import { Sfx } from '../audio.js';
import { currentRating, pushRating, saveGame, gbp } from '../state.js';
import { ensureNextDay, checkMilestones, goalProgress } from '../goals.js';
import { Orders } from '../stations/order.js';
import { Build, PIZZA_POS, TRAY, NEXT_BTN, BINS_Y } from '../stations/build.js';
import { Oven, OVEN } from '../stations/oven.js';
import { Serve } from '../stations/serve.js';

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
    const plan = ensureNextDay(state);        // today's specials + daily goal
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
      lowWarned: {}, outWarned: {},           // one stock warning per topping per day
      goal: { ...plan.goal, hit: false, failed: false },
      bonusEarned: 0,                         // goal + milestone cash won today
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
      onBakeDone: () => this._onBakeDone(),
      onOrderDone: res => this._onOrderDone(res),
      advanceStage: () => this._advanceStage(),
    };
    svc.totalCustomers = 0;
    g._svc = svc;   // debug/testing handle

    Build.resetForOrder(svc);
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
    svc.totalCustomers = svc.pending.length;
    state.boosts = { prep: 0, ad: 0 };
    svc.dayStarted = true;
    g.dom.dayboard.classList.add('hidden');
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

    const chips = state.toppings.map(t => {
      const n = state.stock[t] | 0;
      const cls = n === 0 ? 'db-chip-out' : n <= BAL.STOCK.LOW_AT ? 'db-chip-low' : '';
      return `<span class="db-chip ${cls}">${BAL.TOPPINGS[t].label} ×${n}</span>`;
    }).join('');
    const flagged = state.toppings.filter(t => (state.stock[t] | 0) <= BAL.STOCK.LOW_AT);
    const stockNote = flagged.length
      ? `<div class="db-warn">⚠ Low on ${flagged.map(t => BAL.TOPPINGS[t].label).join(', ')} — restock in the shop!</div>`
      : `<div class="db-ok">Stock looks good ✓</div>`;

    el.innerHTML = `
      <div class="dayboard">
        <div class="db-head">— DAY ${state.day} —</div>
        <div class="db-section">
          <div class="db-label">TODAY'S SPECIAL${plan.specials.length > 1 ? 'S' : ''}</div>
          ${specialRows}
        </div>
        <div class="db-section">
          <div class="db-label">DAILY GOAL</div>
          <div class="db-row"><b>🎯 ${plan.goal.desc}</b><span class="db-reward">+${gbp(plan.goal.reward)}</span></div>
        </div>
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
    Juice.clear();
    svc = null;
  },

  // ================= state machine =================

  _onNewFront(c) {
    svc.orderIndex++;
    svc.ticket = c.ticket;
    Build.resetForOrder(svc);
    svc.stage = 'dough';
    Orders.pinTicket(svc, c);
    Sfx.tick();
    this._setTutorial('dough');
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
    if (svc.stage === 'sauce') { svc.stage = 'cheese'; this._setTutorial('cheese'); }
    else if (svc.stage === 'cheese') { svc.stage = 'toppings'; this._setTutorial('toppings'); }
    else if (svc.stage === 'toppings') { svc.stage = 'tooven'; this._setTutorial('oven'); }
  },

  _onBakeDone() {
    const grade = svc.pizza.bakeZone === 'burnt' ? 'burnt'
      : Oven.zoneOf(svc.pizza.bake, svc.state.upgrades.oven) === svc.ticket.bake ? 'perfect'
      : Math.abs(['raw','light','normal','well','burnt'].indexOf(svc.pizza.bakeZone)
               - ['raw','light','normal','well','burnt'].indexOf(svc.ticket.bake)) === 1 ? 'good' : 'off';
    if (grade === 'burnt') {
      Juice.floatText(PASS.x, PASS.y - 70, 'BURNT!', { color: '#ff6b52', size: 30 });
      Sfx.popOff();
    } else {
      this._gradePop(grade, PASS.x, PASS.y - 70);
    }
    svc.stage = 'serve';
  },

  _onOrderDone(res) {
    // daily-goal + milestone bookkeeping (ticket is still pinned here)
    if (res) {
      const t = svc.ticket;
      if (t && t.size === 'L') svc.largeSold++;
      if (res.perfect) svc.perfectsToday++;
      if (res.elapsed <= res.par) svc.underPar++;
      for (const k in svc.usage) if (svc.usage[k] > 0) svc.usedTypes.add(k);
      this._checkGoal();
      this._checkMilestones();
    }
    Orders.unpinTicket(svc);
    svc.ticket = null;
    svc.stage = 'idle';
    Build.resetForOrder(svc);
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
      const g = svc.game;
      Juice.stamp(640, 270, 'DAILY GOAL!', { color: '#9fe07c', size: 46 });
      Juice.floatText(640, 330, '+' + gbp(goal.reward), { color: '#ffd54a', size: 28 });
      Juice.coinBurst(640, 300, g.hudMoneyPos.x, g.hudMoneyPos.y, 8, () => Sfx.coin());
      Sfx.goalDing();
    }
  },

  _checkMilestones() {
    const hit = checkMilestones(svc.state);
    const g = svc.game;
    hit.forEach((def, i) => {
      svc.state.money += def.reward;
      svc.bonusEarned += def.reward;
      Juice.tween({
        dur: 0.01, delay: 0.55 * i,
        onDone: () => {
          Juice.stamp(640, 215, `MILESTONE!`, { color: '#ffd54a', size: 42 });
          Juice.floatText(640, 268, def.label, { color: '#fff6e0', size: 22 });
          Juice.floatText(640, 300, '+' + gbp(def.reward), { color: '#9fe07c', size: 26 });
          Juice.coinBurst(640, 250, g.hudMoneyPos.x, g.hudMoneyPos.y, 10, () => Sfx.coin());
          Juice.confetti(640, 235, 22);
          Sfx.fanfare();
        },
      });
    });
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
    Orders.unpinTicket(svc);
    svc.ticket = null;
    Sfx.sauceStop();
    if (svc.oven.has) {
      svc.oven.has = false;
      Sfx.ovenStop();
      Juice.tween({ target: svc.oven, to: { door: 0 }, dur: 0.3 });
    }
    // a held piece goes back in its bin; pieces on the binned pizza are spent
    if (svc.held) {
      svc.state.stock[svc.held.type] = (svc.state.stock[svc.held.type] | 0) + svc.held.n;
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
    svc.elapsed += dt;

    Orders.update(svc, dt);
    Build.update(svc, dt);
    Oven.update(svc, dt);

    this._updateHUD();
    this._updateCursor(g);
    this._checkDayEnd(g);
  },

  _checkDayEnd(g) {
    if (svc.dayEndQueued) return;
    if (svc.pending.length === 0 && svc.customers.length === 0 && svc.stage === 'idle'
        && (svc.served + svc.lost) >= svc.totalCustomers && svc.totalCustomers > 0) {
      svc.dayEndQueued = true;
      this._checkGoal();           // all-day goals (no walk-outs, 90% sat) settle now
      const stats = {
        day: svc.state.day,
        served: svc.served, lost: svc.lost,
        sales: svc.sales, tips: svc.tipsTotal,
        satAvg: svc.sats.length ? svc.sats.reduce((a, b) => a + b, 0) / svc.sats.length : 0,
        ratingBefore: svc.ratingAtStart,
        ratingAfter: currentRating(svc.state),
        used: svc.usage, toppingRevenue: svc.toppingRevenue,
        bonus: svc.bonusEarned,
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
    if (!svc || svc.dayEndQueued) return;

    if (svc.stage === 'serve') {
      if (Math.hypot(x - BELL.x, y - BELL.y) < BELL.r + 10) {
        svc.bellPress = true;
        Sfx.press();
        return;
      }
    }
    if (svc.stage === 'baking') {
      if (Oven.ovenHit(x, y) || Oven.mouthHit(x, y)) {
        Oven.pull(svc);
        // first pizza of day 1 completes the tutorial on serve, hint stays
        return;
      }
      return; // while baking nothing else works — the tension IS the timing
    }
    if (svc.stage === 'tooven' && svc.pizza && svc.pizza.state === 'counter'
        && Oven.ovenHit(x, y)) {
      // clicking the oven walks the pizza in (drag also works)
      Juice.tween({
        target: svc.pizza, to: { x: OVEN.x + OVEN.w / 2, y: OVEN.y + OVEN.h * 0.6 },
        dur: 0.25, ease: Ease.outCubic, onDone: () => Oven.insert(svc),
      });
      return;
    }
    Build.onDown(svc, x, y);
  },

  onMove(g, x, y) {
    if (!svc) return;
    Build.onMove(svc, x, y);

    const overBell = svc.stage === 'serve' && Math.hypot(x - BELL.x, y - BELL.y) < BELL.r + 10;
    if (overBell && !svc.bellHover) Sfx.tick();
    svc.bellHover = overBell;

    // dragging the pizza over the oven mouth slides it in
    if (svc.stage === 'tooven' && svc.pizza && svc.pizza.state === 'drag' && Oven.mouthHit(x, y)) {
      Oven.insert(svc);
    }
  },

  onUp(g, x, y) {
    if (!svc) return;
    if (svc.bellPress) {
      svc.bellPress = false;
      if (Math.hypot(x - BELL.x, y - BELL.y) < BELL.r + 14 && svc.stage === 'serve') {
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
    this._renderPass(ctx);
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
    const W = g.W;

    // wall behind the queue — warm two-tone with depth
    const wallColors = ['#e8d5ae', '#f2d9b0', '#f6e0bb', '#fbe7c4'];
    const wallLo = ['#dcc497', '#e6c898', '#eccfa2', '#f1d6ab'];
    const wg = ctx.createLinearGradient(0, 0, 0, 152);
    wg.addColorStop(0, wallColors[tier]);
    wg.addColorStop(1, wallLo[tier]);
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

    // window onto the street (daylight, rooftops)
    ctx.save();
    ctx.fillStyle = '#9c6b3c';
    rr(ctx, 96, 26, 168, 104, 10); ctx.fill(); ctx.stroke();
    rr(ctx, 106, 36, 148, 84, 6);
    ctx.save();
    ctx.clip();
    const sky = ctx.createLinearGradient(0, 36, 0, 120);
    sky.addColorStop(0, '#aed7ec');
    sky.addColorStop(1, '#dceef7');
    ctx.fillStyle = sky;
    ctx.fillRect(106, 36, 148, 84);
    // sun + drifting cloud
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath(); ctx.arc(232, 54, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const cx = 120 + ((svc.elapsed * 3) % 180);
    for (const [dx, r] of [[-14, 8], [0, 11], [14, 8]]) {
      ctx.beginPath(); ctx.arc(cx + dx, 62, r, 0, Math.PI * 2); ctx.fill();
    }
    // rooftop silhouettes
    ctx.fillStyle = '#b98a64';
    ctx.beginPath();
    ctx.moveTo(106, 120);
    ctx.lineTo(106, 96); ctx.lineTo(130, 84); ctx.lineTo(154, 96);
    ctx.lineTo(154, 104); ctx.lineTo(176, 104); ctx.lineTo(176, 88);
    ctx.lineTo(204, 76); ctx.lineTo(232, 88); ctx.lineTo(232, 120);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    rr(ctx, 106, 36, 148, 84, 6); ctx.stroke();
    // crossbars
    ctx.fillStyle = '#9c6b3c';
    ctx.fillRect(178, 36, 5, 84);
    ctx.fillRect(106, 74, 148, 5);
    ctx.restore();

    // hanging menu board
    ctx.save();
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
    const hot = svc.stage === 'serve';
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
