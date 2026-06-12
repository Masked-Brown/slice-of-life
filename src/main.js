// =====================================================================
// main.js — boot, game loop, scene management, input, canvas scaling.
// One requestAnimationFrame loop drives everything.
// =====================================================================

import { BAL } from './balance.js';
import { Juice } from './juice.js';
import { Sfx } from './audio.js';
import { newGame, loadGame, saveGame, hasSave } from './state.js';
import { TitleScene } from './scenes/title.js';
import { ServiceScene } from './scenes/service.js';
import { DayEndScene } from './scenes/dayEnd.js';
import { ShopScene } from './scenes/shop.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const root = document.getElementById('game-root');

const scenes = {
  title: TitleScene,
  service: ServiceScene,
  dayEnd: DayEndScene,
  shop: ShopScene,
};

const $ = id => document.getElementById(id);

const game = {
  canvas, ctx,
  W: BAL.W, H: BAL.H,
  state: loadGame() || newGame(),
  scene: null,
  sceneName: null,
  pointer: { x: 0, y: 0, down: false },
  hudMoneyPos: { x: 1010, y: 38 },   // logical position coins fly to
  _pxScale: 1,

  dom: {
    title: $('ui-title'),
    hud: $('ui-hud'),
    ticket: $('ui-ticket'),
    dayend: $('ui-dayend'),
    shop: $('ui-shop'),
    tutorial: $('ui-tutorial'),
    hudMoney: $('hud-money'),
    hudDay: $('hud-day'),
    hudProgress: $('hud-progress'),
    hudGoal: $('hud-goal'),
    hudStars: $('hud-stars-fg'),
    hudRatingNum: $('hud-rating-num'),
    btnMute: $('btn-mute'),
    btnMuteTitle: $('btn-mute-title'),
  },

  setScene(name, params) {
    if (this.scene) this.scene.exit(this);
    this.sceneName = name;
    this.scene = scenes[name];
    this.scene.enter(this, params);
  },

  applyMute() {
    Sfx.setMuted(this.state.muted);
    const icon = this.state.muted ? '🔇' : '🔊';
    this.dom.btnMute.textContent = icon;
    this.dom.btnMuteTitle.textContent = icon;
  },

  toggleMute() {
    this.state.muted = !this.state.muted;
    this.applyMute();
    if (hasSave()) saveGame(this.state);
    Sfx.tick();
  },
};

// ---- canvas scaling: fixed 1280×720 logical space, letterboxed -------
function resize() {
  const s = Math.min(window.innerWidth / BAL.W, window.innerHeight / BAL.H);
  root.style.transform = `scale(${s})`;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  game._pxScale = dpr * s;
  canvas.width = Math.max(1, Math.round(BAL.W * game._pxScale));
  canvas.height = Math.max(1, Math.round(BAL.H * game._pxScale));
}
window.addEventListener('resize', resize);
resize();

// ---- pointer input (mouse-first; pointer events degrade to touch) ----
function mapPointer(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / r.width * BAL.W,
    y: (e.clientY - r.top) / r.height * BAL.H,
  };
}

canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  const { x, y } = mapPointer(e);
  game.pointer.x = x; game.pointer.y = y; game.pointer.down = true;
  if (game.scene) game.scene.onDown(game, x, y);
});
window.addEventListener('pointermove', e => {
  const { x, y } = mapPointer(e);
  game.pointer.x = x; game.pointer.y = y;
  if (game.scene) game.scene.onMove(game, x, y);
});
window.addEventListener('pointerup', e => {
  const { x, y } = mapPointer(e);
  game.pointer.down = false;
  if (game.scene) game.scene.onUp(game, x, y);
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

// audio unlocks on the first user gesture
window.addEventListener('pointerdown', () => {
  Sfx.init();
  Sfx.setMuted(game.state.muted);
}, { once: true });

// soft hover tick on every enabled DOM button
let lastHoverBtn = null;
document.addEventListener('pointerover', e => {
  const b = e.target.closest ? e.target.closest('button') : null;
  if (b && b !== lastHoverBtn && !b.disabled) Sfx.tick();
  lastHoverBtn = b;
});

// mute buttons
game.dom.btnMute.addEventListener('click', () => game.toggleMute());
game.dom.btnMuteTitle.addEventListener('click', () => game.toggleMute());

// ---- the loop -----------------------------------------------------------
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;          // clamp after tab-switch etc.

  Juice.update(dt);                   // handles its own slow-mo timing
  const sdt = dt * Juice.timeScale;
  if (game.scene) game.scene.update(game, sdt);

  // render
  ctx.setTransform(game._pxScale, 0, 0, game._pxScale, 0, 0);
  ctx.fillStyle = '#16100c';
  ctx.fillRect(0, 0, BAL.W, BAL.H);
  ctx.save();
  const sh = Juice.shakeOffset();
  ctx.translate(sh.x, sh.y);
  if (game.scene) game.scene.render(game, ctx);
  Juice.render(ctx);
  ctx.restore();

  requestAnimationFrame(frame);
}

game.applyMute();
game.setScene('title');
requestAnimationFrame(frame);

// debug/testing handle (also handy in the browser console)
window.__game = game;
