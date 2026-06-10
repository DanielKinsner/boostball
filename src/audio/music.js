// Procedural synthwave score for BOOSTBALL. No asset files. WebAudio only.
//
// Architecture:
//   - Lazy AudioContext on first user gesture (keydown / pointerdown /
//     gamepadconnected) — same pattern as sfx.js. Safe to import in node.
//   - Master gain (~0.16) sits UNDER sfx (sfx master is 0.8) so the music
//     never fights the game.
//   - Four sub-buses (drums, bass, pad, lead) feed master via a sidechain bus
//     on bass+pad. Phase intensity is a target on each layer bus, ramped over
//     0.5..1s — never hard-cut.
//   - Scheduler: classic web-audio lookahead pattern. setInterval @ 25ms,
//     schedule any 16th note whose start time is within 100ms of currentTime.
//     We track `next16Time` (absolute ctx time) and `step16` (monotonic
//     integer) so the loop is drift-free.
//   - All per-note nodes stop() at a scheduled time and disconnect onended.
//     No allocations in update() — update() only ramps layer-bus gains.
//
// Musical content:
//   - 108 BPM, 4/4. Progression: i - VI - III - VII in A minor:
//       Am  (A2 bass; A3 C4 E4 pad)
//       F   (F2 bass; F3 A3 C4 pad)
//       C   (C2 bass; C3 E3 G3 C4 pad)
//       G   (G2 bass; G3 B3 D4 pad)
//     One chord per bar; 4-bar loop.
//   - Pad: dual detuned saws through a lowpass (~900Hz, gentle LFO sweep),
//     soft attack/release, voiced as a 3-4 note chord.
//   - Bass: sawtooth + square octave below, 8th-note groove with bar-indexed
//     variation (rest, octave jump, syncopation). Lowpass ~350Hz.
//   - Drums: kick (sine 150→45 + click) four-on-floor, snare (bandpassed
//     noise burst + 180Hz tone) on 2&4, closed hats (HP noise) offbeat 8ths
//     with bar-indexed velocity. Open hat at last 16th of every 4th bar.
//   - Lead: 2-bar plucky-saw arp through a bandpass + delay-feedback haze
//     (DelayNode, fb ≈ 0.3). Only audible at full intensity ('play' phase).
//   - Sidechain pump: bass+pad bus dips to 30% on every kick, exponential
//     recovery in 120ms.
//
// Per-phase intensity (drum / bass / pad / lead) — cross-faded over 0.6s:
//   countdown: 0.6 / 0.6 / 0.3 / 0.0  (drums filtered low via drumBus LP)
//   play:      1.0 / 1.0 / 1.0 / 1.0
//   goalPause: 0.0 / 0.0 / 0.9 / 0.0  (pad sustain, riser tail from event)
//   over:      0.0 / 0.0 / 0.5 / 0.0  fading
//
// Events:
//   - 'goal'  → one-bar filter-sweep riser (noise + cutoff up, on pad)
//   - 'demo'  → momentary master duck (~250ms)

const LOOKAHEAD_MS = 25;          // setInterval period
const SCHEDULE_AHEAD = 0.10;      // seconds; schedule any note whose time is within this window
const BPM = 108;
const BEATS_PER_BAR = 4;
const STEPS_PER_BEAT = 4;         // 16th-note resolution
const STEPS_PER_BAR = BEATS_PER_BAR * STEPS_PER_BEAT; // 16
const BARS_PER_LOOP = 4;
const STEPS_PER_LOOP = STEPS_PER_BAR * BARS_PER_LOOP; // 64
const DEFAULT_MASTER = 0.16;

// Chord progression: Am – F – C – G  (i – VI – III – VII in A minor).
// Each entry: { bassRoot: Hz, padFreqs: Hz[] }.
const PROGRESSION = [
  { bassRoot: hz('A2'), padFreqs: [hz('A3'), hz('C4'), hz('E4')] }, // Am
  { bassRoot: hz('F2'), padFreqs: [hz('F3'), hz('A3'), hz('C4')] }, // F
  { bassRoot: hz('C2'), padFreqs: [hz('C3'), hz('E3'), hz('G3'), hz('C4')] }, // C
  { bassRoot: hz('G2'), padFreqs: [hz('G3'), hz('B3'), hz('D4')] }, // G
];

