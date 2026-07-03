// =====================================================================
// order.js — customer queue, tickets, patience. Customers are simple
// cartoon characters with visible faces, blinks, and patience meters.
// =====================================================================

import { BAL, TOPPING_ORDER } from '../balance.js';
import { clamp, lerp, rand, randi, pick, Juice, Ease, rr } from '../juice.js';
import { Sfx } from '../audio.js';
import { customersForDay, queueSlots, patienceMult, currentRating } from '../state.js';
import { unlocked, loyaltyTier, loyaltyStamps, masteryStars } from '../progress.js';
import { seasonActive } from '../seasons.js';

const OUTLINE = '#4a2e1d';

// queue geometry: door at far left, front of queue at the right (by the
// pass) — kept left of x≈720 so the HUD never covers a patience meter
const FRONT_X = 690;
const SLOT_GAP = 92;
const QUEUE_Y = 92;
const DOOR_X = -50;

const SKINS = ['#f2c89c', '#e0a878', '#c98c5e', '#8d5a3b', '#f7d9b4'];
const SHIRTS = ['#5da9d6', '#7bbf5e', '#d678c0', '#e2725b', '#9575cd', '#4db6ac', '#f5b942'];
const HAIRS = ['#3a2a1c', '#6d4c2f', '#222', '#b06f2c', '#888', '#d9534f'];

let nextId = 1;

