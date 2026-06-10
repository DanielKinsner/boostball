// Keyboard + Gamepad input. Produces controls per the ARCHITECTURE contract.
// Merge rules: sum keyboard + gamepad analog axes then clamp -1..1; OR booleans.

const KEYS_TO_PREVENT = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

const TOGGLE_KEYS = new Set([
  'KeyC',
  'KeyP',
  'Escape',
  'KeyM',
  'KeyN',
  'KeyH',
  'Enter',
]);

export function zeroControls() {
  return {
    throttle: 0,
    steer: 0,
    pitch: 0,
    yaw: 0,
    roll: 0,
    jump: false,
    boost: false,
    handbrake: false,
  };
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

// Apply a small radial deadzone to a 2D stick value to reduce drift.
function deadzone(v, dz) {
  return Math.abs(v) < dz ? 0 : v;
}

export class InputManager {
  constructor() {
    this._keys = Object.create(null);
    // Edge-trigger queue for keyboard toggles (set on keydown, drained by pollToggles).
    this._pendingToggles = {
      ballCam: false,
      pause: false,
      mute: false,
      music: false,
      help: false,
      restart: false,
    };
    // Gamepad button prev-state for edge detection (by gamepad index 0).
    this._prevPadButtons = [];

    this._onKeyDown = (e) => {
      if (KEYS_TO_PREVENT.has(e.code)) e.preventDefault();
      // Ignore key-repeat for toggles.
      if (!e.repeat && TOGGLE_KEYS.has(e.code)) {
        if (e.code === 'KeyC') this._pendingToggles.ballCam = true;
        else if (e.code === 'KeyP' || e.code === 'Escape') this._pendingToggles.pause = true;
        else if (e.code === 'KeyM') this._pendingToggles.mute = true;
        else if (e.code === 'KeyN') this._pendingToggles.music = true;
        else if (e.code === 'KeyH') this._pendingToggles.help = true;
        // Restart edge is only acted on by main.js when state.phase === 'over'.
        // Enter presses during play are intentional no-ops; InputManager stays
        // phase-agnostic per the architecture contract.
        else if (e.code === 'Enter') this._pendingToggles.restart = true;
      }
      this._keys[e.code] = true;
    };
    this._onKeyUp = (e) => {
      if (KEYS_TO_PREVENT.has(e.code)) e.preventDefault();
      this._keys[e.code] = false;
    };
    this._onBlur = () => {
      // Drop all held keys when the window loses focus to avoid stuck inputs.
      for (const k in this._keys) this._keys[k] = false;
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  // Read first connected gamepad (standard mapping) if any.
  _getPad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (!pads) return null;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p && p.connected) return p;
    }
    return null;
  }

  getControls() {
    const k = this._keys;
    const c = zeroControls();

    // ---- Keyboard ----
    const w = k['KeyW'] || k['ArrowUp'];
    const s = k['KeyS'] || k['ArrowDown'];
    const a = k['KeyA'] || k['ArrowLeft'];
    const d = k['KeyD'] || k['ArrowRight'];

    if (w) { c.throttle += 1; c.pitch += -1; }
    if (s) { c.throttle += -1; c.pitch += 1; }
    if (a) { c.steer += -1; c.yaw += -1; }
    if (d) { c.steer += 1; c.yaw += 1; }
    if (k['KeyQ']) c.roll += -1;
    if (k['KeyE']) c.roll += 1;

    if (k['Space']) c.jump = true;
    if (k['ShiftLeft'] || k['ShiftRight']) c.boost = true;
    if (k['KeyX']) c.handbrake = true;

    // ---- Gamepad (standard mapping) ----
    const pad = this._getPad();
    if (pad) {
      const ax = pad.axes;
      const btns = pad.buttons;
      const stickX = deadzone(ax[0] || 0, 0.12);
      const stickY = deadzone(ax[1] || 0, 0.12);
      // X button (idx 2) held → air-roll modifier: stickX feeds roll instead of steer/yaw.
      const airRollMod = btns[2] && btns[2].pressed;
      if (airRollMod) {
        c.roll += stickX;
      } else {
        c.steer += stickX;
        c.yaw += stickX;
      }
      // Stick up = -1 = nose down — pass through directly (matches W behavior).
      c.pitch += stickY;
      // Triggers (analog 0..1).
      const rt = btns[7] ? btns[7].value : 0;
      const lt = btns[6] ? btns[6].value : 0;
      c.throttle += rt - lt;
      if (btns[0] && btns[0].pressed) c.jump = true;
      if (btns[1] && btns[1].pressed) c.boost = true;
      if (btns[2] && btns[2].pressed) c.handbrake = true;

      // Edge-trigger gamepad toggles: Y (3) → ballCam, Start (9) → pause.
      const prev = this._prevPadButtons;
      const yNow = !!(btns[3] && btns[3].pressed);
      const yPrev = !!prev[3];
      if (yNow && !yPrev) this._pendingToggles.ballCam = true;
      const startNow = !!(btns[9] && btns[9].pressed);
      const startPrev = !!prev[9];
      if (startNow && !startPrev) this._pendingToggles.pause = true;
      // Snapshot pressed state for next frame.
      const snap = new Array(btns.length);
      for (let i = 0; i < btns.length; i++) snap[i] = !!(btns[i] && btns[i].pressed);
      this._prevPadButtons = snap;
    } else if (this._prevPadButtons.length) {
      this._prevPadButtons = [];
    }

    // Clamp analog channels.
    c.throttle = clamp(c.throttle, -1, 1);
    c.steer = clamp(c.steer, -1, 1);
    c.pitch = clamp(c.pitch, -1, 1);
    c.yaw = clamp(c.yaw, -1, 1);
    c.roll = clamp(c.roll, -1, 1);
    return c;
  }

  pollToggles() {
    const out = {
      ballCam: this._pendingToggles.ballCam,
      pause: this._pendingToggles.pause,
      mute: this._pendingToggles.mute,
      music: this._pendingToggles.music,
      help: this._pendingToggles.help,
      restart: this._pendingToggles.restart,
    };
    this._pendingToggles.ballCam = false;
    this._pendingToggles.pause = false;
    this._pendingToggles.mute = false;
    this._pendingToggles.music = false;
    this._pendingToggles.help = false;
    this._pendingToggles.restart = false;
    return out;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
  }
}
