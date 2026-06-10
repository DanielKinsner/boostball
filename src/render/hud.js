// RL-inspired HUD. Pure DOM + CSS, no asset files.
// Cached element refs; textContent updates only when values change.

import {
  CAR_MAX_SPEED,
  TEAM_BLUE,
} from '../constants.js';

const STYLE_ID = 'rc-hud-style';

const HELP_ROWS = [
  ['Drive', 'W / S  or  ↑ / ↓', 'Right / Left Trigger'],
  ['Steer', 'A / D  or  ← / →', 'Left Stick'],
  ['Pitch (air)', 'W / S', 'Left Stick Y'],
  ['Yaw (air)', 'A / D', 'Left Stick X'],
  ['Air Roll', 'Q / E', 'X (hold) + Stick'],
  ['Jump', 'Space', 'A'],
  ['Boost', 'Shift', 'B'],
  ['Handbrake', 'X', 'X'],
  ['Ball Cam', 'C', 'Y'],
  ['Pause', 'P  /  Esc', 'Start'],
  ['Mute SFX', 'M', '—'],
  ['Music on/off', 'N', '—'],
  ['Help', 'H', '—'],
  ['Restart', 'Enter (after match)', '—'],
];

const CSS = `
.rc-hud {
  position: absolute; inset: 0;
  pointer-events: none;
  font-family: 'Bahnschrift', 'Segoe UI', 'Helvetica Neue', system-ui, sans-serif;
  color: #fff;
  user-select: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}
.rc-hud * { box-sizing: border-box; }

/* ---- Scoreboard (top center) ---- */
.rc-scoreboard {
  position: absolute; top: 14px; left: 50%;
  transform: translateX(-50%);
  display: flex; align-items: stretch; gap: 0;
  filter: drop-shadow(0 6px 14px rgba(0,0,0,0.55));
}
.rc-score-box {
  width: 88px; height: 60px;
  display: flex; align-items: center; justify-content: center;
  font-size: 38px; font-weight: 800; font-style: italic; letter-spacing: 1px;
  background: linear-gradient(180deg, rgba(8,12,22,0.92), rgba(2,4,10,0.95));
  border: 2px solid rgba(255,255,255,0.15);
  position: relative;
}
.rc-score-box.rc-blue {
  border-color: #2aa8ff;
  box-shadow: 0 0 18px rgba(42,168,255,0.55), inset 0 0 14px rgba(42,168,255,0.18);
  color: #cfeaff;
  clip-path: polygon(0 0, 100% 0, 92% 100%, 0 100%);
  padding-right: 8px;
}
.rc-score-box.rc-orange {
  border-color: #ff8a2a;
  box-shadow: 0 0 18px rgba(255,138,42,0.55), inset 0 0 14px rgba(255,138,42,0.18);
  color: #ffe1c2;
  clip-path: polygon(8% 0, 100% 0, 100% 100%, 0 100%);
  padding-left: 8px;
}
.rc-clock {
  min-width: 132px; height: 60px; padding: 0 14px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: linear-gradient(180deg, rgba(14,18,28,0.96), rgba(4,6,12,0.98));
  border-top: 2px solid rgba(255,255,255,0.22);
  border-bottom: 2px solid rgba(255,255,255,0.22);
  font-style: italic; font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.rc-clock .rc-time {
  font-size: 28px; line-height: 1; letter-spacing: 1px;
}
.rc-clock .rc-ot-label {
  font-size: 10px; letter-spacing: 3px; color: #ffd34a; margin-bottom: 2px;
  text-shadow: 0 0 6px rgba(255,211,74,0.7);
  display: none;
}
.rc-clock.rc-ot .rc-ot-label { display: block; }
.rc-clock.rc-warn .rc-time {
  color: #ff5a5a; text-shadow: 0 0 8px rgba(255,90,90,0.8);
  animation: rc-pulse 0.6s ease-in-out infinite alternate;
}
@keyframes rc-pulse {
  from { transform: scale(1); }
  to   { transform: scale(1.08); }
}

/* ---- Boost gauge (bottom right) ---- */
.rc-boost {
  position: absolute; right: 30px; bottom: 30px;
  width: 130px;
  display: flex; flex-direction: column; align-items: center;
}
.rc-boost-arc {
  position: relative; width: 130px; height: 130px;
}
.rc-boost-arc svg { width: 100%; height: 100%; display: block; }
.rc-boost-num {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 46px; font-weight: 800; font-style: italic; letter-spacing: 1px;
  color: #ffd28a;
  text-shadow: 0 0 14px rgba(255,180,60,0.9), 0 2px 4px rgba(0,0,0,0.6);
  font-variant-numeric: tabular-nums;
}
.rc-boost-label {
  margin-top: -2px;
  font-size: 11px; letter-spacing: 5px; font-weight: 700; font-style: italic;
  color: rgba(255,210,138,0.85);
}
.rc-speed-bar {
  margin-top: 10px;
  width: 130px; height: 6px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.18);
  overflow: hidden; position: relative;
}
.rc-speed-fill {
  position: absolute; left: 0; top: 0; bottom: 0;
  width: 0%;
  background: linear-gradient(90deg, #ffae3c, #ff5a3c);
  transition: width 60ms linear;
}
.rc-supersonic-label {
  margin-top: 4px;
  font-size: 11px; letter-spacing: 4px; font-weight: 800; font-style: italic;
  color: #ffd34a;
  text-shadow: 0 0 8px #ff8a2a, 0 0 16px #ff5a3c;
  opacity: 0; transition: opacity 0.1s linear;
}
.rc-supersonic-label.rc-on {
  opacity: 1;
  animation: rc-strobe 0.18s steps(2, end) infinite;
}
@keyframes rc-strobe {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-1px) scale(1.04); }
}
.rc-boost-floaters {
  position: absolute; right: 0; top: -10px; width: 130px;
  pointer-events: none;
}
.rc-floater {
  position: absolute; left: 0; right: 0; text-align: center;
  font-size: 22px; font-weight: 800; font-style: italic; color: #ffd34a;
  text-shadow: 0 0 10px rgba(255,180,60,0.9);
  animation: rc-float 1s ease-out forwards;
}
@keyframes rc-float {
  0%   { opacity: 0; transform: translateY(0)    scale(0.8); }
  20%  { opacity: 1; transform: translateY(-8px) scale(1.05); }
  100% { opacity: 0; transform: translateY(-60px) scale(0.9); }
}

/* ---- Controls hint (bottom left) ---- */
.rc-hint {
  position: absolute; left: 22px; bottom: 22px;
  font-size: 12px; letter-spacing: 2px; font-style: italic; font-weight: 600;
  color: rgba(255,255,255,0.55);
  text-shadow: 0 1px 2px rgba(0,0,0,0.7);
}

/* ---- Overlays ---- */
.rc-overlay {
  position: absolute; inset: 0;
  display: none; align-items: center; justify-content: center;
  flex-direction: column; text-align: center;
}
.rc-overlay.rc-show { display: flex; }
.rc-overlay.rc-dim { background: rgba(0,0,0,0.55); backdrop-filter: blur(2px); }

.rc-countdown {
  font-size: 220px; font-weight: 900; font-style: italic;
  color: #fff;
  text-shadow:
    0 0 20px rgba(255,255,255,0.85),
    0 0 60px rgba(80,160,255,0.7),
    0 8px 30px rgba(0,0,0,0.7);
  animation: rc-pop 1s ease-out forwards;
  transform: skewX(-8deg);
}
.rc-countdown.rc-go {
  color: #c6ffae;
  text-shadow:
    0 0 26px rgba(180,255,140,0.95),
    0 0 70px rgba(120,255,80,0.7);
}
@keyframes rc-pop {
  0%   { opacity: 0; transform: skewX(-8deg) scale(0.4); }
  20%  { opacity: 1; transform: skewX(-8deg) scale(1.25); }
  60%  { opacity: 1; transform: skewX(-8deg) scale(1.05); }
  100% { opacity: 0; transform: skewX(-8deg) scale(1.0); }
}

.rc-goal-banner {
  font-size: 180px; font-weight: 900; font-style: italic; letter-spacing: 6px;
  transform: skewX(-9deg);
  text-shadow: 0 0 24px currentColor, 0 8px 32px rgba(0,0,0,0.7);
  animation: rc-pop 1.6s ease-out forwards;
}
.rc-goal-banner.rc-blue   { color: #4ec3ff; }
.rc-goal-banner.rc-orange { color: #ffa44d; }
.rc-goal-sub {
  margin-top: 4px;
  font-size: 30px; letter-spacing: 6px; font-weight: 700; font-style: italic;
  color: #fff; opacity: 0.92;
  text-shadow: 0 2px 12px rgba(0,0,0,0.7);
}

.rc-demo {
  font-size: 96px; font-weight: 900; font-style: italic; letter-spacing: 4px;
  transform: skewX(-9deg);
  animation: rc-fade 1.5s ease-out forwards;
}
.rc-demo.rc-victim   { color: #ff4a4a; text-shadow: 0 0 24px #ff2222, 0 6px 24px rgba(0,0,0,0.7); }
.rc-demo.rc-attacker { color: #ffa44d; text-shadow: 0 0 24px #ff8a2a, 0 6px 24px rgba(0,0,0,0.7); }
@keyframes rc-fade {
  0%   { opacity: 0; transform: skewX(-9deg) scale(0.7); }
  15%  { opacity: 1; transform: skewX(-9deg) scale(1.1); }
  60%  { opacity: 1; transform: skewX(-9deg) scale(1.0); }
  100% { opacity: 0; transform: skewX(-9deg) scale(1.0); }
}

.rc-over-title {
  font-size: 130px; font-weight: 900; font-style: italic; letter-spacing: 10px;
  transform: skewX(-9deg);
  text-shadow: 0 0 30px currentColor, 0 10px 40px rgba(0,0,0,0.8);
}
.rc-over-title.rc-victory { color: #ffd34a; }
.rc-over-title.rc-defeat  { color: #ff4a4a; }
.rc-over-score {
  margin-top: 18px;
  font-size: 56px; font-weight: 800; font-style: italic; letter-spacing: 6px;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 4px 18px rgba(0,0,0,0.7);
}
.rc-over-score .rc-b { color: #4ec3ff; }
.rc-over-score .rc-o { color: #ffa44d; }
.rc-over-score .rc-sep { color: rgba(255,255,255,0.55); margin: 0 14px; }
.rc-over-hint {
  margin-top: 26px;
  font-size: 18px; letter-spacing: 5px; font-weight: 700; font-style: italic;
  color: rgba(255,255,255,0.8);
  animation: rc-blink 1.4s ease-in-out infinite;
}
@keyframes rc-blink {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}

.rc-paused {
  font-size: 120px; font-weight: 900; font-style: italic; letter-spacing: 12px;
  color: #fff; transform: skewX(-9deg);
  text-shadow: 0 0 28px rgba(255,255,255,0.8), 0 8px 30px rgba(0,0,0,0.7);
}

.rc-help-panel {
  background: rgba(8,12,22,0.92);
  border: 2px solid rgba(255,255,255,0.18);
  box-shadow: 0 16px 60px rgba(0,0,0,0.7), 0 0 30px rgba(80,160,255,0.18);
  padding: 28px 40px;
  min-width: 520px;
  text-align: left;
}
.rc-help-title {
  font-size: 28px; font-weight: 800; font-style: italic; letter-spacing: 6px;
  color: #cfeaff;
  text-shadow: 0 0 10px rgba(80,160,255,0.7);
  text-align: center; margin-bottom: 16px;
}
.rc-help-panel table {
  width: 100%; border-collapse: collapse;
  font-size: 14px;
}
.rc-help-panel th {
  font-size: 11px; letter-spacing: 3px; color: rgba(255,255,255,0.6);
  text-align: left; padding: 6px 8px;
  border-bottom: 1px solid rgba(255,255,255,0.15);
  font-weight: 700;
}
.rc-help-panel td {
  padding: 6px 8px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.92);
}
.rc-help-panel td.rc-help-cmd { color: #ffd28a; font-weight: 700; font-style: italic; }
.rc-help-foot {
  margin-top: 14px;
  text-align: center; font-size: 12px; letter-spacing: 4px;
  color: rgba(255,255,255,0.6); font-style: italic;
}
`;

