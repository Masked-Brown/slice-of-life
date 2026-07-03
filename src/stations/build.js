// =====================================================================
// build.js — dough, sauce, cheese, toppings. The tactile heart of the
// game: everything here is hold-drag-feel. Owns the pizza model + render.
// =====================================================================

import { BAL, TOPPING_ORDER, ING } from '../balance.js';
import { clamp, lerp, rand, randi, dist, Juice, Ease, rr } from '../juice.js';
import { Sfx } from '../audio.js';
import { consumeStock, refundStock, unitCost, gbp } from '../state.js';
import { Score } from './serve.js';

// ---- layout (logical px) ----------------------------------------------
export const PIZZA_POS = { x: 610, y: 400 };
export const TRAY = { x: 252, y: 200, w: 206, h: 96 };
export const DOUGH_BALLS = [
  { size: 'S', x: 292, y: 252, r: 15 },
  { size: 'M', x: 352, y: 248, r: 20 },
  { size: 'L', x: 420, y: 244, r: 26 },
];
export const SAUCE_POT = { x: 318, y: 360, r: 34 };
export const CHEESE_BOX = { x: 318, y: 468, w: 76, h: 54 };
export const NEXT_BTN = { x: 768, y: 442, w: 142, h: 56 };
export const BINS_Y = 602;
const BIN_W = 112, BIN_H = 102, BIN_GAP = 8, BINS_X0 = 258;

const SAUCE_CANVAS = 272; // offscreen sauce paint buffer (px, square)
const HALF = SAUCE_CANVAS / 2;

// shared scratch canvas for composing the pizza with bake tint
const scratch = document.createElement('canvas');
scratch.width = scratch.height = 300;
const sctx = scratch.getContext('2d');

const OUTLINE = '#4a2e1d';

// ---- bake colour ramps ---------------------------------------------------
function rampColor(stops, t) {
  t = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(Math.floor(t), stops.length - 2);
  const k = t - i;
  const a = stops[i], b = stops[i + 1];
  return `rgb(${Math.round(lerp(a[0], b[0], k))},${Math.round(lerp(a[1], b[1], k))},${Math.round(lerp(a[2], b[2], k))})`;
}
const CRUST_RAMP = [[238, 213, 160], [224, 178, 96], [178, 116, 44], [58, 40, 26]];
const DOUGH_RAMP = [[245, 226, 180], [240, 210, 150], [216, 168, 96], [90, 64, 40]];

// paint palettes per sauce variant (core / rim-dab gradient / simmer spots)
const SAUCE_PAINT = {
  tomato: { core: 'rgba(199,58,25,0.98)', dabHi: 'rgba(214,72,34,1)', dabMid: 'rgba(196,56,24,0.95)', dabEdge: 'rgba(158,38,14,0)', spot: 'rgba(158,38,14,0.5)' },
  bbq:    { core: 'rgba(110,60,30,0.98)', dabHi: 'rgba(133,76,40,1)', dabMid: 'rgba(106,58,28,0.95)', dabEdge: 'rgba(78,40,18,0)', spot: 'rgba(70,36,16,0.55)' },
  white:  { core: 'rgba(238,228,204,0.98)', dabHi: 'rgba(248,241,222,1)', dabMid: 'rgba(232,220,192,0.95)', dabEdge: 'rgba(206,190,158,0)', spot: 'rgba(202,186,152,0.55)' },
};

