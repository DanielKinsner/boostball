// Procedural WebAudio SFX. No asset files.
// Per ARCHITECTURE.md contract: constructor(playerCarId); update(dt, {playerCar, ball, state});
// handleEvents(events); toggleMute() -> bool.
//
// Design:
//   - Lazy AudioContext, created+resumed on the first user gesture
//     (keydown / pointerdown / gamepadconnected). Importing in node (no DOM)
//     is safe because all `window` access is guarded.
//   - One master GainNode (mute ramps to 0 in 30ms).
//   - Continuous voices (engine, boost roar, supersonic wind) live for the
//     life of the context; we just drive their params each frame.
//   - One-shots (ball hits, goals, dodges, etc.) are spawned per event with
//     hard polyphony cap so we never leak.

const MAX_ONESHOTS = 8;
const MUTE_RAMP = 0.03;

export class SFX {
  /**
   * @param {number} playerCarId - used to distinguish player vs bot events.
   */
  constructor(playerCarId) {
    this.playerCarId = playerCarId;
    this.muted = false;

    // Lazy bits — populated by _initAudio() on first gesture.
    this.ctx = null;
    this.master = null;
    this.engine = null;       // { osc1, osc2, lp, gain }
    this.boostRoar = null;    // { src, bp, gain }
    this.windRoar = null;     // { src, hp, gain }
    this.noiseBuffer = null;  // shared 2s white-noise buffer

    // One-shot bookkeeping (gain nodes — used to find the quietest to evict).
    this._oneShots = [];

    // Internal state derived from `update` args.
    this._lastCountdownT = null;
    this._lastOvertime = false;
    this._initialized = false;

    // Install gesture listeners (browser only).
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this._kickoffInit = this._kickoffInit.bind(this);
      window.addEventListener('keydown', this._kickoffInit, { once: false });
      window.addEventListener('pointerdown', this._kickoffInit, { once: false });
      window.addEventListener('gamepadconnected', this._kickoffInit, { once: false });
    }
  }

  // --- Lazy init ---

  _kickoffInit() {
    if (this._initialized) return;
    try {
      this._initAudio();
      this._initialized = true;
    } catch (e) {
      // Audio just won't play; game continues.
      return;
    }
    // Remove listeners now that we're up.
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._kickoffInit);
      window.removeEventListener('pointerdown', this._kickoffInit);
      window.removeEventListener('gamepadconnected', this._kickoffInit);
    }
  }

  _initAudio() {
    const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    // Some browsers start AudioContexts suspended even after a gesture.
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      ctx.resume().catch(() => {});
    }

    // Master.
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.8;
    master.connect(ctx.destination);
    this.master = master;

    // Pre-render noise buffer (mono, 2s, deterministic-ish white noise).
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 2);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    // Engine: two detuned saws through a lowpass into the master.
    {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc2.type = 'sawtooth';
      osc1.frequency.value = 70;
      osc2.frequency.value = 73;
      const mix = ctx.createGain();
      mix.gain.value = 0.5;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 800;
      lp.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.value = 0.0;
      osc1.connect(mix);
      osc2.connect(mix);
      mix.connect(lp);
      lp.connect(gain);
      gain.connect(master);
      osc1.start();
      osc2.start();
      this.engine = { osc1, osc2, lp, gain };
    }

    // Boost roar: bandpassed noise loop.
    {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 600;
      bp.Q.value = 1.3;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(bp);
      bp.connect(gain);
      gain.connect(master);
      src.start();
      this.boostRoar = { src, bp, gain };
    }

    // Supersonic wind: highpassed noise loop.
    {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3000;
      hp.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(hp);
      hp.connect(gain);
      gain.connect(master);
      src.start();
      this.windRoar = { src, hp, gain };
    }
  }

  // --- Public API ---

  /**
   * @returns {boolean} new muted state.
   */
  toggleMute() {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime;
      const target = this.muted ? 0.0001 : 0.8;
      const g = this.master.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(target, now + MUTE_RAMP);
    }
    return this.muted;
  }

  /**
   * @param {number} dt
   * @param {{playerCar: object, ball: object, state: object}} ctx
   */
  update(dt, { playerCar, ball, state }) {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;

    // Engine — pitch and gain track speed; near-silent when demolished.
    if (this.engine && playerCar) {
      const speed = playerCar.velocity ? playerCar.velocity.length() : 0;
      const t = Math.min(1, speed / 2300);
      const pitch = 70 + 190 * t;
      const gain = playerCar.isDemolished ? 0.0 : 0.05 + 0.18 * t;
      this._ramp(this.engine.osc1.frequency, pitch, 0.08);
      this._ramp(this.engine.osc2.frequency, pitch * 1.04, 0.08);
      this._ramp(this.engine.lp.frequency, 600 + 1800 * t, 0.08);
      this._ramp(this.engine.gain.gain, gain, 0.08);
    }

    // Boost roar — only while player is actively boosting and has fuel.
    if (this.boostRoar && playerCar) {
      const isBoosting =
        !playerCar.isDemolished &&
        playerCar.lastControls &&
        playerCar.lastControls.boost &&
        playerCar.boost > 0;
      const target = isBoosting ? 0.25 : 0.0;
      this._ramp(this.boostRoar.gain.gain, target, 0.05);
      this._ramp(this.boostRoar.bp.frequency, isBoosting ? 800 : 600, 0.1);
    }

    // Supersonic wind.
    if (this.windRoar && playerCar) {
      const target = !playerCar.isDemolished && playerCar.isSupersonic ? 0.18 : 0.0;
      this._ramp(this.windRoar.gain.gain, target, 0.1);
    }

    // Countdown beeps + GO blip.
    if (state) {
      const cdInt = state.countdownT != null ? Math.ceil(state.countdownT) : null;
      if (state.phase === 'countdown' && cdInt !== this._lastCountdownT && cdInt > 0) {
        this._beep(880, 0.08, 'square', 0.25);
      }
      if (state.phase === 'play' && this._lastCountdownT != null && this._lastCountdownT <= 1) {
        // Just transitioned countdown -> play.
        this._beep(1320, 0.25, 'square', 0.35);
      }
      this._lastCountdownT = cdInt;

      // Overtime sting: first transition into overtime.
      if (state.overtime && !this._lastOvertime) {
        this._sting();
      }
      this._lastOvertime = !!state.overtime;
    }
  }

  /**
   * @param {object[]} events
   */
  handleEvents(events) {
    if (!this.ctx || !this.master || !events || events.length === 0) return;
    for (const ev of events) {
      switch (ev.type) {
        case 'ballHit': this._ballHit(ev); break;
        case 'bounce': this._bounce(ev); break;
        case 'goal': this._goal(ev); break;
        case 'demo': this._demo(ev); break;
        case 'jump': this._jump(ev); break;
        case 'dodge': this._dodge(ev); break;
        case 'padPickup':
          if (ev.carId === this.playerCarId) this._padPickup(ev);
          break;
        default: break; // unknown event types are ignored per contract
      }
    }
  }

  // --- Helpers ---

  _ramp(param, value, time) {
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + time);
  }

  // Polyphony management: register a gain node + its expected end time so we
  // can evict the quietest active one-shot when we hit the cap.
  _registerOneShot(gainNode, endTime) {
    if (this._oneShots.length >= MAX_ONESHOTS) {
      // Evict the quietest current voice.
      let quietestIdx = 0;
      let quietestG = Infinity;
      for (let i = 0; i < this._oneShots.length; i++) {
        const g = this._oneShots[i].gain.gain.value;
        if (g < quietestG) {
          quietestG = g;
          quietestIdx = i;
        }
      }
      const evict = this._oneShots[quietestIdx];
      try {
        evict.gain.gain.cancelScheduledValues(this.ctx.currentTime);
        evict.gain.gain.setValueAtTime(0, this.ctx.currentTime);
      } catch (e) { /* ignore */ }
      this._oneShots.splice(quietestIdx, 1);
    }
    const entry = { gain: gainNode, endTime };
    this._oneShots.push(entry);
    // Clean up when done.
    const cleanup = () => {
      const idx = this._oneShots.indexOf(entry);
      if (idx >= 0) this._oneShots.splice(idx, 1);
    };
    setTimeoutSafe(cleanup, Math.max(0, (endTime - this.ctx.currentTime) * 1000) + 50);
  }

  // Simple osc burst with ADSR-ish envelope.
  _beep(freq, dur, type = 'sine', peak = 0.3) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(now);
    osc.stop(now + dur + 0.02);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (e) {} };
    this._registerOneShot(g, now + dur);
  }

  _noiseBurst(dur, peak, filterType, freqStart, freqEnd, q = 1.0) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filt = ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.setValueAtTime(freqStart, now);
    filt.frequency.linearRampToValueAtTime(freqEnd, now + dur);
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + Math.min(0.04, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start(now);
    src.stop(now + dur + 0.02);
    src.onended = () => { try { src.disconnect(); filt.disconnect(); g.disconnect(); } catch (e) {} };
    this._registerOneShot(g, now + dur);
  }

  // --- One-shot SFX ---

  _ballHit(ev) {
    const speed = ev.speed || 0;
    const peak = Math.min(1, speed / 2500);
    if (peak < 0.02) return;
    // Sine pitch drop 90 -> 45 Hz: punchy thump.
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.7 * peak, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    osc.connect(g);
    g.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.28);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (e) {} };
    this._registerOneShot(g, now + 0.25);
    // Click on top: lowpassed noise tick.
    this._noiseBurst(0.06, 0.5 * peak, 'lowpass', 4000, 1500, 0.7);
  }

  _bounce(ev) {
    const speed = ev.speed || 0;
    const peak = Math.min(1, speed / 3000);
    if (peak < 0.02) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.4 * peak, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.connect(g);
    g.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.22);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (e) {} };
    this._registerOneShot(g, now + 0.2);
  }

  _goal(ev) {
    // Air-horn: 3 detuned saws pitch-bending down.
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const dur = 0.8;
    const baseFreqs = [220, 277, 330];
    const hornGain = ctx.createGain();
    hornGain.gain.setValueAtTime(0, now);
    hornGain.gain.linearRampToValueAtTime(0.35, now + 0.05);
    hornGain.gain.linearRampToValueAtTime(0.25, now + 0.4);
    hornGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    const oscs = [];
    for (const f of baseFreqs) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, now);
      o.frequency.linearRampToValueAtTime(f * 0.7, now + dur);
      o.connect(hornGain);
      o.start(now);
      o.stop(now + dur + 0.02);
      oscs.push(o);
    }
    hornGain.connect(this.master);
    oscs[0].onended = () => {
      try { for (const o of oscs) o.disconnect(); hornGain.disconnect(); } catch (e) {}
    };
    this._registerOneShot(hornGain, now + dur);

    // Crowd cheer: pink-ish noise with bandpass sweep + slow attack.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.6;
    bp.frequency.setValueAtTime(800, now);
    bp.frequency.linearRampToValueAtTime(1600, now + 1.0);
    bp.frequency.linearRampToValueAtTime(900, now + 2.5);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0, now);
    cg.gain.linearRampToValueAtTime(0.28, now + 0.2);
    cg.gain.linearRampToValueAtTime(0.2, now + 1.2);
    cg.gain.exponentialRampToValueAtTime(0.0001, now + 2.5);
    src.connect(bp);
    bp.connect(cg);
    cg.connect(this.master);
    src.start(now);
    src.stop(now + 2.6);
    src.onended = () => { try { src.disconnect(); bp.disconnect(); cg.disconnect(); } catch (e) {} };
    this._registerOneShot(cg, now + 2.5);
  }

  _demo(ev) {
    // Lowpassed noise burst + 60 Hz sine thump.
    this._noiseBurst(0.45, 0.6, 'lowpass', 1200, 200, 0.7);
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.7, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    osc.connect(g);
    g.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.42);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (e) {} };
    this._registerOneShot(g, now + 0.4);
  }

  _jump(ev) {
    // Short soft pop.
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(260, now + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.12, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    osc.connect(g);
    g.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.12);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (e) {} };
    this._registerOneShot(g, now + 0.1);
  }

  _dodge(ev) {
    // Whoosh: bandpass-swept noise.
    this._noiseBurst(0.25, 0.4, 'bandpass', 500, 2400, 1.0);
  }

  _padPickup(ev) {
    if (ev.big) {
      // Two-tone richer blip.
      this._beep(660, 0.08, 'square', 0.25);
      const ctx = this.ctx;
      const start = ctx.currentTime + 0.06;
      // Stagger the second note.
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 990;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.25, start + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
      osc.connect(g);
      g.connect(this.master);
      osc.start(start);
      osc.stop(start + 0.14);
      osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (e) {} };
      this._registerOneShot(g, start + 0.12);
    } else {
      this._beep(880, 0.06, 'square', 0.18);
    }
  }

  _sting() {
    // Two-note overtime sting.
    this._beep(520, 0.25, 'sawtooth', 0.25);
    const ctx = this.ctx;
    const start = ctx.currentTime + 0.22;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 392;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(0.28, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
    osc.connect(g);
    g.connect(this.master);
    osc.start(start);
    osc.stop(start + 0.52);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (e) {} };
    this._registerOneShot(g, start + 0.5);
  }
}

// setTimeout shim so node smoke harnesses without window still work.
function setTimeoutSafe(fn, ms) {
  if (typeof setTimeout === 'function') {
    setTimeout(fn, ms);
  }
}
