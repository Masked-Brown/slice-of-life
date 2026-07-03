// =====================================================================
// dayEnd.js — the receipt tally. A reward moment: line items count up
// with ticks, the total slams in with a cha-ching, stars pop one by one.
// Also banks the day: writes state.lastDay (analytics), rolls the day
// counter, and draws up tomorrow's specials + goal for the shop.
// =====================================================================

import { BAL } from '../balance.js';
import { clamp, lerp, Juice, Ease } from '../juice.js';
import { Sfx } from '../audio.js';
import { saveGame, gbp } from '../state.js';
import { ensureNextDay, checkMilestones } from '../goals.js';
import { analyticsHTML } from '../analytics.js';
import { Telemetry } from '../telemetry.js';

let ui = null;

export const DayEndScene = {

  enter(g, stats) {
    const state = g.state;

    // ---- bank the day -------------------------------------------------
    const restockSpend = state.carriedRestockSpend;
    state.lastDay = {
      day: stats.day, served: stats.served, lost: stats.lost,
      sales: stats.sales, tips: stats.tips, bonus: stats.bonus,
      restockSpend,
      satAvg: stats.satAvg, rating: stats.ratingAfter,
      used: stats.used, toppingRevenue: stats.toppingRevenue,
      goalHit: stats.goalHit, goalDesc: stats.goalDesc, goalReward: stats.goalReward,
    };
    state.carriedRestockSpend = 0;
    const dayProfit = stats.sales + stats.tips + stats.bonus - restockSpend;
    state.stats.bestDayProfit = Math.max(state.stats.bestDayProfit, dayProfit);
    state.lifetime.days += 1;

    Telemetry.log('day_end', {
      served: stats.served, lost: stats.lost,
      sales: Math.round(stats.sales), tips: Math.round(stats.tips),
      bonus: Math.round(stats.bonus), restockSpend: Math.round(restockSpend * 100) / 100,
      satAvg: Math.round(stats.satAvg), rating: Math.round(stats.ratingAfter * 10) / 10,
      money: Math.round(state.money),
    });

    state.day += 1;
    state.phase = 'shop';
    ensureNextDay(state);                    // tomorrow's specials + goal, for the shop

    // milestones that settle at close of books (profit/earnings)
    const lateHits = checkMilestones(state);
    let lateBonus = 0;
    for (const def of lateHits) {
      state.money += def.reward;
      lateBonus += def.reward;
    }
    state.lastDay.bonus += lateBonus;
    saveGame(state);

    const el = g.dom.dayend;
    el.classList.remove('hidden');

    ui = {
      g, stats,
      t: 0,
      step: 0,
      lineT: 0,
      tickCD: 0,
      starsShown: 0,
      done: false,
      lateHits,
    };

    const bonusTotal = stats.bonus + lateBonus;
    const total = stats.sales + stats.tips + bonusTotal;
    ui.lines = [
      { label: `Pizzas served × ${stats.served}`, value: stats.sales, money: true },
      { label: 'Tips', value: stats.tips, money: true },
    ];
    if (bonusTotal > 0) ui.lines.push({ label: 'Goals & milestones 🎯', value: bonusTotal, money: true });
    if (stats.goalDesc) {
      ui.lines.push({ label: `Daily goal: ${stats.goalDesc}`, value: stats.goalHit ? '✓' : '✗', money: false });
    }
    if (restockSpend > 0) ui.lines.push({ label: 'Restock paid yesterday', value: '−' + gbp(restockSpend), money: false });
    ui.lines.push(
      { label: `Walk-outs × ${stats.lost}`, value: stats.lost > 0 ? '1★ each' : '—', money: false },
      { label: 'Avg satisfaction', value: stats.served ? Math.round(stats.satAvg) + '%' : '—', money: false },
    );
    ui.total = total;

    el.innerHTML = `
      <div class="receipt">
        <div class="rc-head">— SLICE OF LIFE —<br><span>Day ${stats.day} takings</span></div>
        <div class="rc-lines"></div>
        <div class="rc-total hidden"><span>TOTAL</span><b id="rc-total-num">£0.00</b></div>
        <div class="rc-stars hidden">
          <div class="rc-star-row">${'<span class="rc-star">★</span>'.repeat(5)}</div>
          <div class="rc-rating-delta"></div>
        </div>
        <div class="rc-btns hidden" id="rc-btns">
          <button class="btn" id="btn-analytics">📊 ANALYTICS</button>
          <button class="btn btn-big" id="btn-to-shop">TO THE SHOP ➜</button>
        </div>
      </div>
      <div class="an-wrap hidden" id="an-wrap">
        ${analyticsHTML(state)}
        <button class="btn" id="btn-an-back">⬅ BACK</button>
      </div>`;

    el.querySelector('#btn-to-shop').addEventListener('click', () => {
      Sfx.press();
      g.setScene('shop');
    });
    el.querySelector('#btn-analytics').addEventListener('click', () => {
      Sfx.press();
      el.querySelector('.receipt').classList.add('hidden');
      el.querySelector('#an-wrap').classList.remove('hidden');
    });
    el.querySelector('#btn-an-back').addEventListener('click', () => {
      Sfx.press();
      el.querySelector('#an-wrap').classList.add('hidden');
      el.querySelector('.receipt').classList.remove('hidden');
    });
  },

  exit(g) {
    g.dom.dayend.classList.add('hidden');
    g.dom.dayend.innerHTML = '';
    Juice.clear();
    ui = null;
  },

  update(g, dt) {
    if (!ui || ui.done) return;
    ui.t += dt;

    const el = g.dom.dayend;
    const linesEl = el.querySelector('.rc-lines');

    // reveal lines one by one, counting numbers up with ticks
    if (ui.step < ui.lines.length) {
      if (ui.lineT === 0) {
        const ln = ui.lines[ui.step];
        const row = document.createElement('div');
        row.className = 'rc-row pop-in';
        row.innerHTML = `<span>${ln.label}</span><b>${ln.money ? '£0.00' : ''}</b>`;
        linesEl.appendChild(row);
        ui.curRow = row.querySelector('b');
      }
      ui.lineT += dt;
      const ln = ui.lines[ui.step];
      const k = clamp(ui.lineT / 0.55, 0, 1);
      if (ln.money) {
        ui.curRow.textContent = gbp(ln.value * Ease.outCubic(k));
        ui.tickCD -= dt;
        if (k < 1 && ui.tickCD <= 0) { ui.tickCD = 0.05; Sfx.tally(); }
      } else if (k > 0.3) {
        ui.curRow.textContent = String(ln.value);
      }
      if (ui.lineT > 0.8) { ui.step++; ui.lineT = 0; }
      return;
    }

    // total slams in
    if (ui.step === ui.lines.length) {
      ui.step++;
      const totEl = el.querySelector('.rc-total');
      totEl.classList.remove('hidden');
      totEl.classList.add('slam-in');
      el.querySelector('#rc-total-num').textContent = gbp(ui.total);
      Sfx.chaChing();
      if (ui.lateHits.length) Sfx.fanfare();
      ui.lineT = 0;
      return;
    }

    // stars fill one by one to the new rating
    if (ui.step === ui.lines.length + 1) {
      ui.lineT += dt;
      if (ui.lineT < 0.5) return;
      const starsEl = el.querySelector('.rc-stars');
      starsEl.classList.remove('hidden');
      const rating = ui.stats.ratingAfter;
      const stars = el.querySelectorAll('.rc-star');
      const target = Math.round(rating);          // whole-star pops
      if (ui.starsShown < target && ui.lineT > 0.5 + ui.starsShown * 0.22) {
        const s = stars[ui.starsShown];
        s.classList.add('rc-star-on', 'pop-in');
        Sfx.starPop();
        ui.starsShown++;
        return;
      }
      if (ui.starsShown >= target && ui.lineT > 1.2 + target * 0.22) {
        const delta = ui.stats.ratingAfter - ui.stats.ratingBefore;
        const dEl = el.querySelector('.rc-rating-delta');
        dEl.textContent = `${rating.toFixed(1)} ★  (${delta >= 0 ? '+' : ''}${delta.toFixed(1)})`;
        dEl.className = 'rc-rating-delta ' + (delta >= 0 ? 'up' : 'down');
        el.querySelector('#rc-btns').classList.remove('hidden');
        ui.done = true;
      }
    }
  },

  render(g, ctx) {
    // warm dim backdrop with drifting steam
    ctx.fillStyle = '#241712';
    ctx.fillRect(0, 0, g.W, g.H);
    if (Math.random() < 0.04) Juice.steam(rand(200, 1080), 700, 1);
  },

  onDown() {}, onMove() {}, onUp() {},
};

function rand(a, b) { return a + Math.random() * (b - a); }
