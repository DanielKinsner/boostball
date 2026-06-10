// CameraRig — Rocket-League-style ball cam / chase cam with exp damping.
import * as THREE from 'three';
import {
  ARENA_HALF_WIDTH,
  ARENA_HALF_LENGTH,
  SUPERSONIC_ON,
} from '../constants.js';

const BALL_CAM_DIST_MIN = 400;
const BALL_CAM_DIST_MAX = 650;
const BALL_CAM_HEIGHT_MIN = 125;
const BALL_CAM_HEIGHT_MAX = 225;
const CHASE_DIST = 380;
const CHASE_HEIGHT = 135;
const CHASE_LOOK_AHEAD = 300;
// Max angular speed (rad/s) the camera may swing around the car (ball cam).
// Without this the boom whips 180° in a frame when the car crosses the ball.
const SWIVEL_RATE = 3.2;
const MIN_Z = 25;
const SOFT_X = 4350;
const SOFT_Y = 5500;

const FOV_BASE = 80;
const FOV_SUPERSONIC = 88;

// Scratch — module-level to avoid per-frame allocs.
const _idealPos = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _planar = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _ballPos = new THREE.Vector3();
const _carPos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _vel = new THREE.Vector3();

export class CameraRig {
  /** @param {THREE.PerspectiveCamera} camera */
  constructor(camera) {
    this.camera = camera;
    this.camera.up.set(0, 0, 1);
    this._lookSmooth = new THREE.Vector3(0, 0, 100);
    this._fov = FOV_BASE;
    this._orbitT = 0;
    this._boomDir = new THREE.Vector3(0, -1, 0); // smoothed planar camera-boom direction
    this._trauma = 0;   // 0..1; shake amplitude follows trauma^2
    this._shakeT = 0;
  }

  /** Add screen shake (goal/demo/big hits). amount 0..1, accumulates and decays. */
  addShake(amount) {
    this._trauma = Math.min(1, this._trauma + amount);
  }

  _applyShake(dt) {
    if (this._trauma <= 0.001) { this._trauma = 0; return; }
    this._shakeT += dt;
    const s = this._trauma * this._trauma;
    const t = this._shakeT;
    // Layered incommensurate sines read as noise but stay frame-rate independent.
    const amp = 30 * s;
    this.camera.position.x += amp * (Math.sin(t * 91.3) * 0.6 + Math.sin(t * 47.7) * 0.4);
    this.camera.position.y += amp * (Math.sin(t * 83.1 + 1.7) * 0.6 + Math.sin(t * 53.9 + 0.6) * 0.4);
    this.camera.position.z += amp * 0.55 * Math.sin(t * 71.7 + 3.1);
    this.camera.rotateZ(0.018 * s * Math.sin(t * 59.3));
    this._trauma = Math.max(0, this._trauma - dt * 1.4);
  }

