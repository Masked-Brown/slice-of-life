// =====================================================================
// smoke-test.mjs — drives the real game in headless Chromium:
//   scenario A: new game → day board → full first order end-to-end
//               (hold-to-pour, stock counters, out-of-stock block, bake, bell)
//   scenario B: injected mid-game save → shop tabs (restock buy, analytics,
//               goals), day board stock flags
// Run: node tools/smoke-test.mjs
// =====================================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import os from 'node:os';

import { BAL, TOPPING_ORDER } from '../src/balance.js';
import { newGame } from '../src/state.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- find playwright in the npx cache --------------------------------------
function resolvePlaywright() {
  const base = path.join(os.homedir(), '.npm', '_npx');
  if (fs.existsSync(base)) {
    for (const dir of fs.readdirSync(base)) {
      const cand = path.join(base, dir, 'node_modules', 'playwright');
      if (fs.existsSync(cand)) return createRequire(import.meta.url)(cand);
    }
  }
  try { return createRequire(import.meta.url)('playwright'); } catch { /* fall through */ }
  throw new Error('playwright not found — run `npx playwright install chromium` once');
}

// ---- tiny static server -----------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mjs': 'text/javascript' };
function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      const file = path.join(ROOT, url === '/' ? 'index.html' : url);
      if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name} ${detail}`); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// canvas-space → page-space click helpers
async function canvasPoint(page, x, y) {
  return page.evaluate(([lx, ly]) => {
    const r = document.getElementById('game-canvas').getBoundingClientRect();
    return { x: r.left + lx / 1280 * r.width, y: r.top + ly / 720 * r.height };
  }, [x, y]);
}
async function clickCanvas(page, x, y) {
  const p = await canvasPoint(page, x, y);
  await page.mouse.click(p.x, p.y);
}

const svcEval = (page, fn) => page.evaluate(fn);

async function waitFor(page, fn, timeout = 15000, every = 40) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() - t0 > timeout) return false;
    await sleep(every);
  }
}

// hold the pointer until an amount metric lands inside [lo, hi]
async function holdUntil(page, x, y, readPct, lo, hi, timeout = 12000) {
  const p = await canvasPoint(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  const t0 = Date.now();
  let pct = 0;
  const releaseAt = lo + (hi - lo) * 0.45;
  while (Date.now() - t0 < timeout) {
    pct = await page.evaluate(readPct);
    if (pct >= releaseAt) break;
    await sleep(20);
  }
  await page.mouse.up();
  return pct;
}

const pw = resolvePlaywright();
const server = await serve();
const PORT = server.address().port;
const browser = await pw.chromium.launch();
const errors = [];

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  return page;
}

// =====================================================================
// Scenario A — first order end-to-end
// =====================================================================
console.log('scenario A: full first order');
{
  const page = await newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.click('#btn-new');

  check('day board appears', await waitFor(page, () => {
    const el = document.getElementById('ui-dayboard');
    return el && !el.classList.contains('hidden');
  }));
  check('day 1 has no back-to-shop', await page.locator('#db-shop').count() === 0);
  check('board shows special + goal + stock check',
    await page.locator('.db-label').count() === 3);

  await page.click('#db-start');
  check('board dismissed, day starts', await waitFor(page, () =>
    window.__game._svc.dayStarted && document.getElementById('ui-dayboard').classList.contains('hidden')));

  check('front customer arrives → dough stage', await waitFor(page, () =>
    window.__game._svc.stage === 'dough', 30000));

  const ticket = await svcEval(page, () => JSON.parse(JSON.stringify(window.__game._svc.ticket)));
  console.log(`  · ticket: ${ticket.size} / sauce ${ticket.sauce} / cheese ${ticket.cheese} / bake ${ticket.bake} / ` +
    ticket.toppings.map(w => `${w.count}×${w.type}`).join(', '));
  check('ticket DOM pinned', await page.evaluate(() =>
    !document.getElementById('ui-ticket').classList.contains('hidden')));

  // --- dough -----------------------------------------------------------
  const DOUGH = { S: [292, 252], M: [352, 248], L: [420, 244] };
  await clickCanvas(page, ...DOUGH[ticket.size]);
  check('dough lands → sauce stage', await waitFor(page, () => window.__game._svc.stage === 'sauce', 4000));

  // --- sauce: hold-to-pour ------------------------------------------------
  const [sLo, sHi] = BAL.SCORE.BANDS[ticket.sauce];
  const sBefore = await svcEval(page, () => window.__game._svc.pizza.sauceCoverage);
  const sPct = await holdUntil(page, 610, 400,
    () => window.__game._svc.pizza.sauceCoverage, sLo, sHi);
  check('coverage grew while held', sPct > sBefore, `(${sBefore} → ${sPct.toFixed(1)})`);
  // a couple of frames may land between the last sample and mouse-up;
  // frozen means two post-release samples agree
  await sleep(150);
  const sSettled = await svcEval(page, () => window.__game._svc.pizza.sauceCoverage);
  await sleep(250);
  const sAfter = await svcEval(page, () => window.__game._svc.pizza.sauceCoverage);
  check('coverage freezes on release', Math.abs(sAfter - sSettled) < 0.01);
  check(`sauce inside ${ticket.sauce} band [${sLo},${sHi}]`, sAfter >= sLo && sAfter <= sHi, `(${sAfter.toFixed(1)})`);

  await clickCanvas(page, 839, 470);          // NEXT
  check('→ cheese stage', await waitFor(page, () => window.__game._svc.stage === 'cheese', 3000));

  // --- cheese: hold-to-pour --------------------------------------------------
  const [cLo, cHi] = BAL.SCORE.BANDS[ticket.cheese];
  const full = BAL.PIZZA.CHEESE_FULL * BAL.PIZZA.SIZE_FACTOR[ticket.size];
  const cPct = await holdUntil(page, 610, 400,
    new Function(`return window.__game._svc.pizza.cheese.length / ${full} * 100`), cLo, cHi);
  check(`cheese inside ${ticket.cheese} band`, cPct >= cLo && cPct <= cHi, `(${cPct.toFixed(1)})`);

  await clickCanvas(page, 839, 470);          // NEXT
  check('→ toppings stage', await waitFor(page, () => window.__game._svc.stage === 'toppings', 3000));

  // --- out-of-stock block on a topping the ticket doesn't need ----------------
  const owned = await page.evaluate(() => window.__game.state.toppings);
  const needed = new Set(ticket.toppings.map(w => w.type));
  const spare = owned.find(t => !needed.has(t));
  if (spare) {
    await page.evaluate(t => { window.__game.state.stock[t] = 0; }, spare);
    const bi = owned.indexOf(spare);
    const bp = await canvasPoint(page, 258 + bi * 120 + 56, 602 + 50);
    await page.mouse.click(bp.x, bp.y);
    const held = await svcEval(page, () => window.__game._svc.held);
    check('empty bin refuses to give pieces', held === null, `(held ${JSON.stringify(held)})`);
  }

  // --- drag the ticket's pieces on ------------------------------------------------
  for (const w of ticket.toppings) {
    const bi = owned.indexOf(w.type);
    const stock0 = await page.evaluate(t => window.__game.state.stock[t], w.type);
    for (let i = 0; i < w.count; i++) {
      const from = await canvasPoint(page, 258 + bi * 120 + 56, 602 + 50);
      const a = i * 2.4, r = 28 + (i % 3) * 16;
      const to = await canvasPoint(page, 610 + Math.cos(a) * r, 400 + Math.sin(a) * r);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 4 });
      await page.mouse.up();
      await sleep(40);
    }
    const placed = await page.evaluate(t =>
      window.__game._svc.pizza.toppings.filter(p => p.type === t).length, w.type);
    const stock1 = await page.evaluate(t => window.__game.state.stock[t], w.type);
    check(`${w.count}× ${w.type} placed`, placed === w.count, `(placed ${placed})`);
    check(`stock ticked down by ${w.count}`, stock0 - stock1 === w.count, `(${stock0} → ${stock1})`);
  }

  await clickCanvas(page, 839, 470);          // NEXT
  check('→ to-oven stage', await waitFor(page, () => window.__game._svc.stage === 'tooven', 3000));

  // --- bake: insert, pull inside the ticket zone --------------------------------
  await clickCanvas(page, 1090, 350);
  check('pizza in the oven', await waitFor(page, () => window.__game._svc.stage === 'baking', 3000));
  const Z = BAL.OVEN.ZONES;
  const zoneLo = { raw: 0, light: Z.raw, normal: Z.light, well: Z.normal }[ticket.bake];
  const zoneHi = { raw: Z.raw, light: Z.light, normal: Z.normal, well: Z.well }[ticket.bake];
  const pullAt = zoneLo + (zoneHi - zoneLo) * 0.4;
  check('bake reaches the ticket zone', await waitFor(page,
    new Function(`return window.__game._svc.ovens[0].prog >= ${pullAt}`), 16000, 20));
  await clickCanvas(page, 1090, 350);
  check('pulled → serve stage', await waitFor(page, () => window.__game._svc.stage === 'serve', 3000));
  const zone = await svcEval(page, () => window.__game._svc.pizza.bakeZone);
  check(`bake zone is ${ticket.bake}`, zone === ticket.bake, `(got ${zone})`);

  // --- bell --------------------------------------------------------------------------
  await clickCanvas(page, 918, 248);
  check('order pays out', await waitFor(page, () =>
    window.__game._svc.served === 1 && window.__game.state.money > 0, 6000));
  const money = await page.evaluate(() => window.__game.state.money);
  const usage = await page.evaluate(() => window.__game._svc.usage);
  console.log(`  · paid ${money.toFixed(2)}, usage ${JSON.stringify(usage)}`);
  check('usage recorded for analytics',
    ticket.toppings.every(w => usage[w.type] === w.count));
  check('goal pill visible', await page.evaluate(() =>
    document.getElementById('hud-goal').textContent.includes('🎯')));

  await page.close();
}

// =====================================================================
// Scenario B — shop tabs from an injected day-5 save
// =====================================================================
console.log('scenario B: shop tabs + day board flags');
{
  const save = newGame();
  save.phase = 'shop';
  save.day = 5;
  save.money = 300;
  save.toppings = ['pepperoni', 'mushroom', 'onion'];
  save.stock = { pepperoni: 30, mushroom: 4, onion: 0 };
  save.recentRatings = [4, 4, 5, 4, 3, 4, 4, 5, 4, 4];
  save.stats.lifetimeServed = 28; save.stats.lifetimeEarned = 320;
  save.milestonesDone = { serve25: true, earn250: true };
  save.lastDay = {
    day: 4, served: 9, lost: 1, sales: 96.4, tips: 12.2, bonus: 11, restockSpend: 4.2,
    satAvg: 83.5, rating: 4.1,
    used: { pepperoni: 22, mushroom: 11, onion: 6 },
    toppingRevenue: { pepperoni: 19.2, mushroom: 9.8, onion: 5.5 },
    goalHit: true, goalDesc: 'No walk-outs all day', goalReward: 11,
  };

  const page = await newPage();
  await page.addInitScript(s => localStorage.setItem('slice-of-life-save-v1', JSON.stringify(s)), save);
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.click('#btn-continue');

  check('shop opens with specials banner', await waitFor(page, () =>
    document.querySelector('.shop-banner') && document.querySelector('.shop-banner').textContent.includes('special')));

  // restock tab: low/out flags + buying works (3 basics + 3 owned toppings)
  await page.click('.shop-tab[data-tab="restock"]');
  check('restock rows for basics + owned toppings',
    await page.locator('.rs-row:not(.rs-head-row)').count() === 6);
  check('shelf life shown per row', await page.evaluate(() =>
    [...document.querySelectorAll('.rs-shelf')].some(el => /keeps \dd/.test(el.textContent))));
  check('low + out stock flagged', await page.evaluate(() =>
    document.querySelector('.rs-stock.rs-low') !== null && document.querySelector('.rs-stock.rs-out') !== null));
  check('last-session usage shown', await page.evaluate(() =>
    [...document.querySelectorAll('.rs-used')].some(el => el.textContent === '×22')));
  const before = await page.evaluate(() => ({ money: window.__game.state.money, stock: window.__game.state.stock.onion }));
  await page.locator('.rs-row', { hasText: 'Onion' }).locator('.rs-btn').first().click();
  const after = await page.evaluate(() => ({
    money: window.__game.state.money, stock: window.__game.state.stock.onion,
    carried: window.__game.state.carriedRestockSpend,
  }));
  check('+5 restock adds stock, charges money', after.stock === before.stock + 5 && after.money < before.money);
  check('restock spend carried for analytics', after.carried > 0);

  // analytics tab
  await page.click('.shop-tab[data-tab="analytics"]');
  check('analytics shows the books', await page.evaluate(() =>
    document.querySelector('.an-panel') && document.querySelector('.an-title').textContent.includes('DAY 4')));
  check('per-topping margin rows + basics rows',
    await page.locator('.an-row:not(.an-head-row):not(.an-basic-row)').count() === 3
    && await page.locator('.an-basic-row').count() === 3);
  check('waste column present', await page.evaluate(() =>
    [...document.querySelectorAll('.an-head-row .an-num')].some(el => el.textContent === 'Waste')));

  // goals tab
  await page.click('.shop-tab[data-tab="goals"]');
  check('milestone rows with progress', await page.locator('.gl-row').count() === BAL.MILESTONES.length);
  check('completed milestones marked', await page.locator('.gl-row.gl-done').count() === 2);

  // supply upgrade present in equipment
  await page.click('.shop-tab[data-tab="equipment"]');
  check('supply deals upgrade listed', await page.evaluate(() =>
    [...document.querySelectorAll('.sc-title')].some(el => el.textContent.includes('Supply Deals'))));

  // open the day → board should flag mushroom (low) + onion was restocked to 5 (low)
  await page.click('#btn-open-day');
  check('day board shows on day 5 with back-to-shop', await waitFor(page, () =>
    !document.getElementById('ui-dayboard').classList.contains('hidden')
    && document.getElementById('db-shop') !== null));
  check('low-stock chips flagged on board', await page.evaluate(() =>
    document.querySelectorAll('.db-chip-low, .db-chip-out').length >= 1));
  check('board warns to restock', await page.evaluate(() =>
    document.querySelector('.db-warn') !== null));

  // back to shop keeps boosts/day intact
  await page.click('#db-shop');
  check('back-to-shop returns to the shop', await waitFor(page, () =>
    document.querySelector('.shop-panel') !== null));

  await page.close();
}

// =====================================================================
// Scenario C — second oven concurrency + automation arc
// (proofer one-click, auto-dispenser, cheese hopper, dual slots, bell)
// =====================================================================
console.log('scenario C: second oven + automation');
{
  const save = newGame();
  save.phase = 'service';
  save.day = 1;                       // 1-type tickets keep the build short
  save.money = 500;
  save.tutorialDone = true;
  save.level = 30;
  save.xp = 99999;
  save.upgrades.oven2 = 1;
  save.upgrades.proofer = 1;
  save.upgrades.ladle = 4;
  save.upgrades.shaker = 4;
  save.dials = { sauce: 'normal', cheese: 'normal' };
  // mark every unlock seen so no reveal card pauses the floor
  for (const u of BAL.UNLOCKS) save.seenUnlocks[`${u.kind}:${u.id}:${u.tier || 1}`] = true;

  const page = await newPage();
  await page.addInitScript(s => localStorage.setItem('slice-of-life-save-v1', JSON.stringify(s)), save);
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.click('#btn-continue');

  await waitFor(page, () => {
    const el = document.getElementById('ui-dayboard');
    return el && !el.classList.contains('hidden');
  });
  await page.click('#db-start');

  // strip randomness: plain identical tickets, no personas/groups/pre-orders
  await page.evaluate(() => {
    const svc = window.__game._svc;
    svc.preorders = [];
    svc.pending.forEach(c => {
      c.group = null; c.role = null; c.archetype = null; c.preorder = null; c.drainScale = 1;
      c.ticket = { size: 'M', sauce: 'normal', cheese: 'normal', bake: 'normal',
        sauceType: 'tomato', crust: 'classic', special: false,
        toppings: [{ type: 'pepperoni', count: 3 }] };
    });
    svc.arrivalIn = 0.1;
  });

  check('dual oven slots exist', await page.evaluate(() => window.__game._svc.ovens.length === 2));
  check('front arrives', await waitFor(page, () => window.__game._svc.stage === 'dough', 30000));

  // proofer: one click anywhere on the tray picks the ticket's base
  await clickCanvas(page, 355, 248);
  check('proofer one-click dough', await waitFor(page, () => window.__game._svc.stage === 'sauce', 4000));

  // auto-dispenser pours to the normal band by itself
  check('dispenser pours hands-free', await waitFor(page, () => {
    const svc = window.__game._svc;
    return svc.pizza && svc.pizza.sauceCoverage >= 50 && svc._auto.sauce && !svc._auto.sauce.active;
  }, 8000));
  await clickCanvas(page, 839, 470);          // NEXT
  check('→ cheese stage', await waitFor(page, () => window.__game._svc.stage === 'cheese', 3000));

  // hopper sprinkles to the band by itself
  check('hopper fills hands-free', await waitFor(page, () => {
    const svc = window.__game._svc;
    return svc.pizza && svc.pizza.cheese.length / 110 * 100 >= 50;
  }, 8000));
  await clickCanvas(page, 839, 470);          // NEXT
  check('→ toppings stage', await waitFor(page, () => window.__game._svc.stage === 'toppings', 3000));

  // three pepperoni on
  for (let i = 0; i < 3; i++) {
    const from = await canvasPoint(page, 258 + 56, 602 + 50);
    const to = await canvasPoint(page, 610 + Math.cos(i * 2.4) * 40, 400 + Math.sin(i * 2.4) * 40);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    await sleep(40);
  }
  await clickCanvas(page, 839, 470);          // NEXT
  await waitFor(page, () => window.__game._svc.stage === 'tooven', 3000);
  await clickCanvas(page, 1090, 350);         // into the oven

  // the flagship moment: customer steps aside, the counter frees up
  check('customer steps to the pickup spot', await waitFor(page, () =>
    window.__game._svc.customers.some(c => c.state === 'waiting'), 4000));
  check('oven slot bakes while the counter is free', await page.evaluate(() => {
    const svc = window.__game._svc;
    return svc.ovens[0].has && svc.stage !== 'baking';
  }));
  check('next customer can be taken mid-bake', await waitFor(page, () =>
    window.__game._svc.stage === 'dough', 30000));

  // pull slot 1 in its zone, ring the bell for the waiting customer
  const Z2 = BAL.OVEN.ZONES;
  await waitFor(page, new Function(`return window.__game._svc.ovens[0].prog >= ${Z2.light + 0.03}`), 16000, 20);
  await clickCanvas(page, 1020, 350);         // left slot half
  check('pulled to the pass', await waitFor(page, () =>
    !!window.__game._svc.passOrder, 3000));
  await clickCanvas(page, 918, 248);          // bell
  check('waiting customer served off the pass', await waitFor(page, () =>
    window.__game._svc.served === 1, 6000));
  check('the in-progress build survived the serve', await page.evaluate(() => {
    const svc = window.__game._svc;
    return svc.stage === 'dough' && svc.ticket !== null;
  }));

  await page.close();
}

// real console errors fail the run (audio autoplay warnings are not errors)
check('no console/page errors', errors.length === 0, '\n    ' + errors.join('\n    '));

await browser.close();
server.close();
console.log(failures === 0 ? '\nSMOKE TEST PASSED' : `\n${failures} SMOKE FAILURES`);
process.exit(failures ? 1 : 0);
