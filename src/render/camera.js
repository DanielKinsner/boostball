// CameraRig — Rocket-League-style ball cam / chase cam with exp damping.
import * as THREE from 'three';
import {
  ARENA_HALF_WIDTH,
  ARENA_HALF_LENGTH,
  SUPERSONIC_ON,
} from '../constants.js';

const BALL_CAM_DIST = 430;
const BALL_CAM_HEIGHT = 120;
const CHASE_DIST = 430;
const CHASE_HEIGHT = 140;
const CHASE_LOOK_AHEAD = 300;
const MIN_Z = 25;
const SOFT_X = 4350;
const SOFT_Y = 5500;

const FOV_BASE = 80;
const FOV_SUPERSONIC = 86;

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
      this._updateFov(dt, false);
      return;
    }

    if (car.isDemolished) {
      this._orbit(dt, _ballPos, 1100, 420);
      this._applySoftClamps();
      this._updateFov(dt, false);
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
      _idealPos.copy(_carPos)
        .addScaledVector(_dir, BALL_CAM_DIST)
        .add(_v3(0, 0, BALL_CAM_HEIGHT));
      _lookTarget.copy(_ballPos);
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
      _idealPos.copy(_carPos)
        .addScaledVector(_planar, CHASE_DIST)
        .add(_v3(0, 0, CHASE_HEIGHT));
      _lookTarget.copy(_carPos).addScaledVector(_fwd, CHASE_LOOK_AHEAD);
    }

    // Exp damping
    const kPos = 1 - Math.exp(-5 * dt);
    const kLook = 1 - Math.exp(-8 * dt);

    _camPos.copy(this.camera.position).lerp(_idealPos, kPos);
    this.camera.position.copy(_camPos);

    this._lookSmooth.lerp(_lookTarget, kLook);

    this._applySoftClamps();

    this.camera.lookAt(this._lookSmooth);

    // FOV kick when supersonic.
    const isSuper = car.velocity.length() >= SUPERSONIC_ON;
    this._updateFov(dt, isSuper);
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

  _updateFov(dt, isSuper) {
    const target = isSuper ? FOV_SUPERSONIC : FOV_BASE;
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
