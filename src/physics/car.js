// Car physics for the Rocket clone. Z-up world, car-local +X forward / +Y left / +Z up.
// Owner: physics-car. See ARCHITECTURE.md for the contract.

import * as THREE from 'three';
import * as C from '../constants.js';
import * as arena from './arena.js';

// --- module-scratch (avoid per-frame allocations) ---
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();
const _v7 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _left = new THREE.Vector3();
const _up = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _e1 = new THREE.Euler();

const LOCAL_X = new THREE.Vector3(1, 0, 0);
const LOCAL_Y = new THREE.Vector3(0, 1, 0);
const LOCAL_Z = new THREE.Vector3(0, 0, 1);
const WORLD_Z = new THREE.Vector3(0, 0, 1);

let _nextId = 1;

/**
 * Quaternion that maps car local +X to the given (planar-ish) forward vector, with +Z up.
 * @param {THREE.Vector3} forwardVec3
 * @returns {THREE.Quaternion}
 */
export function makeCarQuaternion(forwardVec3) {
  const f = _v1.copy(forwardVec3);
  f.z = 0;
  if (f.lengthSq() < 1e-12) f.set(1, 0, 0);
  else f.normalize();
  // Left = up × forward
  const left = _v2.copy(WORLD_Z).cross(f).normalize();
  const up = _v3.copy(f).cross(left).normalize();
  _m1.makeBasis(f, left, up);
  const q = new THREE.Quaternion();
  q.setFromRotationMatrix(_m1);
  return q;
}

export class Car {
  /**
   * @param {{ id?:number, team:string, name?:string }} opts
   */
  constructor({ id, team, name = '' }) {
    this.id = id != null ? id : _nextId++;
    this.team = team;
    this.name = name;

    this.position = new THREE.Vector3(0, 0, C.CAR_REST_Z);
    this.velocity = new THREE.Vector3();
    this.angularVelocity = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();

    this.boost = C.BOOST_SPAWN_AMOUNT;
    this.isOnGround = true;
    this.isSupersonic = false;
    this.isDemolished = false;

    /** @type {Object} */
    this.lastControls = {
      throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0,
      jump: false, boost: false, handbrake: false,
    };

    // Internal jump state machine
    this._groundNormal = new THREE.Vector3(0, 0, 1);
    this._jumpPrev = false; // for edge-detect
    this._jumpHoldT = 0;     // remaining seconds where jump-hold accel applies
    this._holdingJump = false;
    this._airTime = 0;       // seconds since leaving ground
    this._jumpedSinceGround = false; // RL rule: flip window only counts after a JUMP;
    this._timeSinceJump = 0;         // falling without jumping keeps the flip forever (wavedash)
    this._usedDoubleJump = false;
    this._dodgeTorqueT = 0;  // remaining seconds of dodge flip torque
    this._dodgeFlipAxis = new THREE.Vector3(); // car-local axis to spin around during flip
    this._wasOnGround = true;
    this._groundLockoutT = 0; // suppress 'grounded' for this many seconds (post-jump)
    this._ballContactCooldown = 0; // seconds where Psyonix kick is suppressed (per-hit-event gate)
  }

  /** @returns {THREE.Vector3} world forward (cloned) */
  get forward() { return LOCAL_X.clone().applyQuaternion(this.quaternion); }
  /** @returns {THREE.Vector3} world up */
  get up() { return LOCAL_Z.clone().applyQuaternion(this.quaternion); }
  /** @returns {THREE.Vector3} world left */
  get left() { return LOCAL_Y.clone().applyQuaternion(this.quaternion); }
  /** RL convention: right = -left */
  get right() { return LOCAL_Y.clone().applyQuaternion(this.quaternion).multiplyScalar(-1); }

