// Car ⟷ ball OBB-sphere collision with the Psyonix impulse.
// Owner: physics-car. See ARCHITECTURE.md.

import * as THREE from 'three';
import * as C from '../constants.js';

// --- module scratch ---
const _localBallPos = new THREE.Vector3();
const _closestLocal = new THREE.Vector3();
const _contactWorld = new THREE.Vector3();
const _normalWorld = new THREE.Vector3();
const _relVel = new THREE.Vector3();
const _rArm = new THREE.Vector3();
const _impulse = new THREE.Vector3();
const _psyDir = new THREE.Vector3();
const _spinAdd = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _left = new THREE.Vector3();
const _up = new THREE.Vector3();
const _qInv = new THREE.Quaternion();
const _v = new THREE.Vector3();

const LOCAL_X = new THREE.Vector3(1, 0, 0);
const LOCAL_Y = new THREE.Vector3(0, 1, 0);
const LOCAL_Z = new THREE.Vector3(0, 0, 1);

const RESTITUTION = 0.0;
const CAR_MASS = C.CAR_MASS;
const BALL_MASS = C.BALL_MASS;
const CAR_REACTION_FACTOR = 0.35; // how much the car bumps back from the ball collision
const SPIN_K = 0.0005;

/**
 * Detect OBB(car)-sphere(ball) collision, depenetrate ball, apply impulse + Psyonix kick.
 * @param {import('./car.js').Car} car
 * @param {import('./ball.js').Ball} ball
 * @returns {null | { speed: number, position: THREE.Vector3 }}
 */
