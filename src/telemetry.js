// =====================================================================
// telemetry.js — local, private, exportable playtest signal.
// A capped ring buffer in localStorage. No network calls, no PII.
// Dev panel on Ctrl+Shift+D: summary stats + EXPORT JSON + CLEAR.
// =====================================================================

const KEY = 'slice-of-life-telemetry-v1';
const CAP = 600;                       // events kept (ring buffer)

let events = [];
let sessionId = null;
let getContext = () => ({});           // () => { day, level, screen }
let panel = null;

function load() {
  try { events = JSON.parse(localStorage.getItem(KEY)) || []; }
  catch { events = []; }
}

function persist() {
  if (events.length > CAP) events = events.slice(events.length - CAP);
  try { localStorage.setItem(KEY, JSON.stringify(events)); } catch { /* full/blocked */ }
}

export const Telemetry = {

  init(contextFn) {
    getContext = contextFn || getContext;
    load();
    sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.log('session_start', {});
    // "where sessions end": refresh one session_end marker on every hide,
    // so the last write always says where the player actually stopped.
    const onHide = () => {
      const last = events[events.length - 1];
      if (last && last.type === 'session_end' && last.sid === sessionId) {
        Object.assign(last, { t: Date.now(), ...getContext() });
      } else {
        this.log('session_end', {});
      }
      persist();
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onHide();
    });
    window.addEventListener('keydown', e => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        this.togglePanel();
      }
    });
  },

  log(type, data = {}) {
    events.push({ t: Date.now(), sid: sessionId, type, ...getContext(), ...data });
    persist();
    if (panel && !panel.hidden) this._renderPanel();
  },

  all() { return events; },

  clear() {
    events = [];
    persist();
    if (panel) this._renderPanel();
  },

  // ---- summary -------------------------------------------------------
  summary() {
    const s = {
      events: events.length,
      sessions: new Set(events.map(e => e.sid)).size,
      dayReached: 0, levelReached: 0,
      purchases: [], levelCurve: [],
      stockouts: 0, walkouts: 0, served: 0,
      wasteCost: 0, restockSpend: 0,
      goalsHit: 0, milestones: 0, eventsSeen: {},
      sessionEnds: [],
    };
    for (const e of events) {
      if (e.day) s.dayReached = Math.max(s.dayReached, e.day);
      if (e.level) s.levelReached = Math.max(s.levelReached, e.level);
      if (e.type === 'purchase') s.purchases.push(e.item);
      if (e.type === 'levelup') s.levelCurve.push({ day: e.day, level: e.level });
      if (e.type === 'day_end') {
        s.stockouts += e.stockouts || 0;
        s.walkouts += e.lost || 0;
        s.served += e.served || 0;
        s.wasteCost += e.wasteCost || 0;
        s.restockSpend += e.restockSpend || 0;
        if (e.event) s.eventsSeen[e.event] = (s.eventsSeen[e.event] || 0) + 1;
      }
      if (e.type === 'goal') s.goalsHit++;
      if (e.type === 'milestone') s.milestones++;
      if (e.type === 'session_end') s.sessionEnds.push({ screen: e.screen, day: e.day });
    }
    s.wastePct = s.restockSpend > 0 ? Math.round(s.wasteCost / s.restockSpend * 100) : 0;
    return s;
  },

  exportJSON() {
    const payload = {
      game: 'slice-of-life', schema: 1,
      exportedAt: new Date().toISOString(),
      summary: this.summary(),
      events,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    a.download = `slice-of-life-telemetry-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    this.log('export', {});
  },

  // ---- dev panel -------------------------------------------------------
  togglePanel() {
    if (!panel) this._buildPanel();
    panel.hidden = !panel.hidden;
    if (!panel.hidden) this._renderPanel();
  },

  _buildPanel() {
    panel = document.createElement('div');
    panel.hidden = true;
    Object.assign(panel.style, {
      position: 'fixed', top: '12px', left: '12px', zIndex: 9999,
      width: '380px', maxHeight: '86vh', overflowY: 'auto',
      background: 'rgba(20,14,10,0.96)', color: '#f6e7c9',
      border: '2px solid #f5b942', borderRadius: '10px',
      font: '12px/1.5 ui-monospace, Menlo, Consolas, monospace',
      padding: '12px 14px', pointerEvents: 'auto',
    });
    panel.addEventListener('pointerdown', e => e.stopPropagation());
    document.body.appendChild(panel);
  },

  _renderPanel() {
    const s = this.summary();
    const ends = s.sessionEnds.slice(-5).map(e => `${e.screen || '?'} d${e.day || '?'}`).join(' · ') || '—';
    const purch = s.purchases.slice(-14).join(', ') || '—';
    const lvls = s.levelCurve.slice(-10).map(p => `d${p.day}:L${p.level}`).join(' ') || '—';
    const evs = Object.entries(s.eventsSeen).map(([k, v]) => `${k}×${v}`).join(' ') || '—';
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <b style="color:#f5b942">TELEMETRY (local only)</b>
        <span style="cursor:pointer;padding:0 6px" data-act="close">✕</span>
      </div>
      <div>events <b>${s.events}</b> · sessions <b>${s.sessions}</b> · day <b>${s.dayReached}</b> · level <b>${s.levelReached}</b></div>
      <div>served <b>${s.served}</b> · walk-outs <b>${s.walkouts}</b> · stockout orders <b>${s.stockouts}</b></div>
      <div>waste £<b>${s.wasteCost.toFixed(2)}</b> of £<b>${s.restockSpend.toFixed(2)}</b> restock (<b>${s.wastePct}%</b>)</div>
      <div>goals <b>${s.goalsHit}</b> · milestones <b>${s.milestones}</b></div>
      <div style="margin-top:6px;color:#cbbda4">level curve</div><div>${lvls}</div>
      <div style="margin-top:6px;color:#cbbda4">recent purchases</div><div>${purch}</div>
      <div style="margin-top:6px;color:#cbbda4">events seen</div><div>${evs}</div>
      <div style="margin-top:6px;color:#cbbda4">last session ends</div><div>${ends}</div>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button data-act="export" style="cursor:pointer;font:inherit;padding:4px 10px">EXPORT JSON</button>
        <button data-act="clear" style="cursor:pointer;font:inherit;padding:4px 10px">CLEAR</button>
      </div>`;
    panel.querySelector('[data-act="close"]').onclick = () => { panel.hidden = true; };
    panel.querySelector('[data-act="export"]').onclick = () => this.exportJSON();
    panel.querySelector('[data-act="clear"]').onclick = () => this.clear();
  },
};