  /**
   * @param {number} dt
   * @param {Object} controls
   * @returns {Array}
   */
  update(dt, controls) {
    const events = [];
    if (this.isDemolished) {
      this.lastControls = controls || this.lastControls;
      return events;
    }
    const ctl = controls || this.lastControls;
    this.lastControls = ctl;

    const throttle = clamp(ctl.throttle, -1, 1);
    const steer = clamp(ctl.steer, -1, 1);
    const pitch = clamp(ctl.pitch, -1, 1);
    const yawIn = clamp(ctl.yaw, -1, 1);
    const rollIn = clamp(ctl.roll, -1, 1);
    const jump = !!ctl.jump;
    const boostHeld = !!ctl.boost;
    const handbrake = !!ctl.handbrake;

    // Cache world basis vectors
    _fwd.copy(LOCAL_X).applyQuaternion(this.quaternion);
    _left.copy(LOCAL_Y).applyQuaternion(this.quaternion);
    _up.copy(LOCAL_Z).applyQuaternion(this.quaternion);

    // Decrement ground lockout (suppresses 'grounded' briefly after a jump)
    if (this._groundLockoutT > 0) {
      this._groundLockoutT -= dt;
      if (this._groundLockoutT < 0) this._groundLockoutT = 0;
    }

    // --- Suspension raycast ---
    const rayOrigin = _v1.copy(this.position);
    const rayDir = _v2.copy(_up).multiplyScalar(-1);
    // Reach is generous so the car keeps its footing through wall-floor fillet
    // transitions, where the surface curves away under the (lagging) chassis.
    const maxDist = C.CAR_REST_Z + 45;
    let hit = null;
    if (arena && typeof arena.raycast === 'function') {
      hit = arena.raycast(rayOrigin, rayDir, maxDist);
    }
    // 0.6 ⇒ surface within ~53° of the car's belly. Looser values let tilted cars
    // "ground" on flat floor, hover on the suspension spring, and skip gravity.
    const rayGrounded = !!(hit && hit.normal && hit.normal.dot(_up) > 0.6);
    const grounded = rayGrounded && this._groundLockoutT <= 0;

    // Edge-detect jump button
    const jumpPressed = jump && !this._jumpPrev;

    if (grounded) {
      this._groundNormal.copy(hit.normal);
      this._airTime = 0;
      this._jumpedSinceGround = false;
      this._timeSinceJump = 0;
      this._usedDoubleJump = false;
    } else {
      this._airTime += dt;
      // RL rule: the 1.25s flip window starts at the FIRST JUMP. A car that drove
      // off a wall/edge without jumping keeps its flip until it lands (wavedash).
      if (this._jumpedSinceGround) {
        this._timeSinceJump += dt;
        if (this._timeSinceJump > C.DOUBLE_JUMP_WINDOW) this._usedDoubleJump = true;
      }
    }

    // --- Ground physics ---
    if (grounded) {
      // Suspension spring along surface normal to maintain rest height.
      // Stiff enough to keep car near CAR_REST_Z against gravity+sticky.
      const dist = hit.dist; // distance from chassis center to ground along -up
      const heightErr = C.CAR_REST_Z - dist;
      const vAlongN = this.velocity.dot(hit.normal);
      // Critical damping ~ 2*sqrt(stiffness). 250 stiffness, ~32 damping.
      let springAccel = heightErr * 250 - vAlongN * 32;
      // Wheels can't grab the ground: never pull the car downward while it's
      // genuinely launching away from the surface (post-jump), only while riding it.
      if (springAccel < 0 && vAlongN > 250) springAccel = 0;
      // Clamp for stability
      springAccel = clamp(springAccel, -10000, 10000);
      this.velocity.addScaledVector(hit.normal, springAccel * dt);

      // STICKY_FORCE along -surface-normal (sticks car to surface, enables wall driving).
      // Use hit.normal rather than _up so the force points into the surface during
      // alignment transients (alignUpTo below only closes ~4% of misalignment per
      // substep at 240Hz, so _up can lag the normal by tens of degrees on floor↔wall fillets).
      // Steady-state is unchanged because once aligned, -_up == -hit.normal.
      this.velocity.addScaledVector(hit.normal, -C.STICKY_FORCE * dt);

      // Align car up to surface normal. 14/s keeps orientation lag ~18° when riding
      // a fillet at full speed (4.3 rad/s of surface rotation) — enough to stay grounded.
      alignUpTo(this.quaternion, hit.normal, dt * 14, _q1, _q2);
      // Refresh basis after alignment
      _fwd.copy(LOCAL_X).applyQuaternion(this.quaternion);
      _left.copy(LOCAL_Y).applyQuaternion(this.quaternion);
      _up.copy(LOCAL_Z).applyQuaternion(this.quaternion);

      // Decompose velocity into car frame
      const fwdSpeed = this.velocity.dot(_fwd);
      const latSpeed = this.velocity.dot(_left);

      // Throttle / brake / coast (along forward axis)
      let driveAccel = 0;
      if (throttle !== 0) {
        const sameDir = (throttle > 0 && fwdSpeed >= 0) || (throttle < 0 && fwdSpeed <= 0);
        if (sameDir || Math.abs(fwdSpeed) < 5) {
          // Accelerate using throttle curve
          const a = C.curveLerp(C.THROTTLE_ACCEL_CURVE, Math.abs(fwdSpeed));
          driveAccel = a * (throttle > 0 ? 1 : -1);
        } else {
          // Brake: throttle opposes motion direction
          driveAccel = C.BRAKE_ACCEL * (throttle > 0 ? 1 : -1);
        }
      } else if (Math.abs(fwdSpeed) > 1) {
        driveAccel = -Math.sign(fwdSpeed) * C.COAST_DECEL;
      }
      this.velocity.addScaledVector(_fwd, driveAccel * dt);

      // Lateral grip — kill a fraction of lateral velocity
      let gripStrength = C.LATERAL_GRIP * 20; // per-second rate
      if (handbrake) gripStrength *= C.HANDBRAKE_GRIP;
      const killFrac = Math.min(1, gripStrength * dt);
      // Remove lateral component
      this.velocity.addScaledVector(_left, -latSpeed * killFrac);

      // Yaw: while grounded, angular velocity *is* the steer rate about car up.
      // steer +1 = turn right = negative rotation about +Z (when upright).
      // Magnitude scales with forward speed and steering curvature.
      const steerCurv = C.curveLerp(C.STEER_CURVE, Math.abs(fwdSpeed));
      const yawRate = -steer * fwdSpeed * steerCurv;
      // Set angular velocity = yawRate about car up. Reset other axes while grounded
      // (alignment is handled by the quaternion slerp above; no torque needed).
      this.angularVelocity.copy(_up).multiplyScalar(yawRate);

      // Jump from ground
      if (jumpPressed) {
        // Impulse along car up
        this.velocity.addScaledVector(_up, C.JUMP_IMPULSE);
        this._jumpHoldT = C.JUMP_HOLD_MAX_TIME;
        this._holdingJump = true;
        this._airTime = 1e-6; // mark as airborne
        this._jumpedSinceGround = true;
        this._timeSinceJump = 0;
        this._usedDoubleJump = false;
        // Prevent suspension from immediately pulling us back down. Long enough for
        // the car to clear the (generous) suspension ray reach before it can re-ground.
        this._groundLockoutT = 0.2;
        events.push({ type: 'jump', carId: this.id });
        // Also remember: we are now leaving ground for this step
      }
    } else {
      // --- Air physics ---
      // Jump hold accel (only while holding and within hold window after first jump)
      if (this._holdingJump && jump && this._jumpHoldT > 0) {
        const useDt = Math.min(dt, this._jumpHoldT);
        this.velocity.addScaledVector(_up, C.JUMP_HOLD_ACCEL * useDt);
        this._jumpHoldT -= useDt;
      }
      if (!jump) {
        this._holdingJump = false;
        this._jumpHoldT = 0;
      }

      // Air control torques (only if not in active dodge flip override)
      const dodgeActive = this._dodgeTorqueT > 0;
      if (!dodgeActive) {
        // Compute local angular velocity components
        const wLocalX = this.angularVelocity.dot(_fwd); // roll axis (car +X)
        const wLocalY = this.angularVelocity.dot(_left); // pitch axis (car +Y)
        const wLocalZ = this.angularVelocity.dot(_up);  // yaw axis (car +Z)

        // Pitch: pitch +1 = nose up. Nose-up rotates +X toward +Z.
        // Rotation about +Y maps +X -> -Z. So nose-up needs torque about -Y.
        // torque_about_carY = -pitch * AIR_TORQUE_PITCH
        // Pitch/yaw damping is input-gated — scales with (1-|input|), per Sam Mish's
        // calibration. Roll damping below is constant (not gated).
        let pitchTorque = -pitch * C.AIR_TORQUE_PITCH;
        pitchTorque += -wLocalY * C.AIR_DAMP_PITCH * (1 - Math.min(1, Math.abs(pitch)));

        // Yaw: yaw +1 = turn right = negative about car +Z
        let yawTorque = -yawIn * C.AIR_TORQUE_YAW;
        yawTorque += -wLocalZ * C.AIR_DAMP_YAW * (1 - Math.min(1, Math.abs(yawIn)));

        // Roll: roll +1 = roll right (top tilts right). +rotation about +X tilts +Z -> -Y (right).
        let rollTorque = rollIn * C.AIR_TORQUE_ROLL;
        rollTorque += -wLocalX * C.AIR_DAMP_ROLL;

        // Apply local torques to world angular velocity
        const dwX = rollTorque * dt;
        const dwY = pitchTorque * dt;
        const dwZ = yawTorque * dt;
        this.angularVelocity.addScaledVector(_fwd, dwX);
        this.angularVelocity.addScaledVector(_left, dwY);
        this.angularVelocity.addScaledVector(_up, dwZ);
      } else {
        this._dodgeTorqueT -= dt;
        if (this._dodgeTorqueT < 0) this._dodgeTorqueT = 0;
      }

      // Second jump / dodge logic. Window enforcement happens above via _usedDoubleJump —
      // a car that fell without jumping keeps its flip indefinitely (RL behavior).
      if (jumpPressed && !this._usedDoubleJump) {
        const hasDir = Math.abs(pitch) > 0.1 || Math.abs(yawIn) > 0.1 || Math.abs(steer) > 0.1;
        if (hasDir) {
          // Dodge.
          const yawComp = Math.abs(yawIn) > Math.abs(steer) ? yawIn : steer;
          // Local 2D direction (car +X forward, +Y left)
          let dx = -pitch;     // pitch=-1 => +X forward
          let dy = -yawComp;   // yaw=+1 (right) => -Y (right)
          const dl = Math.hypot(dx, dy);
          if (dl > 1e-6) { dx /= dl; dy /= dl; }
          else { dx = 1; dy = 0; }
          const backward = dx < -0.1;
          const sideways = !backward && Math.abs(dy) > Math.abs(dx);
          const mag = C.DODGE_IMPULSE *
            (backward ? C.DODGE_BACKWARD_SCALE : sideways ? C.DODGE_SIDE_SCALE : 1);

          // Planar dodge: project car forward/left onto xy plane
          const fwdPlanar = _v3.copy(_fwd); fwdPlanar.z = 0;
          if (fwdPlanar.lengthSq() < 1e-8) fwdPlanar.set(1, 0, 0); else fwdPlanar.normalize();
          const leftPlanar = _v4.copy(_left); leftPlanar.z = 0;
          if (leftPlanar.lengthSq() < 1e-8) {
            // Choose any horizontal perpendicular
            leftPlanar.set(-fwdPlanar.y, fwdPlanar.x, 0);
          } else {
            leftPlanar.normalize();
          }

          // Zero vertical velocity first
          this.velocity.z = 0;
          this.velocity.addScaledVector(fwdPlanar, dx * mag);
          this.velocity.addScaledVector(leftPlanar, dy * mag);

          // Flip torque: forward/back flip about car +Y (pitch axis), side flip about car +X (roll)
          // Choose axis perpendicular to the (dx,dy) planar dir in car frame:
          // for forward dodge (dx=1,dy=0): flip = pitch (about car +Y), and direction = +Y for nose-down (forward flip) — but convention is forward flip pitches nose DOWN initially. We use sign such that forward dodge => +rotation about +Y (nose-down).
          // Side dodge (dx=0, dy=-1 right): roll right => +rotation about +X.
          // General: axis = (-dy, dx, 0) in car-local
          const axLocalX = -dy;
          const axLocalY = dx;
          // Normalize (already unit length from dx,dy)
          // Build world axis from car-local components
          _v5.copy(_fwd).multiplyScalar(axLocalX).addScaledVector(_left, axLocalY);
          if (_v5.lengthSq() < 1e-8) _v5.copy(_left);
          else _v5.normalize();
          this.angularVelocity.copy(_v5).multiplyScalar(C.DODGE_ANG_VEL);

          this._dodgeTorqueT = C.DODGE_TORQUE_TIME;
          this._usedDoubleJump = true;
          this._holdingJump = false;
          this._jumpHoldT = 0;
          events.push({ type: 'dodge', carId: this.id });
        } else {
          // Plain double jump along car up
          this.velocity.addScaledVector(_up, C.DOUBLE_JUMP_IMPULSE);
          this._usedDoubleJump = true;
          this._holdingJump = false;
          this._jumpHoldT = 0;
          events.push({ type: 'jump', carId: this.id });
        }
      }
    }

    // --- Boost (works in air and ground; air boost is stronger, per RocketSim) ---
    if (boostHeld && this.boost > 0) {
      this.velocity.addScaledVector(_fwd, (grounded ? C.BOOST_ACCEL : C.BOOST_ACCEL_AIR) * dt);
      this.boost -= C.BOOST_CONSUMPTION * dt;
      if (this.boost < 0) this.boost = 0;
    }

    // --- Gravity (world -z). Skipped while grounded — suspension carries weight. ---
    if (!grounded) {
      this.velocity.z -= C.GRAVITY * dt;
    }

    // --- Caps ---
    const speed = this.velocity.length();
    if (speed > C.CAR_MAX_SPEED) {
      this.velocity.multiplyScalar(C.CAR_MAX_SPEED / speed);
    }
    const aSpeed = this.angularVelocity.length();
    if (aSpeed > C.CAR_MAX_ANG_VEL) {
      this.angularVelocity.multiplyScalar(C.CAR_MAX_ANG_VEL / aSpeed);
    }

    // --- Integrate position ---
    this.position.addScaledVector(this.velocity, dt);

    // --- Integrate quaternion from angular velocity ---
    integrateQuaternion(this.quaternion, this.angularVelocity, dt, _q1);

    // --- Chassis-vs-arena collision (4 hitbox corner spheres) ---
    if (arena && typeof arena.collideSphere === 'function') {
      _fwd.copy(LOCAL_X).applyQuaternion(this.quaternion);
      _left.copy(LOCAL_Y).applyQuaternion(this.quaternion);
      _up.copy(LOCAL_Z).applyQuaternion(this.quaternion);

      const r = C.CAR_HEIGHT / 2;
      const halfL = C.CAR_LENGTH / 2;
      const halfW = C.CAR_WIDTH / 2;
      const corners = [
        [+halfL, +halfW], [+halfL, -halfW],
        [-halfL, +halfW], [-halfL, -halfW],
      ];
      let restingContact = false; // chassis touching a floor-ish surface while not grounded
      for (let i = 0; i < 4; i++) {
        const cx = corners[i][0];
        const cy = corners[i][1];
        _v6.copy(this.position)
          .addScaledVector(_fwd, cx)
          .addScaledVector(_left, cy);
        const contacts = arena.collideSphere(_v6, r);
        if (!contacts || contacts.length === 0) continue;
        for (const c of contacts) {
          const n = c.normal;
          const depth = c.depth;
          // Skip near-ground contacts while grounded (suspension handles those)
          if (grounded && n.dot(this._groundNormal) > 0.9) continue;
          if (!grounded && n.z > 0.7) restingContact = true;
          // Positional correction
          this.position.addScaledVector(n, depth);
          // Velocity response: reflect along normal with restitution, friction tangential
          const vn = this.velocity.dot(n);
          if (vn < 0) {
            this.velocity.addScaledVector(n, -vn * (1 + 0.3));
            // Tangential friction: remove 20% of tangential component
            // tangent = v - (v·n)n  (using new v)
            _v7.copy(this.velocity).addScaledVector(n, -this.velocity.dot(n));
            this.velocity.addScaledVector(_v7, -0.2);
          }
        }
      }

      // Self-righting: a near-rest car sitting on its side/roof topples back onto its
      // wheels (real RL cars settle too — flat boxes balancing on an edge feel broken).
      if (restingContact && this._dodgeTorqueT <= 0 &&
          this.velocity.lengthSq() < 300 * 300 && this.angularVelocity.lengthSq() < 9) {
        const upZ = _up.z;
        if (upZ < 0.95) {
          // Torque axis rotates car-up toward world +z.
          _v7.set(_up.y, -_up.x, 0); // up × worldZ: +rotation about this lifts up toward +z
          const al = _v7.length();
          // Exactly inverted ⇒ axis degenerates; pick the roll axis so it tips sideways.
          if (al < 1e-4) _v7.copy(_fwd).setZ(0).normalize();
          else _v7.multiplyScalar(1 / al);
          {
            // Stronger when fully inverted, gentle near upright; capped contribution.
            const strength = 14 * (1 - upZ * 0.5);
            this.angularVelocity.addScaledVector(_v7, strength * dt);
            const w = this.angularVelocity.length();
            if (w > 3.2) this.angularVelocity.multiplyScalar(3.2 / w);
          }
        }
      }
    }

    // --- Supersonic hysteresis ---
    const sp2 = this.velocity.length();
    if (this.isSupersonic) {
      if (sp2 < C.SUPERSONIC_OFF) this.isSupersonic = false;
    } else {
      if (sp2 >= C.SUPERSONIC_ON) this.isSupersonic = true;
    }

    // --- Landing detection ---
    if (this._wasOnGround && !grounded) {
      // Just left ground (jump already emitted, just bookkeeping)
    }
    if (!this._wasOnGround && grounded) {
      // Just landed
      events.push({ type: 'land', carId: this.id, speed });
      // Reset jump state on landing
      this._jumpHoldT = 0;
      this._holdingJump = false;
      this._airTime = 0;
      this._usedDoubleJump = false;
      this._dodgeTorqueT = 0;
    }
    this._wasOnGround = grounded;
    this.isOnGround = grounded;
    this._jumpPrev = jump;

    return events;
  }
}

