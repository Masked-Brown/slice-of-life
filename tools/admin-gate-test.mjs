// =====================================================================
// admin-gate-test.mjs — drives the real game in headless Chromium to
// verify the hidden admin panel's gating:
//   plain URL   → the dev module is never even fetched, no panel in the
//                 DOM, Ctrl+Shift+A does nothing
//   ?admin=1    → still nothing in the DOM until Ctrl+Shift+A; the panel
//                 then works (money / level / skip-to-day-end) and every
//                 telemetry event from the session is tagged dev:true
// Run: node tools/admin-gate-test.mjs
// =====================================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

const pw = resolvePlaywright();
const srv = await serve();
const PORT = srv.address().port;
const browser = await pw.chromium.launch();

// ---- scenario A: plain URL — no trace of the panel ---------------------------
console.log('plain URL (no ?admin=1)');
{
  const page = await browser.newPage();
  const fetched = [];
  page.on('request', r => fetched.push(r.url()));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await sleep(600);
  check('dev module never fetched', !fetched.some(u => u.includes('/dev/')));
  await page.keyboard.press('Control+Shift+A');
  await sleep(300);
  check('no panel element in the DOM',
    await page.evaluate(() => document.getElementById('dev-admin-panel') === null));
  await page.close();
}

// ---- scenario B: ?admin=1 — armed but invisible until the combo ---------------
console.log('?admin=1');
{
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/?admin=1`);
  await sleep(600);
  check('nothing in the DOM before the key combo',
    await page.evaluate(() => document.getElementById('dev-admin-panel') === null));

  await page.keyboard.press('Control+Shift+A');
  await sleep(200);
  const visible = await page.evaluate(() => {
    const p = document.getElementById('dev-admin-panel');
    return !!p && !p.hidden;
  });
  check('Ctrl+Shift+A opens the panel', visible);

  await page.keyboard.press('Control+Shift+A');
  await sleep(200);
  check('Ctrl+Shift+A again hides it',
    await page.evaluate(() => document.getElementById('dev-admin-panel').hidden));

  // exercise the controls headlessly
  await page.keyboard.press('Control+Shift+A');
  await sleep(200);
  const money0 = await page.evaluate(() => window.__game.state.money);
  await page.click('[data-act="money-1000"]');
  check('+£1000 lands', await page.evaluate(() => window.__game.state.money) === money0 + 1000);

  await page.fill('#adm-level', '15');
  await page.click('[data-act="set-level"]');
  check('set level 15 applies', await page.evaluate(() =>
    window.__game.state.level === 15 && window.__game.state.xp > 0));

  await page.click('[data-act="unlock-all"]');
  check('unlock everything owns the catalogue', await page.evaluate(() =>
    window.__game.state.sizeL && window.__game.state.upgrades.oven2 === 1
    && window.__game.state.toppings.includes('truffle')));

  await page.fill('#adm-day', '12');
  await page.click('[data-act="set-day"]');
  await sleep(300);
  check('set day jumps to a fresh day board', await page.evaluate(() =>
    window.__game.state.day === 12 && window.__game.sceneName === 'service'
    && window.__game._svc && !window.__game._svc.dayStarted));

  await page.click('[data-act="skip-day"]');
  await sleep(600);
  check('skip to day end reaches the receipt', await page.evaluate(() =>
    window.__game.sceneName === 'dayEnd' && window.__game.state.day === 13));

  await page.fill('#adm-ff', '3');
  await page.click('[data-act="ff"]');
  await sleep(600);
  check('fast-forward 3 days lands on the final receipt', await page.evaluate(() =>
    window.__game.sceneName === 'dayEnd' && window.__game.state.day === 16));

  check('all telemetry this session is dev-tagged', await page.evaluate(() => {
    const ev = JSON.parse(localStorage.getItem('slice-of-life-telemetry-v1')) || [];
    return ev.length > 0 && ev.every(e => e.dev === true);
  }));
  await page.close();
}

await browser.close();
srv.close();
console.log(failures ? `\n${failures} FAILED` : '\nall admin-gate checks passed');
process.exit(failures ? 1 : 0);