export const Build = {

  // ---- order lifecycle ----------------------------------------------------
  resetForOrder(svc) {
    svc.pizza = null;
    svc.held = null;
    svc.splatCount = 0;
    svc.ghostPts = null;
    svc._pouring = false;        // hold-to-pour active (sauce or cheese)
    svc._pourCov = 0;            // sauce coverage % driven by hold time
    svc._wasInBand = false;      // for the band-entry tick
    svc._splatCD = 0;
    svc._cheeseAcc = 0;
    svc._binShake = null;        // { type, t } — empty-bin feedback wobble
    svc.orderGrades = {};        // { key: {grade: count} } consumed this order
    svc.sauceSel = 'tomato';     // pot selection (click the pot to cycle)
    svc.crustSel = 'classic';    // dough-tray selection
    svc._crustBtns = null;       // hit rects, rebuilt each render
  },

  // owned sauces / crusts in canonical order
  ownedSauces(svc) {
    return Object.keys(BAL.SAUCES).filter(k => svc.state.sauces.includes(k));
  },
  ownedCrusts(svc) {
    return Object.keys(BAL.CRUSTS).filter(k => svc.state.crusts.includes(k));
  },

  // consume one unit of a basic (dough/sauce/cheese). Never blocks: at zero
  // stock it auto-charges an emergency corner-shop run instead (soft-fail).
  useBasic(svc, key) {
    const r = consumeStock(svc.state, key, 1);
    if (r.taken >= 1) {
      svc.usage[key] = (svc.usage[key] || 0) + 1;
      this._recordGrades(svc, key, r.grades);
      this._basicWarning(svc, key);
      return;
    }
    const cost = unitCost(svc.state, key) * BAL.STOCK.EMERGENCY_MULT;
    svc.state.money -= cost;
    svc.emergencyCost = (svc.emergencyCost || 0) + cost;
    Juice.floatText(PIZZA_POS.x, PIZZA_POS.y - 150,
      `Corner-shop ${ING(key).label.toLowerCase()}! −${gbp(cost)}`, { color: '#ff8a70', size: 17 });
    Sfx.warn();
  },

  _recordGrades(svc, key, grades) {
    const slot = svc.orderGrades[key] || (svc.orderGrades[key] = {});
    for (const g in grades) slot[g] = (slot[g] || 0) + grades[g];
  },

  // one amber heads-up per basic per day, mirroring the bins
  _basicWarning(svc, key) {
    const n = svc.state.stock[key] | 0;
    if (n > 0 && n <= BAL.STOCK.LOW_AT_BASICS && !svc.lowWarned[key]) {
      svc.lowWarned[key] = true;
      Juice.floatText(PIZZA_POS.x, PIZZA_POS.y - 150,
        `Low on ${ING(key).label.toLowerCase()}!`, { color: '#f5b942', size: 17 });
      Sfx.warn();
    }
  },

  makePizza(size) {
    const R = BAL.PIZZA.RADIUS[size];
    const c = document.createElement('canvas');
    c.width = c.height = SAUCE_CANVAS;
    const charSeed = [];
    for (let i = 0; i < 9; i++) {
      const a = rand(0, Math.PI * 2), r = rand(0, R * 0.8);
      charSeed.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, r: rand(6, 14) });
    }
    return {
      size, R,
      x: PIZZA_POS.x, y: PIZZA_POS.y,
      scale: 1, sx: 1, sy: 1, rot: 0,
      sauceCanvas: c, sauceCtx: c.getContext('2d'),
      sauceCoverage: 0,
      cheese: [],
      toppings: [],
      bake: 0, bakeZone: 'raw',
      state: 'counter',
      charSeed,
    };
  },

  // dough ball arcs from the tray, slaps down, flattens
  spawnDough(svc, size) {
    const ball = DOUGH_BALLS.find(b => b.size === size);
    const pz = this.makePizza(size);
    pz.crust = svc.crustSel || 'classic';
    pz.x = ball.x; pz.y = ball.y;
    pz.scale = (ball.r * 2) / (pz.R * 2);
    pz.state = 'arc';
    svc.pizza = pz;

    const sx = ball.x, sy = ball.y, ex = PIZZA_POS.x, ey = PIZZA_POS.y;
    const apex = -120;
    Juice.tween({
      dur: 0.38, ease: Ease.linear,
      onUpdate: (e, t) => {
        pz.x = lerp(sx, ex, t);
        pz.y = lerp(sy, ey, t) + apex * 4 * t * (1 - t);
        pz.scale = lerp((ball.r * 2) / (pz.R * 2), 0.55, t);
        pz.rot = t * 2.2;
      },
      onDone: () => {
        pz.rot = 0;
        Sfx.doughSlap();
        Juice.flourPuff(ex, ey + 20, 14);
        // squash-and-stretch flatten into the base
        Juice.tween({ target: pz, to: { scale: 1 }, dur: 0.34, ease: Ease.outBack });
        Juice.tween({ target: pz, from: { sx: 1.35, sy: 0.5 }, to: { sx: 1, sy: 1 }, dur: 0.4, ease: Ease.outElastic });
        pz.state = 'counter';
        svc.onDoughDown(size);
      },
    });
  },

  // ---- per-frame -------------------------------------------------------
  update(svc, dt) {
    const pz = svc.pizza;

    if (svc._splatCD > 0) svc._splatCD -= dt;
    if (svc._binShake && (svc._binShake.t -= dt) <= 0) svc._binShake = null;

    // hold-to-pour: coverage grows from the centre while held
    if (svc.stage === 'sauce' && svc._pouring && pz) this._updateSaucePour(svc, dt);
    if (svc.stage === 'cheese' && svc._pouring && pz) this._updateCheesePour(svc, dt);
  },

  // current amount % for the active pour stage (drives gauge + band logic)
  pourPct(svc) {
    const pz = svc.pizza;
    if (!pz) return 0;
    return svc.stage === 'sauce' ? pz.sauceCoverage : Score.cheesePct(pz);
  },

  _inTicketBand(band, pct) {
    const [lo, hi] = Array.isArray(band) ? band : BAL.SCORE.BANDS[band];
    return pct >= lo && pct <= hi;
  },

  // the tick the moment the needle enters the ticket's band
  _bandFeedback(svc, band, pct) {
    const inBand = this._inTicketBand(band, pct);
    if (inBand && !svc._wasInBand) Sfx.bandTick();
    svc._wasInBand = inBand;
  },

  _updateSaucePour(svc, dt) {
    const pz = svc.pizza;
    const P = BAL.POUR;
    const tier = svc.state.upgrades.ladle;
    const band = Score.bandOf(svc.ticket, 'sauce');
    const inBand = this._inTicketBand(band, svc._pourCov);
    const rate = P.SAUCE_RATE[tier] * (inBand ? P.IN_BAND_SLOW[tier] : 1);
    svc._pourCov = clamp(svc._pourCov + rate * 100 * dt, 0, 100);
    pz.sauceCoverage = svc._pourCov;
    this._paintSauce(svc, pz);
    this._bandFeedback(svc, band, svc._pourCov);

    // holding past full slops sauce onto the counter
    if (svc._pourCov >= 99.5 && svc._splatCD <= 0) {
      svc._splatCD = P.OVERPOUR_SPLAT_CD;
      svc.splatCount++;
      const a = rand(0, Math.PI * 2);
      const sx = pz.x + Math.cos(a) * (pz.R * 1.08 + rand(4, 30));
      const sy = clamp(pz.y + Math.sin(a) * (pz.R * 0.8 + rand(4, 26)), 210, 575);
      const col = (BAL.SAUCES[pz.sauceType] || BAL.SAUCES.tomato).color;
      if (svc.splats.length < 14) svc.splats.push({ x: sx, y: sy, r: rand(8, 15), rot: rand(0, 6), color: col });
      Juice.splat(sx, sy, col, 5);
      Sfx.pat();
    }
  },

  // visual only — coverage % is authoritative, the canvas just looks the part
  _paintSauce(svc, pz) {
    const rim = pz.R * BAL.PIZZA.SAUCE_RIM;
    const targetR = rim * Math.sqrt(svc._pourCov / 100);
    if (targetR < 3) return;
    const P = SAUCE_PAINT[pz.sauceType] || SAUCE_PAINT.tomato;
    const c = pz.sauceCtx;
    c.save();
    c.beginPath(); c.arc(HALF, HALF, rim, 0, Math.PI * 2); c.clip();
    // solid wet core
    c.fillStyle = P.core;
    c.beginPath(); c.arc(HALF, HALF, targetR * 0.98, 0, Math.PI * 2); c.fill();
    // organic rim dabs so the edge spreads unevenly, like real sauce
    for (let i = 0; i < 9; i++) {
      const a = rand(0, Math.PI * 2);
      const r = targetR * rand(0.84, 1.05);
      const dabR = Math.max(6, targetR * rand(0.12, 0.22));
      const dx = HALF + Math.cos(a) * r, dy = HALF + Math.sin(a) * r;
      const grad = c.createRadialGradient(dx, dy, dabR * 0.15, dx, dy, dabR);
      grad.addColorStop(0, P.dabHi);
      grad.addColorStop(0.75, P.dabMid);
      grad.addColorStop(1, P.dabEdge);
      c.fillStyle = grad;
      c.beginPath(); c.arc(dx, dy, dabR, 0, Math.PI * 2); c.fill();
    }
    // darker simmer spots for texture
    if (Math.random() < 0.35) {
      const a = rand(0, Math.PI * 2), r = targetR * Math.sqrt(Math.random()) * 0.8;
      c.fillStyle = P.spot;
      c.beginPath();
      c.arc(HALF + Math.cos(a) * r, HALF + Math.sin(a) * r, rand(4, 9), 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  },

  _updateCheesePour(svc, dt) {
    const pz = svc.pizza;
    const P = BAL.POUR;
    const tier = svc.state.upgrades.shaker;
    const band = Score.bandOf(svc.ticket, 'cheese');
    const pct = Score.cheesePct(pz);
    const inBand = this._inTicketBand(band, pct);
    const rate = P.CHEESE_RATE[tier] * (inBand ? P.IN_BAND_SLOW[tier] : 1);
    svc._cheeseAcc += rate * dt;
    const full = BAL.PIZZA.CHEESE_FULL * BAL.PIZZA.SIZE_FACTOR[pz.size];
    while (svc._cheeseAcc >= 1) {
      svc._cheeseAcc -= 1;
      // flecks land from the centre outward as the pile grows
      const fillFrac = clamp(pz.cheese.length / full, 0, 1);
      const r = pz.R * 0.85 * Math.sqrt(Math.random()) * (0.4 + 0.6 * fillFrac);
      const a = rand(0, Math.PI * 2);
      this._dropCheese(svc, Math.cos(a) * r, Math.sin(a) * r);
    }
    this._bandFeedback(svc, band, Score.cheesePct(pz));
  },

  // lx/ly are pizza-local coordinates
  _dropCheese(svc, lx, ly) {
    const pz = svc.pizza;
    if (pz.cheese.length >= 430) return;
    const fleck = { x: lx, y: ly, rot: rand(0, Math.PI), len: rand(6, 11), shade: Math.random(), s: 0 };
    pz.cheese.push(fleck);
    Juice.tween({ target: fleck, to: { s: 1 }, dur: 0.18, ease: Ease.outBack });
    if (pz.cheese.length % 4 === 0) Sfx.cheeseTick();
  },

  // ---- pointer ------------------------------------------------------------
  onDown(svc, x, y) {
    const st = svc.stage, pz = svc.pizza;

    // NEXT button
    if (this._nextVisible(svc) && this._inNext(x, y)) {
      svc._nextPress = true;
      Sfx.press();
      return;
    }

    if (st === 'dough') {
      // crust selector chips above the tray
      if (svc._crustBtns) {
        for (const cb of svc._crustBtns) {
          if (x >= cb.x && x <= cb.x + cb.w && y >= cb.y && y <= cb.y + cb.h) {
            svc.crustSel = cb.key;
            Sfx.press();
            return;
          }
        }
      }
      for (const b of DOUGH_BALLS) {
        if (dist(x, y, b.x, b.y) < b.r + 14) {
          if (b.size === 'L' && !svc.state.sizeL) {
            Sfx.popOff();
            Juice.floatText(b.x, b.y - 36, 'Locked!', { color: '#ff9b80', size: 17 });
            return;
          }
          Sfx.press();
          svc.stage = 'doughdrop';
          this.useBasic(svc, 'dough');
          this.spawnDough(svc, b.size);
          return;
        }
      }
    } else if (st === 'sauce') {
      // clicking the pot cycles the sauce variant (before any pour lands)
      if (dist(x, y, SAUCE_POT.x, SAUCE_POT.y) < SAUCE_POT.r + 8) {
        const owned = this.ownedSauces(svc);
        if (owned.length > 1) {
          if (pz && pz.sauceCoverage > 0) {
            Juice.floatText(SAUCE_POT.x, SAUCE_POT.y - 50, 'Already sauced!', { color: '#ff9b80', size: 15 });
            Sfx.popOff();
          } else {
            svc.sauceSel = owned[(owned.indexOf(svc.sauceSel) + 1) % owned.length];
            Juice.floatText(SAUCE_POT.x, SAUCE_POT.y - 50,
              BAL.SAUCES[svc.sauceSel].label, { color: '#fff6e0', size: 16 });
            Sfx.press();
          }
          return;
        }
      }
      // press & hold near the pizza to pour from the centre
      if (pz && dist(x, y, pz.x, pz.y) < pz.R * 1.35) {
        if (!pz.sauceType) pz.sauceType = svc.sauceSel;
        svc._pouring = true;
        Sfx.sauceStart();
      }
    } else if (st === 'cheese') {
      if (pz && dist(x, y, pz.x, pz.y) < pz.R * 1.35) {
        svc._pouring = true;
        svc._cheeseAcc = 1;
      }
    } else if (st === 'toppings') {
      // pick up a placed piece (topmost first)
      if (pz) {
        for (let i = pz.toppings.length - 1; i >= 0; i--) {
          const t = pz.toppings[i];
          if (dist(x, y, pz.x + t.x, pz.y + t.y) < BAL.PIZZA.TOPPING_R + 4) {
            pz.toppings.splice(i, 1);
            svc.held = { type: t.type, x, y, n: 1 };
            Sfx.pluck();
            return;
          }
        }
      }
      // grab from a bin (stock permitting)
      const bin = this._binAt(svc, x, y);
      if (bin) {
        const binStock = svc.state.stock[bin.type] | 0;
        if (binStock <= 0) {
          // empty bin — the order has to go out without it
          svc._binShake = { type: bin.type, t: 0.4 };
          Juice.floatText(bin.x + bin.w / 2, bin.y - 30,
            `Out of ${BAL.TOPPINGS[bin.type].label}!`, { color: '#ff8a70', size: 17 });
          Sfx.popOff();
          return;
        }
        let n = 1;
        if (svc.state.upgrades.tongs >= 3 && binStock >= 2) {
          const w = this._needed(svc, bin.type);
          const placed = pz ? pz.toppings.filter(t => t.type === bin.type).length : 0;
          if (w != null && w - placed >= 2) n = 2; // double-grab when ≥2 still needed
        }
        const r = consumeStock(svc.state, bin.type, n);
        this._recordGrades(svc, bin.type, r.grades);
        this._stockWarning(svc, bin.type);
        svc.held = { type: bin.type, x, y, n };
        Sfx.pluck();
      }
    } else if (st === 'tooven' && pz && pz.state === 'counter') {
      if (dist(x, y, pz.x, pz.y) < pz.R + 12) {
        pz.state = 'drag';
        pz.dragOff = { x: pz.x - x, y: pz.y - y };
        Juice.killTweensOf(pz);
        Sfx.pluck();
      }
    }
  },

  onMove(svc, x, y) {
    const pz = svc.pizza;
    if (svc.held) { svc.held.x = x; svc.held.y = y; }
    if (pz && pz.state === 'drag') {
      pz.x = x + pz.dragOff.x;
      pz.y = y + pz.dragOff.y;
    }
    // NEXT hover
    const overNext = this._nextVisible(svc) && this._inNext(x, y);
    if (overNext && !svc._nextHover) Sfx.tick();
    svc._nextHover = overNext;
    // bin hover
    const bin = this._binAt(svc, x, y);
    svc._binHover = bin ? bin.type : null;
    // dough hover
    svc._doughHover = null;
    if (svc.stage === 'dough') {
      for (const b of DOUGH_BALLS) if (dist(x, y, b.x, b.y) < b.r + 14) svc._doughHover = b.size;
    }
  },

  onUp(svc, x, y) {
    const pz = svc.pizza;

    if (svc._nextPress) {
      svc._nextPress = false;
      if (this._inNext(x, y)) svc.advanceStage();
      return;
    }

    if (svc._pouring) {
      svc._pouring = false;
      if (svc.stage === 'sauce') Sfx.sauceStop();
    }

    if (svc.held && pz) {
      const h = svc.held;
      svc.held = null;
      // a piece that misses the pizza goes back in its bin
      if (!this._placePiece(svc, h.type, x, y)) refundStock(svc.state, h.type);
      if (h.n === 2) {
        // second piece lands beside the first on a free grid point
        const spot = this._freeGhost(svc, x, y, true);
        if (spot) this._placePiece(svc, h.type, pz.x + spot.x, pz.y + spot.y, 0.08);
        else refundStock(svc.state, h.type);
      }
    } else if (svc.held) {
      refundStock(svc.state, svc.held.type, svc.held.n);
      svc.held = null;
    }

    if (pz && pz.state === 'drag') {
      // not over the oven → snap back to the counter
      pz.state = 'counter';
      Juice.tween({ target: pz, to: { x: PIZZA_POS.x, y: PIZZA_POS.y }, dur: 0.3, ease: Ease.outBack });
    }
  },

  _placePiece(svc, type, x, y, delay = 0) {
    const pz = svc.pizza;
    const tongs = svc.state.upgrades.tongs;
    let lx = x - pz.x, ly = y - pz.y;
    let d = Math.hypot(lx, ly);
    const maxR = pz.R * 0.82;

    // tongs t2+: snap to the ghost grid for fast neat placement
    if (tongs >= 2) {
      const spot = this._freeGhost(svc, x, y, false);
      if (spot) { lx = spot.x; ly = spot.y; d = Math.hypot(lx, ly); }
    }

    if (d > maxR) {
      if (tongs >= 1 && d < pz.R * 1.25) {
        // edge-save grip: nudge the piece back inside the rim
        const k = maxR / d;
        lx *= k; ly *= k;
      } else {
        // missed the pizza — back to the bin (caller refunds stock)
        Juice.flourPuff(x, y + 6, 5);
        Sfx.pat();
        return false;
      }
    }

    const piece = { type, x: lx, y: ly, rot: rand(0, Math.PI * 2), s: 1.35, sy: 1 };
    pz.toppings.push(piece);
    Juice.tween({
      target: piece, to: { s: 1 }, dur: 0.22, ease: Ease.outBack, delay,
      onDone: () => {
        Sfx.pat();
        Juice.tween({ target: piece, from: { sy: 0.72 }, to: { sy: 1 }, dur: 0.25, ease: Ease.outElastic });
      },
    });
    return true;
  },

  // amber heads-up the moment a bin dips low, red shout when it empties
  _stockWarning(svc, type) {
    const stock = svc.state.stock[type] | 0;
    const bin = this.bins(svc).find(b => b.type === type);
    if (!bin) return;
    const label = BAL.TOPPINGS[type].label;
    if (stock === 0 && !svc.outWarned[type]) {
      svc.outWarned[type] = true;
      Juice.floatText(bin.x + bin.w / 2, bin.y - 30, `${label} EMPTY!`, { color: '#ff6b52', size: 19 });
      Sfx.warn();
    } else if (stock > 0 && stock <= BAL.STOCK.LOW_AT && !svc.lowWarned[type]) {
      svc.lowWarned[type] = true;
      Juice.floatText(bin.x + bin.w / 2, bin.y - 30, `Low on ${label}!`, { color: '#f5b942', size: 17 });
      Sfx.warn();
    }
  },

  _needed(svc, type) {
    const t = svc.ticket;
    if (!t) return null;
    const w = t.toppings.find(w => w.type === type);
    return w ? w.count : null;
  },

  _ghostPoints(svc) {
    const pz = svc.pizza;
    if (!svc.ghostPts || svc.ghostPts.R !== pz.R) {
      const pts = [];
      const N = 26;
      for (let i = 0; i < N; i++) {
        const r = pz.R * 0.76 * Math.sqrt((i + 0.5) / N);
        const a = i * 2.39996;
        pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
      }
      svc.ghostPts = { R: pz.R, pts };
    }
    return svc.ghostPts.pts;
  },

  _freeGhost(svc, x, y, any) {
    const pz = svc.pizza;
    if (!pz) return null;
    const pts = this._ghostPoints(svc);
    const lx = x - pz.x, ly = y - pz.y;
    let best = null, bestD = any ? 1e9 : BAL.PIZZA.GRID_SNAP_DIST;
    for (const pt of pts) {
      const occupied = pz.toppings.some(t => dist(t.x, t.y, pt.x, pt.y) < BAL.PIZZA.TOPPING_R * 1.4);
      if (occupied) continue;
      const d = dist(lx, ly, pt.x, pt.y);
      if (d < bestD) { bestD = d; best = pt; }
    }
    return best;
  },

  // ---- stage evaluation (per-station feedback pops) -------------------------
  evalStage(svc) {
    const pz = svc.pizza, t = svc.ticket;
    if (svc.stage === 'sauce') {
      // wrong variant sinks the station no matter how neat the pour
      if (t.sauceType && pz.sauceType && pz.sauceType !== t.sauceType) return 'off';
      return Score.amountGrade(pz.sauceCoverage, Score.bandOf(t, 'sauce'));
    }
    if (svc.stage === 'cheese') return Score.amountGrade(Score.cheesePct(pz), Score.bandOf(t, 'cheese'));
    if (svc.stage === 'toppings') return Score.toppingsResult(pz, t).grade;
    return 'good';
  },

  // ---- geometry helpers -------------------------------------------------
  _nextVisible(svc) {
    return ['sauce', 'cheese', 'toppings'].includes(svc.stage);
  },
  _inNext(x, y) {
    const b = NEXT_BTN;
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  },

  // bins stay at the V2 spot while ≤8 owned; past that the whole row
  // compresses and slides left so every bin keeps a seat at the counter
  bins(svc) {
    const owned = TOPPING_ORDER.filter(t => svc.state.toppings.includes(t));
    const n = owned.length;
    let pitch = BIN_W + BIN_GAP;
    let x0 = BINS_X0;
    if (BINS_X0 + n * pitch > 1272) {
      pitch = Math.floor((1272 - 10) / n);
      x0 = 10;
    }
    const w = Math.min(BIN_W, pitch - 6);
    return owned.map((type, i) => ({
      type, x: x0 + i * pitch, y: BINS_Y, w, h: BIN_H,
    }));
  },

  _binAt(svc, x, y) {
    if (svc.stage !== 'toppings') return null;
    return this.bins(svc).find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) || null;
  },

  // =====================================================================
  // RENDER
  // =====================================================================
  render(svc, ctx) {
    this._renderSplats(svc, ctx);
    this._renderTray(svc, ctx);
    this._renderPotAndBox(svc, ctx);

    const pz = svc.pizza;
    if (pz && pz.state !== 'oven') {
      // soft shadow
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(pz.x, pz.y + pz.R * pz.scale * 0.16 + 8, pz.R * pz.scale * 1.02, pz.R * pz.scale * 0.36, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      this.drawPizza(ctx, pz);
    }

    // band gauge: how full vs the ticket's band (sauce & cheese stages)
    if (pz && (svc.stage === 'sauce' || svc.stage === 'cheese') && svc.ticket) {
      this._renderGauge(svc, ctx, pz);
    }

    // half-and-half: the divider and side labels during toppings
    if (pz && svc.ticket && svc.ticket.half && svc.stage === 'toppings' && pz.state === 'counter') {
      ctx.save();
      ctx.setLineDash([7, 6]);
      ctx.strokeStyle = 'rgba(255,251,239,0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(pz.x, pz.y - pz.R - 10);
      ctx.lineTo(pz.x, pz.y + pz.R + 10);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '900 17px Trebuchet MS, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,251,239,0.9)';
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4; ctx.lineJoin = 'round';
      ctx.strokeText('L', pz.x - pz.R - 22, pz.y);
      ctx.fillText('L', pz.x - pz.R - 22, pz.y);
      ctx.strokeText('R', pz.x + pz.R + 22, pz.y);
      ctx.fillText('R', pz.x + pz.R + 22, pz.y);
      ctx.restore();
    }

    // ghost grid hint while holding a piece (tongs t2+)
    if (svc.held && pz && svc.state.upgrades.tongs >= 2) {
      const spot = this._freeGhost(svc, svc.held.x, svc.held.y, false);
      if (spot) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(pz.x + spot.x, pz.y + spot.y, BAL.PIZZA.TOPPING_R + 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    this._renderBins(svc, ctx);
    this._renderNext(svc, ctx);
    this._renderHeldAndTool(svc, ctx);
  },

  _renderSplats(svc, ctx) {
    ctx.save();
    for (const s of svc.splats) {
      ctx.fillStyle = s.color || 'rgba(170,46,18,0.85)';
      ctx.globalAlpha = 0.85;
      ctx.save();
      ctx.translate(s.x, s.y); ctx.rotate(s.rot);
      ctx.beginPath(); ctx.ellipse(0, 0, s.r, s.r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(s.r * 0.9, s.r * 0.3, s.r * 0.35, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-s.r * 0.8, -s.r * 0.4, s.r * 0.28, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#f3d98a';
    for (const c of svc.crumbs) {
      ctx.save();
      ctx.translate(c.x, c.y); ctx.rotate(c.rot);
      ctx.fillRect(-c.len / 2, -1.5, c.len, 3);
      ctx.restore();
    }
    ctx.restore();
  },

  _renderTray(svc, ctx) {
    const active = svc.stage === 'dough';
    ctx.save();
    ctx.globalAlpha = active ? 1 : 0.75;
    // tray
    rr(ctx, TRAY.x, TRAY.y, TRAY.w, TRAY.h, 14);
    ctx.fillStyle = '#9c6b3c'; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE; ctx.stroke();
    rr(ctx, TRAY.x + 7, TRAY.y + 7, TRAY.w - 14, TRAY.h - 14, 9);
    ctx.fillStyle = '#b98350'; ctx.fill();

    for (const b of DOUGH_BALLS) {
      const locked = b.size === 'L' && !svc.state.sizeL;
      const hov = svc._doughHover === b.size && active && !locked;
      const lift = hov ? -5 : 0;
      const r = b.r * (hov ? 1.12 : 1);
      ctx.save();
      ctx.globalAlpha *= locked ? 0.45 : 1;
      // ball
      ctx.fillStyle = '#f5e2b4';
      ctx.beginPath(); ctx.arc(b.x, b.y + lift, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 3.5; ctx.strokeStyle = OUTLINE; ctx.stroke();
      ctx.fillStyle = '#fff3d6';
      ctx.beginPath(); ctx.arc(b.x - r * 0.3, b.y + lift - r * 0.3, r * 0.32, 0, Math.PI * 2); ctx.fill();
      // label
      ctx.fillStyle = locked ? '#7a6a55' : '#4a2e1d';
      ctx.font = '900 15px Trebuchet MS, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.size, b.x, b.y + lift + r + 14);
      if (locked) {
        ctx.font = '14px system-ui';
        ctx.fillText('🔒', b.x, b.y + lift);
      }
      ctx.restore();
    }
    // glow when it's dough time
    if (active) {
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(svc.elapsed * 5);
      rr(ctx, TRAY.x - 4, TRAY.y - 4, TRAY.w + 8, TRAY.h + 8, 16);
      ctx.lineWidth = 4; ctx.strokeStyle = '#ffd54a'; ctx.stroke();
    }
    ctx.globalAlpha = 1;
    this._stockChip(svc, ctx, 'dough', TRAY.x + 6, TRAY.y - 10);
    this._renderCrustChips(svc, ctx, active);
    ctx.restore();
  },

  // crust selector above the tray (once a second crust is owned)
  _renderCrustChips(svc, ctx, active) {
    const crusts = this.ownedCrusts(svc);
    if (crusts.length < 2) { svc._crustBtns = null; return; }
    const w = 66, h = 22, gap = 5;
    const x0 = TRAY.x + 56, y = TRAY.y - 13;
    svc._crustBtns = crusts.map((key, i) => ({ key, x: x0 + i * (w + gap), y, w, h }));
    ctx.save();
    ctx.globalAlpha = active ? 1 : 0.7;
    ctx.font = '900 11px Trebuchet MS, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const cb of svc._crustBtns) {
      const on = svc.crustSel === cb.key;
      rr(ctx, cb.x, cb.y, cb.w, cb.h, 11);
      ctx.fillStyle = on ? '#e2725b' : '#e6d3ac';
      ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = OUTLINE; ctx.stroke();
      ctx.fillStyle = on ? '#fff6e8' : '#4a2e1d';
      ctx.fillText(BAL.CRUSTS[cb.key].label.toUpperCase(), cb.x + cb.w / 2, cb.y + cb.h / 2 + 0.5);
    }
    ctx.restore();
  },

  // small ×N stock chip for a basics station — amber low, red empty
  _stockChip(svc, ctx, key, x, y) {
    const n = svc.state.stock[key] | 0;
    const low = n > 0 && n <= BAL.STOCK.LOW_AT_BASICS;
    ctx.save();
    rr(ctx, x, y, 42, 19, 9);
    ctx.fillStyle = n === 0 ? '#e25540' : low ? '#f5b942' : '#fffbef';
    ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = OUTLINE; ctx.stroke();
    if (low || n === 0) {
      ctx.globalAlpha = 0.45 + 0.3 * Math.sin(svc.elapsed * (n === 0 ? 8 : 5));
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = n === 0 ? '#e25540' : '#f5b942';
      rr(ctx, x - 3, y - 3, 48, 25, 11);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = n === 0 ? '#fff' : '#4a2e1d';
    ctx.font = '900 12px Trebuchet MS, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`×${n}`, x + 21, y + 10);
    ctx.restore();
  },

  _renderPotAndBox(svc, ctx) {
    // sauce pot — filled with the selected variant, click to cycle
    const sauceCol = (BAL.SAUCES[svc.sauceSel] || BAL.SAUCES.tomato).color;
    const multiSauce = this.ownedSauces(svc).length > 1;
    ctx.save();
    ctx.globalAlpha = svc.stage === 'sauce' ? 1 : 0.75;
    ctx.fillStyle = '#8d8d96';
    ctx.beginPath(); ctx.arc(SAUCE_POT.x, SAUCE_POT.y, SAUCE_POT.r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE; ctx.stroke();
    ctx.fillStyle = sauceCol;
    ctx.beginPath(); ctx.arc(SAUCE_POT.x, SAUCE_POT.y, SAUCE_POT.r - 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.ellipse(SAUCE_POT.x - 8, SAUCE_POT.y - 8, 10, 6, -0.6, 0, Math.PI * 2); ctx.fill();
    if (multiSauce) {
      ctx.fillStyle = '#fff6e0';
      ctx.font = '900 11px Trebuchet MS, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`◂ ${BAL.SAUCES[svc.sauceSel].label.toUpperCase()} ▸`, SAUCE_POT.x, SAUCE_POT.y + SAUCE_POT.r + 15);
    }
    if (svc.stage === 'sauce') {
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(svc.elapsed * 5);
      ctx.beginPath(); ctx.arc(SAUCE_POT.x, SAUCE_POT.y, SAUCE_POT.r + 5, 0, Math.PI * 2);
      ctx.lineWidth = 4; ctx.strokeStyle = '#ffd54a'; ctx.stroke();
    }
    ctx.globalAlpha = svc.stage === 'sauce' ? 1 : 0.85;
    this._stockChip(svc, ctx, 'sauce', SAUCE_POT.x - 21, SAUCE_POT.y - SAUCE_POT.r - 26);
    ctx.restore();

    // cheese box
    ctx.save();
    ctx.globalAlpha = svc.stage === 'cheese' ? 1 : 0.75;
    rr(ctx, CHEESE_BOX.x - CHEESE_BOX.w / 2, CHEESE_BOX.y - CHEESE_BOX.h / 2, CHEESE_BOX.w, CHEESE_BOX.h, 9);
    ctx.fillStyle = '#d9c08a'; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE; ctx.stroke();
    ctx.fillStyle = '#f7d774';
    for (let i = 0; i < 9; i++) {
      const fx = CHEESE_BOX.x + ((i * 37) % CHEESE_BOX.w) - CHEESE_BOX.w / 2 + 6;
      const fy = CHEESE_BOX.y + ((i * 23) % (CHEESE_BOX.h - 14)) - CHEESE_BOX.h / 2 + 4;
      ctx.save(); ctx.translate(fx, fy); ctx.rotate(i * 0.7);
      ctx.fillRect(-4, -1.5, 8, 3);
      ctx.restore();
    }
    if (svc.stage === 'cheese') {
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(svc.elapsed * 5);
      rr(ctx, CHEESE_BOX.x - CHEESE_BOX.w / 2 - 5, CHEESE_BOX.y - CHEESE_BOX.h / 2 - 5, CHEESE_BOX.w + 10, CHEESE_BOX.h + 10, 11);
      ctx.lineWidth = 4; ctx.strokeStyle = '#ffd54a'; ctx.stroke();
    }
    ctx.globalAlpha = svc.stage === 'cheese' ? 1 : 0.85;
    this._stockChip(svc, ctx, 'cheese', CHEESE_BOX.x - 21, CHEESE_BOX.y - CHEESE_BOX.h / 2 - 26);
    ctx.restore();
  },

  // Vertical fill gauge left of the pizza: band segments, ticket band in
  // pulsing gold, needle at the current amount. Same language as the oven meter.
  _renderGauge(svc, ctx, pz) {
    const which = svc.stage === 'sauce' ? 'sauce' : 'cheese';
    const pct = this.pourPct(svc);
    const MAX = 115;                        // gauge top (heavy band ends 112)
    const W = 18, H = 170;
    const gx = pz.x - pz.R - 52, gy = pz.y - H / 2;
    const yFor = p => gy + H - (clamp(p, 0, MAX) / MAX) * H;

    ctx.save();
    // frame + track
    rr(ctx, gx - 4, gy - 4, W + 8, H + 8, 8);
    ctx.fillStyle = '#4a2e1d'; ctx.fill();
    ctx.fillStyle = '#2e1d12';
    ctx.fillRect(gx, gy, W, H);

    // band segments
    const COLS = { light: '#fde9c8', normal: '#f7c173', heavy: '#ef9b4e' };
    for (const [name, [lo, hi]] of Object.entries(BAL.SCORE.BANDS)) {
      ctx.fillStyle = COLS[name];
      ctx.fillRect(gx, yFor(hi), W, yFor(lo) - yFor(hi));
    }

    // ticket band: pulsing gold outline (+ green glow when the needle is inside)
    // — modifiers ("no cheese", "double sauce") move this band, so the gauge
    // is always telling the truth about what the ticket wants
    const [lo, hi] = Score.bandOf(svc.ticket, which);
    const inBand = pct >= lo && pct <= hi;
    ctx.save();
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(svc.elapsed * 6);
    ctx.lineWidth = 4;
    ctx.strokeStyle = inBand ? '#9fe07c' : '#ffd54a';
    rr(ctx, gx - 2, yFor(hi) - 2, W + 4, yFor(lo) - yFor(hi) + 4, 5);
    ctx.stroke();
    ctx.restore();

    // current fill line up the side
    ctx.fillStyle = inBand ? '#9fe07c' : '#fffbef';
    ctx.fillRect(gx + W + 5, yFor(pct), 3, gy + H - yFor(pct));

    // needle
    const ny = yFor(pct);
    ctx.fillStyle = '#fffbef';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(gx - 6, ny);
    ctx.lineTo(gx - 16, ny - 7);
    ctx.lineTo(gx - 16, ny + 7);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillRect(gx - 2, ny - 1.5, W + 4, 3);

    // band initials
    ctx.fillStyle = '#4a2e1d';
    ctx.font = '900 10px Trebuchet MS, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [name, [blo, bhi]] of Object.entries(BAL.SCORE.BANDS)) {
      ctx.fillText(name[0].toUpperCase(), gx + W / 2, (yFor(blo) + yFor(bhi)) / 2);
    }

    // header
    ctx.fillStyle = '#fff6e0';
    ctx.font = '900 11px Trebuchet MS, system-ui, sans-serif';
    ctx.fillText(svc.stage === 'sauce' ? 'SAUCE' : 'CHEESE', gx + W / 2, gy - 16);
    if (inBand) {
      ctx.fillStyle = '#9fe07c';
      ctx.fillText('IN BAND!', gx + W / 2, gy + H + 16);
    }
    ctx.restore();
  },

  _renderBins(svc, ctx) {
    const active = svc.stage === 'toppings';
    const pz = svc.pizza;
    for (const b of this.bins(svc)) {
      const stock = svc.state.stock[b.type] | 0;
      const low = stock > 0 && stock <= BAL.STOCK.LOW_AT;
      const out = stock === 0;
      const hov = active && svc._binHover === b.type;
      const lift = hov ? -6 : 0;
      // empty-bin wobble feedback
      const shake = svc._binShake && svc._binShake.type === b.type
        ? Math.sin(svc._binShake.t * 50) * 5 * (svc._binShake.t / 0.4) : 0;
      ctx.save();
      ctx.translate(shake, 0);
      ctx.globalAlpha = active ? 1 : 0.55;
      // bin body
      rr(ctx, b.x, b.y + lift, b.w, b.h, 12);
      ctx.fillStyle = hov ? '#aab4bd' : '#98a2ab';
      ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE; ctx.stroke();
      // low/out alert glow — visible at every stage so run-outs never surprise
      if (low || out) {
        ctx.save();
        ctx.globalAlpha = 0.45 + 0.3 * Math.sin(svc.elapsed * (out ? 8 : 5));
        ctx.lineWidth = 5;
        ctx.strokeStyle = out ? '#e25540' : '#f5b942';
        rr(ctx, b.x - 4, b.y - 4 + lift, b.w + 8, b.h + 8, 14);
        ctx.stroke();
        ctx.restore();
      }
      rr(ctx, b.x + 6, b.y + 6 + lift, b.w - 12, b.h - 30, 8);
      ctx.fillStyle = '#6e7880'; ctx.fill();

      // heap of pieces — thins out as stock runs down
      const heapN = Math.min(5, Math.ceil(stock / 5));
      ctx.save();
      rr(ctx, b.x + 6, b.y + 6 + lift, b.w - 12, b.h - 30, 8);
      ctx.clip();
      for (let i = 0; i < heapN; i++) {
        const px = b.x + 20 + ((i * 41) % (b.w - 40));
        const py = b.y + 22 + lift + ((i * 29) % (b.h - 52));
        drawToppingShape(ctx, b.type, px, py, (i * 1.3) % 6.2, 0.95, 0);
      }
      ctx.restore();
      if (out) {
        ctx.save();
        ctx.translate(b.x + b.w / 2, b.y + (b.h - 24) / 2 + lift);
        ctx.rotate(-0.12);
        ctx.fillStyle = '#e25540';
        ctx.font = '900 17px Trebuchet MS, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('OUT', 0, 0);
        ctx.restore();
      }

      // stock chip (top-left)
      rr(ctx, b.x + 4, b.y + 4 + lift, 40, 19, 9);
      ctx.fillStyle = out ? '#e25540' : low ? '#f5b942' : '#fffbef';
      ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = OUTLINE; ctx.stroke();
      ctx.fillStyle = out ? '#fff' : '#4a2e1d';
      ctx.font = '900 12px Trebuchet MS, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`×${stock}`, b.x + 24, b.y + 14 + lift);

      // label + needed count chip (narrow bins get short labels)
      let label = BAL.TOPPINGS[b.type].label;
      if (b.w < 90) label = label.split(' ')[0].slice(0, 8).replace(/-$/, '');
      ctx.fillStyle = '#fffbef';
      ctx.font = `800 ${b.w < 90 ? 10 : 12}px Trebuchet MS, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, b.x + b.w / 2, b.y + b.h - 12 + lift);

      if (active) {
        const need = this._needed(svc, b.type);
        if (need != null) {
          const placed = pz ? pz.toppings.filter(t => t.type === b.type).length : 0;
          const done = placed === need;
          rr(ctx, b.x + b.w / 2 - 22, b.y - 14 + lift, 44, 22, 11);
          ctx.fillStyle = done ? '#7bbf5e' : '#fffbef';
          ctx.fill();
          ctx.lineWidth = 3; ctx.strokeStyle = OUTLINE; ctx.stroke();
          ctx.fillStyle = done ? '#fff' : '#4a2e1d';
          ctx.font = '900 13px Trebuchet MS, system-ui, sans-serif';
          ctx.fillText(placed > 0 ? `${placed}/${need}` : `×${need}`, b.x + b.w / 2, b.y - 3 + lift);
        }
      }
      ctx.restore();
    }
  },

  _renderNext(svc, ctx) {
    if (!this._nextVisible(svc)) return;
    const b = NEXT_BTN;
    const press = svc._nextPress ? 0.92 : 1;
    const hov = svc._nextHover && !svc._nextPress;
    ctx.save();
    ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
    ctx.scale(press, press);
    if (hov) ctx.translate(0, -2);
    rr(ctx, -b.w / 2, -b.h / 2 + 4, b.w, b.h, 14);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
    rr(ctx, -b.w / 2, -b.h / 2, b.w, b.h, 14);
    ctx.fillStyle = hov ? '#f0836b' : '#e2725b';
    ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE; ctx.stroke();
    ctx.fillStyle = '#fff6e8';
    ctx.font = '900 22px Trebuchet MS, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('NEXT ➜', 0, 1);
    ctx.restore();
  },

  _renderHeldAndTool(svc, ctx) {
    const p = svc.game.pointer;

    if (svc.stage === 'sauce') {
      const pz = svc.pizza;
      const pourCol = (BAL.SAUCES[(pz && pz.sauceType) || svc.sauceSel] || BAL.SAUCES.tomato).color;
      // pour stream: sauce drops fall from the ladle toward the pizza centre
      if (svc._pouring && pz) {
        ctx.save();
        for (let i = 0; i < 3; i++) {
          const k = ((svc.elapsed * 2.4) + i / 3) % 1;
          const dx = lerp(p.x + 10, pz.x, k);
          const dy = lerp(p.y + 16, pz.y, k);
          ctx.globalAlpha = 0.9 - k * 0.3;
          ctx.fillStyle = pourCol;
          ctx.beginPath(); ctx.arc(dx, dy, 5.5 - k * 2.5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
      // ladle follows the cursor, tips while pouring
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(-0.5 + (svc._pouring ? 0.45 : 0));
      ctx.fillStyle = '#8d8d96';
      rr(ctx, -4, -58, 8, 52, 4); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = OUTLINE; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 4, 16, 0, Math.PI * 2);
      ctx.fillStyle = '#8d8d96'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 4, 11, 0, Math.PI * 2);
      ctx.fillStyle = pourCol; ctx.fill();
      ctx.restore();
    } else if (svc.stage === 'cheese') {
      const pz = svc.pizza;
      // falling fleck stream while shaking
      if (svc._pouring && pz) {
        ctx.save();
        ctx.fillStyle = '#f7d774';
        for (let i = 0; i < 4; i++) {
          const k = ((svc.elapsed * 3) + i / 4) % 1;
          const dx = lerp(p.x + rand(-8, 8), pz.x + rand(-20, 20), k);
          const dy = lerp(p.y - 6, pz.y, k);
          ctx.save();
          ctx.translate(dx, dy); ctx.rotate(k * 5 + i);
          ctx.globalAlpha = 0.9 - k * 0.4;
          ctx.fillRect(-4, -1.5, 8, 3);
          ctx.restore();
        }
        ctx.restore();
      }
      // shaker follows the cursor, rattles while dispensing
      const wob = svc._pouring ? Math.sin(svc.elapsed * 40) * 0.12 : 0;
      ctx.save();
      ctx.translate(p.x, p.y - 14);
      ctx.rotate(Math.PI + wob); // upside down, shaking holes downward
      rr(ctx, -14, -26, 28, 44, 8);
      ctx.fillStyle = '#e8e3d8'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = OUTLINE; ctx.stroke();
      rr(ctx, -14, -26, 28, 12, 6);
      ctx.fillStyle = '#aab4bd'; ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#4a2e1d';
      for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(i * 7, -20, 1.6, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }

    if (svc.held) {
      const h = svc.held;
      ctx.save();
      // drop shadow under the held piece
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(h.x, h.y + 14, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      drawToppingShape(ctx, h.type, h.x, h.y, 0.4, 1.15, 0);
      if (h.n === 2) drawToppingShape(ctx, h.type, h.x + 16, h.y - 12, 1.2, 1.05, 0);
      ctx.restore();
    }
  },

  // =====================================================================
  // PIZZA RENDER (raw→baked via scratch-canvas tinting)
  // =====================================================================
  drawPizza(ctx, pz) {
    const b = clamp(pz.bake, 0, 1);
    const C = 150; // scratch center

    sctx.clearRect(0, 0, 300, 300);
    sctx.save();
    sctx.translate(C, C);

    // crust — the rim tells you the crust type at a glance
    const rimFrac = pz.crust === 'thin' ? 0.95 : pz.crust === 'stuffed' ? 0.8 : 0.9;
    sctx.fillStyle = rampColor(CRUST_RAMP, b);
    sctx.beginPath(); sctx.arc(0, 0, pz.R, 0, Math.PI * 2); sctx.fill();
    sctx.lineWidth = 4; sctx.strokeStyle = OUTLINE; sctx.stroke();
    // stuffed: cheesy pockets bulge around the rim
    if (pz.crust === 'stuffed') {
      sctx.fillStyle = rampColor(CRUST_RAMP, Math.min(1, b + 0.08));
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI * 2;
        sctx.beginPath();
        sctx.arc(Math.cos(a) * pz.R * 0.9, Math.sin(a) * pz.R * 0.9, pz.R * 0.11, 0, Math.PI * 2);
        sctx.fill();
      }
      sctx.fillStyle = 'rgba(247,215,116,0.5)';
      for (let i = 0; i < 14; i += 2) {
        const a = (i + 0.5) / 14 * Math.PI * 2;
        sctx.beginPath();
        sctx.arc(Math.cos(a) * pz.R * 0.9, Math.sin(a) * pz.R * 0.9, pz.R * 0.05, 0, Math.PI * 2);
        sctx.fill();
      }
    }
    // inner base
    sctx.fillStyle = rampColor(DOUGH_RAMP, b);
    sctx.beginPath(); sctx.arc(0, 0, pz.R * rimFrac, 0, Math.PI * 2); sctx.fill();

    // sauce
    sctx.drawImage(pz.sauceCanvas, -HALF, -HALF);

    // cheese: flecks raw → melted pools when baked
    const melt = clamp((b - 0.3) / 0.25, 0, 1);
    if (melt < 1) {
      sctx.save();
      sctx.globalAlpha = 1 - melt;
      for (const f of pz.cheese) {
        sctx.save();
        sctx.translate(f.x, f.y); sctx.rotate(f.rot); sctx.scale(f.s, f.s);
        sctx.fillStyle = f.shade > 0.5 ? '#f7d774' : '#f3ca5e';
        sctx.fillRect(-f.len / 2, -2, f.len, 4);
        sctx.restore();
      }
      sctx.restore();
    }
    if (melt > 0) {
      sctx.save();
      sctx.globalAlpha = melt * 0.92;
      for (const f of pz.cheese) {
        sctx.fillStyle = f.shade > 0.5 ? '#f4c14b' : '#eeb53b';
        sctx.beginPath(); sctx.arc(f.x, f.y, 3.2 + f.len * 0.42, 0, Math.PI * 2); sctx.fill();
      }
      // glossy melt highlights
      sctx.globalAlpha = melt * 0.3;
      sctx.fillStyle = '#fff3c9';
      for (let i = 0; i < pz.cheese.length; i += 6) {
        const f = pz.cheese[i];
        sctx.beginPath(); sctx.arc(f.x - 1.5, f.y - 2, 2.2, 0, Math.PI * 2); sctx.fill();
      }
      sctx.restore();
    }

    // toppings
    for (const t of pz.toppings) {
      drawToppingShape(sctx, t.type, t.x, t.y, t.rot, t.s ?? 1, b, t.sy ?? 1);
    }

    // bake tint over everything that is pizza
    if (b > 0.02) {
      sctx.globalCompositeOperation = 'source-atop';
      const burn = clamp((b - 0.86) / 0.14, 0, 1);
      sctx.fillStyle = `rgba(96,52,16,${0.28 * clamp(b / 0.86, 0, 1) + 0.2 * burn})`;
      sctx.fillRect(-C, -C, 300, 300);
      // crust ring browns first
      sctx.strokeStyle = `rgba(70,38,12,${0.5 * b})`;
      sctx.lineWidth = pz.R * 0.1;
      sctx.beginPath(); sctx.arc(0, 0, pz.R * 0.95, 0, Math.PI * 2); sctx.stroke();
      // char spots when burnt
      if (burn > 0) {
        sctx.fillStyle = `rgba(28,20,14,${0.75 * burn})`;
        for (const s of pz.charSeed) {
          sctx.beginPath(); sctx.arc(s.x, s.y, s.r * burn, 0, Math.PI * 2); sctx.fill();
        }
      }
      sctx.globalCompositeOperation = 'source-over';
    }
    sctx.restore();

    ctx.save();
    ctx.translate(pz.x, pz.y);
    ctx.rotate(pz.rot || 0);
    ctx.scale(pz.scale * (pz.sx ?? 1), pz.scale * (pz.sy ?? 1));
    ctx.drawImage(scratch, -C, -C);
    ctx.restore();
  },
};

// =====================================================================
// Topping piece shapes — flat, chunky, bold-outlined.
// =====================================================================
export function drawToppingShape(ctx, type, x, y, rot = 0, s = 1, bake = 0, sy = 1) {
  const R = BAL.PIZZA.TOPPING_R;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(s, s * sy);
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = OUTLINE;
  const dk = clamp(bake, 0, 1) * 0.25; // toppings darken slightly in the oven

  const shade = (hex, k) => {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * (1 - k));
    const g = Math.round(((n >> 8) & 255) * (1 - k));
    const bl = Math.round((n & 255) * (1 - k));
    return `rgb(${r},${g},${bl})`;
  };

  switch (type) {
    case 'pepperoni': {
      ctx.fillStyle = shade('#d8442e', dk);
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = shade('#b53322', dk);
      ctx.beginPath(); ctx.arc(0, 0, R * 0.72, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade('#8e2618', dk);
      for (const [px, py] of [[-4, -3], [5, 2], [-1, 6], [3, -6]]) {
        ctx.beginPath(); ctx.arc(px, py, 1.8, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'mushroom': {
      ctx.fillStyle = shade('#e8d9bd', dk);
      ctx.beginPath();
      ctx.arc(0, -2, R * 0.85, Math.PI, 0);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      rr(ctx, -4, -2, 8, R * 0.75, 3);
      ctx.fillStyle = shade('#f4ebd7', dk); ctx.fill(); ctx.stroke();
      ctx.fillStyle = shade('#c9b694', dk);
      ctx.beginPath(); ctx.arc(0, -5, R * 0.32, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'onion': {
      ctx.strokeStyle = shade('#b48cc8', dk);
      ctx.lineWidth = 4;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, R * (0.35 + i * 0.3), 0.4, Math.PI * 1.4);
        ctx.stroke();
      }
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, R * 0.65, 0.6, Math.PI * 1.2); ctx.stroke();
      break;
    }
    case 'olive': {
      ctx.fillStyle = shade('#3d4a26', dk);
      ctx.beginPath(); ctx.arc(0, 0, R * 0.75, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = shade('#1f2614', dk);
      ctx.beginPath(); ctx.arc(0, 0, R * 0.32, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath(); ctx.arc(-3, -3, 2.4, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'pepper': {
      ctx.strokeStyle = OUTLINE;
      ctx.fillStyle = shade('#4caf50', dk);
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.85, 0.3, Math.PI - 0.3);
      ctx.arc(0, 0, R * 0.45, Math.PI - 0.3, 0.3, true);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = shade('#7bd47f', dk);
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.66, 0.55, Math.PI - 0.55);
      ctx.arc(0, 0, R * 0.55, Math.PI - 0.55, 0.55, true);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'ham': {
      ctx.fillStyle = shade('#f0a0b8', dk);
      rr(ctx, -R * 0.75, -R * 0.65, R * 1.5, R * 1.3, 5);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = shade('#f8c5d4', dk);
      rr(ctx, -R * 0.45, -R * 0.35, R * 0.9, R * 0.7, 4);
      ctx.fill();
      break;
    }
    case 'pineapple': {
      ctx.fillStyle = shade('#f6c945', dk);
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.85);
      ctx.lineTo(R * 0.8, R * 0.55);
      ctx.lineTo(-R * 0.8, R * 0.55);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = shade('#d9a429', dk);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-R * 0.35, 0); ctx.lineTo(R * 0.35, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-R * 0.18, -R * 0.4); ctx.lineTo(R * 0.18, -R * 0.4); ctx.stroke();
      break;
    }
    case 'chilli': {
      ctx.fillStyle = shade('#e53935', dk);
      ctx.beginPath();
      ctx.moveTo(-R * 0.7, -R * 0.3);
      ctx.quadraticCurveTo(R * 0.1, -R * 0.75, R * 0.75, -R * 0.1);
      ctx.quadraticCurveTo(R * 0.2, R * 0.35, -R * 0.55, R * 0.05);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = shade('#5f9e46', dk);
      ctx.beginPath(); ctx.arc(-R * 0.7, -R * 0.18, R * 0.22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    }
    case 'sweetcorn': {
      // cluster of plump kernels
      ctx.fillStyle = shade('#f7de6b', dk);
      for (const [px, py] of [[-6, -4], [6, -4], [0, 6]]) {
        ctx.beginPath();
        ctx.moveTo(px - 5, py - 4);
        ctx.quadraticCurveTo(px, py - 9, px + 5, py - 4);
        ctx.quadraticCurveTo(px + 5, py + 4, px, py + 6);
        ctx.quadraticCurveTo(px - 5, py + 4, px - 5, py - 4);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.arc(-7, -6, 1.8, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'bacon': {
      // wavy rasher with a fat streak
      ctx.fillStyle = shade('#c96a52', dk);
      ctx.beginPath();
      ctx.moveTo(-R * 0.9, -R * 0.45);
      ctx.quadraticCurveTo(-R * 0.3, -R * 0.75, R * 0.2, -R * 0.45);
      ctx.quadraticCurveTo(R * 0.7, -R * 0.2, R * 0.9, -R * 0.45 + R * 0.55);
      ctx.lineTo(R * 0.75, R * 0.55);
      ctx.quadraticCurveTo(R * 0.2, R * 0.2, -R * 0.35, R * 0.5);
      ctx.quadraticCurveTo(-R * 0.85, R * 0.75 - R * 0.6, -R * 0.9, -R * 0.45);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = shade('#f0d3c0', dk);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-R * 0.7, -R * 0.2);
      ctx.quadraticCurveTo(0, -R * 0.45, R * 0.6, 0);
      ctx.stroke();
      break;
    }
    case 'spinach': {
      // a leaf with a pale central vein
      ctx.fillStyle = shade('#3e7d3a', dk);
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.9);
      ctx.quadraticCurveTo(R * 0.75, -R * 0.4, R * 0.35, R * 0.5);
      ctx.quadraticCurveTo(R * 0.1, R * 0.85, 0, R * 0.9);
      ctx.quadraticCurveTo(-R * 0.1, R * 0.85, -R * 0.35, R * 0.5);
      ctx.quadraticCurveTo(-R * 0.75, -R * 0.4, 0, -R * 0.9);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = shade('#8dc48a', dk);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -R * 0.6); ctx.lineTo(0, R * 0.7); ctx.stroke();
      break;
    }
    case 'meatball': {
      ctx.fillStyle = shade('#8a4b32', dk);
      ctx.beginPath(); ctx.arc(0, 0, R * 0.8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = shade('#6d3a25', dk);
      for (const [px, py] of [[-4, 2], [5, -3], [1, 7], [-6, -5]]) {
        ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,235,210,0.5)';
      ctx.beginPath(); ctx.arc(-R * 0.25, -R * 0.3, R * 0.2, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'anchovy': {
      // a curved silver sliver
      ctx.fillStyle = shade('#7c93a6', dk);
      ctx.beginPath();
      ctx.moveTo(-R * 0.9, R * 0.15);
      ctx.quadraticCurveTo(-R * 0.2, -R * 0.55, R * 0.7, -R * 0.15);
      ctx.lineTo(R * 0.9, R * 0.05);
      ctx.quadraticCurveTo(R * 0.3, -R * 0.15, -R * 0.5, R * 0.4);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-R * 0.6, R * 0.12);
      ctx.quadraticCurveTo(-R * 0.05, -R * 0.32, R * 0.55, -R * 0.08);
      ctx.stroke();
      break;
    }
    case 'prosciutto': {
      // a draped, ruffled slice with white marbling
      ctx.fillStyle = shade('#e88f9c', dk);
      ctx.beginPath();
      ctx.moveTo(-R * 0.85, -R * 0.3);
      ctx.quadraticCurveTo(-R * 0.3, -R * 0.8, R * 0.4, -R * 0.5);
      ctx.quadraticCurveTo(R * 0.9, -R * 0.2, R * 0.65, R * 0.35);
      ctx.quadraticCurveTo(R * 0.2, R * 0.15, -R * 0.1, R * 0.5);
      ctx.quadraticCurveTo(-R * 0.5, R * 0.75, -R * 0.7, R * 0.3);
      ctx.quadraticCurveTo(-R * 0.95, 0, -R * 0.85, -R * 0.3);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,245,245,0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-R * 0.6, 0);
      ctx.quadraticCurveTo(-R * 0.1, -R * 0.3, R * 0.45, -R * 0.15);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-R * 0.4, R * 0.3);
      ctx.quadraticCurveTo(R * 0.05, R * 0.05, R * 0.4, R * 0.15);
      ctx.stroke();
      break;
    }
    case 'artichoke': {
      // fanned petals
      ctx.fillStyle = shade('#93a45a', dk);
      for (let i = -2; i <= 2; i++) {
        ctx.save();
        ctx.rotate(i * 0.42);
        ctx.beginPath();
        ctx.moveTo(0, R * 0.5);
        ctx.quadraticCurveTo(-R * 0.28, -R * 0.1, 0, -R * 0.75);
        ctx.quadraticCurveTo(R * 0.28, -R * 0.1, 0, R * 0.5);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = shade('#c9d19a', dk);
      ctx.beginPath(); ctx.arc(0, R * 0.25, R * 0.22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    }
    case 'goatcheese': {
      // crumbly white dollop
      ctx.fillStyle = shade('#f4f0e3', dk * 0.6);
      ctx.beginPath();
      ctx.moveTo(-R * 0.6, R * 0.3);
      ctx.quadraticCurveTo(-R * 0.75, -R * 0.25, -R * 0.15, -R * 0.55);
      ctx.quadraticCurveTo(R * 0.35, -R * 0.75, R * 0.65, -R * 0.15);
      ctx.quadraticCurveTo(R * 0.8, R * 0.35, R * 0.2, R * 0.5);
      ctx.quadraticCurveTo(-R * 0.25, R * 0.65, -R * 0.6, R * 0.3);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(210,200,175,0.7)';
      for (const [px, py] of [[-4, -2], [5, 3], [2, -6]]) {
        ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'sundried': {
      // shriveled, folded red oval
      ctx.fillStyle = shade('#b23c22', dk);
      ctx.beginPath();
      ctx.ellipse(0, 0, R * 0.8, R * 0.55, 0.3, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = shade('#7e2413', dk);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-R * 0.55, -R * 0.1);
      ctx.quadraticCurveTo(0, R * 0.15, R * 0.55, -R * 0.05);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-R * 0.4, R * 0.25);
      ctx.quadraticCurveTo(R * 0.05, R * 0.38, R * 0.4, R * 0.22);
      ctx.stroke();
      break;
    }
    case 'basil': {
      // two bright little leaves
      ctx.fillStyle = shade('#4e9b40', dk);
      for (const [ox, oy, a] of [[-4, -2, -0.5], [5, 3, 0.7]]) {
        ctx.save();
        ctx.translate(ox, oy); ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(0, -R * 0.55);
        ctx.quadraticCurveTo(R * 0.42, -R * 0.1, 0, R * 0.5);
        ctx.quadraticCurveTo(-R * 0.42, -R * 0.1, 0, -R * 0.55);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case 'cherrytomato': {
      // glossy half, green calyx
      ctx.fillStyle = shade('#e04c30', dk);
      ctx.beginPath(); ctx.arc(0, 0, R * 0.65, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.arc(-R * 0.2, -R * 0.22, R * 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade('#5f9e46', dk);
      for (let i = 0; i < 4; i++) {
        const a = -Math.PI / 2 + (i - 1.5) * 0.5;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * R * 0.3, -R * 0.45 + Math.sin(a) * R * 0.12, 4, 2, a, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'pumpkin': {
      // a ridged roasted chunk
      ctx.fillStyle = shade('#e07b39', dk);
      ctx.beginPath();
      ctx.moveTo(-R * 0.7, R * 0.4);
      ctx.quadraticCurveTo(-R * 0.85, -R * 0.3, -R * 0.2, -R * 0.6);
      ctx.quadraticCurveTo(R * 0.4, -R * 0.85, R * 0.75, -R * 0.15);
      ctx.quadraticCurveTo(R * 0.85, R * 0.4, R * 0.15, R * 0.55);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = shade('#b05a20', dk);
      ctx.lineWidth = 2.2;
      for (const k of [-0.3, 0.1, 0.5]) {
        ctx.beginPath();
        ctx.moveTo(-R * 0.5 + k * R, -R * 0.5);
        ctx.quadraticCurveTo(-R * 0.35 + k * R, 0, -R * 0.45 + k * R, R * 0.45);
        ctx.stroke();
      }
      break;
    }
    case 'cranberry': {
      // a cluster of little dark berries
      ctx.fillStyle = shade('#8e2440', dk);
      for (const [px, py, r] of [[-5, -4, 5.5], [6, -2, 5], [0, 6, 5.5], [8, 7, 4]]) {
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.arc(-6.5, -5.5, 1.8, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'truffle': {
      // dark irregular shavings
      ctx.fillStyle = shade('#4d4038', dk);
      ctx.beginPath();
      ctx.moveTo(-R * 0.8, R * 0.1);
      ctx.lineTo(-R * 0.3, -R * 0.5);
      ctx.lineTo(R * 0.25, -R * 0.35);
      ctx.lineTo(R * 0.8, -R * 0.55);
      ctx.lineTo(R * 0.6, R * 0.15);
      ctx.lineTo(R * 0.05, R * 0.45);
      ctx.lineTo(-R * 0.45, R * 0.35);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(214,196,170,0.6)';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-R * 0.5, 0); ctx.lineTo(R * 0.45, -R * 0.2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-R * 0.2, R * 0.25); ctx.lineTo(R * 0.35, R * 0.05); ctx.stroke();
      break;
    }
  }
  ctx.restore();
}