export function collideCarBall(car, ball) {
  if (!car || !ball) return null;
  if (car.isDemolished) return null;

  // Car local frame
  _fwd.copy(LOCAL_X).applyQuaternion(car.quaternion);
  _left.copy(LOCAL_Y).applyQuaternion(car.quaternion);
  _up.copy(LOCAL_Z).applyQuaternion(car.quaternion);

  // Ball position in car local frame (centered at chassis center)
  _v.copy(ball.position).sub(car.position);
  const lx = _v.dot(_fwd);
  const ly = _v.dot(_left);
  const lz = _v.dot(_up);
  _localBallPos.set(lx, ly, lz);

  const hl = C.CAR_LENGTH * 0.5;
  const hw = C.CAR_WIDTH * 0.5;
  const hh = C.CAR_HEIGHT * 0.5;
  const r = ball.radius;

  // Closest point on OBB to ball center (in local frame)
  const cx = clamp(lx, -hl, hl);
  const cy = clamp(ly, -hw, hw);
  const cz = clamp(lz, -hh, hh);

  // Distance in local (== world) since rotation preserves distances
  const dx = lx - cx;
  const dy = ly - cy;
  const dz = lz - cz;
  const distSq = dx * dx + dy * dy + dz * dz;

  if (distSq >= r * r) return null;

  let dist = Math.sqrt(distSq);
  // Normal points from car surface to ball center (in world).
  // World contact normal = world(local diff vector)/dist; if dist ~0 (ball center inside OBB),
  // pick the axis with smallest penetration and push out along it.
  if (dist < 1e-6) {
    // Penetration along each axis: how far from face
    const penX = hl - Math.abs(lx);
    const penY = hw - Math.abs(ly);
    const penZ = hh - Math.abs(lz);
    let nLocalX = 0, nLocalY = 0, nLocalZ = 0;
    if (penX < penY && penX < penZ) nLocalX = lx >= 0 ? 1 : -1;
    else if (penY < penZ) nLocalY = ly >= 0 ? 1 : -1;
    else nLocalZ = lz >= 0 ? 1 : -1;
    _normalWorld.copy(_fwd).multiplyScalar(nLocalX)
      .addScaledVector(_left, nLocalY)
      .addScaledVector(_up, nLocalZ);
    dist = 0;
  } else {
    // Build world normal from local components (dx,dy,dz) projected onto car basis
    _normalWorld.copy(_fwd).multiplyScalar(dx / dist)
      .addScaledVector(_left, dy / dist)
      .addScaledVector(_up, dz / dist);
  }

  const penetration = r - dist;

  // Contact point in world (on the OBB surface)
  _closestLocal.set(cx, cy, cz);
  _contactWorld.copy(car.position)
    .addScaledVector(_fwd, cx)
    .addScaledVector(_left, cy)
    .addScaledVector(_up, cz);

  // Depenetrate ball fully along normal
  ball.position.addScaledVector(_normalWorld, penetration);

  // --- Velocities at contact ---
  // Car velocity at contact point: v_car + omega × r
  _rArm.copy(_contactWorld).sub(car.position);
  _v.crossVectors(car.angularVelocity, _rArm);
  const vCarAtContactX = car.velocity.x + _v.x;
  const vCarAtContactY = car.velocity.y + _v.y;
  const vCarAtContactZ = car.velocity.z + _v.z;

  _relVel.set(
    ball.velocity.x - vCarAtContactX,
    ball.velocity.y - vCarAtContactY,
    ball.velocity.z - vCarAtContactZ,
  );
  const relSpeed = _relVel.length();
  const vNormal = _relVel.dot(_normalWorld);

  // Normal impulse with masses 180/30; restitution 0.
  // J = -(1+e) * vNormal / (1/m_ball + 1/m_car)
  if (vNormal < 0) {
    const denom = (1 / BALL_MASS) + (1 / CAR_MASS);
    const j = -(1 + RESTITUTION) * vNormal / denom;
    // Apply to ball
    ball.velocity.addScaledVector(_normalWorld, j / BALL_MASS);
    // Reaction on car (scaled down)
    car.velocity.addScaledVector(_normalWorld, -(j / CAR_MASS) * CAR_REACTION_FACTOR);
  }

  // --- Psyonix impulse: forces ball along (ballPos - carPos), z flattened ---
  // Per-hit-event gate: if the car is still embedded in the ball on subsequent
  // substeps, depenetration alone won't separate them, but the Psyonix kick
  // must only fire once per contact. Cooldown is ticked down per substep in
  // world.js between collision passes.
  if ((car._ballContactCooldown || 0) <= 0) {
    _psyDir.copy(ball.position).sub(car.position);
    _psyDir.z *= C.BALL_HIT_Z_SCALE;
    const psyLen = _psyDir.length();
    if (psyLen > 1e-6) {
      _psyDir.multiplyScalar(1 / psyLen);
      const scale = C.curveLerp(C.BALL_HIT_SCALE_CURVE, relSpeed);
      const mag = relSpeed * scale;
      ball.velocity.addScaledVector(_psyDir, mag);
    }
    car._ballContactCooldown = 0.05; // 50 ms hit-event gate
  }

  // --- Ball spin: tangential change couples to angular velocity ---
  // Use change in ball velocity (post - pre) crossed with contactOffset(=rArm from ball center toward contact)
  // Approximate: spin += contactOffset × (Δv_ball). Δv_ball ≈ relVel after impulse, but we
  // approximate with current relSpeed direction.
  const ballRelContact = _v.copy(_contactWorld).sub(ball.position);
  _spinAdd.crossVectors(ballRelContact, _relVel).multiplyScalar(SPIN_K);
  ball.angularVelocity.add(_spinAdd);

  // Cap ball angular velocity here too (ball.update enforces too, but keep clean)
  const aSpeed = ball.angularVelocity.length();
  if (aSpeed > C.BALL_MAX_ANG_VEL) {
    ball.angularVelocity.multiplyScalar(C.BALL_MAX_ANG_VEL / aSpeed);
  }
  // Cap ball linear speed
  const bSpeed = ball.velocity.length();
  if (bSpeed > C.BALL_MAX_SPEED) {
    ball.velocity.multiplyScalar(C.BALL_MAX_SPEED / bSpeed);
  }

  return { speed: relSpeed, position: _contactWorld.clone() };
}

function clamp(x, lo, hi) {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}
