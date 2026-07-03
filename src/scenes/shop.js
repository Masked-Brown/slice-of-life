// =====================================================================
// shop.js — the between-days menu. Five tabs: Equipment, Menu, Restock
// (ingredients + boosts), Analytics, Goals. Affordable items pulse;
// every purchase changes feel. The specials banner makes restocking a
// forecast, not a guess.
// =====================================================================

import { BAL, TOPPING_ORDER } from '../balance.js';
import { Juice } from '../juice.js';
import { Sfx } from '../audio.js';
import { saveGame, gbp, unitCost, addStock } from '../state.js';
import { ensureNextDay, checkMilestones, metrics } from '../goals.js';
import { analyticsHTML } from '../analytics.js';
import { Telemetry } from '../telemetry.js';

let ui = null;

export const ShopScene = {

  enter(g) {
    ui = { g, tab: 'equipment' };
    ensureNextDay(g.state);          // tomorrow's specials drive the banner
    g.dom.shop.classList.remove('hidden');
    this._build(g);
  },

  exit(g) {
    g.dom.shop.classList.add('hidden');
    g.dom.shop.innerHTML = '';
    Juice.clear();
    ui = null;
  },

  _build(g) {
    const el = g.dom.shop;
    const specials = g.state.nextDay.specials;
    const specialTxt = specials.map(t =>
      `<span class="tk-dot" style="background:${BAL.TOPPINGS[t].dot}"></span><b>${BAL.TOPPINGS[t].label}</b>`).join(' & ');
    el.innerHTML = `
      <div class="shop-panel">
        <div class="shop-head">
          <div class="shop-title">PIZZA SUPPLY CO.</div>
          <div class="shop-money" id="shop-money">${gbp(g.state.money)}</div>
        </div>
        <div class="shop-banner">📌 Tomorrow's special: ${specialTxt} — expect extra demand, stock up!</div>
        <div class="shop-tabs">
          <button class="shop-tab" data-tab="equipment">Equipment</button>
          <button class="shop-tab" data-tab="menu">Menu</button>
          <button class="shop-tab" data-tab="restock">Restock</button>
          <button class="shop-tab" data-tab="analytics">Analytics</button>
          <button class="shop-tab" data-tab="goals">Goals</button>
        </div>
        <div class="shop-grid" id="shop-grid"></div>
        <div class="shop-foot">
          <button class="btn btn-big" id="btn-open-day">OPEN DAY ${g.state.day} ➜</button>
        </div>
      </div>`;

    el.querySelectorAll('.shop-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        Sfx.press();
        ui.tab = btn.dataset.tab;
        this._renderTab(g);
      });
    });

    el.querySelector('#btn-open-day').addEventListener('click', () => {
      Sfx.press();
      g.state.phase = 'service';
      saveGame(g.state);
      g.setScene('service');
    });

    this._renderTab(g);
  },

  _renderTab(g) {
    const el = g.dom.shop;
    el.querySelectorAll('.shop-tab').forEach(b =>
      b.classList.toggle('shop-tab-on', b.dataset.tab === ui.tab));
    const grid = el.querySelector('#shop-grid');
    grid.innerHTML = '';
    grid.classList.toggle('shop-grid-list', ui.tab === 'restock' || ui.tab === 'analytics' || ui.tab === 'goals');

    if (ui.tab === 'equipment') this._equipmentTab(g, grid);
    else if (ui.tab === 'menu') this._menuTab(g, grid);
    else if (ui.tab === 'restock') this._restockTab(g, grid);
    else if (ui.tab === 'analytics') grid.innerHTML = analyticsHTML(g.state);
    else this._goalsTab(g, grid);
  },

  _card({ title, desc, pips = null, cost = null, owned = false, afford = false, buyLabel = 'BUY', onBuy = null, dot = null }) {
    const card = document.createElement('div');
    card.className = 'shop-card' + (afford && !owned ? ' afford' : '') + (owned ? ' owned' : '');
    card.innerHTML = `
      <div class="sc-title">${dot ? `<span class="tk-dot" style="background:${dot}"></span>` : ''}${title}</div>
      ${pips !== null ? `<div class="sc-pips">${pips}</div>` : ''}
      <div class="sc-desc">${desc}</div>
      <div class="sc-buy">
        ${owned
          ? `<span class="sc-owned">✓ ${cost === null ? 'OWNED' : 'MAXED'}</span>`
          : `<button class="btn sc-btn" ${afford ? '' : 'disabled'}>${buyLabel} · ${gbp(cost)}</button>`}
      </div>`;
    if (!owned && onBuy) {
      const btn = card.querySelector('.sc-btn');
      if (btn && afford) btn.addEventListener('click', onBuy);
    }
    return card;
  },

  _buy(g, cost, mutate, itemLabel = null) {
    if (g.state.money < cost) return;
    g.state.money -= cost;
    mutate();
    if (itemLabel) Telemetry.log('purchase', { item: itemLabel, cost });
    this._milestoneToasts(g);        // upgrades/toppings can complete milestones
    saveGame(g.state);
    Sfx.buy();
    Sfx.chaChing();
    const m = g.dom.shop.querySelector('#shop-money');
    m.textContent = gbp(g.state.money);
    m.classList.remove('pop-in'); void m.offsetWidth; m.classList.add('pop-in');
    this._renderTab(g);
  },

  _milestoneToasts(g) {
    const hit = checkMilestones(g.state);
    const panel = g.dom.shop.querySelector('.shop-panel');
    hit.forEach((def, i) => {
      g.state.money += def.reward;
      const toast = document.createElement('div');
      toast.className = 'milestone-toast';
      toast.style.top = (84 + i * 56) + 'px';
      toast.innerHTML = `🏆 <b>${def.label}</b> &nbsp;+${gbp(def.reward)}`;
      panel.appendChild(toast);
      setTimeout(() => toast.remove(), 3400);
      Sfx.fanfare();
    });
  },

  _equipmentTab(g, grid) {
    const s = g.state;
    for (const key of Object.keys(BAL.UPGRADES)) {
      const u = BAL.UPGRADES[key];
      const tier = s.upgrades[key];
      const maxed = tier >= u.costs.length;
      const cost = maxed ? null : u.costs[tier];
      const pips = Array.from({ length: u.costs.length }, (_, i) =>
        `<span class="pip ${i < tier ? 'pip-on' : ''}"></span>`).join('');
      grid.appendChild(this._card({
        title: u.name,
        pips,
        desc: maxed ? 'Fully upgraded.' : `<b>Tier ${tier + 1}:</b> ${u.tiers[tier]}`,
        cost,
        owned: maxed,
        afford: !maxed && s.money >= cost,
        buyLabel: 'UPGRADE',
        onBuy: () => this._buy(g, cost, () => { s.upgrades[key]++; }, `${key} t${tier + 1}`),
      }));
    }
  },

  _menuTab(g, grid) {
    const s = g.state;
    // Size L unlock
    grid.appendChild(this._card({
      title: 'Large Pizzas (L)',
      desc: 'Unlock the big dough. Large orders pay the most — and start appearing on tickets tomorrow.',
      cost: s.sizeL ? null : BAL.SIZE_L_COST,
      owned: s.sizeL,
      afford: !s.sizeL && s.money >= BAL.SIZE_L_COST,
      buyLabel: 'UNLOCK',
      onBuy: () => this._buy(g, BAL.SIZE_L_COST, () => { s.sizeL = true; }, 'size L'),
    }));
    // topping unlocks (come with starter stock)
    for (const key of TOPPING_ORDER) {
      const t = BAL.TOPPINGS[key];
      if (t.cost === 0) continue;
      const owned = s.toppings.includes(key);
      grid.appendChild(this._card({
        title: t.label,
        dot: t.dot,
        desc: owned ? 'On the menu — appears on tickets and in your bins.'
                    : `Adds ticket variety and raises average order value from tomorrow. Includes ×${BAL.STOCK.NEW_TOPPING_INCLUDED} stock.`,
        cost: owned ? null : t.cost,
        owned,
        afford: !owned && s.money >= t.cost,
        buyLabel: 'ADD',
        onBuy: () => this._buy(g, t.cost, () => {
          s.toppings.push(key);
          addStock(s, key, BAL.STOCK.NEW_TOPPING_INCLUDED);
        }, t.label),
      }));
    }
  },

  // ---- restock: the supply decision ------------------------------------
  _restockTab(g, grid) {
    const s = g.state;
    const disc = BAL.SUPPLY_DISCOUNTS[s.upgrades.supply] || 0;
    const list = document.createElement('div');
    list.className = 'restock-list';
    list.innerHTML = `
      <div class="rs-row rs-head-row">
        <span class="rs-name">Ingredient</span><span class="rs-stock">In stock</span>
        <span class="rs-used">Used yesterday</span><span class="rs-price">Per piece</span>
        <span class="rs-btns"></span>
      </div>`;

    const specials = s.nextDay.specials;
    for (const key of TOPPING_ORDER) {
      if (!s.toppings.includes(key)) continue;
      const t = BAL.TOPPINGS[key];
      const stock = s.stock[key] | 0;
      const used = s.lastDay ? (s.lastDay.used[key] || 0) : null;
      const cost = unitCost(s, key);
      const low = stock <= BAL.STOCK.LOW_AT;
      const row = document.createElement('div');
      row.className = 'rs-row';
      row.innerHTML = `
        <span class="rs-name"><span class="tk-dot" style="background:${t.dot}"></span>${t.label}
          ${specials.includes(key) ? '<span class="rs-special">★ special</span>' : ''}</span>
        <span class="rs-stock ${stock === 0 ? 'rs-out' : low ? 'rs-low' : ''}">×${stock}</span>
        <span class="rs-used">${used === null ? '—' : '×' + used}</span>
        <span class="rs-price">${disc > 0 ? `<s>${Math.round(t.unit * 100)}p</s> ` : ''}${Math.round(cost * 100)}p</span>
        <span class="rs-btns"></span>`;
      const btns = row.querySelector('.rs-btns');
      for (const n of BAL.STOCK.BUY_AMOUNTS) {
        const price = cost * n;
        const b = document.createElement('button');
        b.className = 'btn rs-btn';
        b.textContent = `+${n} · ${gbp(price)}`;
        b.disabled = s.money < price;
        b.addEventListener('click', () => {
          if (s.money < price) return;
          s.money -= price;
          addStock(s, key, n);
          s.carriedRestockSpend += price;
          saveGame(s);
          Sfx.buy();
          const m = g.dom.shop.querySelector('#shop-money');
          m.textContent = gbp(s.money);
          this._renderTab(g);
        });
        btns.appendChild(b);
      }
      list.appendChild(row);
    }
    grid.appendChild(list);

    // boosts live here too — they're tomorrow's supplies
    const boostHead = document.createElement('div');
    boostHead.className = 'rs-section-head';
    boostHead.textContent = "TOMORROW'S BOOSTS";
    grid.appendChild(boostHead);
    const boostRow = document.createElement('div');
    boostRow.className = 'rs-boosts';
    for (const b of [{ key: 'prep', ...BAL.BOOSTS.prep }, { key: 'ad', ...BAL.BOOSTS.ad }]) {
      const booked = s.boosts[b.key] > 0;
      boostRow.appendChild(this._card({
        title: b.name,
        desc: b.desc + (booked ? '<br><b>Booked for tomorrow ✓</b>' : ''),
        cost: booked ? null : b.cost,
        owned: booked,
        afford: !booked && s.money >= b.cost,
        buyLabel: 'BOOK',
        onBuy: () => this._buy(g, b.cost, () => { s.boosts[b.key] = 1; }, `boost:${b.key}`),
      }));
    }
    grid.appendChild(boostRow);
  },

  // ---- goals: milestone progress + tomorrow's goal -----------------------
  _goalsTab(g, grid) {
    const s = g.state;
    const m = metrics(s);
    const goal = s.nextDay.goal;

    const wrap = document.createElement('div');
    wrap.className = 'goals-list';
    wrap.innerHTML = `
      <div class="gl-day">Tomorrow's goal: 🎯 <b>${goal.desc}</b>
        <span class="gl-reward">+${gbp(goal.reward)}</span></div>`;

    const fmt = (stat, v) =>
      stat === 'earned' || stat === 'bestDayProfit' ? gbp(v)
      : stat === 'rating' ? v.toFixed(1)
      : String(Math.floor(v));

    for (const def of BAL.MILESTONES) {
      const done = !!s.milestonesDone[def.id];
      const cur = Math.min(m[def.stat] ?? 0, def.target);
      let pct = done ? 100 : Math.round((cur / def.target) * 100);
      let progTxt = done ? '✓' : `${fmt(def.stat, cur)} / ${fmt(def.stat, def.target)}`;
      // star milestones wait for enough reviews — show that instead of 0.0
      if (!done && def.stat === 'rating' && s.recentRatings.length < BAL.MILESTONE_MIN_RATINGS) {
        progTxt = `${s.recentRatings.length}/${BAL.MILESTONE_MIN_RATINGS} reviews`;
        pct = Math.round(s.recentRatings.length / BAL.MILESTONE_MIN_RATINGS * 40);
      }
      const row = document.createElement('div');
      row.className = 'gl-row' + (done ? ' gl-done' : '');
      row.innerHTML = `
        <span class="gl-label">${def.label}</span>
        <span class="gl-bar"><i style="width:${pct}%"></i></span>
        <span class="gl-prog">${progTxt}</span>
        <span class="gl-reward">${done ? 'PAID' : '+' + gbp(def.reward)}</span>`;
      wrap.appendChild(row);
    }
    grid.appendChild(wrap);
  },

  update() {},

  render(g, ctx) {
    ctx.fillStyle = '#241712';
    ctx.fillRect(0, 0, g.W, g.H);
  },

  onDown() {}, onMove() {}, onUp() {},
};