function ensureStyleInjected(doc) {
  if (!doc) return;
  if (doc.getElementById(STYLE_ID)) return;
  const styleEl = doc.createElement('style');
  styleEl.id = STYLE_ID;
  styleEl.textContent = CSS;
  doc.head.appendChild(styleEl);
}

function fmtClock(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m + ':' + (s < 10 ? '0' + s : '' + s);
}

// Boost arc geometry — full ring, dash-offset reveal.
const ARC_R = 58;
const ARC_C = 2 * Math.PI * ARC_R;

export class HUD {
  constructor(rootEl, playerCarId) {
    this.root = rootEl;
    this.playerCarId = playerCarId;
    this.playerTeam = TEAM_BLUE; // main.js: player is blue.

    ensureStyleInjected(rootEl ? rootEl.ownerDocument : document);

    // Container — pointer-events:none so it never blocks the canvas.
    this.el = document.createElement('div');
    this.el.className = 'rc-hud';
    this.root.appendChild(this.el);

    // ---- Scoreboard ----
    const sb = document.createElement('div');
    sb.className = 'rc-scoreboard';
    this._scoreBlue = document.createElement('div');
    this._scoreBlue.className = 'rc-score-box rc-blue';
    this._scoreBlue.textContent = '0';
    this._clock = document.createElement('div');
    this._clock.className = 'rc-clock';
    this._otLabel = document.createElement('div');
    this._otLabel.className = 'rc-ot-label';
    this._otLabel.textContent = 'OVERTIME';
    this._clockTime = document.createElement('div');
    this._clockTime.className = 'rc-time';
    this._clockTime.textContent = '5:00';
    this._clock.appendChild(this._otLabel);
    this._clock.appendChild(this._clockTime);
    this._scoreOrange = document.createElement('div');
    this._scoreOrange.className = 'rc-score-box rc-orange';
    this._scoreOrange.textContent = '0';
    sb.appendChild(this._scoreBlue);
    sb.appendChild(this._clock);
    sb.appendChild(this._scoreOrange);
    this.el.appendChild(sb);

    // ---- Boost gauge ----
    const boostWrap = document.createElement('div');
    boostWrap.className = 'rc-boost';
    const arc = document.createElement('div');
    arc.className = 'rc-boost-arc';

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 130 130');
    const ringBg = document.createElementNS(SVG_NS, 'circle');
    ringBg.setAttribute('cx', '65');
    ringBg.setAttribute('cy', '65');
    ringBg.setAttribute('r', String(ARC_R));
    ringBg.setAttribute('fill', 'none');
    ringBg.setAttribute('stroke', 'rgba(255,255,255,0.10)');
    ringBg.setAttribute('stroke-width', '8');
    svg.appendChild(ringBg);
    const ringFill = document.createElementNS(SVG_NS, 'circle');
    ringFill.setAttribute('cx', '65');
    ringFill.setAttribute('cy', '65');
    ringFill.setAttribute('r', String(ARC_R));
    ringFill.setAttribute('fill', 'none');
    ringFill.setAttribute('stroke', 'url(#rc-boost-grad)');
    ringFill.setAttribute('stroke-width', '8');
    ringFill.setAttribute('stroke-linecap', 'round');
    ringFill.setAttribute('stroke-dasharray', String(ARC_C));
    ringFill.setAttribute('stroke-dashoffset', String(ARC_C));
    // Rotate so the arc fills clockwise from the top.
    ringFill.setAttribute('transform', 'rotate(-90 65 65)');
    const defs = document.createElementNS(SVG_NS, 'defs');
    const grad = document.createElementNS(SVG_NS, 'linearGradient');
    grad.setAttribute('id', 'rc-boost-grad');
    grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '1'); grad.setAttribute('y2', '1');
    const stop1 = document.createElementNS(SVG_NS, 'stop');
    stop1.setAttribute('offset', '0%'); stop1.setAttribute('stop-color', '#ffd34a');
    const stop2 = document.createElementNS(SVG_NS, 'stop');
    stop2.setAttribute('offset', '100%'); stop2.setAttribute('stop-color', '#ff5a3c');
    grad.appendChild(stop1); grad.appendChild(stop2);
    defs.appendChild(grad);
    svg.appendChild(defs);
    svg.appendChild(ringFill);

