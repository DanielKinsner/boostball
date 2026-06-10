// Bot AI for a competent 1v1 opponent.
// Per ARCHITECTURE.md contract: constructor(car, world, boostPads); update(dt, phase) -> controls.
// Coordinate system: z-up, car local frame +X forward, +Y left, +Z up.
// Own goal y-sign derives from car.team ('orange' => +1 own goal at y=+5120).

import * as THREE from 'three';
import {
  ARENA_HALF_LENGTH,
  ARENA_HALF_WIDTH,
  BALL_RADIUS,
  BOOST_MAX,
  GRAVITY,
  GOAL_HALF_WIDTH,
} from '../constants.js';

// Steering sign convention: car local +Y is LEFT.
// If target's local angle = atan2(localY, localX) is positive (target on the left),
// we want to turn LEFT, which per the controls contract is steer = -1 (right = +1).
// So steer = -clamp(angle * GAIN). Adjust here if the parallel car.js uses
// the opposite convention; isolating this constant makes it trivial to flip.
const STEER_SIGN = -1;
const STEER_GAIN = 2.5;

// Decision tick: re-evaluate target/state on a fixed cadence (not every frame)
// so the bot behavior stays stable instead of dithering between branches.
const DECISION_INTERVAL = 0.15;

// Reusable scratch vectors (avoid per-frame allocations in the hot loop).
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _qInv = new THREE.Quaternion();
const _local = new THREE.Vector3();

