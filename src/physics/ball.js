// Ball — kinematic sphere with the Sam Mish bounce model.
//
// Integrator order per update(dt):
//   1. velocity += gravity*dt
//   2. velocity *= max(0, 1 − BALL_DRAG*dt)
//   3. position += velocity*dt
//   4. Resolve arena contacts (positional depenetration + bounce impulse if moving into surface).
//   5. Clamp speed / angular-speed.
//   6. Settle: zero tiny normal velocity into near-horizontal floor to avoid jitter.
//
// Emits one 'bounce' event per contact resolved where |v·n| > 250 (matches the architecture
// contract — main.js consumer ignores soft bounces).

import * as THREE from 'three';
import {
  BALL_RADIUS,
  BALL_RESTITUTION,
  BALL_FRICTION_MU,
  BALL_FRICTION_Y,
  BALL_SPIN_A,
  BALL_DRAG,
  BALL_MAX_SPEED,
  BALL_MAX_ANG_VEL,
  GRAVITY,
} from '../constants.js';
import { collideSphere } from './arena.js';

// Module-scratch vectors so update() allocates nothing per-frame.
const _vPerp = new THREE.Vector3();
const _vPara = new THREE.Vector3();
const _vSpin = new THREE.Vector3();
const _s = new THREE.Vector3();
const _dv = new THREE.Vector3();
const _dvPara = new THREE.Vector3();
const _dWfromFric = new THREE.Vector3();

export class Ball {
  constructor() {
    this.position = new THREE.Vector3(0, 0, BALL_RADIUS);
    this.velocity = new THREE.Vector3();
    this.angularVelocity = new THREE.Vector3();
    this.radius = BALL_RADIUS;
  }

  update(dt) {
    const events = [];

    // 1. Gravity
    this.velocity.z -= GRAVITY * dt;
    // 2. Linear drag
    const dragFactor = Math.max(0, 1 - BALL_DRAG * dt);
    this.velocity.multiplyScalar(dragFactor);
    // 3. Position integration
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.position.z += this.velocity.z * dt;

    // 4. Resolve arena contacts. We iterate a few times because depenetration on one surface
    // (e.g. floor) can put the ball into contact with another (e.g. wall fillet). Two passes
    // is usually enough; cap at 4 for safety.
    for (let iter = 0; iter < 4; iter++) {
      const contacts = collideSphere(this.position, this.radius);
      if (contacts.length === 0) break;
      let anyBounced = false;
      for (const c of contacts) {
        const n = c.normal;
        // Positional depenetration along inward normal.
        this.position.x += n.x * c.depth;
        this.position.y += n.y * c.depth;
        this.position.z += n.z * c.depth;
        // Only bounce if moving into the surface (v·n < 0).
        const vDotN = this.velocity.dot(n);
        if (vDotN < 0) {
          const impactSpeed = -vDotN;
          this._bounce(n, vDotN);
          anyBounced = true;
          if (impactSpeed > 250) {
            events.push({
              type: 'bounce',
              speed: impactSpeed,
              position: this.position.clone(),
            });
          }
        }
      }
      if (!anyBounced) break;
    }

    // 5. Speed caps
    const speedSq = this.velocity.lengthSq();
    if (speedSq > BALL_MAX_SPEED * BALL_MAX_SPEED) {
      this.velocity.multiplyScalar(BALL_MAX_SPEED / Math.sqrt(speedSq));
    }
    const angSq = this.angularVelocity.lengthSq();
    if (angSq > BALL_MAX_ANG_VEL * BALL_MAX_ANG_VEL) {
      this.angularVelocity.multiplyScalar(BALL_MAX_ANG_VEL / Math.sqrt(angSq));
    }

    return events;
  }

  /**
   * Apply Sam Mish bounce off a unit inward normal n. Caller guarantees v·n < 0 (moving in).
   * vDotN is provided to avoid recomputing.
   *
   *   vPerp = (v·n) n
   *   vPara = v − vPerp
   *   vSpin = R · (n × ω)
   *   s = vPara + vSpin
   *   Δv = −(1+e)·vPerp − min(1, Y·|vPerp|/|s|)·μ·s     (friction term skipped if |s|≈0)
   *   ω += A·R·(Δv_para × n)   where Δv_para is the friction component only.
   *
   *   After applying Δv to v, if the resulting v·n is small (<5) and the surface is near horizontal
   *   (n.z > 0.9), zero the normal-velocity component so the ball settles flat without jitter.
   */
  _bounce(n, vDotN) {
    _vPerp.copy(n).multiplyScalar(vDotN);
    _vPara.copy(this.velocity).sub(_vPerp);
    // vSpin = R · (n × ω)
    _vSpin.copy(n).cross(this.angularVelocity).multiplyScalar(this.radius);
    _s.copy(_vPara).add(_vSpin);
    const sLen = _s.length();
    const vPerpLen = Math.abs(vDotN);

    // Normal impulse: Δv_n = −(1+e)·vPerp
    _dv.copy(_vPerp).multiplyScalar(-(1 + BALL_RESTITUTION));

    // Friction impulse: −min(1, Y·|vPerp|/|s|)·μ·s
    if (sLen > 1e-3) {
      const ratio = Math.min(1, (BALL_FRICTION_Y * vPerpLen) / sLen);
      const fricScale = -ratio * BALL_FRICTION_MU;
      _dvPara.copy(_s).multiplyScalar(fricScale);
      _dv.add(_dvPara);
      // Angular update: ω += A·R·(Δv_para × n)
      _dWfromFric.copy(_dvPara).cross(n).multiplyScalar(BALL_SPIN_A * this.radius);
      this.angularVelocity.add(_dWfromFric);
    }

    this.velocity.add(_dv);

    // Settling — if we're essentially flat against a near-horizontal surface (floor/ceiling)
    // and the post-bounce normal velocity is tiny, zero it. Keeps tangential roll + spin.
    const newVDotN = this.velocity.dot(n);
    if (Math.abs(newVDotN) < 5 && n.z > 0.9) {
      // Subtract the residual normal component so the ball can roll freely along the floor.
      this.velocity.x -= n.x * newVDotN;
      this.velocity.y -= n.y * newVDotN;
      this.velocity.z -= n.z * newVDotN;
    }
  }
}