    arc.appendChild(svg);

    this._boostNum = document.createElement('div');
    this._boostNum.className = 'rc-boost-num';
    this._boostNum.textContent = '33';
    arc.appendChild(this._boostNum);

    this._boostFloaters = document.createElement('div');
    this._boostFloaters.className = 'rc-boost-floaters';
    arc.appendChild(this._boostFloaters);

    const boostLabel = document.createElement('div');
    boostLabel.className = 'rc-boost-label';
    boostLabel.textContent = 'BOOST';

    const speedBar = document.createElement('div');
    speedBar.className = 'rc-speed-bar';
    this._speedFill = document.createElement('div');
    this._speedFill.className = 'rc-speed-fill';
    speedBar.appendChild(this._speedFill);

    this._supersonic = document.createElement('div');
    this._supersonic.className = 'rc-supersonic-label';
    this._supersonic.textContent = 'SUPERSONIC';

    boostWrap.appendChild(arc);
    boostWrap.appendChild(boostLabel);
    boostWrap.appendChild(speedBar);
    boostWrap.appendChild(this._supersonic);
    this.el.appendChild(boostWrap);

    this._boostRingFill = ringFill;

    // ---- Hint ----
    const hint = document.createElement('div');
    hint.className = 'rc-hint';
    hint.textContent = 'H — HELP';
    this.el.appendChild(hint);