function zeroControls() {
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

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export class Bot {
  /**
   * @param {object} car   - the bot's Car (from World.addCar)
   * @param {object} world - World instance (exposes ball, cars)
   * @param {object} boostPads - BoostPads instance (exposes pads[])
   */
  constructor(car, world, boostPads) {
    this.car = car;
    this.world = world;
    this.boostPads = boostPads;

    // Own goal direction along y. orange defends y>0 => +1; blue => -1.
    this.ownGoalSign = car.team === 'orange' ? +1 : -1;
    this.opponentGoalSign = -this.ownGoalSign;

    // Decision-layer state.
    this._decisionTimer = 0;
    this._mode = 'attack'; // 'kickoff' | 'attack' | 'defend' | 'boost' | 'demo' | 'recover'
    this._target = new THREE.Vector3(); // current world-space target point

    // Action queue: small list of timed actions for jumps/dodges/anti-stuck.
    // Each entry: { duration, controls: partial controls object, then?: () => action }
    this._queue = [];

    // Stuck detector.
    this._slowTime = 0;

    // Track previous phase to detect kickoff transitions.
    this._prevPhase = null;
  }

  /**
   * Produce controls for this frame.
   * @param {number} dt
   * @param {string} phase - 'countdown' | 'play' | 'goalPause' | 'over'
   * @returns {object} controls
   */
  update(dt, phase) {
    const controls = zeroControls();
    const car = this.car;

    // Demolished or non-play phases: be inert. (main.js already passes zero
    // controls while frozen, but harden against goalPause/over.)
    if (car.isDemolished || phase === 'goalPause' || phase === 'over' || phase === 'countdown') {
      this._prevPhase = phase;
      return controls;
    }

    // Kickoff trigger: just transitioned countdown -> play with ball near origin.
    const ball = this.world.ball;
    const ballAtOrigin = ball.position.lengthSq() < 200 * 200 && ball.velocity.lengthSq() < 50 * 50;
    if (this._prevPhase === 'countdown' && phase === 'play' && ballAtOrigin) {
      this._mode = 'kickoff';
      this._queue.length = 0;
    }
    this._prevPhase = phase;

    // Service the action queue first; queued actions take precedence over
    // the steering controller so timed sequences (jump->dodge, anti-stuck
    // reverse) play out cleanly.
    if (this._queue.length > 0) {
      const head = this._queue[0];
      Object.assign(controls, head.controls);
      head.duration -= dt;
      if (head.duration <= 0) {
        const next = head.then ? head.then() : null;
        this._queue.shift();
        if (next) this._queue.unshift(next);
      }
      this._tickStuck(dt);
      return controls;
    }

    // Airborne recovery overrides driving — orient wheels down before anything
    // else, since we have no traction in the air.
    if (!car.isOnGround) {
      this._recoveryControls(controls);
      this._tickStuck(dt);
      return controls;
    }

    // Periodic decision update — pick a mode + target.
    this._decisionTimer -= dt;
    if (this._decisionTimer <= 0 || this._mode === 'kickoff') {
      this._decisionTimer = DECISION_INTERVAL;
      this._chooseModeAndTarget();
    }

    // Steering controller toward this._target.
    this._driveTo(controls, this._target);

    // Mode-specific augmentations: queue jump/dodge into ball, demo line, etc.
    this._modeAugmentations(controls);

    this._tickStuck(dt, controls);
    return controls;
  }

  // ----- Mode selection -----

  _chooseModeAndTarget() {
    const car = this.car;
    const ball = this.world.ball;

    const ownGoalY = this.ownGoalSign * ARENA_HALF_LENGTH;
    const oppGoalY = this.opponentGoalSign * ARENA_HALF_LENGTH;

    // Distances along y (signed): how deep into our half the ball is.
    // Ball is "behind us" defensively if it's between us and our own goal
    // on the y axis (closer to own goal than we are).
    const ballToOwnGoal = Math.abs(ball.position.y - ownGoalY);
    const carToOwnGoal = Math.abs(car.position.y - ownGoalY);

    // Velocity component toward own goal (positive = ball heading at our net).
    const vTowardOwnGoal = ball.velocity.y * this.ownGoalSign;

    const ballOnOurHalf = ball.position.y * this.ownGoalSign > 0;
    const ballHeadingAtGoal = vTowardOwnGoal > 400;

    // 1) KICKOFF holds until ball moves.
    if (this._mode === 'kickoff') {
      if (ball.position.lengthSq() > 600 * 600 || ball.velocity.lengthSq() > 400 * 400) {
        this._mode = 'attack'; // ball broke out of kickoff zone
      } else {
        this._target.set(0, 0, BALL_RADIUS);
        return;
      }
    }

    // 2) DEFEND: ball closer to our goal than we are, OR rocketing at goal.
    if ((ballOnOurHalf && ballToOwnGoal < carToOwnGoal - 100) || ballHeadingAtGoal) {
      this._mode = 'defend';
      // Park between ball and goal center, on the own goal line side.
      const goalCenter = _v1.set(0, ownGoalY * 0.75, 17);
      const ballPos = _v2.copy(ball.position);
      // Position 800 uu in front of the goal, on the line from goal to ball.
      const dir = _v3.subVectors(ballPos, goalCenter);
      dir.z = 0;
      if (dir.lengthSq() < 1) dir.set(0, this.opponentGoalSign, 0);
      dir.normalize();
      this._target.copy(goalCenter).addScaledVector(dir, 800);
      this._target.z = 17;

      // Once near home, pivot to face the ball; if ball comes close, clear it.
      const arrived = car.position.distanceTo(this._target) < 300;
      const ballNear = car.position.distanceTo(ball.position) < 1500;
      if (arrived && !ballNear) {
        // Aim at the ball itself so we're ready to clear.
        this._target.copy(ball.position);
        this._target.z = 17;
      }
      if (ballNear) {
        // Clear: place the target on the OWN-GOAL side of the predicted ball
        // so we strike it moving AWAY from own goal (opposite geometry to
        // _attackTarget, which assumes the ball is in the opp half).
        const oppGoalY = this.opponentGoalSign * ARENA_HALF_LENGTH;
        const pred = _v1.copy(ball.position).addScaledVector(ball.velocity, 0.2);
        const goalDir = _v2.set(0, oppGoalY, 0).sub(pred);
        goalDir.z = 0;
        if (goalDir.lengthSq() < 1) goalDir.set(0, this.opponentGoalSign, 0);
        goalDir.normalize();
        // +120 (not -120): target on the own-goal side of the ball.
        this._target.copy(pred).addScaledVector(goalDir, 120);
        this._target.x = clamp(this._target.x, -ARENA_HALF_WIDTH + 120, ARENA_HALF_WIDTH - 120);
        this._target.y = clamp(this._target.y, -ARENA_HALF_LENGTH + 120, ARENA_HALF_LENGTH - 120);
        this._target.z = 17;
      }
      return;
    }

    // 3) BOOST RUN: low boost, ball isn't urgent, and a big pad is available.
    if (
      car.boost < 25 &&
      car.position.distanceTo(ball.position) > 2500 &&
      !ballHeadingAtGoal
    ) {
      const pad = this._nearestActiveBigPad();
      if (pad) {
        this._mode = 'boost';
        this._target.set(pad.position.x, pad.position.y, 17);
        return;
      }
    }

    // 4) DEMO OPPORTUNITY (5% bias built into the trigger conditions):
    // if supersonic-ready and player is nearly on our line, line them up.
    if (this._demoCandidate()) {
      this._mode = 'demo';
      const victim = this._demoCandidate();
      // Aim slightly through the victim's predicted future position.
      this._target.copy(victim.position).addScaledVector(victim.velocity, 0.15);
      this._target.z = 17;
      return;
    }

    // 5) ATTACK by default.
    this._mode = 'attack';
    this._attackTarget();
  }

  _attackTarget() {
    const ball = this.world.ball;
    const oppGoalY = this.opponentGoalSign * ARENA_HALF_LENGTH;

    // Predict ball position a short way ahead.
    const pred = _v1.copy(ball.position).addScaledVector(ball.velocity, 0.3);

    if (ball.position.z > 400) {
      // Ball is high. Estimate landing spot under gravity and meet it there
      // rather than jump-chasing — bot air play is unreliable.
      const vz = ball.velocity.z;
      const z = ball.position.z;
      // Solve z + vz*t - 0.5*g*t^2 = BALL_RADIUS for t (take positive root).
      const a = -0.5 * GRAVITY;
      const b = vz;
      const c = z - BALL_RADIUS;
      const disc = b * b - 4 * a * c;
      let t = 0.3;
      if (disc > 0) {
        const sq = Math.sqrt(disc);
        const t1 = (-b - sq) / (2 * a);
        const t2 = (-b + sq) / (2 * a);
        t = Math.max(t1, t2);
        if (!isFinite(t) || t < 0) t = 0.3;
      }
      pred.copy(ball.position).addScaledVector(ball.velocity, t);
      pred.z = BALL_RADIUS;
    }

    // Offset 120 uu on the goal-opposite side so we hit the ball TOWARD the
    // opponent goal (approach behind the ball, line up the shot).
    const goalDir = _v2.set(0, oppGoalY, BALL_RADIUS).sub(pred);
    goalDir.z = 0;
    if (goalDir.lengthSq() < 1) goalDir.set(0, this.opponentGoalSign, 0);
    goalDir.normalize();

    this._target.copy(pred).addScaledVector(goalDir, -120);
    // Clamp into the field so we don't try to drive out of bounds.
    this._target.x = clamp(this._target.x, -ARENA_HALF_WIDTH + 120, ARENA_HALF_WIDTH - 120);
    this._target.y = clamp(
      this._target.y,
      -ARENA_HALF_LENGTH + 120,
      ARENA_HALF_LENGTH - 120
    );
    this._target.z = 17;
  }

  _nearestActiveBigPad() {
    const pads = this.boostPads?.pads;
    if (!pads || pads.length === 0) return null;
    let best = null;
    let bestDist = Infinity;
    const pos = this.car.position;
    for (const p of pads) {
      if (!p.big || !p.active) continue;
      const dx = p.position.x - pos.x;
      const dy = p.position.y - pos.y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }

  _demoCandidate() {
    const car = this.car;
    if (car.boost < 40) return null;
    const speed = car.velocity.length();
    if (speed < 1800) return null;

    // Find an opposing car.
    let victim = null;
    for (const c of this.world.cars) {
      if (c.id === car.id) continue;
      if (c.team === car.team) continue;
      if (c.isDemolished) continue;
      victim = c;
      break;
    }
    if (!victim) return null;

    const dist = car.position.distanceTo(victim.position);
    if (dist > 900) return null;

    // Roughly ahead test (|angle| < 0.35).
    const angle = this._angleToTarget(victim.position);
    if (Math.abs(angle) > 0.35) return null;

    return victim;
  }

  // ----- Steering controller -----

  /**
   * Transform target into car-local space, return atan2(localY, localX).
   * +angle == target is on the LEFT (since car local +Y is left).
   */
  _angleToTarget(target) {
    const car = this.car;
    _qInv.copy(car.quaternion).invert();
    _local.copy(target).sub(car.position).applyQuaternion(_qInv);
    return Math.atan2(_local.y, _local.x);
  }

  _driveTo(controls, target) {
    const car = this.car;
    const angle = this._angleToTarget(target);
    const absA = Math.abs(angle);
    const speed = car.velocity.length();
    const dist = car.position.distanceTo(target);

    // Behind us (>= 90deg off-axis) and close: prefer reversing to a quicker
    // sharp turn. We flip throttle AND steer so the car arcs around backwards
    // toward the target.
    if (absA > Math.PI * 0.55 && dist < 800) {
      controls.throttle = -1;
      controls.steer = clamp(-STEER_SIGN * angle * STEER_GAIN, -1, 1);
    } else {
      controls.throttle = 1;
      controls.steer = clamp(STEER_SIGN * angle * STEER_GAIN, -1, 1);
    }

    // Powerslide when whipping the car around at speed.
    if (absA > 1.7 && speed > 600) {
      controls.handbrake = true;
    }

    // Boost on a long, well-aimed straight when we have fuel to spare.
    if (absA < 0.25 && dist > 1200 && car.boost > 10) {
      controls.boost = true;
    }
  }

  // ----- Mode augmentations (jumps, dodges, recovery) -----

  _modeAugmentations(controls) {
    const car = this.car;
    const ball = this.world.ball;

    // Kickoff dodge into the ball when close.
    if (this._mode === 'kickoff') {
      controls.boost = car.boost > 0;
      const dToBall = car.position.distanceTo(ball.position);
      if (dToBall < 700) {
        this._queueFrontFlip();
      }
      return;
    }

    // Attack/defend: jump+forward-dodge into ball when in range.
    if (this._mode === 'attack' || this._mode === 'defend') {
      const dToBall = car.position.distanceTo(ball.position);
      const ballLow = ball.position.z < 220;
      const lined = Math.abs(this._angleToTarget(ball.position)) < 0.35;
      if (dToBall < 350 && ballLow && lined && car.isOnGround) {
        this._queueFrontFlip();
      }
    }

    // Demo mode: hold line, boost hard.
    if (this._mode === 'demo') {
      controls.boost = car.boost > 0;
      controls.handbrake = false;
    }
  }

  /**
   * Queue a jump -> release -> wait -> forward-dodge (pitch -1) sequence.
   * - press jump for 1 tick (~dt)
   * - release jump for ~0.13s (within DOUBLE_JUMP_WINDOW)
   * - re-press jump with pitch=-1 for one tick to trigger dodge
   * - hold pitch=-1 briefly to complete the flip
   */
  _queueFrontFlip() {
    if (this._queue.length > 0) return; // don't stack
    this._queue.push({ duration: 0.05, controls: { throttle: 1, jump: true } });
    this._queue.push({ duration: 0.13, controls: { throttle: 1, jump: false } });
    this._queue.push({ duration: 0.05, controls: { throttle: 1, jump: true, pitch: -1 } });
    this._queue.push({ duration: 0.3, controls: { throttle: 1, jump: false, pitch: -1 } });
  }

  _recoveryControls(controls) {
    const car = this.car;
    // Aim car.up toward world +z. Decompose error in car-local axes:
    // localTilt.x => need pitch correction, localTilt.y => need roll correction.
    _v1.set(0, 0, 1); // world up
    _qInv.copy(car.quaternion).invert();
    _local.copy(_v1).applyQuaternion(_qInv); // world-up in car-local

    // If _local.z > 0 we're roughly upright; tilt is encoded in (_local.x, _local.y).
    // Roll: world up appearing on the left of car-local (+Y) means we're rolled
    // to the right; we need roll input to rotate left.
    // Pitch: world up appearing forward (+X local) means nose is high; we want
    // pitch input to bring nose down (pitch convention: +1 nose up — see RL —
    // so we use -sign(localX)).
    const rollErr = _local.y;
    const pitchErr = _local.x;

    if (_local.z < 0) {
      // Inverted: proportional terms vanish at the antipode (world-up appears
      // straight down in car-local, so rollErr/pitchErr ≈ 0 and AIR_DAMP_ROLL
      // would hold us upside-down). Commit to a roll direction to escape the
      // unstable equilibrium; prefer whichever side we're already tipping
      // toward. Roll-only avoids the pitch+roll corkscrew that fights itself.
      const bias = Math.abs(_local.y) > 1e-3 ? -Math.sign(_local.y) : 1;
      controls.roll = bias;
      controls.pitch = 0;
    } else {
      controls.roll = clamp(-rollErr * 3, -1, 1);
      controls.pitch = clamp(-pitchErr * 3, -1, 1);
    }
    // Mild forward throttle so we land moving the right way.
    controls.throttle = 1;
  }

  // ----- Anti-stuck -----

  _tickStuck(dt, controls) {
    const car = this.car;
    const speed = car.velocity.length();
    if (speed < 100 && car.isOnGround) {
      this._slowTime += dt;
    } else {
      this._slowTime = 0;
    }
    if (this._slowTime > 1.2 && this._queue.length === 0) {
      // Queue 0.7s of reverse with opposite steer to wiggle out.
      const reverseSteer = (controls && controls.steer) ? -Math.sign(controls.steer) : 1;
      this._queue.push({
        duration: 0.7,
        controls: {
          throttle: -1,
          steer: reverseSteer * 0.7,
          handbrake: false,
        },
      });
      this._slowTime = 0;
    }
  }
}