// Lead motif: A-minor pentatonic, 2 bars (32 sixteenths). Frequencies in Hz
// or null for rests. Sparse — about 12 hits across 2 bars.
const LEAD_MOTIF_HZ = [
  hz('E5'), null,    null,    hz('A5'),
  null,    hz('G5'), null,    null,
  hz('E5'), null,    hz('D5'), null,
  null,    hz('A4'), null,    null,
  // bar 2
  hz('C5'), null,    null,    hz('E5'),
  null,    hz('G5'), null,    hz('A5'),
  null,    null,    hz('E5'), null,
  hz('D5'), null,    null,    null,
];

// Bass 8th-note pattern per bar (8 slots — one per 8th note). Values are
// chromatic offsets in semitones from the bar's bass root. `null` = rest.
// Four bar variants, indexed by absLoopBar % 4 — gives deterministic
// non-repetitive movement without RNG per note.
const BASS_PATTERNS = [
  [ 0, 0, 12, 0, 0, 0, 7, 0 ],   // bar 0: walking-ish
  [ 0, 0, 12, 0, 0, 12, 0, 7 ],  // bar 1: bouncy
  [ 0, null, 0, 12, 0, 0, 7, 5 ],// bar 2: rest, then climb
  [ 0, 0, 12, 0, 7, null, 0, 0 ],// bar 3: syncopated
];

// Hat velocity per 16th step. Length 16 — one bar. Bar-indexed variations.
const HAT_PATTERNS = [
  // bar 0: classic offbeat 8ths (steps 2,6,10,14)
  [ 0,0, 0.5, 0,  0,0, 0.5, 0,  0,0, 0.5, 0,  0,0, 0.5, 0 ],
  // bar 1: add quiet 16ths
  [ 0,0.15, 0.5, 0.15,  0,0, 0.55, 0,  0,0.15, 0.5, 0.15,  0,0, 0.5, 0 ],
  // bar 2: same as bar 0 but a touch hotter
  [ 0,0, 0.55, 0,  0,0, 0.55, 0,  0,0, 0.55, 0,  0,0, 0.55, 0 ],
  // bar 3: push toward the next downbeat (more 16ths late in bar)
  [ 0,0, 0.5, 0,  0,0.2, 0.5, 0.2,  0,0, 0.5, 0,  0,0.25, 0.5, 0.35 ],
];

