// =====================================================================
// title.js — shop-front at dusk: flickering sign, glowing window,
// steam from the vent. Continue / New Game / mute.
// =====================================================================

import { rand, Juice, rr } from '../juice.js';
import { Sfx } from '../audio.js';
import { newGame, hasSave, loadGame, wipeSave } from '../state.js';

const OUTLINE = '#4a2e1d';

let ui = null;

export const TitleScene = {

  enter(g) {
    ui = { t: 0, steamT: 0, flicker: 1, flickerT: rand(2, 5), confirmT: 0 };

    const el = g.dom.title;
    el.classList.remove('hidden');

    const canContinue = hasSave();
    el.querySelector('#btn-continue').classList.toggle('hidden', !canContinue);
    const newBtn = el.querySelector('#btn-new');
    newBtn.textContent = 'NEW GAME';

    // (re)wire buttons — clean slate each visit
    const cont = el.querySelector('#btn-continue');
    cont.onclick = () => {
      Sfx.press();
      const s = loadGame();
      if (!s) return;
      g.state = s;
      g.applyMute();
      g.setScene(s.phase === 'shop' ? 'shop' : 'service');
    };
    newBtn.onclick = () => {
      Sfx.press();
      if (hasSave() && ui.confirmT <= 0) {
        newBtn.textContent = 'OVERWRITE SAVE?';
        ui.confirmT = 3;
        return;
      }
      wipeSave();
      g.state = newGame(g.state.muted);
      g.applyMute();
      g.setScene('service');
    };
  },

  exit(g) {
    g.dom.title.classList.add('hidden');
    Juice.clear();
    ui = null;
  },

  update(g, dt) {
    if (!ui) return;
    ui.t += dt;

    if (ui.confirmT > 0) {
      ui.confirmT -= dt;
      if (ui.confirmT <= 0) g.dom.title.querySelector('#btn-new').textContent = 'NEW GAME';
    }

    // steam from the roof vent
    ui.steamT -= dt;
    if (ui.steamT <= 0) {
      ui.steamT = rand(0.25, 0.7);
      Juice.steam(420 + rand(-10, 10), 188, 1);
    }

    // occasional sign flicker
    ui.flickerT -= dt;
    if (ui.flickerT <= 0) {
      ui.flicker = ui.flicker === 1 ? rand(0.35, 0.7) : 1;
      ui.flickerT = ui.flicker === 1 ? rand(2, 6) : rand(0.04, 0.18);
    }
  },

  render(g, ctx) {
    if (!ui) return;
    const t = ui.t;

    // dusk sky
    const sky = ctx.createLinearGradient(0, 0, 0, g.H);
    sky.addColorStop(0, '#2c2140');
    sky.addColorStop(0.6, '#5d3a55');
    sky.addColorStop(1, '#8a4a50');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, g.W, g.H);

    // stars
    ctx.fillStyle = 'rgba(255,245,220,0.8)';
    for (let i = 0; i < 24; i++) {
      const sx = (i * 167) % g.W, sy = (i * 89) % 220;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.3 + i));
      ctx.globalAlpha = tw * 0.8;
      ctx.fillRect(sx, sy, 2.5, 2.5);
    }
    ctx.globalAlpha = 1;

    // street
    ctx.fillStyle = '#3a2d33';
    ctx.fillRect(0, 560, g.W, g.H - 560);

    // ---- shop building -------------------------------------------------
    const bx = 180, bw = 560, by = 210, bh = 360;
    ctx.fillStyle = '#b8745a';
    rr(ctx, bx, by, bw, bh, 10); ctx.fill();
    ctx.lineWidth = 6; ctx.strokeStyle = OUTLINE; ctx.stroke();

    // roof + vent
    ctx.fillStyle = '#8a5340';
    rr(ctx, bx - 18, by - 26, bw + 36, 38, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#6e6e78';
    rr(ctx, 400, by - 50, 44, 30, 5); ctx.fill(); ctx.stroke();

    // sign board with neon flicker
    const glow = ui.flicker;
    ctx.save();
    rr(ctx, bx + 60, by + 26, bw - 120, 84, 14);
    ctx.fillStyle = '#3a2415'; ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = OUTLINE; ctx.stroke();
    ctx.shadowColor = `rgba(255,180,80,${0.9 * glow})`;
    ctx.shadowBlur = 24 * glow;
    ctx.fillStyle = `rgba(255,${Math.round(170 + 60 * glow)},90,${0.55 + 0.45 * glow})`;
    ctx.font = '900 44px Trebuchet MS, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('SLICE OF LIFE', bx + bw / 2, by + 70);
    ctx.restore();

    // awning
    ctx.save();
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#e2725b' : '#fdf3dd';
      ctx.beginPath();
      const ax = bx + 30 + i * ((bw - 60) / 8);
      const aw = (bw - 60) / 8;
      ctx.moveTo(ax, by + 130);
      ctx.lineTo(ax + aw, by + 130);
      ctx.lineTo(ax + aw, by + 162);
      ctx.arc(ax + aw / 2, by + 162, aw / 2, 0, Math.PI);
      ctx.closePath(); ctx.fill();
    }
    ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE;
    ctx.strokeRect(bx + 30, by + 130, bw - 60, 4);
    ctx.restore();

    // window with warm light + silhouette pizza on a stand
    const wob = Math.sin(t * 1.1) * 0.04;
    ctx.save();
    rr(ctx, bx + 80, by + 190, 250, 130, 10);
    const wg = ctx.createLinearGradient(0, by + 190, 0, by + 320);
    wg.addColorStop(0, `rgba(255,214,130,${0.95 + wob})`);
    wg.addColorStop(1, 'rgba(232,160,70,0.95)');
    ctx.fillStyle = wg; ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = OUTLINE; ctx.stroke();
    // pizza in the window
    ctx.fillStyle = '#c98a4b';
    rr(ctx, bx + 175, by + 290, 60, 14, 4); ctx.fill();
    ctx.fillStyle = '#e0b260';
    ctx.beginPath(); ctx.arc(bx + 205, by + 272, 34, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.fillStyle = '#c23a1c';
    ctx.beginPath(); ctx.arc(bx + 205, by + 272, 26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d8442e';
    for (const [dx, dy] of [[-10, -8], [10, -4], [-2, 10], [8, 12], [-14, 6]]) {
      ctx.beginPath(); ctx.arc(bx + 205 + dx, by + 272 + dy, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // door
    ctx.fillStyle = '#6e4226';
    rr(ctx, bx + 380, by + 190, 100, 170, 8); ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = OUTLINE; ctx.stroke();
    ctx.fillStyle = 'rgba(255,214,130,0.85)';
    rr(ctx, bx + 394, by + 204, 72, 70, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8c46a';
    ctx.beginPath(); ctx.arc(bx + 466, by + 290, 5, 0, Math.PI * 2); ctx.fill();

    // OPEN sign swings gently
    ctx.save();
    ctx.translate(bx + 430, by + 196);
    ctx.rotate(Math.sin(t * 1.6) * 0.06);
    rr(ctx, -28, 4, 56, 26, 6);
    ctx.fillStyle = '#fdf3dd'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = OUTLINE; ctx.stroke();
    ctx.fillStyle = '#c9574b';
    ctx.font = '900 14px Trebuchet MS, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('OPEN', 0, 17);
    ctx.restore();

    // pavement light pool
    ctx.fillStyle = 'rgba(255,200,110,0.12)';
    ctx.beginPath();
    ctx.ellipse(bx + 280, 600, 280, 46, 0, 0, Math.PI * 2);
    ctx.fill();
  },

  onDown() {}, onMove() {}, onUp() {},
};