    // ---- Overlays ----
    this._countdownOverlay = this._makeOverlay();
    this._countdownEl = document.createElement('div');
    this._countdownEl.className = 'rc-countdown';
    this._countdownOverlay.appendChild(this._countdownEl);
    this.el.appendChild(this._countdownOverlay);

    this._goalOverlay = this._makeOverlay();
    this._goalBanner = document.createElement('div');
    this._goalBanner.className = 'rc-goal-banner';
    this._goalBanner.textContent = 'GOAL!';
    this._goalSub = document.createElement('div');
    this._goalSub.className = 'rc-goal-sub';
    this._goalSub.textContent = '';
    this._goalOverlay.appendChild(this._goalBanner);
    this._goalOverlay.appendChild(this._goalSub);
    this.el.appendChild(this._goalOverlay);

    this._demoOverlay = this._makeOverlay();
    this._demoEl = document.createElement('div');
    this._demoEl.className = 'rc-demo';
    this._demoOverlay.appendChild(this._demoEl);
    this.el.appendChild(this._demoOverlay);

    this._overOverlay = this._makeOverlay(true);
    this._overTitle = document.createElement('div');
    this._overTitle.className = 'rc-over-title';
    this._overScore = document.createElement('div');
    this._overScore.className = 'rc-over-score';
    this._overHint = document.createElement('div');
    this._overHint.className = 'rc-over-hint';
    this._overHint.textContent = 'PRESS  ENTER  TO  RESTART';
    this._overOverlay.appendChild(this._overTitle);
    this._overOverlay.appendChild(this._overScore);
    this._overOverlay.appendChild(this._overHint);
    this.el.appendChild(this._overOverlay);

