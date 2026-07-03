// =====================================================================
// analytics.js — read-only business analytics built from state.lastDay.
// One HTML builder shared by the shop tab and the day-end screen.
// V3: waste per ingredient, basics P&L, emergency costs.
// =====================================================================

import { BAL, TOPPING_ORDER } from './balance.js';
import { gbp, unitCost, shelfLife } from './state.js';

export function analyticsHTML(state) {
  const d = state.lastDay;
  if (!d) {
    return `<div class="an-empty">No session data yet — serve a day and the numbers land here.</div>`;
  }

  const waste = d.waste || {};
  const wasteCost = d.wasteCost || 0;
  const emergency = d.emergency || 0;
  const grossProfit = d.sales + d.tips + d.bonus - d.restockSpend - emergency;

  // per-topping P&L: revenue attributed during service vs cost of units used
  const rows = TOPPING_ORDER
    .filter(t => state.toppings.includes(t))
    .map(t => {
      const used = d.used[t] || 0;
      const rev = d.toppingRevenue[t] || 0;
      const cost = used * unitCost(state, t);
      const w = waste[t] || null;
      return { t, used, rev, cost, margin: rev - cost - (w ? w.cost : 0), w };
    })
    .sort((a, b) => b.margin - a.margin);
  const maxRev = Math.max(1, ...rows.map(r => r.rev));

  const stat = (label, value, cls = '') =>
    `<div class="an-stat ${cls}"><div class="an-stat-num">${value}</div><div class="an-stat-lbl">${label}</div></div>`;

  const wasteCell = w => w
    ? `<span class="an-num an-neg">−${gbp(w.cost)}<i class="an-waste-n">×${w.n}</i></span>`
    : `<span class="an-num an-waste-zero">—</span>`;

  const tableRows = rows.map(r => `
    <div class="an-row">
      <span class="an-name"><span class="tk-dot" style="background:${BAL.TOPPINGS[r.t].dot}"></span>${BAL.TOPPINGS[r.t].label}</span>
      <span class="an-used">×${r.used}</span>
      <span class="an-bar"><i style="width:${Math.round(r.rev / maxRev * 100)}%"></i></span>
      <span class="an-num">${gbp(r.rev)}</span>
      <span class="an-num an-cost">−${gbp(r.cost)}</span>
      ${wasteCell(r.w)}
      <span class="an-num ${r.margin >= 0 ? 'an-pos' : 'an-neg'}">${r.margin >= 0 ? '+' : '−'}${gbp(Math.abs(r.margin))}</span>
    </div>`).join('');

  // basics: units used vs spoiled — the forecasting scoreboard
  const basicsRows = Object.keys(BAL.BASICS).map(k => {
    const used = d.used[k] || 0;
    const cost = used * unitCost(state, k);
    const w = waste[k] || null;
    return `
      <div class="an-row an-basic-row">
        <span class="an-name"><span class="tk-dot" style="background:${BAL.BASICS[k].dot}"></span>${BAL.BASICS[k].label}</span>
        <span class="an-used">×${used}</span>
        <span class="an-bar an-bar-empty">keeps ${shelfLife(k)}d</span>
        <span class="an-num">—</span>
        <span class="an-num an-cost">−${gbp(cost)}</span>
        ${wasteCell(w)}
        <span class="an-num"></span>
      </div>`;
  }).join('');

  return `
    <div class="an-panel">
      <div class="an-title">DAY ${d.day} — THE BOOKS</div>
      <div class="an-summary">
        ${stat('Revenue', gbp(d.sales))}
        ${stat('Tips', gbp(d.tips))}
        ${stat('Bonuses', gbp(d.bonus))}
        ${stat('Restock spend', '−' + gbp(d.restockSpend), 'an-stat-cost')}
        ${stat('Spoiled', '−' + gbp(wasteCost), wasteCost > 0.005 ? 'an-stat-loss' : '')}
        ${emergency > 0.005 ? stat('Corner-shop', '−' + gbp(emergency), 'an-stat-cost') : ''}
        ${stat('Gross profit', (grossProfit >= 0 ? '' : '−') + gbp(Math.abs(grossProfit)), grossProfit >= 0 ? 'an-stat-profit' : 'an-stat-loss')}
        ${stat('Avg satisfaction', d.served ? Math.round(d.satAvg) + '%' : '—')}
        ${stat('Rating', d.rating.toFixed(1) + ' ★')}
      </div>
      <div class="an-table">
        <div class="an-row an-head-row">
          <span class="an-name">Topping</span><span class="an-used">Used</span>
          <span class="an-bar"></span><span class="an-num">Revenue</span>
          <span class="an-num">Supply</span><span class="an-num">Waste</span><span class="an-num">Margin</span>
        </div>
        ${tableRows || '<div class="an-empty">No toppings used.</div>'}
        <div class="an-row an-head-row an-basics-head">
          <span class="an-name">Basics</span><span class="an-used">Used</span>
          <span class="an-bar"></span><span class="an-num"></span>
          <span class="an-num">Supply</span><span class="an-num">Waste</span><span class="an-num"></span>
        </div>
        ${basicsRows}
      </div>
      <div class="an-hint">${wasteCost > 0.005
        ? 'Spoilage is money in the bin — buy closer to what tomorrow needs.'
        : 'Margins update with your supply deals — cheaper restocks, fatter margins.'}</div>
    </div>`;
}