// --- helpers ---

function clamp(x, lo, hi) {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

/**
 * Rotate quaternion `q` so its local +Z aligns toward `targetUp` at rate `factor` (0..1+).
 * factor is dt * rate; clamped to [0,1] internally.
 */
function alignUpTo(q, targetUp, factor, scratchQ1, scratchQ2) {
  const t = Math.min(1, Math.max(0, factor));
  const currentUp = _v4.copy(LOCAL_Z).applyQuaternion(q);
  const tup = _v5.copy(targetUp).normalize();
  const dot = currentUp.dot(tup);
  if (dot > 0.99995) return; // already aligned
  // Rotation axis perpendicular to current and target
  const axis = _v6.crossVectors(currentUp, tup);
  const al = axis.length();
  if (al < 1e-8) {
    // Anti-parallel; pick any horizontal axis to spin around
    axis.set(1, 0, 0);
  } else {
    axis.multiplyScalar(1 / al);
  }
  const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * t;
  scratchQ1.setFromAxisAngle(axis, angle);
  // q = scratchQ1 * q (world-space rotation pre-applied)
  q.premultiply(scratchQ1);
  q.normalize();
}

/**
 * Integrate quaternion by angular velocity (world frame) for time dt.
 * q += 0.5 * (w_quat * q) * dt ; then normalize.
 */
function integrateQuaternion(q, w, dt, scratchQ) {
  const wx = w.x * dt * 0.5;
  const wy = w.y * dt * 0.5;
  const wz = w.z * dt * 0.5;
  scratchQ.set(wx, wy, wz, 0);
  // dq = scratchQ * q
  const ax = scratchQ.x, ay = scratchQ.y, az = scratchQ.z, aw = scratchQ.w;
  const bx = q.x, by = q.y, bz = q.z, bw = q.w;
  const nx = aw * bx + ax * bw + ay * bz - az * by;
  const ny = aw * by - ax * bz + ay * bw + az * bx;
  const nz = aw * bz + ax * by - ay * bx + az * bw;
  const nw = aw * bw - ax * bx - ay * by - az * bz;
  q.x += nx;
  q.y += ny;
  q.z += nz;
  q.w += nw;
  q.normalize();
}