    this._pausedOverlay = this._makeOverlay(true);
    const pausedEl = document.createElement('div');
    pausedEl.className = 'rc-paused';
    pausedEl.textContent = 'PAUSED';
    this._pausedOverlay.appendChild(pausedEl);
    this.el.appendChild(this._pausedOverlay);

    this._helpOverlay = this._makeOverlay(true);
    this._helpOverlay.appendChild(this._buildHelpPanel());
    this.el.appendChild(this._helpOverlay);

    // ---- Internal state ----
    this._lastBoost = -1;
    this._lastBoostFrac = -1;
    this._lastSpeed = -1;
    this._lastSupersonic = false;
    this._lastScoreBlue = -1;
    this._lastScoreOrange = -1;
    this._lastClockStr = '';
    this._lastWarn = false;
    this._lastOT = false;
    this._lastCountdownLabel = '';

    // Goal banner: show during goalPause if a goal was scored.
    this._goalBannerActive = false;
    this._goalPauseSeen = false;
    this._lastPhase = null;

    // GO! label: shown for 0.5s when transitioning countdown→play.
    this._goShowT = 0;

    // Demo overlay timer.
    this._demoT = 0;

    // Help overlay visibility.
    this._helpVisible = true;
    this._helpAutoHidden = false;
    this._showOverlay(this._helpOverlay, true);

