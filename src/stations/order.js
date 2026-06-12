// =====================================================================
// order.js — customer queue, tickets, patience. Customers are simple
// cartoon characters with visible faces, blinks, and patience meters.
// =====================================================================

import { BAL, TOPPING_ORDER } from '../balance.js';
import { clamp, lerp, rand, randi, pick, Juice, Ease } from '../juice.js';
import { Sfx } from '../audio.js';
import { customersForDay, queueSlots, patienceMult } from '../state.js';

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
    const total = customersForDay(state) + (state.boosts.ad ? BAL.BOOSTS.AD_EXTRA_CUSTOMERS : 0);
    const list = [];
    for (let i = 0; i < total; i++) list.push(this._makeCustomer(state, i));
    return list;
  },

  _makeCustomer(state, i) {
    return {
      id: nextId++,
      ticket: this.makeTicket(state),
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
  },

  makeTicket(state) {
    const O = BAL.ORDERS;
    const sizes = state.sizeL && Math.random() < O.SIZE_L_CHANCE ? ['L'] : ['S', 'M'];
    const size = pick(sizes);
    const maxTypes = Math.min(
      1 + Math.floor((state.day - 1) / O.TYPES_PER_TICKET_DAY_DIV),
      O.MAX_TYPES_PER_TICKET,
      state.toppings.length,
    );
    const nTypes = randi(1, maxTypes);
    const pool = TOPPING_ORDER.filter(t => state.toppings.includes(t));
    const chosen = [];
    while (chosen.length < nTypes && pool.length) {
      const t = pick(pool);
      pool.splice(pool.indexOf(t), 1);
      chosen.push(t);
    }
    const [lo, hi] = O.COUNT_RANGE[size];
    return {
      size,
      sauce: pick(['light', 'normal', 'heavy']),
      cheese: pick(['light', 'normal', 'heavy']),
      bake: pick(['light', 'normal', 'well']),
      toppings: chosen.map(type => ({ type, count: randi(lo, hi) })),
    };
  },

  arrivalGap(state) {
    const D = BAL.DAYS;
    if (Math.random() < D.RUSH_CHANCE) return D.RUSH_GAP;
    const decay = Math.pow(D.GAP_DAY_DECAY, state.day - 1);
    return Math.max(D.GAP_FLOOR, rand(D.GAP_BASE_MIN, D.GAP_BASE_MAX) * decay);
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

    for (let i = svc.customers.length - 1; i >= 0; i--) {
      const c = svc.customers[i];

      // slot targets — only steer customers still in the queue; leavers
      // keep the door as their target
      const inQueue = c.state === 'enter' || c.state === 'queued' || c.state === 'front';
      const slot = svc.customers.indexOf(c);
      if (inQueue) c.tx = FRONT_X - slot * SLOT_GAP;

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

      // patience drain (front drains faster); frozen during the handoff
      if ((c.state === 'front' && svc.stage !== 'handoff') || c.state === 'queued') {
        const secs = (c.state === 'front' ? BAL.PATIENCE.FRONT_SECONDS : BAL.PATIENCE.QUEUE_SECONDS) * pm;
        c.patience -= dt / secs;
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
    const c = svc.customers[0];
    return c && c.state === 'front' ? c : null;
  },

  // served customer reacts then leaves
  dismissFront(svc, mood) {
    const c = svc.customers[0];
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
      onDone: () => { c.state = 'leaving'; c.tx = DOOR_X; },
    });
  },

  // ---- ticket DOM -----------------------------------------------------------
  pinTicket(svc, c) {
    const el = svc.game.dom.ticket;
    const t = c.ticket;
    const tops = t.toppings.map(w =>
      `<div class="tk-row tk-top">
         <span class="tk-dot" style="background:${BAL.TOPPINGS[w.type].dot}"></span>
         <b>${w.count}×</b>&nbsp;${BAL.TOPPINGS[w.type].label}
       </div>`).join('');
    el.innerHTML = `
      <div class="tk-pin"></div>
      <div class="tk-head">ORDER <span>#${svc.orderIndex}</span></div>
      <div class="tk-row"><span class="tk-lbl">SIZE</span><span class="tk-chip tk-size">${t.size}</span></div>
      <div class="tk-row"><span class="tk-lbl">SAUCE</span><span class="tk-chip lv-${t.sauce}">${t.sauce}</span></div>
      <div class="tk-row"><span class="tk-lbl">CHEESE</span><span class="tk-chip lv-${t.cheese}">${t.cheese}</span></div>
      <div class="tk-sep"></div>
      ${tops}
      <div class="tk-sep"></div>
      <div class="tk-row"><span class="tk-lbl">BAKE</span><span class="tk-chip bk-${t.bake}">${t.bake === 'well' ? 'well-done' : t.bake}</span></div>`;
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

    ctx.restore();

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
