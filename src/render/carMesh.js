// CarVisual — procedural Octane-ish car built from box/cylinder primitives.
// +X forward, +Y left, +Z up. Chassis center matches car.position.
import * as THREE from 'three';
import { CAR_LENGTH, CAR_WIDTH, CAR_HEIGHT, CAR_REST_Z, TEAM_BLUE } from '../constants.js';

const WHEEL_RADIUS = 17;
const WHEEL_WIDTH = 14;
// Wheel axle local Z = CAR_REST_Z subtracted from world ground touch point:
// world axle z = WHEEL_RADIUS → local axle z = WHEEL_RADIUS - CAR_REST_Z ≈ -0.01.
// We allow the wheel to peek slightly above the chassis bottom (small visual overlap).
const WHEEL_AXLE_Z = WHEEL_RADIUS - CAR_REST_Z;

const BLUE_BODY = 0x143a6e;
const BLUE_ACCENT = 0x36c5ff;
const ORANGE_BODY = 0x6e2b07;
const ORANGE_ACCENT = 0xffb24d;

// Scratch
const _v = new THREE.Vector3();
const _vFwd = new THREE.Vector3();

export class CarVisual {
  /** @param {'blue'|'orange'} team */
  constructor(team) {
    this.team = team;
    this.mesh = new THREE.Group();
    this.mesh.name = `carVisual:${team}`;

    const isBlue = team === TEAM_BLUE;
    const bodyColor = isBlue ? BLUE_BODY : ORANGE_BODY;
    const accent = isBlue ? BLUE_ACCENT : ORANGE_ACCENT;

    // --- Chassis: low wedge built from a slightly tapered box + nose taper ---
    const chassisMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.35,
      metalness: 0.6,
    });
    const chassisGeom = new THREE.BoxGeometry(CAR_LENGTH * 0.85, CAR_WIDTH * 0.92, CAR_HEIGHT * 0.55);
    const chassis = new THREE.Mesh(chassisGeom, chassisMat);
    chassis.position.set(0, 0, -CAR_HEIGHT * 0.05);
    chassis.castShadow = true;
    this.mesh.add(chassis);

    // Wedge nose (front).
    const noseGeom = new THREE.BoxGeometry(CAR_LENGTH * 0.25, CAR_WIDTH * 0.7, CAR_HEIGHT * 0.35);
    const nose = new THREE.Mesh(noseGeom, chassisMat);
    nose.position.set(CAR_LENGTH * 0.42, 0, -CAR_HEIGHT * 0.12);
    nose.castShadow = true;
    this.mesh.add(nose);

    // Cabin / canopy (dark tinted glass).
    const canopyMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0e18,
      roughness: 0.15,
      metalness: 0.4,
      transmission: 0.0,
      clearcoat: 0.7,
      clearcoatRoughness: 0.2,
    });
    const canopyGeom = new THREE.BoxGeometry(CAR_LENGTH * 0.5, CAR_WIDTH * 0.7, CAR_HEIGHT * 0.55);
    const canopy = new THREE.Mesh(canopyGeom, canopyMat);
    canopy.position.set(-CAR_LENGTH * 0.02, 0, CAR_HEIGHT * 0.4);
    canopy.castShadow = true;
    this.mesh.add(canopy);

    // Rear spoiler (small).
    const spoilerMat = new THREE.MeshStandardMaterial({ color: 0x141822, metalness: 0.4, roughness: 0.5 });
    const spoiler = new THREE.Mesh(
      new THREE.BoxGeometry(CAR_LENGTH * 0.16, CAR_WIDTH * 0.95, CAR_HEIGHT * 0.12),
      spoilerMat,
    );
    spoiler.position.set(-CAR_LENGTH * 0.45, 0, CAR_HEIGHT * 0.55);
    spoiler.castShadow = true;
    this.mesh.add(spoiler);
    // Spoiler stilts
    const stiltGeom = new THREE.BoxGeometry(CAR_LENGTH * 0.04, CAR_WIDTH * 0.05, CAR_HEIGHT * 0.45);
    for (const sy of [-1, 1]) {
      const s = new THREE.Mesh(stiltGeom, spoilerMat);
      s.position.set(-CAR_LENGTH * 0.43, sy * CAR_WIDTH * 0.36, CAR_HEIGHT * 0.3);
      this.mesh.add(s);
    }

    // Emissive trim stripes along the sides.
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x0a0d18,
      emissive: accent,
      emissiveIntensity: 2.0,
    });
    const trimGeom = new THREE.BoxGeometry(CAR_LENGTH * 0.9, 2, 3);
    for (const sy of [-1, 1]) {
      const t = new THREE.Mesh(trimGeom, trimMat);
      t.position.set(0, sy * (CAR_WIDTH * 0.46), 0);
      this.mesh.add(t);
    }
    // Roof accent line
    const roofTrim = new THREE.Mesh(
      new THREE.BoxGeometry(CAR_LENGTH * 0.45, 2, 2),
      trimMat,
    );
    roofTrim.position.set(0, 0, CAR_HEIGHT * 0.71);
    this.mesh.add(roofTrim);

    // Rear boost nozzle.
    const nozzleMat = new THREE.MeshStandardMaterial({
      color: 0x101218,
      emissive: 0xff7a1a,
      emissiveIntensity: 1.6,
      metalness: 0.7,
      roughness: 0.4,
    });
    const nozzleGeom = new THREE.CylinderGeometry(6, 8, 14, 16);
    this.nozzle = new THREE.Mesh(nozzleGeom, nozzleMat);
    this.nozzle.rotation.z = Math.PI / 2;
    this.nozzle.position.set(-CAR_LENGTH * 0.5 - 6, 0, 0);
    this.mesh.add(this.nozzle);

    // --- Wheels ---
    // Cylinder oriented around its local Y axis; we want it rolling about car Y (left/right axle).
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x070a10, roughness: 0.95, metalness: 0.0 });
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x202632,
      emissive: accent,
      emissiveIntensity: 1.2,
      metalness: 0.7,
      roughness: 0.35,
    });
    const tireGeom = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 18);
    const rimGeom = new THREE.CylinderGeometry(WHEEL_RADIUS * 0.55, WHEEL_RADIUS * 0.55, WHEEL_WIDTH + 0.5, 12);

    // Wheel local positions (car local: +X forward, +Y left).
    const wx = CAR_LENGTH * 0.36;
    const wy = CAR_WIDTH * 0.45;
    /** @type {Array<{mesh: THREE.Group, isFront: boolean, side: number, spinMesh: THREE.Mesh}>} */
    this.wheels = [];
    const wheelDefs = [
      { x: wx, y: wy, isFront: true, side: 1 },
      { x: wx, y: -wy, isFront: true, side: -1 },
      { x: -wx, y: wy, isFront: false, side: 1 },
      { x: -wx, y: -wy, isFront: false, side: -1 },
    ];
    for (const wd of wheelDefs) {
      // Outer group: steers (yaw).
      const steerGroup = new THREE.Group();
      steerGroup.position.set(wd.x, wd.y, WHEEL_AXLE_Z);
      // Inner group: rotates the wheel cylinder so its axis aligns with car +Y, then spins around that axle.
      const spinGroup = new THREE.Group();
      // Cylinder's axis is local Y; align with car Y by default (no rotation needed). However, the cylinder's
      // "rolling axis" is its local Y. So we rotate by 0 to keep axle along Y. To roll, we rotate spinGroup around X
      // (no — rolling about Y means rotating about Y means spinning the wheel face). To make the wheel ROLL forward,
      // it must spin around its Y axle. We'll spin around local Y of spinGroup.
      // Actually rotating around Y will spin the cylinder around its own axis (rolling visually). Good.
      // But the wheel needs to lie flat with its circular face facing +Y/-Y of car. CylinderGeometry default axis is Y,
      // so its circular faces are +Y/-Y. Perfect — no extra rotation.
      const tire = new THREE.Mesh(tireGeom, tireMat);
      tire.castShadow = true;
      spinGroup.add(tire);
      const rim = new THREE.Mesh(rimGeom, rimMat);
      spinGroup.add(rim);
      steerGroup.add(spinGroup);
      this.mesh.add(steerGroup);
      this.wheels.push({ mesh: steerGroup, isFront: wd.isFront, side: wd.side, spinMesh: spinGroup });
    }

    // Wheel spin accumulator (radians).
    this._wheelAngle = 0;
    // Smoothed steering angle.
    this._steerAngle = 0;
  }

  /**
   * @param {{
   *   position: THREE.Vector3,
   *   quaternion: THREE.Quaternion,
   *   velocity: THREE.Vector3,
   *   isDemolished: boolean,
   *   lastControls: { steer: number, [k: string]: any } | null,
   *   forward: THREE.Vector3,
   * }} car
   * @param {number} dt
   */
  update(car, dt) {
    this.mesh.visible = !car.isDemolished;
    if (car.isDemolished) return;

    this.mesh.position.copy(car.position);
    this.mesh.quaternion.copy(car.quaternion);

    // Forward speed = velocity · forward (signed).
    _vFwd.copy(car.forward);
    const fwdSpeed = car.velocity.dot(_vFwd);
    // Wheel angular speed = fwdSpeed / radius. Spin around local Y of spinGroup.
    const dAng = (fwdSpeed / WHEEL_RADIUS) * dt;
    this._wheelAngle += dAng;

    // Smoothed steer (front wheels yaw).
    const ctrls = car.lastControls;
    const steerInput = ctrls ? Math.max(-1, Math.min(1, ctrls.steer || 0)) : 0;
    const targetSteer = steerInput * 0.35;
    // Exp smoothing
    const k = 1 - Math.exp(-12 * dt);
    this._steerAngle += (targetSteer - this._steerAngle) * k;

    for (const w of this.wheels) {
      // Steer the front wheels around the steer group's local Z (vertical axle).
      if (w.isFront) {
        w.mesh.rotation.z = this._steerAngle;
      }
      // Roll the spin group around its local Y. But Cylinder spins around its own axis (Y). Rolling forward
      // visually corresponds to rotating the wheel about its axle. Setting rotation.y rolls it.
      // However the wheel mesh's local up after axle alignment — its circular face points in ±Y, and "rolling"
      // is rotation about Y of the spinGroup. Sign: positive forward speed → wheel rolls "forward" (+X).
      // For a wheel with axis +Y, rolling forward = rotating around -Y (right-hand rule: forward = +X, up = +Z,
      // axle = +Y; rotating about +Y by positive angle moves +X face downward toward -Z → backward roll). So flip sign.
      w.spinMesh.rotation.y = -this._wheelAngle;
    }

    void _v;
  }

  /**
   * World-space position of the boost nozzle tip (rear of car).
   * Returns a reference to a scratch Vector3 — caller must copy if storing.
   * @param {THREE.Vector3} [out]
   * @returns {THREE.Vector3}
   */
  nozzleWorldPos(out) {
    const target = out || _v;
    // Local nozzle tip in car space: x ≈ -CAR_LENGTH*0.5 - 13 (one cylinder length past the nozzle base).
    target.set(-CAR_LENGTH * 0.5 - 13, 0, 0);
    target.applyQuaternion(this.mesh.quaternion);
    target.add(this.mesh.position);
    return target;
  }
}
