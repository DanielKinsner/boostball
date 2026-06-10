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

    // Engine: two filtered saw LAYERS (low and high) crossfaded by speed.
    // Both layers share the same fundamental so it always reads as ONE motor;
    // the high layer just opens up the upper harmonics as you accelerate.
    {
      // Low layer: detuned saws into a lowpass set tight (rounded body).
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc2.type = 'sawtooth';
      osc1.frequency.value = 70;
      osc2.frequency.value = 73;
      const mixLo = ctx.createGain();
      mixLo.gain.value = 0.5;
      const lp = ctx.createBiquadFilter(); // .lp = low-layer cutoff (kept name for stability)
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      lp.Q.value = 0.7;
      const gainLo = ctx.createGain();
      gainLo.gain.value = 1.0; // crossfade gain (relative to gain bus)

      // High layer: same fundamental, brighter tilt — additional saw partials
      // at +12 / +19 semitones and a wide-open filter.
      const osc3 = ctx.createOscillator();
      const osc4 = ctx.createOscillator();
      osc3.type = 'sawtooth';
      osc4.type = 'sawtooth';
      osc3.frequency.value = 140;       // octave
      osc4.frequency.value = 140 * 1.498; // ~perfect fifth above the octave
      const mixHi = ctx.createGain();
      mixHi.gain.value = 0.35;
      const lpHi = ctx.createBiquadFilter();
      lpHi.type = 'lowpass';
      lpHi.frequency.value = 1500;
      lpHi.Q.value = 0.8;
      const gainHi = ctx.createGain();
      gainHi.gain.value = 0.0; // silent at rest

      // Shared engine bus.
      const gain = ctx.createGain();
      gain.gain.value = 0.0;

      osc1.connect(mixLo); osc2.connect(mixLo);
      mixLo.connect(lp); lp.connect(gainLo); gainLo.connect(gain);
      osc3.connect(mixHi); osc4.connect(mixHi);
      mixHi.connect(lpHi); lpHi.connect(gainHi); gainHi.connect(gain);
      gain.connect(master);

      osc1.start(); osc2.start(); osc3.start(); osc4.start();
      this.engine = { osc1, osc2, osc3, osc4, lp, lpHi, gainLo, gainHi, gain };
    }

    // Boost roar: bandpassed noise loop + a sub-rumble sine layer under it.
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

      // Sub-rumble layer: 55 Hz sine through a tight lowpass, with a 7 Hz
      // tremolo on a downstream gain so subGain itself (the on/off envelope)
      // doesn't bleed when off.
      const subOsc = ctx.createOscillator();
      subOsc.type = 'sine';
      subOsc.frequency.value = 55;
      const subLp = ctx.createBiquadFilter();
      subLp.type = 'lowpass';
      subLp.frequency.value = 120;
      subLp.Q.value = 0.7;
      const subGain = ctx.createGain();
      subGain.gain.value = 0; // on/off envelope, ramped in update()
      const subTrem = ctx.createGain();
      subTrem.gain.value = 1.0; // base 1.0; LFO ±0.3 around this
      const subLfo = ctx.createOscillator();
      subLfo.type = 'sine';
      subLfo.frequency.value = 7;
      const subLfoDepth = ctx.createGain();
      subLfoDepth.gain.value = 0.3;
      subLfo.connect(subLfoDepth);
      subLfoDepth.connect(subTrem.gain);
      subOsc.connect(subLp); subLp.connect(subGain); subGain.connect(subTrem); subTrem.connect(master);
      subOsc.start(); subLfo.start();
      this.boostRoar = { src, bp, gain, subGain };
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
   * Duck continuous voices on pause so they don't drone while update() is
   * skipped. On unpause, the next update() tick ramps gains back to their
   * speed/boost/supersonic-derived targets — no explicit restore needed.
   * @param {boolean} paused
   */
  setPaused(paused) {
    if (!this.ctx || !this.master) return;
    if (paused) {
      if (this.engine) this._ramp(this.engine.gain.gain, 0, 0.05);
      if (this.boostRoar) {
        this._ramp(this.boostRoar.gain.gain, 0, 0.05);
        if (this.boostRoar.subGain) this._ramp(this.boostRoar.subGain.gain, 0, 0.05);
      }
      if (this.windRoar) this._ramp(this.windRoar.gain.gain, 0, 0.05);
    }
  }

  /**
   * @param {number} dt
   * @param {{playerCar: object, ball: object, state: object}} ctx
   */
  update(dt, { playerCar, ball, state }) {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;

    // Engine — pitch and layer crossfade track speed; near-silent when demolished.
    if (this.engine && playerCar) {
      const speed = playerCar.velocity ? playerCar.velocity.length() : 0;
      const t = Math.min(1, speed / 2300);
      const pitch = 70 + 190 * t; // 70 → 260 Hz
      const overall = playerCar.isDemolished ? 0.0 : 0.06 + 0.20 * t;
      // Low layer is loudest at rest, fades as we speed up.
      const lowGain = 1.0 - 0.6 * t;
      // High layer comes in above ~30% throttle and dominates near top speed.
      const hiGain = Math.max(0, (t - 0.20)) * 1.1;
      this._ramp(this.engine.osc1.frequency, pitch, 0.08);
      this._ramp(this.engine.osc2.frequency, pitch * 1.04, 0.08);
      this._ramp(this.engine.osc3.frequency, pitch * 2, 0.08);
      this._ramp(this.engine.osc4.frequency, pitch * 2 * 1.498, 0.08);
      this._ramp(this.engine.lp.frequency, 500 + 1200 * t, 0.08);
      this._ramp(this.engine.lpHi.frequency, 1100 + 2400 * t, 0.08);
      this._ramp(this.engine.gainLo.gain, lowGain, 0.08);
      this._ramp(this.engine.gainHi.gain, hiGain, 0.08);
      this._ramp(this.engine.gain.gain, overall, 0.08);
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
      // Sub-rumble — sit it well under the noise so it's felt, not heard.
      this._ramp(this.boostRoar.subGain.gain, isBoosting ? 0.18 : 0.0, 0.08);
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
      if (state.phase === 'play' && this._lastCountdownT != null && this._lastCountdownT >= 1 && cdInt <= 0) {
        // Just transitioned countdown -> play (edge: prev tick was still in countdown, this tick is at 0).
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
    const lin = Math.min(1, speed / 2500);
    if (lin < 0.02) return;
    // Exponential impact curve — soft taps barely register; hard hits crack.
    const peak = Math.pow(lin, 1.6);
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Layer 1: low thump — sine 80 → 40 Hz, the body of the impact.
    {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(80, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.20);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.85 * peak, now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      osc.connect(g); g.connect(this.master);
      osc.start(now); osc.stop(now + 0.30);
      osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (e) {} };
      this._registerOneShot(g, now + 0.28);
    }

    // Layer 2: mid knock — bandpassed noise around 900 Hz, the "thock".
    {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 4.0;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.55 * peak, now + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      src.connect(bp); bp.connect(g); g.connect(this.master);
      src.start(now); src.stop(now + 0.14);
      src.onended = () => { try { src.disconnect(); bp.disconnect(); g.disconnect(); } catch (e) {} };
      this._registerOneShot(g, now + 0.12);
    }

    // Layer 3: slap transient — very short HP noise click for top-end snap.
    {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3500;
      hp.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.35 * peak, now + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
      src.connect(hp); hp.connect(g); g.connect(this.master);
      src.start(now); src.stop(now + 0.04);
      src.onended = () => { try { src.disconnect(); hp.disconnect(); g.disconnect(); } catch (e) {} };
      this._registerOneShot(g, now + 0.025);
    }
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
    // Air-horn: 3 detuned saws (each ±7c) + a sub octave, slower pitch fall.
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const dur = 1.2;
    const baseFreqs = [220, 277, 330];
    const hornGain = ctx.createGain();
    hornGain.gain.setValueAtTime(0, now);
    hornGain.gain.linearRampToValueAtTime(0.32, now + 0.05);
    hornGain.gain.linearRampToValueAtTime(0.26, now + 0.6);
    hornGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    const oscs = [];
    for (const f of baseFreqs) {
      // Two detuned saws per voice.
      for (let k = 0; k < 2; k++) {
        const det = (k === 0 ? 0.996 : 1.004);
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f * det, now);
        o.frequency.linearRampToValueAtTime(f * det * 0.78, now + dur); // slower fall, lands higher than before
        o.connect(hornGain);
        o.start(now);
        o.stop(now + dur + 0.02);
        oscs.push(o);
      }
    }
    // Sub octave under the lowest voice.
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(110, now);
    sub.frequency.linearRampToValueAtTime(110 * 0.78, now + dur);
    const subG = ctx.createGain();
    subG.gain.setValueAtTime(0, now);
    subG.gain.linearRampToValueAtTime(0.45, now + 0.08);
    subG.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    sub.connect(subG); subG.connect(this.master);
    sub.start(now); sub.stop(now + dur + 0.02);
    sub.onended = () => { try { sub.disconnect(); subG.disconnect(); } catch (e) {} };

    hornGain.connect(this.master);
    oscs[0].onended = () => {
      try { for (const o of oscs) o.disconnect(); hornGain.disconnect(); } catch (e) {}
    };
    this._registerOneShot(hornGain, now + dur);
    this._registerOneShot(subG, now + dur);

    // Crowd cheer: ~3.5s, with a short feedback-delay "stadium" haze.
    const crowdDur = 3.5;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.6;
    bp.frequency.setValueAtTime(700, now);
    bp.frequency.linearRampToValueAtTime(1600, now + 1.2);
    bp.frequency.linearRampToValueAtTime(900, now + crowdDur);

    // Pre-delay tap → feedback loop for cheap stadium ambience (no convolver).
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.085;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    delay.connect(fb); fb.connect(delay); // self-feedback
    delay.connect(wet); // wet tap to mix
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0, now);
    cg.gain.linearRampToValueAtTime(0.30, now + 0.30);
    cg.gain.linearRampToValueAtTime(0.24, now + 1.4);
    cg.gain.exponentialRampToValueAtTime(0.0001, now + crowdDur);
    src.connect(bp);
    bp.connect(cg);
    // Dry crowd → master.
    cg.connect(this.master);
    // Wet (delayed) crowd → master via wet gain.
    cg.connect(delay);
    wet.connect(this.master);
    src.start(now);
    src.stop(now + crowdDur + 0.1);
    src.onended = () => {
      try {
        src.disconnect(); bp.disconnect(); cg.disconnect();
        delay.disconnect(); fb.disconnect(); wet.disconnect();
      } catch (e) {}
    };
    this._registerOneShot(cg, now + crowdDur);
  }

  _demo(ev) {
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Body: lowpassed noise burst (the "whoomph").
    this._noiseBurst(0.55, 0.7, 'lowpass', 1400, 180, 0.7);

    // Big sub thump: sine 90 → 30 Hz, longer than the body.
    {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(90, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + 0.40);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.95, now + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      osc.connect(g); g.connect(this.master);
      osc.start(now); osc.stop(now + 0.58);
      osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (e) {} };
      this._registerOneShot(g, now + 0.55);
    }

    // Debris tail: mid/high noise crackling for ~0.7s.
    {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2400, now);
      bp.frequency.linearRampToValueAtTime(900, now + 0.7);
      bp.Q.value = 0.9;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.30, now + 0.03);
      g.gain.linearRampToValueAtTime(0.10, now + 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);
      src.connect(bp); bp.connect(g); g.connect(this.master);
      src.start(now); src.stop(now + 0.80);
      src.onended = () => { try { src.disconnect(); bp.disconnect(); g.disconnect(); } catch (e) {} };
      this._registerOneShot(g, now + 0.75);
    }
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
