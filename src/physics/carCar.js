// Car-vs-car collision: bump or demolition.
// Owner: physics-car. See ARCHITECTURE.md.

import * as THREE from 'three';
import * as C from '../constants.js';

const _delta = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _relVel = new THREE.Vector3();
const _aVelDir = new THREE.Vector3();
const _bVelDir = new THREE.Vector3();
const _dirAtoB = new THREE.Vector3();
const _dirBtoA = new THREE.Vector3();
const _contact = new THREE.Vector3();

const CAR_SPHERE_R = 55;

/**
 * @param {import('./car.js').Car} a
 * @param {import('./car.js').Car} b
 * @returns {null | { type: 'bump'|'demo', attacker, victim, position: THREE.Vector3 }}
 */
export function collideCarCar(a, b) {
  if (!a || !b) return null;
  if (a.isDemolished || b.isDemolished) return null;

  _delta.copy(b.position).sub(a.position);
  const dist = _delta.length();
  const minDist = CAR_SPHERE_R * 2;
  if (dist >= minDist) return null;

  // Normal from a -> b
  if (dist < 1e-6) {
    _normal.set(1, 0, 0);
  } else {
    _normal.copy(_delta).multiplyScalar(1 / dist);
  }
  const overlap = minDist - dist;

  // Depenetrate halves
  a.position.addScaledVector(_normal, -overlap * 0.5);
  b.position.addScaledVector(_normal, overlap * 0.5);

  // Contact position midpoint between centers
  _contact.copy(a.position).addScaledVector(_normal, CAR_SPHERE_R);

  // Demo qualification
  const aSpeed = a.velocity.length();
  const bSpeed = b.velocity.length();
  let aQualifies = false;
  let bQualifies = false;

  if (a.isSupersonic && aSpeed > 1e-3) {
    _aVelDir.copy(a.velocity).multiplyScalar(1 / aSpeed);
    _dirAtoB.copy(b.position).sub(a.position);
    const dab = _dirAtoB.length();
    if (dab > 1e-3) {
      _dirAtoB.multiplyScalar(1 / dab);
      if (_aVelDir.dot(_dirAtoB) > C.DEMO_ALIGNMENT) aQualifies = true;
    }
  }
  if (b.isSupersonic && bSpeed > 1e-3) {
    _bVelDir.copy(b.velocity).multiplyScalar(1 / bSpeed);
    _dirBtoA.copy(a.position).sub(b.position);
    const dba = _dirBtoA.length();
    if (dba > 1e-3) {
      _dirBtoA.multiplyScalar(1 / dba);
      if (_bVelDir.dot(_dirBtoA) > C.DEMO_ALIGNMENT) bQualifies = true;
    }
  }

  if (aQualifies || bQualifies) {
    let attacker, victim;
    if (aQualifies && bQualifies) {
      // Both qualify: faster is attacker
      if (aSpeed >= bSpeed) { attacker = a; victim = b; }
      else { attacker = b; victim = a; }
    } else if (aQualifies) {
      attacker = a; victim = b;
    } else {
      attacker = b; victim = a;
    }
    return { type: 'demo', attacker, victim, position: _contact.clone() };
  }

  // Bump: equal/opposite impulses along the center line.
  _relVel.copy(b.velocity).sub(a.velocity);
  const vRelN = _relVel.dot(_normal); // positive if separating
  if (vRelN < 0) {
    // Convergent — apply impulse
    const mag = -vRelN * C.BUMP_IMPULSE_SCALE; // both masses equal => half-share via factor
    a.velocity.addScaledVector(_normal, -mag);
    b.velocity.addScaledVector(_normal, mag);
  }
  return { type: 'bump', attacker: a, victim: b, position: _contact.clone() };
}