export const Orders = {

  // ---- day generation -----------------------------------------------------
  generateDay(state) {
    const ev = (state.nextDay && state.nextDay.event) || null;
    const evDef = ev ? BAL.EVENTS.DEFS[ev.id] : null;
    let total = customersForDay(state) + (state.boosts.ad ? BAL.BOOSTS.AD_EXTRA_CUSTOMERS : 0);
    total += (state.criticBoost | 0);          // yesterday's rave review
    state.criticBoost = 0;
    if (evDef) {
      if (evDef.extraCustomers) total += evDef.extraCustomers;
      if (evDef.customersMult) total = Math.max(BAL.DAYS.MIN_CUSTOMERS, Math.round(total * evDef.customersMult));
    }
    const R = BAL.REGULARS;
    const chance = clamp(
      R.CHANCE + (currentRating(state) - BAL.RATING.START) * R.RATING_CHANCE_BONUS,
      0, R.MAX_CHANCE);
    const usedRegulars = new Set();
    const list = [];
    for (let i = 0; i < total; i++) {
      let c = null;
      if (Math.random() < chance) {
        const eligible = Object.entries(R.LIST).filter(([key, r]) =>
          !usedRegulars.has(key)
          && r.fav.toppings.every(t => state.toppings.includes(t.type))
          && (r.fav.size !== 'L' || state.sizeL));
        if (eligible.length) {
          // loyalty makes a regular visit more often — weighted pick by tier
          const weights = eligible.map(([key]) =>
            1 + BAL.LOYALTY.VISIT_BONUS[loyaltyTier(state, key)]);
          let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
          let idx = 0;
          for (; idx < weights.length - 1; idx++) { roll -= weights[idx]; if (roll <= 0) break; }
          const [key, r] = eligible[idx];
          usedRegulars.add(key);
          c = this._makeRegular(state, key, r);
          // top-tier regulars bring a friend now and then
          if (loyaltyTier(state, key) >= 3 && Math.random() < BAL.LOYALTY.FRIEND_CHANCE) {
            total += 1;
          }
        }
      }
      c = c || this._makeCustomer(state, i);
      // group leaders bring one ticket with several pizzas on it
      if (!c.regular && unlocked(state, 'group', 'group2') && Math.random() < BAL.GROUP.CHANCE) {
        const n = unlocked(state, 'group', 'group3') && Math.random() < BAL.GROUP.THREE_CHANCE ? 3 : 2;
        const tickets = [c.ticket];
        while (tickets.length < n) tickets.push(this._rollTicket(state));
        tickets.forEach(t => delete t.side);   // enough plates already
        c.group = { tickets, idx: 0, results: [] };
        c.ticket = tickets[0];
        c.drainScale = 1 / BAL.GROUP.PATIENCE_MULT;  // patience scaled to the work
        c.archetype = null;                    // the group IS the archetype
      }
      list.push(c);
    }
    // a marked visitor (critic / nonna / inspector) lands mid-day
    if (evDef && ['critic', 'nonna', 'inspector'].includes(ev.id) && list.length) {
      const idx = Math.min(list.length - 1,
        Math.max(1, Math.floor(list.length * rand(0.4, 0.7))));
      const c = list[idx];
      if (!c.regular) {
        c.role = ev.id;
        c.group = null;
        c.ticket = this.makeTicket(state, []);
        delete c.ticket.side;
        c.archetype = null;
        if (ev.id === 'critic') c.drainScale = 1.15;
      }
    }
    return list;
  },

  // recipes the shop can actually make: level-unlocked + every component
  // owned; seasonal specialties only while their season runs
  availableRecipes(state) {
    const season = seasonActive(state);
    return Object.keys(BAL.RECIPES).filter(id => {
      const r = BAL.RECIPES[id];
      if (r.seasonal) {
        if (r.seasonal !== season) return false;
      } else if (!unlocked(state, 'recipe', id)) {
        return false;
      }
      const b = r.build;
      if (b.size === 'L' && !state.sizeL) return false;
      if (!state.sauces.includes(b.sauceType)) return false;
      if (!state.crusts.includes(b.crust)) return false;
      return b.toppings.every(t => state.toppings.includes(t.type));
    });
  },

  recipeTicket(state, id) {
    const b = BAL.RECIPES[id].build;
    return {
      size: b.size, sauce: b.sauce, cheese: b.cheese, bake: b.bake,
      sauceType: b.sauceType, crust: b.crust,
      toppings: b.toppings.map(t => ({ ...t })),
      special: false,
      specialty: id,
    };
  },

  _rollTicket(state) {
    const evDef = state.nextDay && state.nextDay.event
      ? BAL.EVENTS.DEFS[state.nextDay.event.id] : null;
    const recipes = this.availableRecipes(state);
    const recipeChance = BAL.RECIPE_CHANCE + (evDef && evDef.recipeChanceAdd || 0);
    const t = recipes.length && Math.random() < recipeChance
      ? this.recipeTicket(state, pick(recipes))
      : this.makeTicket(state, (state.nextDay && state.nextDay.specials) || []);
    if (!t.specialty) {
      // half-and-half: a 2-type ticket splits into sides (placement test)
      if (t.toppings.length >= 2 && unlocked(state, 'halfhalf', 'halfhalf')
          && Math.random() < BAL.HALFHALF_CHANCE) {
        t.half = true;
        t.halves = { L: [], R: [] };
        t.toppings.forEach((w, i) => t.halves[i % 2 === 0 ? 'L' : 'R'].push(w));
      }
      // a modifier — one twist per ticket, from whichever sets are unlocked
      if (!t.half && Math.random() < BAL.MODIFIER_CHANCE) {
        const pool = Object.keys(BAL.MODIFIERS).filter(k =>
          unlocked(state, 'modifier', BAL.MODIFIERS[k].set));
        if (pool.length) {
          const key = pick(pool);
          t.modifier = key;
          if (BAL.MODIFIERS[key].bakeDeep) t.bake = 'well';
        }
      }
    }
    const sideChance = BAL.SIDE_CHANCE + (evDef && evDef.sideChanceAdd || 0);
    if (state.sides.length && Math.random() < sideChance) {
      t.side = pick(state.sides);
    }
    return t;
  },

  _makeCustomer(state, i) {
    const c = {
      id: nextId++,
      ticket: this._rollTicket(state),
      regular: null,
      archetype: null,
      colors: {
        skin: pick(SKINS), shirt: pick(SHIRTS), hair: pick(HAIRS),
        hat: Math.random() < 0.25,
      },
      seed: Math.random() * 100,
      x: DOOR_X, y: QUEUE_Y, tx: DOOR_X,
      state: 'pending',     // pending → enter → queued/front → leaving/storming
      patience: 1,
      blinkT: rand(1, 4),
      reaction: null,
      scale: 1,
      frontAt: null,
    };
    this._rollArchetype(state, c);
    return c;
  },

  // moods & personas — each with a silhouette the queue reads instantly
  _rollArchetype(state, c) {
    const A = BAL.ARCHETYPES;
    const roll = Math.random();
    let acc = 0;
    const moodsOpen = unlocked(state, 'customer', 'moods');
    const entries = [];
    if (moodsOpen) entries.push('impatient', 'easygoing');
    if (unlocked(state, 'customer', 'tourist')) entries.push('tourist');
    if (unlocked(state, 'customer', 'vip')) entries.push('vip');
    for (const key of entries) {
      acc += A[key].chance;
      if (roll < acc) {
        c.archetype = key;
        if (A[key].drain) c.drainScale = A[key].drain;
        if (key === 'vip') c.colors = { ...c.colors, shirt: '#e8c46a', hat: false };
        // tourists chase the specialties board
        if (key === 'tourist' && Math.random() < A.tourist.specialtyBias) {
          const recipes = this.availableRecipes(state);
          if (recipes.length) {
            const side = c.ticket.side;
            c.ticket = this.recipeTicket(state, pick(recipes));
            if (side) c.ticket.side = side;
          }
        }
        return;
      }
    }
  },

  // a regular: fixed look, fixed signature order
  _makeRegular(state, key, r) {
    const c = this._makeCustomer(state, 0);
    c.regular = { key, name: r.name };
    c.colors = { skin: r.skin, shirt: r.shirt, hair: r.hair, hat: r.hat };
    c.ticket = {
      size: r.fav.size, sauce: r.fav.sauce, cheese: r.fav.cheese, bake: r.fav.bake,
      sauceType: r.fav.sauceType || 'tomato',
      crust: r.fav.crust || 'classic',
      toppings: r.fav.toppings.map(t => ({ ...t })),
      special: false,
    };
    return c;
  },

  // a phone pre-order pickup: known ticket, priority entry, less patience
  makePreorderCustomer(state, offer) {
    const c = this._makeCustomer(state, 0);
    c.ticket = offer.ticket;
    c.preorder = offer;
    c.drainScale = 1 / BAL.PREORDER.PATIENCE_SCALE;
    c.colors.hat = true;
    return c;
  },

  makeTicket(state, specials = []) {
    const O = BAL.ORDERS;
    const evDef = state.nextDay && state.nextDay.event
      ? BAL.EVENTS.DEFS[state.nextDay.event.id] : null;
    const bigOrders = !!(evDef && evDef.bigOrders);
    const sizes = state.sizeL && Math.random() < (bigOrders ? O.SIZE_L_CHANCE * 1.8 : O.SIZE_L_CHANCE)
      ? ['L'] : ['S', 'M'];
    const size = pick(sizes);
    const maxTypes = Math.min(
      1 + Math.floor((state.day - 1) / O.TYPES_PER_TICKET_DAY_DIV) + (bigOrders ? 1 : 0),
      O.MAX_TYPES_PER_TICKET + (bigOrders ? 1 : 0),
      state.toppings.length,
    );
    const nTypes = bigOrders ? maxTypes : randi(1, maxTypes);
    // weighted pick: today's specials show up on far more tickets
    const pool = TOPPING_ORDER.filter(t => state.toppings.includes(t))
      .map(t => ({ t, w: specials.includes(t) ? BAL.SPECIALS.WEIGHT : 1 }));
    const chosen = [];
    while (chosen.length < nTypes && pool.length) {
      let r = Math.random() * pool.reduce((a, p) => a + p.w, 0);
      let idx = 0;
      for (; idx < pool.length - 1; idx++) { r -= pool[idx].w; if (r <= 0) break; }
      chosen.push(pool[idx].t);
      pool.splice(idx, 1);
    }
    const [lo, hi] = O.COUNT_RANGE[size];
    return {
      size,
      sauce: pick(['light', 'normal', 'heavy']),
      cheese: pick(['light', 'normal', 'heavy']),
      bake: pick(['light', 'normal', 'well']),
      sauceType: this._pickDim(state.sauces, 'tomato', BAL.TICKET_WEIGHTS.SAUCE_DEFAULT),
      crust: this._pickDim(state.crusts, 'classic', BAL.TICKET_WEIGHTS.CRUST_DEFAULT),
      toppings: chosen.map(type => ({ type, count: randi(lo, hi) })),
      special: chosen.some(t => specials.includes(t)),
    };
  },

  // weighted pick over an owned dimension: the default stays most common
  _pickDim(owned, def, defWeight) {
    if (!owned || owned.length <= 1) return def;
    const total = defWeight + (owned.length - 1);
    let r = Math.random() * total;
    if (r < defWeight) return def;
    r -= defWeight;
    for (const k of owned) {
      if (k === def) continue;
      if (r < 1) return k;
      r -= 1;
    }
    return def;
  },

  arrivalGap(state) {
    const D = BAL.DAYS;
    const evDef = state.nextDay && state.nextDay.event
      ? BAL.EVENTS.DEFS[state.nextDay.event.id] : null;
    const gapMult = (evDef && evDef.gapMult) || 1;
    if (Math.random() < D.RUSH_CHANCE) return D.RUSH_GAP;
    const decay = Math.pow(D.GAP_DAY_DECAY, state.day - 1);
    return Math.max(D.GAP_FLOOR * gapMult, rand(D.GAP_BASE_MIN, D.GAP_BASE_MAX) * decay * gapMult);
  },

  // ---- per-frame ------------------------------------------------------------
  update(svc, dt) {
    const state = svc.state;

    // arrivals: next pending customer walks in when a slot frees up
    if (svc.pending.length) {
      svc.arrivalIn -= dt;
      if (svc.arrivalIn <= 0 && svc.customers.length < queueSlots(state)) {
        const c = svc.pending.shift();
        c.state = 'enter';
        svc.customers.push(c);
        svc.arrivalIn = this.arrivalGap(state);
      }
    }

    const pm = patienceMult(state);

    // queue slots count only customers actually in line — the served, the
    // storming, and (dual oven) the waiting all stand elsewhere
    const queueers = svc.customers.filter(c =>
      c.state === 'enter' || c.state === 'queued' || c.state === 'front');
    const waiting = svc.customers.filter(c => c.state === 'waiting');

    for (let i = svc.customers.length - 1; i >= 0; i--) {
      const c = svc.customers[i];

      // slot targets — only steer customers still in the queue; leavers
      // keep the door as their target
      const inQueue = c.state === 'enter' || c.state === 'queued' || c.state === 'front';
      const slot = queueers.indexOf(c);
      if (inQueue) c.tx = FRONT_X - slot * SLOT_GAP;
      if (c.state === 'waiting') {
        c.tx = 764 + waiting.indexOf(c) * 56;   // pickup spot by the pass
        c.y = 100;
      }

      // movement (ease toward target; storm-outs move in a hurry)
      const speed = c.state === 'storming' ? 5.2 : 3.2;
      c.x += (c.tx - c.x) * Math.min(1, dt * speed);

      // idle life: blink + weight shift
      c.blinkT -= dt;
      if (c.blinkT < -0.12) c.blinkT = rand(1.6, 4.5);

      if (c.state === 'enter' && Math.abs(c.x - c.tx) < 4) c.state = 'queued';

      // promote to front
      if (slot === 0 && c.state === 'queued' && Math.abs(c.x - c.tx) < 10) {
        c.state = 'front';
        c.frontAt = svc.elapsed;
        svc.onNewFront(c);
      }

      // patience drain (front drains faster); frozen during the handoff.
      // drainScale: groups drain slower (big order), pre-orders a touch faster
      if ((c.state === 'front' && svc.stage !== 'handoff') || c.state === 'queued') {
        const secs = (c.state === 'front' ? BAL.PATIENCE.FRONT_SECONDS : BAL.PATIENCE.QUEUE_SECONDS) * pm;
        c.patience -= (dt / secs) * (c.drainScale || 1) * (svc.eventDrain || 1);
        if (c.patience <= 0) {
          this._stormOut(svc, c);
        }
      }

      // walked out the door → gone
      if ((c.state === 'leaving' || c.state === 'storming') && c.x < DOOR_X + 10) {
        svc.customers.splice(svc.customers.indexOf(c), 1);
      }
    }
  },

  _stormOut(svc, c) {
    const wasFront = c.state === 'front';
    c.state = 'storming';
    c.reaction = 'grumpy';
    c.tx = DOOR_X;
    c.x -= 6;
    Sfx.doorSlam();
    Sfx.grumpy();
    Juice.floatText(c.x, c.y - 60, '-★', { color: '#ff6b52', size: 26 });
    Juice.smoke(c.x, c.y - 46, 4);
    svc.onStormOut(c, wasFront);
  },

  front(svc) {
    const c = svc.customers.find(k => k.state === 'front');
    return c || null;
  },

  // dual oven: this customer's pizza is baking — they step to the pickup
  // spot by the pass and wait (patience frozen: the order is committed)
  sendToWaiting(svc, c) {
    c.state = 'waiting';
    c.reaction = null;
    Sfx.tick();
  },

  // served customer reacts then leaves
  dismiss(svc, c, mood) {
    if (!c) return;
    c.reaction = mood;
    c.state = 'served';
    if (mood === 'delighted') {
      Juice.tween({ target: c, from: { scale: 1 }, to: { scale: 1.12 }, dur: 0.18, ease: Ease.outBack,
        onDone: () => Juice.tween({ target: c, to: { scale: 1 }, dur: 0.3, ease: Ease.outElastic }) });
      Juice.sparkle(c.x, c.y - 50, 7);
    }
    // linger a moment with the reaction face, then go
    Juice.tween({
      dur: 0.85, onUpdate: () => { },
      onDone: () => { c.state = 'leaving'; c.tx = DOOR_X; c.y = QUEUE_Y; },
    });
  },

  dismissFront(svc, mood) {
    this.dismiss(svc, this.front(svc), mood);
  },

  // ---- ticket DOM -----------------------------------------------------------
  pinTicket(svc, c) {
    const el = svc.game.dom.ticket;
    const t = c.ticket;
    const topRow = w => `
      <div class="tk-row tk-top">
        <span class="tk-dot" style="background:${BAL.TOPPINGS[w.type].dot}"></span>
        <b>${w.count}×</b>&nbsp;${BAL.TOPPINGS[w.type].label}
      </div>`;
    const tops = t.half && t.halves
      ? `<div class="tk-halflbl">◐ LEFT</div>${t.halves.L.map(topRow).join('')}
         <div class="tk-halflbl">RIGHT ◑</div>${t.halves.R.map(topRow).join('')}`
      : t.toppings.map(topRow).join('');
    const state = svc.state;
    const mod = t.modifier ? BAL.MODIFIERS[t.modifier] : null;
    const showCrust = state.crusts.length > 1 || (t.crust && t.crust !== 'classic');
    const showVariant = state.sauces.length > 1 || (t.sauceType && t.sauceType !== 'tomato');
    const sauceTxt = mod && mod.band && mod.band.sauce ? mod.chip : t.sauce;
    const cheeseTxt = mod && mod.band && mod.band.cheese ? mod.chip : t.cheese;
    const sauceChip = showVariant
      ? `<span class="tk-chip lv-${t.sauce}"><span class="tk-saucedot" style="background:${BAL.SAUCES[t.sauceType || 'tomato'].color}"></span>${sauceTxt} ${BAL.SAUCES[t.sauceType || 'tomato'].label}</span>`
      : `<span class="tk-chip lv-${t.sauce}">${sauceTxt}</span>`;
    const recipe = t.specialty ? BAL.RECIPES[t.specialty] : null;
    const stars = t.specialty ? masteryStars(state, t.specialty) : 0;
    const group = c.group;
    // loyalty card progress rides on the regular's banner
    let regLine = '';
    if (c.regular) {
      const stamps = loyaltyStamps(state, c.regular.key);
      const tier = loyaltyTier(state, c.regular.key);
      const next = BAL.LOYALTY.TIERS.find(n => n > stamps);
      const cardTxt = unlocked(state, 'system', 'loyalty')
        ? ` · card ${'✚'.repeat(Math.min(stamps, 10))}${next ? ` ${stamps}/${next}` : ' MAX'}`
        : '';
      regLine = `<div class="tk-reg">⭐ for ${c.regular.name}${tier > 0 ? ' ' + '♥'.repeat(tier) : ''}${cardTxt}</div>`;
    }
    el.innerHTML = `
      <div class="tk-pin"></div>
      <div class="tk-head">${group ? `GROUP <span>${group.idx + 1}/${group.tickets.length}</span>` : `ORDER <span>#${svc.orderIndex}</span>`}</div>
      ${regLine}
      ${c.preorder ? `<div class="tk-preorder">📞 pre-order · +${Math.round(BAL.PREORDER.PREMIUM * 100)}%</div>` : ''}
      ${group ? `<div class="tk-group">👨‍👩‍👧 ${group.tickets.length} pizzas · +${Math.round(BAL.GROUP.PREMIUM * 100)}%</div>` : ''}
      ${recipe ? `<div class="tk-recipe">🍕 ${recipe.name}${stars ? ' ' + '★'.repeat(stars) : ''} · +${Math.round((recipe.premium + stars * BAL.MASTERY.PREMIUM_PER_STAR) * 100)}%</div>` : ''}
      ${t.special ? `<div class="tk-special">★ today's special · +${Math.round(BAL.SPECIALS.PRICE_PREMIUM * 100)}%</div>` : ''}
      ${mod ? `<div class="tk-mod">❗ ${mod.label}</div>` : ''}
      <div class="tk-row"><span class="tk-lbl">SIZE</span><span class="tk-chip tk-size">${t.size}</span></div>
      ${showCrust ? `<div class="tk-row"><span class="tk-lbl">CRUST</span><span class="tk-chip ck-${t.crust || 'classic'}">${BAL.CRUSTS[t.crust || 'classic'].label.toLowerCase()}</span></div>` : ''}
      <div class="tk-row"><span class="tk-lbl">SAUCE</span>${sauceChip}</div>
      <div class="tk-row"><span class="tk-lbl">CHEESE</span><span class="tk-chip lv-${t.cheese} ${cheeseTxt === 'none!' ? 'tk-none' : ''}">${cheeseTxt}</span></div>
      <div class="tk-sep"></div>
      ${tops}
      <div class="tk-sep"></div>
      <div class="tk-row"><span class="tk-lbl">BAKE</span><span class="tk-chip bk-${t.bake}">${mod && mod.bakeDeep ? 'EXTRA well' : t.bake === 'well' ? 'well-done' : t.bake}</span></div>
      ${t.side ? `<div class="tk-sideorder">+ ${BAL.SIDES[t.side].name}</div>` : ''}`;
    el.classList.remove('hidden', 'ticket-out');
    el.classList.remove('ticket-in');
    void el.offsetWidth;            // restart the slide-in animation
    el.classList.add('ticket-in');
  },

  unpinTicket(svc) {
    const el = svc.game.dom.ticket;
    el.classList.remove('ticket-in');
    el.classList.add('ticket-out');
  },

  // ---- render -----------------------------------------------------------------
  render(svc, ctx) {
    // back wall strip, door
    for (const c of svc.customers) this._drawCustomer(svc, ctx, c);
    if (svc.state.upgrades.rail >= 1) this._drawRailPreview(svc, ctx);
  },

  // ticket rail: the NEXT order floats over its owner's head — pure
  // information, pure strategist fuel (save those last mushrooms?)
  _drawRailPreview(svc, ctx) {
    const queueers = svc.customers.filter(c =>
      c.state === 'queued' || c.state === 'front');
    const next = queueers[1];
    if (!next || !next.ticket) return;
    const t = next.ticket;
    const dots = t.toppings.slice(0, 4);
    const w = 34 + dots.length * 30;
    const x = next.x - w / 2, y = next.y - 130;

    ctx.save();
    ctx.globalAlpha = 0.94;
    rr(ctx, x, y, w, 30, 8);
    ctx.fillStyle = '#fffbef'; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = OUTLINE; ctx.stroke();
    // stem to the head
    ctx.beginPath();
    ctx.moveTo(next.x - 5, y + 30); ctx.lineTo(next.x, y + 38); ctx.lineTo(next.x + 5, y + 30);
    ctx.closePath();
    ctx.fillStyle = '#fffbef'; ctx.fill(); ctx.stroke();

    ctx.font = '900 14px Trebuchet MS, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#4a2e1d';
    ctx.fillText(t.size, x + 15, y + 15);
    dots.forEach((wnt, i) => {
      const dx = x + 34 + i * 30;
      const def = BAL.TOPPINGS[wnt.type];
      ctx.fillStyle = def ? def.dot : '#999';
      ctx.beginPath(); ctx.arc(dx + 6, y + 15, 6, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = OUTLINE; ctx.stroke();
      ctx.fillStyle = '#4a2e1d';
      ctx.font = '900 11px Trebuchet MS, system-ui, sans-serif';
      ctx.fillText('×' + wnt.count, dx + 21, y + 15);
      ctx.font = '900 14px Trebuchet MS, system-ui, sans-serif';
    });
    ctx.restore();
  },

  _drawCustomer(svc, ctx, c) {
    const t = svc.elapsed + c.seed;
    const bob = Math.sin(t * 1.7) * 2;                  // weight shift
    const x = c.x, y = c.y + bob;
    const angry = c.patience < BAL.PATIENCE.ANGRY_FRAC;
    const warn = c.patience < BAL.PATIENCE.WARN_FRAC;
    const storming = c.state === 'storming';
    const mood = c.reaction || (storming || angry ? 'grumpy' : warn ? 'wait' : 'content');

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(c.scale, c.scale);
    if (storming) ctx.rotate(Math.sin(svc.elapsed * 18) * 0.04);

    // body
    ctx.fillStyle = c.colors.shirt;
    ctx.beginPath();
    ctx.moveTo(-24, 46);
    ctx.quadraticCurveTo(-26, 2, 0, 0);
    ctx.quadraticCurveTo(26, 2, 24, 46);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 3.5; ctx.strokeStyle = OUTLINE; ctx.stroke();

    // head
    ctx.fillStyle = c.colors.skin;
    ctx.beginPath(); ctx.arc(0, -22, 21, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    // hair / hat
    if (c.colors.hat) {
      ctx.fillStyle = c.colors.hair;
      ctx.beginPath(); ctx.arc(0, -30, 16, Math.PI, 0); ctx.fill(); ctx.stroke();
      ctx.fillRect(-19, -32, 38, 5);
    } else {
      ctx.fillStyle = c.colors.hair;
      ctx.beginPath(); ctx.arc(0, -27, 18, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
    }

    // face
    const blink = c.blinkT < 0;
    ctx.fillStyle = '#2b2118';
    if (blink) {
      ctx.fillRect(-10, -25, 6, 2);
      ctx.fillRect(4, -25, 6, 2);
    } else {
      ctx.beginPath(); ctx.arc(-7, -24, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(7, -24, 2.6, 0, Math.PI * 2); ctx.fill();
    }
    // brows
    if (mood === 'grumpy') {
      ctx.strokeStyle = '#2b2118'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-11, -31); ctx.lineTo(-3, -28); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(11, -31); ctx.lineTo(3, -28); ctx.stroke();
    }
    // mouth
    ctx.strokeStyle = '#2b2118'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath();
    if (mood === 'delighted') {
      ctx.arc(0, -16, 7, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = '#7a3b30';
      ctx.beginPath(); ctx.arc(0, -14, 4.5, 0, Math.PI); ctx.fill();
    } else if (mood === 'grumpy') {
      ctx.arc(0, -9, 6, 1.2 * Math.PI, 1.8 * Math.PI);
      ctx.stroke();
    } else if (mood === 'wait') {
      ctx.moveTo(-5, -14); ctx.lineTo(5, -14);
      ctx.stroke();
    } else {
      ctx.arc(0, -17, 6, 0.25 * Math.PI, 0.75 * Math.PI);
      ctx.stroke();
    }

    // checking-watch pose when impatient (small wrist + glance)
    if (warn && !angry && (c.state === 'queued' || c.state === 'front')) {
      ctx.fillStyle = c.colors.skin;
      ctx.beginPath(); ctx.arc(-20, 18 + Math.sin(t * 3) * 1.5, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#555';
      ctx.fillRect(-24, 14 + Math.sin(t * 3) * 1.5, 8, 3);
    }
    // steam puffs when angry
    if (angry && (c.state === 'queued' || c.state === 'front') && Math.sin(t * 6) > 0.85) {
      Juice.steam(x + rand(-14, 14), y - 52, 1);
    }

    // ---- archetype & role silhouettes (read the queue at a glance) --------
    ctx.lineWidth = 2.5; ctx.strokeStyle = OUTLINE;
    if (c.archetype === 'impatient') {
      // tapping foot
      const tap = Math.abs(Math.sin(t * 7));
      ctx.fillStyle = '#3a2a1c';
      ctx.beginPath(); ctx.ellipse(14, 48 - tap * 5, 8, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      // permanent knit brows
      ctx.strokeStyle = '#2b2118';
      ctx.beginPath(); ctx.moveTo(-11, -31); ctx.lineTo(-3, -29); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(11, -31); ctx.lineTo(3, -29); ctx.stroke();
    } else if (c.archetype === 'easygoing') {
      // coffee cup in hand, gentle steam
      ctx.fillStyle = '#fffbef';
      ctx.fillRect(20, 8, 11, 13);
      ctx.strokeRect(20, 8, 11, 13);
      ctx.beginPath(); ctx.arc(31, 14, 4, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      if (Math.sin(t * 2) > 0.7) Juice.steam(x + 26, y - 2, 1);
    } else if (c.archetype === 'tourist') {
      // camera on a strap
      ctx.strokeStyle = '#6b543c';
      ctx.beginPath(); ctx.moveTo(-14, 2); ctx.quadraticCurveTo(0, 12, 14, 2); ctx.stroke();
      ctx.fillStyle = '#4a4a52';
      ctx.fillRect(-10, 10, 20, 13);
      ctx.strokeStyle = OUTLINE; ctx.strokeRect(-10, 10, 20, 13);
      ctx.fillStyle = '#9fd0e8';
      ctx.beginPath(); ctx.arc(0, 16.5, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (c.archetype === 'vip') {
      // top hat + a glint
      ctx.fillStyle = '#2b2430';
      ctx.fillRect(-13, -52, 26, 16);
      ctx.fillRect(-18, -38, 36, 5);
      ctx.strokeRect(-13, -52, 26, 16);
      ctx.fillStyle = '#e8c46a';
      ctx.fillRect(-13, -41, 26, 4);
      if (Math.sin(t * 3) > 0.9) Juice.sparkle(x + rand(-14, 14), y - 40, 1);
    }
    if (c.role === 'critic') {
      // monocle + notebook
      ctx.strokeStyle = '#2b2118';
      ctx.beginPath(); ctx.arc(7, -24, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(11, -19); ctx.lineTo(14, -8); ctx.stroke();
      ctx.fillStyle = '#fffbef';
      ctx.fillRect(16, 6, 14, 18);
      ctx.strokeStyle = OUTLINE; ctx.strokeRect(16, 6, 14, 18);
      ctx.strokeStyle = '#a3886a';
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(18, 10 + i * 5); ctx.lineTo(28, 10 + i * 5); ctx.stroke(); }
    } else if (c.role === 'nonna') {
      // shawl + bun
      ctx.fillStyle = '#b0b0b8';
      ctx.beginPath(); ctx.arc(0, -40, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#8d5a7c';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(0, -4, 24, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
    } else if (c.role === 'inspector') {
      // clipboard + cap
      ctx.fillStyle = '#5da9d6';
      ctx.fillRect(-16, -44, 32, 8);
      ctx.strokeStyle = OUTLINE; ctx.strokeRect(-16, -44, 32, 8);
      ctx.fillStyle = '#e8c88a';
      ctx.fillRect(16, 4, 15, 20);
      ctx.strokeRect(16, 4, 15, 20);
      ctx.fillStyle = '#fffbef';
      ctx.fillRect(18, 7, 11, 14);
    }
    if (c.group) {
      // a "×N" order slip in hand
      ctx.fillStyle = '#fffbef';
      ctx.fillRect(-30, 6, 16, 20);
      ctx.strokeStyle = OUTLINE; ctx.strokeRect(-30, 6, 16, 20);
      ctx.fillStyle = '#4a2e1d';
      ctx.font = '900 10px Trebuchet MS, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`×${c.group.tickets.length}`, -22, 18);
    }
    if (c.preorder) {
      // phone out, checking the time
      ctx.fillStyle = '#2b2430';
      ctx.fillRect(18, 6, 10, 17);
      ctx.strokeStyle = OUTLINE; ctx.strokeRect(18, 6, 10, 17);
      ctx.fillStyle = '#9fd0e8';
      ctx.fillRect(20, 8, 6, 11);
    }

    ctx.restore();

    // name tag above the patience arc: regulars, VIPs, marked visitors
    const tag = c.regular ? c.regular.name
      : c.role === 'critic' ? 'THE CRITIC'
      : c.role === 'nonna' ? 'NONNA'
      : c.role === 'inspector' ? 'INSPECTOR'
      : c.archetype === 'vip' ? 'VIP'
      : null;
    if (tag && c.state !== 'pending') {
      ctx.save();
      ctx.font = '900 12px Trebuchet MS, system-ui, sans-serif';
      const w = ctx.measureText(tag).width + 18;
      rr(ctx, x - w / 2, y - 94, w, 21, 10);
      ctx.fillStyle = c.role ? '#fdeec0' : c.archetype === 'vip' ? '#f3e2b0' : '#fffbef';
      ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = OUTLINE; ctx.stroke();
      ctx.fillStyle = '#4a2e1d';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(tag, x, y - 82.5);
      ctx.restore();
    }

    // patience meter (arc above head)
    if (c.state === 'queued' || c.state === 'front') {
      const px = x, py = y - 58;
      const k = clamp(c.patience, 0, 1);
      const col = k > BAL.PATIENCE.WARN_FRAC ? '#7bbf5e' : k > BAL.PATIENCE.ANGRY_FRAC ? '#f5b942' : '#e25540';
      ctx.save();
      ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.arc(px, py, 13, -Math.PI / 2, Math.PI * 1.5); ctx.stroke();
      ctx.strokeStyle = col;
      // angry meter pulses
      if (k <= BAL.PATIENCE.ANGRY_FRAC) ctx.lineWidth = 5 + Math.sin(svc.elapsed * 10) * 1.5;
      ctx.beginPath(); ctx.arc(px, py, 13, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  },
};