export class Music {
  constructor() {
    this.muted = false;            // 'off' state via toggle()
    this.level = DEFAULT_MASTER;   // user level 0..1 (applied to master)

    // Lazy bits.
    this.ctx = null;
    this.master = null;
    this.duckBus = null;           // 'demo' duck — sits between master and dest
    this.sidechainBus = null;      // shared by bass+pad, kick-pumped
    this.drumBus = null;           // layer bus → master
    this.drumLP = null;            // lowpass on drumBus for filtered-down countdown
    this.bassBus = null;           // layer bus → sidechainBus
    this.padBus = null;            // layer bus → sidechainBus
    this.padLP = null;             // pad lowpass (LFO sweep)
    this.padLfo = null;
    this.padLfoGain = null;
    this.leadBus = null;           // layer bus → master (post-delay)
    this.leadDelay = null;         // DelayNode
    this.leadDelayFb = null;       // feedback gain
    this.noiseBuffer = null;

    // Scheduler state.
    this._schedulerHandle = null;
    this._next16Time = 0;          // ctx time of the next 16th to schedule
    this._step16 = 0;              // monotonic 16th counter (modulo STEPS_PER_LOOP for pattern lookup)

    // Current phase / target gains (driven by update()).
    this._curPhase = 'countdown';
    this._intensity = { drum: 0.6, bass: 0.6, pad: 0.3, lead: 0.0 };
    this._goalRiserActive = false; // suppress motif while riser plays

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
      return; // game continues without music
    }
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
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      ctx.resume().catch(() => {});
    }

    const sr = ctx.sampleRate;

    // Master + duck.
    const duckBus = ctx.createGain();
    duckBus.gain.value = 1.0;
    duckBus.connect(ctx.destination);
    this.duckBus = duckBus;

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0.0001 : this.level;
    master.connect(duckBus);
    this.master = master;

    // Noise buffer (2s mono).
    const len = Math.floor(sr * 2);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    // Sidechain bus: bass+pad share this; kick dips it.
    const sidechainBus = ctx.createGain();
    sidechainBus.gain.value = 1.0;
    sidechainBus.connect(master);
    this.sidechainBus = sidechainBus;

    // Drum bus.
    const drumLP = ctx.createBiquadFilter();
    drumLP.type = 'lowpass';
    drumLP.frequency.value = 18000;
    drumLP.Q.value = 0.7;
    const drumBus = ctx.createGain();
    drumBus.gain.value = this._intensity.drum;
    drumBus.connect(drumLP);
    drumLP.connect(master);
    this.drumBus = drumBus;
    this.drumLP = drumLP;

    // Bass bus.
    const bassBus = ctx.createGain();
    bassBus.gain.value = this._intensity.bass;
    bassBus.connect(sidechainBus);
    this.bassBus = bassBus;

    // Pad bus + LFO-modulated lowpass.
    const padLP = ctx.createBiquadFilter();
    padLP.type = 'lowpass';
    padLP.frequency.value = 900;
    padLP.Q.value = 0.6;
    const padBus = ctx.createGain();
    padBus.gain.value = this._intensity.pad;
    padBus.connect(sidechainBus);
    // We route per-note pad voices into padLP → padBus. Pad LFO modulates
    // padLP.frequency via a depth gain.
    const padLfo = ctx.createOscillator();
    padLfo.type = 'sine';
    padLfo.frequency.value = 0.12; // 0.12 Hz — very slow sweep
    const padLfoGain = ctx.createGain();
    padLfoGain.gain.value = 250; // ±250 Hz around the 900 Hz center
    padLfo.connect(padLfoGain);
    padLfoGain.connect(padLP.frequency);
    padLfo.start();
    padLP.connect(padBus);
    this.padLP = padLP;
    this.padBus = padBus;
    this.padLfo = padLfo;
    this.padLfoGain = padLfoGain;

    // Lead bus with delay feedback haze.
    const leadBus = ctx.createGain();
    leadBus.gain.value = this._intensity.lead;
    leadBus.connect(master);
    // Per-note lead voices go into a small mixer node → leadBus (dry) and
    // into the delay line → feedback → leadBus (wet). We expose leadIn as
    // the per-note connection point.
    const leadDelay = ctx.createDelay(1.0);
    // 1 beat at 108 BPM = 60/108 ≈ 0.555s; use dotted 8th for a synthwave feel
    // dotted 8th = 1.5 * (60/BPM/2) ≈ 0.417s
    leadDelay.delayTime.value = (60 / BPM) * (3 / 4);
    const leadDelayFb = ctx.createGain();
    leadDelayFb.gain.value = 0.3;
    leadDelay.connect(leadDelayFb);
    leadDelayFb.connect(leadDelay);
    leadDelay.connect(leadBus);
    this.leadBus = leadBus;
    this.leadDelay = leadDelay;
    this.leadDelayFb = leadDelayFb;

    // Kick off scheduler.
    this._next16Time = ctx.currentTime + 0.10;
    this._step16 = 0;
    if (typeof setInterval === 'function') {
      this._schedulerHandle = setInterval(() => {
        try { this._scheduler(); } catch (e) { /* swallow */ }
      }, LOOKAHEAD_MS);
    }
  }

  // --- Public API ---

  /**
   * @param {number} dt
   * @param {{ state?: object }} args
   */
  update(dt, args) {
    if (!this.ctx || !this.master) return;
    const state = args && args.state;
    const phase = state && state.phase ? state.phase : this._curPhase;
    if (phase !== this._curPhase) {
      this._curPhase = phase;
      this._applyPhase(phase);
    }
  }

  /**
   * @param {object[]} events
   */
  handleEvents(events) {
    if (!this.ctx || !this.master || !events || events.length === 0) return;
    for (const ev of events) {
      switch (ev.type) {
        case 'goal': this._goalRiser(); break;
        case 'demo': this._duck(); break;
        default: break;
      }
    }
  }

  /**
   * Toggle music on/off with an 80ms gain ramp.
   * @returns {boolean} new on-state (true = ON, false = muted/off)
   */
  toggle() {
    if (!this.ctx || !this.master) {
      this.muted = !this.muted;
      return !this.muted;
    }
    this.muted = !this.muted;
    const now = this.ctx.currentTime;
    const target = this.muted ? 0.0001 : this.level;
    const g = this.master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(target, now + 0.08);
    return !this.muted;
  }

  /**
   * @param {number} v 0..1
   */
  setLevel(v) {
    this.level = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx && !this.muted) {
      const now = this.ctx.currentTime;
      const g = this.master.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(Math.max(0.0001, this.level), now + 0.08);
    }
  }

  // --- Phase / intensity ---

  _applyPhase(phase) {
    // Target intensities per layer.
    let drum, bass, pad, lead;
    let drumCutoff = 18000;
    switch (phase) {
      case 'countdown':
        drum = 0.6; bass = 0.6; pad = 0.3; lead = 0.0;
        drumCutoff = 1800; // filter the kit down so it doesn't punch over the GO blip
        break;
      case 'play':
        drum = 1.0; bass = 1.0; pad = 1.0; lead = 1.0;
        break;
      case 'goalPause':
        drum = 0.0; bass = 0.0; pad = 0.9; lead = 0.0;
        break;
      case 'over':
        drum = 0.0; bass = 0.0; pad = 0.5; lead = 0.0;
        break;
      default:
        drum = 0.6; bass = 0.6; pad = 0.3; lead = 0.0;
        break;
    }
    this._intensity = { drum, bass, pad, lead };

    const t = 0.6; // fade time
    this._rampParam(this.drumBus.gain, drum, t);
    this._rampParam(this.bassBus.gain, bass, t);
    this._rampParam(this.padBus.gain, pad, t);
    this._rampParam(this.leadBus.gain, lead, t);
    this._rampParam(this.drumLP.frequency, drumCutoff, t);
  }

  _rampParam(param, value, time) {
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + time);
  }

  // --- Scheduler ---

  _scheduler() {
    const ctx = this.ctx;
    if (!ctx) return;
    const spq = 60 / BPM;                  // seconds per quarter
    const stepSec = spq / STEPS_PER_BEAT;  // seconds per 16th
    const horizon = ctx.currentTime + SCHEDULE_AHEAD;
    // Guard against missed wakeups (tab backgrounded): if we've fallen way
    // behind, snap forward.
    if (this._next16Time < ctx.currentTime - 0.25) {
      const skip = Math.ceil((ctx.currentTime - this._next16Time) / stepSec);
      this._next16Time += skip * stepSec;
      this._step16 += skip;
    }
    while (this._next16Time < horizon) {
      this._scheduleStep(this._step16, this._next16Time, stepSec);
      this._next16Time += stepSec;
      this._step16 += 1;
    }
  }

  _scheduleStep(stepAbs, when, stepSec) {
    const stepInLoop = ((stepAbs % STEPS_PER_LOOP) + STEPS_PER_LOOP) % STEPS_PER_LOOP;
    const barInLoop = Math.floor(stepInLoop / STEPS_PER_BAR);  // 0..3
    const stepInBar = stepInLoop % STEPS_PER_BAR;              // 0..15
    const chord = PROGRESSION[barInLoop];

    // Drums.
    // Kick: four-on-the-floor — steps 0, 4, 8, 12 in the bar.
    if (stepInBar % 4 === 0) {
      this._kick(when);
      this._sidechainDuck(when);
    }
    // Snare: beats 2 and 4 — steps 4 and 12 in the bar.
    if (stepInBar === 4 || stepInBar === 12) {
      this._snare(when);
    }
    // Hats: bar-indexed velocity table (one velocity per 16th).
    {
      const hp = HAT_PATTERNS[barInLoop % HAT_PATTERNS.length];
      const v = hp[stepInBar];
      if (v && v > 0.01) {
        this._closedHat(when, v);
      }
      // Open hat on the very last 16th of bar 3 — a once-per-loop accent.
      if (barInLoop === 3 && stepInBar === 15) {
        this._openHat(when);
      }
    }

    // Bass: 8th-note grid → steps 0,2,4,6,8,10,12,14.
    if (stepInBar % 2 === 0) {
      const eighthIdx = stepInBar / 2; // 0..7
      const pattern = BASS_PATTERNS[barInLoop % BASS_PATTERNS.length];
      const semis = pattern[eighthIdx];
      if (semis != null) {
        const freq = chord.bassRoot * Math.pow(2, semis / 12);
        this._bassNote(when, freq);
      }
    }

    // Pad: trigger once at the start of each bar (sustain through the bar).
    if (stepInBar === 0) {
      const barSec = STEPS_PER_BAR * stepSec;
      this._padChord(when, chord.padFreqs, barSec);
    }

    // Lead: 2-bar arp aligned to bars 0-1 and bars 2-3 of the loop.
    // Only audible if leadBus intensity > 0 (we still schedule cheaply —
    // a near-silent note costs almost nothing and keeps timing rock-solid).
    if (!this._goalRiserActive && this._intensity.lead > 0.05) {
      const idx2bar = stepInLoop % (STEPS_PER_BAR * 2); // 0..31
      const motifHz = LEAD_MOTIF_HZ[idx2bar];
      if (motifHz != null) {
        this._leadNote(when, motifHz);
      }
    }
  }

  // --- Voices ---

  _kick(when) {
    const ctx = this.ctx;
    const dur = 0.32;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, when);
    osc.frequency.exponentialRampToValueAtTime(45, when + 0.10);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.95, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g);
    g.connect(this.drumBus);
    osc.start(when);
    osc.stop(when + dur + 0.02);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (e) {} };

    // Click on top: brief HP noise tick.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2000;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0, when);
    cg.gain.linearRampToValueAtTime(0.18, when + 0.002);
    cg.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
    src.connect(hp); hp.connect(cg); cg.connect(this.drumBus);
    src.start(when);
    src.stop(when + 0.06);
    src.onended = () => { try { src.disconnect(); hp.disconnect(); cg.disconnect(); } catch (e) {} };
  }

  _snare(when) {
    const ctx = this.ctx;
    // Noise body: bandpassed burst.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    // Random-ish 1.5s slice into the 2s buffer for variation without per-note RNG headaches.
    src.playbackRate.value = 1.0 + ((this._step16 % 7) * 0.03); // tiny deterministic wobble
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.9;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, when);
    ng.gain.linearRampToValueAtTime(0.45, when + 0.004);
    ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
    src.connect(bp); bp.connect(ng); ng.connect(this.drumBus);
    src.start(when);
    src.stop(when + 0.22);
    src.onended = () => { try { src.disconnect(); bp.disconnect(); ng.disconnect(); } catch (e) {} };

    // Tone: 180 Hz body.
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, when);
    osc.frequency.exponentialRampToValueAtTime(150, when + 0.10);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, when);
    og.gain.linearRampToValueAtTime(0.22, when + 0.003);
    og.gain.exponentialRampToValueAtTime(0.0001, when + 0.14);
    osc.connect(og); og.connect(this.drumBus);
    osc.start(when);
    osc.stop(when + 0.18);
    osc.onended = () => { try { osc.disconnect(); og.disconnect(); } catch (e) {} };
  }

  _closedHat(when, velocity) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6500;
    hp.Q.value = 0.7;
    const g = ctx.createGain();
    const peak = 0.20 * Math.max(0.1, Math.min(1, velocity));
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    src.connect(hp); hp.connect(g); g.connect(this.drumBus);
    src.start(when);
    src.stop(when + 0.07);
    src.onended = () => { try { src.disconnect(); hp.disconnect(); g.disconnect(); } catch (e) {} };
  }

  _openHat(when) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5500;
    hp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.22, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.28);
    src.connect(hp); hp.connect(g); g.connect(this.drumBus);
    src.start(when);
    src.stop(when + 0.32);
    src.onended = () => { try { src.disconnect(); hp.disconnect(); g.disconnect(); } catch (e) {} };
  }

  _bassNote(when, freq) {
    const ctx = this.ctx;
    const dur = 0.22;  // 8th-note-ish
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = freq * 0.5; // sub octave
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 350;
    lp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.40, when + 0.008);
    g.gain.linearRampToValueAtTime(0.30, when + 0.10);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o1.connect(mix); o2.connect(mix); mix.connect(lp); lp.connect(g); g.connect(this.bassBus);
    o1.start(when); o2.start(when);
    o1.stop(when + dur + 0.02);
    o2.stop(when + dur + 0.02);
    o1.onended = () => {
      try { o1.disconnect(); o2.disconnect(); mix.disconnect(); lp.disconnect(); g.disconnect(); } catch (e) {}
    };
  }

  _padChord(when, freqs, holdSec) {
    const ctx = this.ctx;
    const dur = holdSec + 0.4; // overlap the next chord slightly for smoothness
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.30, when + 0.25);
    g.gain.linearRampToValueAtTime(0.28, when + holdSec * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    // Two detuned saws per chord tone.
    const oscs = [];
    for (const f of freqs) {
      for (let k = 0; k < 2; k++) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f * (k === 0 ? 0.997 : 1.003); // ±5 cents detune
        o.connect(g);
        o.start(when);
        o.stop(when + dur + 0.02);
        oscs.push(o);
      }
    }
    g.connect(this.padLP);
    // Cleanup when last osc ends (they all end together).
    oscs[oscs.length - 1].onended = () => {
      try { for (const o of oscs) o.disconnect(); g.disconnect(); } catch (e) {}
    };
  }

  _leadNote(when, freq) {
    const ctx = this.ctx;
    const dur = 0.30;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq * 2.2;
    bp.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.22, when + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(bp); bp.connect(g);
    // Dry → leadBus and also feed the delay line.
    g.connect(this.leadBus);
    g.connect(this.leadDelay);
    o.start(when);
    o.stop(when + dur + 0.02);
    o.onended = () => { try { o.disconnect(); bp.disconnect(); g.disconnect(); } catch (e) {} };
  }

  // --- Sidechain pump ---

  _sidechainDuck(when) {
    const ctx = this.ctx;
    if (!this.sidechainBus) return;
    const g = this.sidechainBus.gain;
    // Cancel any in-flight ramp at/after this kick's time, then dip and recover.
    g.cancelScheduledValues(when);
    g.setValueAtTime(0.30, when);
    g.exponentialRampToValueAtTime(1.0, when + 0.12);
  }

  // --- Events ---

  _goalRiser() {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const dur = 1.4;
    // Cutoff sweep on the pad lowpass — bright opening.
    const padFreq = this.padLP.frequency;
    padFreq.cancelScheduledValues(now);
    padFreq.setValueAtTime(padFreq.value, now);
    padFreq.linearRampToValueAtTime(4500, now + 1.0);
    padFreq.linearRampToValueAtTime(900, now + dur + 0.3);

    // Noise riser: highpassed noise sweeping up.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(400, now);
    hp.frequency.exponentialRampToValueAtTime(8000, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.18, now + 0.4);
    g.gain.linearRampToValueAtTime(0.30, now + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.25);
    src.connect(hp); hp.connect(g); g.connect(this.master);
    src.start(now);
    src.stop(now + dur + 0.3);
    src.onended = () => { try { src.disconnect(); hp.disconnect(); g.disconnect(); } catch (e) {} };

    // Suppress lead motif during the riser so it doesn't fight.
    this._goalRiserActive = true;
    setTimeoutSafe(() => { this._goalRiserActive = false; }, (dur + 0.3) * 1000);
  }

  _duck() {
    const ctx = this.ctx;
    if (!ctx || !this.duckBus) return;
    const now = ctx.currentTime;
    const g = this.duckBus.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0.35, now + 0.04);
    g.linearRampToValueAtTime(1.0, now + 0.35);
  }
}

// --- Helpers ---

// Equal-temperament name → Hz. Supports 'A4', 'C#3', 'Bb2', etc.
function hz(name) {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name);
  if (!m) return 440;
  const letter = m[1].toUpperCase();
  const acc = m[2];
  const oct = parseInt(m[3], 10);
  const semis = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0);
  const midi = (oct + 1) * 12 + semis;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// setTimeout shim so node smoke harnesses without window still work.
function setTimeoutSafe(fn, ms) {
  if (typeof setTimeout === 'function') setTimeout(fn, ms);
}