    // Paused state (controlled externally).
    this._paused = false;
  }

  _makeOverlay(dim) {
    const o = document.createElement('div');
    o.className = 'rc-overlay' + (dim ? ' rc-dim' : '');
    return o;
  }

  _showOverlay(o, show) {
    if (show) o.classList.add('rc-show');
    else o.classList.remove('rc-show');
  }

  _buildHelpPanel() {
    const panel = document.createElement('div');
    panel.className = 'rc-help-panel';

    const title = document.createElement('div');
    title.className = 'rc-help-title';
    title.textContent = 'CONTROLS';
    panel.appendChild(title);

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    ['Action', 'Keyboard', 'Gamepad'].forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (let i = 0; i < HELP_ROWS.length; i++) {
      const row = HELP_ROWS[i];
      const tr = document.createElement('tr');
      const tdA = document.createElement('td');
      tdA.textContent = row[0];
      const tdK = document.createElement('td');
      tdK.className = 'rc-help-cmd';
      tdK.textContent = row[1];
      const tdG = document.createElement('td');
      tdG.className = 'rc-help-cmd';
      tdG.textContent = row[2];
      tr.appendChild(tdA); tr.appendChild(tdK); tr.appendChild(tdG);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    panel.appendChild(table);

    const foot = document.createElement('div');
    foot.className = 'rc-help-foot';
    foot.textContent = 'PRESS  H  TO  TOGGLE';
    panel.appendChild(foot);

    return panel;
  }

  // ----- Public API -----

  setPaused(paused) {
    this._paused = !!paused;
    this._showOverlay(this._pausedOverlay, this._paused);
  }

  toggleHelp() {
    this._helpVisible = !this._helpVisible;
    this._helpAutoHidden = true; // user has interacted with help; stop auto-hide logic
    this._showOverlay(this._helpOverlay, this._helpVisible);
  }

  /**
   * @param {number} dt
   * @param {{state:any, playerCar:any, ball:any}} ctx
   */
  update(dt, { state, playerCar, ball }) {
    // Auto-hide the boot-time help overlay on the first update tick so it
    // doesn't visually collide with the kickoff countdown text. The "H — HELP"
    // hint at bottom-left still prompts users to re-open it.
    if (!this._helpAutoHidden && state && state.phase !== 'over') {
      this._helpVisible = false;
      this._helpAutoHidden = true;
      this._showOverlay(this._helpOverlay, false);
    }

    // --- Scoreboard ---
    if (state) {
      if (state.score.blue !== this._lastScoreBlue) {
        this._scoreBlue.textContent = String(state.score.blue);
        this._lastScoreBlue = state.score.blue;
      }
      if (state.score.orange !== this._lastScoreOrange) {
        this._scoreOrange.textContent = String(state.score.orange);
        this._lastScoreOrange = state.score.orange;
      }
      const ot = !!state.overtime;
      if (ot !== this._lastOT) {
        if (ot) this._clock.classList.add('rc-ot');
        else this._clock.classList.remove('rc-ot');
        this._lastOT = ot;
      }
      const clockStr = fmtClock(state.clock);
      if (clockStr !== this._lastClockStr) {
        this._clockTime.textContent = clockStr;
        this._lastClockStr = clockStr;
      }
      // Warn pulse: <30s in regulation (not OT, not paused/countdown).
      const warn = !ot && state.phase === 'play' && state.clock <= 30 && state.clock > 0;
      if (warn !== this._lastWarn) {
        if (warn) this._clock.classList.add('rc-warn');
        else this._clock.classList.remove('rc-warn');
        this._lastWarn = warn;
      }
    }

    // --- Boost gauge ---
    if (playerCar) {
      const boost = Math.max(0, Math.min(100, Math.round(playerCar.boost)));
      if (boost !== this._lastBoost) {
        this._boostNum.textContent = String(boost);
        this._lastBoost = boost;
      }
      const frac = boost / 100;
      if (frac !== this._lastBoostFrac) {
        const offset = ARC_C * (1 - frac);
        this._boostRingFill.setAttribute('stroke-dashoffset', String(offset));
        this._lastBoostFrac = frac;
      }

      // Speed bar
      const vx = playerCar.velocity.x;
      const vy = playerCar.velocity.y;
      const vz = playerCar.velocity.z;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      // Bar uses car max speed (2300) as 100% — matches isSupersonic threshold.
      const denom = CAR_MAX_SPEED || 2300;
      const speedFrac = Math.max(0, Math.min(1, speed / denom));
      const speedPct = Math.round(speedFrac * 100);
      if (speedPct !== this._lastSpeed) {
        this._speedFill.style.width = speedPct + '%';
        this._lastSpeed = speedPct;
      }

      const ss = !!playerCar.isSupersonic;
      if (ss !== this._lastSupersonic) {
        if (ss) this._supersonic.classList.add('rc-on');
        else this._supersonic.classList.remove('rc-on');
        this._lastSupersonic = ss;
      }
    }

    // --- Countdown overlay ---
    let countdownLabel = '';
    if (state) {
      if (state.phase === 'countdown') {
        // RL convention: ceil so "3,2,1" appear as integer beats.
        const t = Math.max(0, state.countdownT);
        const beat = Math.max(1, Math.min(3, Math.ceil(t)));
        countdownLabel = String(beat);
      }

      // Transition: countdown → play => show GO! for 0.5s.
      if (this._lastPhase === 'countdown' && state.phase === 'play') {
        this._goShowT = 0.5;
      }

      if (state.phase === 'play' && this._goShowT > 0) {
        this._goShowT -= dt;
        if (this._goShowT > 0) countdownLabel = 'GO!';
      } else if (state.phase !== 'play') {
        this._goShowT = 0;
      }
    }
    if (countdownLabel !== this._lastCountdownLabel) {
      if (countdownLabel) {
        this._countdownEl.textContent = countdownLabel;
        this._countdownEl.classList.toggle('rc-go', countdownLabel === 'GO!');
        // Re-trigger CSS animation by cloning the element identity.
        // Simpler: force reflow by toggling the class.
        this._countdownEl.style.animation = 'none';
        // Force reflow without using offsetHeight directly to satisfy linters.
        void this._countdownEl.offsetWidth;
        this._countdownEl.style.animation = '';
        this._showOverlay(this._countdownOverlay, true);
      } else {
        this._showOverlay(this._countdownOverlay, false);
      }
      this._lastCountdownLabel = countdownLabel;
    }

    // --- Goal banner (during goalPause that came from a real goal) ---
    if (state) {
      const inGoalPause = state.phase === 'goalPause';
      const showGoal = inGoalPause && this._goalBannerActive;
      if (this._goalOverlay.classList.contains('rc-show') !== showGoal) {
        this._showOverlay(this._goalOverlay, showGoal);
      }
      if (!inGoalPause) {
        this._goalBannerActive = false;
      }
    }

    // --- Demo overlay timer ---
    if (this._demoT > 0) {
      this._demoT -= dt;
      if (this._demoT <= 0) {
        this._demoT = 0;
        this._showOverlay(this._demoOverlay, false);
      }
    }

    // --- Game over overlay ---
    if (state) {
      const over = state.phase === 'over';
      if (over) {
        const isVictory = state.winner === this.playerTeam;
        this._overTitle.textContent = isVictory ? 'VICTORY' : 'DEFEAT';
        this._overTitle.classList.toggle('rc-victory', isVictory);
        this._overTitle.classList.toggle('rc-defeat', !isVictory);
        // Build score line once per update; cheap.
        this._overScore.innerHTML = '';
        const b = document.createElement('span');
        b.className = 'rc-b';
        b.textContent = String(state.score.blue);
        const sep = document.createElement('span');
        sep.className = 'rc-sep';
        sep.textContent = '–';
        const o = document.createElement('span');
        o.className = 'rc-o';
        o.textContent = String(state.score.orange);
        this._overScore.appendChild(b);
        this._overScore.appendChild(sep);
        this._overScore.appendChild(o);
        this._showOverlay(this._overOverlay, true);
      } else {
        this._showOverlay(this._overOverlay, false);
      }

      this._lastPhase = state.phase;
    }
  }

  /**
   * @param {Array<any>} events
   */
  handleEvents(events) {
    if (!events || !events.length) return;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (!ev) continue;
      if (ev.type === 'goal') {
        const team = ev.team;
        const playerScored = team === this.playerTeam;
        this._goalBanner.classList.toggle('rc-blue', team === TEAM_BLUE);
        this._goalBanner.classList.toggle('rc-orange', team !== TEAM_BLUE);
        this._goalSub.textContent = playerScored ? 'YOU SCORED!' : 'BOT SCORED';
        this._goalBannerActive = true;
        // Don't open overlay here — update() opens it when phase becomes goalPause
        // (which happens on the same tick as the event in main.js).
        this._showOverlay(this._goalOverlay, true);
      } else if (ev.type === 'demo') {
        const victimIsPlayer = ev.victimId === this.playerCarId;
        const attackerIsPlayer = ev.attackerId === this.playerCarId;
        if (victimIsPlayer || attackerIsPlayer) {
          this._demoEl.classList.toggle('rc-victim', victimIsPlayer);
          this._demoEl.classList.toggle('rc-attacker', !victimIsPlayer && attackerIsPlayer);
          this._demoEl.textContent = victimIsPlayer ? 'DEMOLISHED!' : 'DEMOLITION!';
          // Re-trigger animation.
          this._demoEl.style.animation = 'none';
          void this._demoEl.offsetWidth;
          this._demoEl.style.animation = '';
          this._demoT = 1.5;
          this._showOverlay(this._demoOverlay, true);
        }
      } else if (ev.type === 'padPickup') {
        if (ev.carId === this.playerCarId) {
          this._spawnBoostFloater(ev.big ? '+100' : '+12');
        }
      }
      // ignore unknown event types
    }
  }

  _spawnBoostFloater(text) {
    const f = document.createElement('div');
    f.className = 'rc-floater';
    f.textContent = text;
    this._boostFloaters.appendChild(f);
    // Self-clean after animation (1s).
    const tid = setTimeout(() => {
      if (f.parentNode) f.parentNode.removeChild(f);
    }, 1100);
    // If HUD goes away before then we leak the timeout; tolerable for a single match.
    f._rcTid = tid;
  }
}
