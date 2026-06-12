// =====================================================================
// shop.js — the upgrade shop between days. Three tabs: Equipment,
// Menu, Boosts. Affordable items pulse; every purchase changes feel.
// =====================================================================

import { BAL, TOPPING_ORDER } from '../balance.js';
import { Juice } from '../juice.js';
import { Sfx } from '../audio.js';
import { saveGame, gbp } from '../state.js';

let ui = null;

export const ShopScene = {

  enter(g) {
    ui = { g, tab: 'equipment' };
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
    el.innerHTML = `
      <div class="shop-panel">
        <div class="shop-head">
          <div class="shop-title">PIZZA SUPPLY CO.</div>
          <div class="shop-money" id="shop-money">${gbp(g.state.money)}</div>
        </div>
        <div class="shop-tabs">
          <button class="shop-tab" data-tab="equipment">Equipment</button>
          <button class="shop-tab" data-tab="menu">Menu</button>
          <button class="shop-tab" data-tab="boosts">Boosts</button>
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

    if (ui.tab === 'equipment') this._equipmentTab(g, grid);
    else if (ui.tab === 'menu') this._menuTab(g, grid);
    else this._boostsTab(g, grid);
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

  _buy(g, cost, mutate) {
    if (g.state.money < cost) return;
    g.state.money -= cost;
    mutate();
    saveGame(g.state);
    Sfx.buy();
    Sfx.chaChing();
    const m = g.dom.shop.querySelector('#shop-money');
    m.textContent = gbp(g.state.money);
    m.classList.remove('pop-in'); void m.offsetWidth; m.classList.add('pop-in');
    this._renderTab(g);
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
        onBuy: () => this._buy(g, cost, () => { s.upgrades[key]++; }),
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
      onBuy: () => this._buy(g, BAL.SIZE_L_COST, () => { s.sizeL = true; }),
    }));
    // topping unlocks
    for (const key of TOPPING_ORDER) {
      const t = BAL.TOPPINGS[key];
      if (t.cost === 0) continue;
      const owned = s.toppings.includes(key);
      grid.appendChild(this._card({
        title: t.label,
        dot: t.dot,
        desc: owned ? 'On the menu — appears on tickets and in your bins.'
                    : 'Adds ticket variety and raises average order value from tomorrow.',
        cost: owned ? null : t.cost,
        owned,
        afford: !owned && s.money >= t.cost,
        buyLabel: 'ADD',
        onBuy: () => this._buy(g, t.cost, () => { s.toppings.push(key); }),
      }));
    }
  },

  _boostsTab(g, grid) {
    const s = g.state;
    const defs = [
      { key: 'prep', ...BAL.BOOSTS.prep },
      { key: 'ad', ...BAL.BOOSTS.ad },
    ];
    for (const b of defs) {
      const booked = s.boosts[b.key] > 0;
      grid.appendChild(this._card({
        title: b.name,
        desc: b.desc + (booked ? '<br><b>Booked for tomorrow ✓</b>' : ''),
        cost: booked ? null : b.cost,
        owned: booked,
        afford: !booked && s.money >= b.cost,
        buyLabel: 'BOOK',
        onBuy: () => this._buy(g, b.cost, () => { s.boosts[b.key] = 1; }),
      }));
    }
  },

  update() {},

  render(g, ctx) {
    ctx.fillStyle = '#241712';
    ctx.fillRect(0, 0, g.W, g.H);
  },

  onDown() {}, onMove() {}, onUp() {},
};