  /**
   * @param {number} dt
   * @param {{ car: any, ball: any, ballCam: boolean, phase: string }} args
   */
  update(dt, { car, ball, ballCam, phase }) {
    _ballPos.copy(ball.position);
    _carPos.copy(car.position);

    if (phase === 'goalPause') {
      this._orbit(dt, _ballPos, 900, 350);
      this._applySoftClamps();
      this._updateFov(dt, 0);
      this._applyShake(dt);
      return;
    }

    if (car.isDemolished) {
      this._orbit(dt, _ballPos, 1100, 420);
      this._applySoftClamps();
      this._updateFov(dt, 0);
      this._applyShake(dt);
      return;
    }

    if (ballCam) {
      // Ideal pos = carPos + normalize(carPos - ballPos) * dist + z*height
      _dir.copy(_carPos).sub(_ballPos);
      _dir.z = 0; // planar dir (avoid camera diving when ball directly above/below)
      if (_dir.lengthSq() < 1e-4) {
        // Degenerate: pick world-back direction relative to team default; fall back to car forward reverse.
        _fwd.copy(car.forward);
        _planar.set(-_fwd.x, -_fwd.y, 0);
        if (_planar.lengthSq() < 1e-4) _planar.set(0, -1, 0);
        _dir.copy(_planar);
      }
      _dir.normalize();
      this._swivelToward(_dir, dt);
      const carBallDist = Math.min(1, _carPos.distanceTo(_ballPos) / 4200);
      const speedT = Math.min(1, car.velocity.length() / SUPERSONIC_ON);
      const camDist = BALL_CAM_DIST_MIN + (BALL_CAM_DIST_MAX - BALL_CAM_DIST_MIN) * (carBallDist * 0.72 + speedT * 0.28);
      const camHeight = BALL_CAM_HEIGHT_MIN + (BALL_CAM_HEIGHT_MAX - BALL_CAM_HEIGHT_MIN) * (carBallDist * 0.55 + speedT * 0.45);
      _idealPos.copy(_carPos)
        .addScaledVector(this._boomDir, camDist)
        .add(_v3(0, 0, camHeight));
      const leadT = Math.min(0.12, ball.velocity.length() / 6000 * 0.12);
      _lookTarget.copy(_ballPos).addScaledVector(ball.velocity, leadT);
    } else {
      // CHASE: behind car facing, blended with velocity direction at high speed.
      _fwd.copy(car.forward);
      _vel.copy(car.velocity);
      const speed = _vel.length();
      if (speed > 600) {
        _vel.multiplyScalar(1 / speed);
        // Blend factor based on speed (more velocity-following as speed grows).
        const t = Math.min(1, (speed - 600) / 1400);
        _fwd.multiplyScalar(1 - t).addScaledVector(_vel, t).normalize();
      }
      _planar.set(-_fwd.x, -_fwd.y, 0);
      if (_planar.lengthSq() < 1e-4) _planar.set(0, -1, 0);
      _planar.normalize();
      this._swivelToward(_planar, dt);
      _idealPos.copy(_carPos)
        .addScaledVector(this._boomDir, CHASE_DIST)
        .add(_v3(0, 0, CHASE_HEIGHT));
      _lookTarget.copy(_carPos).addScaledVector(_fwd, CHASE_LOOK_AHEAD);
    }

    // Exp damping
    const kPos = 1 - Math.exp(-3.2 * dt);
    const kLook = 1 - Math.exp(-6 * dt);

    _camPos.copy(this.camera.position).lerp(_idealPos, kPos);
    this.camera.position.copy(_camPos);

    this._lookSmooth.lerp(_lookTarget, kLook);

    this._applySoftClamps();

    this.camera.lookAt(this._lookSmooth);

    // FOV kick when supersonic.
    this._updateFov(dt, car.velocity.length());
    this._applyShake(dt);
  }

  // Rotate the smoothed boom direction toward `target` (planar unit vector),
  // capped at SWIVEL_RATE rad/s so the camera never whips around the car.
  _swivelToward(target, dt) {
    const cur = Math.atan2(this._boomDir.y, this._boomDir.x);
    const tgt = Math.atan2(target.y, target.x);
    let delta = tgt - cur;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const maxStep = SWIVEL_RATE * dt;
    if (delta > maxStep) delta = maxStep;
    else if (delta < -maxStep) delta = -maxStep;
    const a = cur + delta;
    this._boomDir.set(Math.cos(a), Math.sin(a), 0);
  }

  _orbit(dt, center, dist, height) {
    this._orbitT += dt * 0.35;
    const x = center.x + Math.cos(this._orbitT) * dist;
    const y = center.y + Math.sin(this._orbitT) * dist;
    const z = center.z + height;
    const target = _v3(x, y, z);
    const kPos = 1 - Math.exp(-3 * dt);
    this.camera.position.lerp(target, kPos);
    const kLook = 1 - Math.exp(-5 * dt);
    this._lookSmooth.lerp(center, kLook);
    this.camera.lookAt(this._lookSmooth);
  }

  _applySoftClamps() {
    if (this.camera.position.z < MIN_Z) this.camera.position.z = MIN_Z;
    if (this.camera.position.x > SOFT_X) this.camera.position.x = SOFT_X;
    else if (this.camera.position.x < -SOFT_X) this.camera.position.x = -SOFT_X;
    if (this.camera.position.y > SOFT_Y) this.camera.position.y = SOFT_Y;
    else if (this.camera.position.y < -SOFT_Y) this.camera.position.y = -SOFT_Y;
    // Touch unused imports to silence lints.
    void ARENA_HALF_WIDTH; void ARENA_HALF_LENGTH;
  }

  _updateFov(dt, speed) {
    const speedT = Math.min(1, Math.max(0, speed / SUPERSONIC_ON));
    const target = speed >= SUPERSONIC_ON
      ? FOV_SUPERSONIC
      : FOV_BASE + (FOV_SUPERSONIC - FOV_BASE - 3) * speedT;
    const k = 1 - Math.exp(-4 * dt);
    this._fov += (target - this._fov) * k;
    if (Math.abs(this._fov - this.camera.fov) > 0.01) {
      this.camera.fov = this._fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

// Tiny scratch-vector helper that reuses a module-level vector.
const _scratch = new THREE.Vector3();
function _v3(x, y, z) {
  return _scratch.set(x, y, z);
}
