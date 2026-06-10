// CarVisual — photoreal procedural Octane-ish car. +X forward, +Y left, +Z up.
// Materials: MeshPhysicalMaterial car paint (clearcoat), tinted glass canopy,
// rubber tires (rough/dark), metallic rims. Restrained HDR emissive accents only
// where bloom should catch.
import * as THREE from 'three';
import { CAR_LENGTH, CAR_WIDTH, CAR_HEIGHT, CAR_REST_Z, TEAM_BLUE } from '../constants.js';

const WHEEL_RADIUS = 17;
const WHEEL_WIDTH = 14;
// Wheel axle local Z = CAR_REST_Z subtracted from world ground touch point:
// world axle z = WHEEL_RADIUS → local axle z = WHEEL_RADIUS - CAR_REST_Z ≈ -0.01.
const WHEEL_AXLE_Z = WHEEL_RADIUS - CAR_REST_Z;

// Body paint — fully saturated team color (the clearcoat darkens it slightly).
const BLUE_BODY = 0x0a3a82;
const BLUE_ACCENT = 0x36c5ff;
const ORANGE_BODY = 0x8a2c00;
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

    // --- Car paint: metallic flake + clearcoat lacquer ---
    // High metalness + clearcoat = the classic candy-paint reflective look.
    const chassisMat = new THREE.MeshPhysicalMaterial({
      color: bodyColor,
      roughness: 0.35,
      metalness: 0.85,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.2,
    });
    // Slight bevel feel via a slightly-tapered chassis box.
    const chassisGeom = new THREE.BoxGeometry(CAR_LENGTH * 0.85, CAR_WIDTH * 0.92, CAR_HEIGHT * 0.55);
    const chassis = new THREE.Mesh(chassisGeom, chassisMat);
    chassis.position.set(0, 0, -CAR_HEIGHT * 0.05);
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    this.mesh.add(chassis);

    // Wedge nose (front).
    const noseGeom = new THREE.BoxGeometry(CAR_LENGTH * 0.25, CAR_WIDTH * 0.7, CAR_HEIGHT * 0.35);
    const nose = new THREE.Mesh(noseGeom, chassisMat);
    nose.position.set(CAR_LENGTH * 0.42, 0, -CAR_HEIGHT * 0.12);
    nose.castShadow = true;
    this.mesh.add(nose);

    // Side skirts / lower fenders — softens the silhouette.
    const skirtMat = new THREE.MeshPhysicalMaterial({
      color: 0x14171c,
      roughness: 0.35,
      metalness: 0.7,
      clearcoat: 0.6,
      clearcoatRoughness: 0.15,
      envMapIntensity: 1.0,
    });
    const skirtGeom = new THREE.BoxGeometry(CAR_LENGTH * 0.78, CAR_WIDTH * 0.06, CAR_HEIGHT * 0.32);
    for (const sy of [-1, 1]) {
      const sk = new THREE.Mesh(skirtGeom, skirtMat);
      sk.position.set(-CAR_LENGTH * 0.02, sy * CAR_WIDTH * 0.48, -CAR_HEIGHT * 0.18);
      sk.castShadow = true;
      this.mesh.add(sk);
    }
    // Front bumper splitter
    const splitter = new THREE.Mesh(
      new THREE.BoxGeometry(CAR_LENGTH * 0.18, CAR_WIDTH * 0.85, CAR_HEIGHT * 0.1),
      skirtMat,
    );
    splitter.position.set(CAR_LENGTH * 0.46, 0, -CAR_HEIGHT * 0.32);
    splitter.castShadow = true;
    this.mesh.add(splitter);

    // Cabin / canopy — dark tinted glossy "glass" (real fresnel via PhysicalMaterial).
    // Not transmissive (transmission=0 keeps it cheap and prevents seeing through the car).
    const canopyMat = new THREE.MeshPhysicalMaterial({
      color: 0x05070c,
      roughness: 0.05,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.5,
      ior: 1.5,
      reflectivity: 0.85,
    });
    const canopyGeom = new THREE.BoxGeometry(CAR_LENGTH * 0.5, CAR_WIDTH * 0.7, CAR_HEIGHT * 0.55);
    const canopy = new THREE.Mesh(canopyGeom, canopyMat);
    canopy.position.set(-CAR_LENGTH * 0.02, 0, CAR_HEIGHT * 0.4);
    canopy.castShadow = true;
    this.mesh.add(canopy);

    // Rear spoiler (carbon-fiber-ish dark matte).
    const spoilerMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0c12,
      metalness: 0.3,
      roughness: 0.45,
      clearcoat: 0.5,
      clearcoatRoughness: 0.2,
      envMapIntensity: 0.9,
    });
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

    // Emissive trim stripes along the sides — HDR-bright so bloom catches them
    // but only the trim, not the whole panel.
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: accent,
      emissiveIntensity: 4.0, // HDR — feeds bloom (threshold 1.0)
      toneMapped: true,
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

    // Headlight cluster (small but HDR — feeds bloom subtly).
    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0x101418,
      emissive: 0xfff5d8,
      emissiveIntensity: 3.0,
    });
    const hlGeom = new THREE.BoxGeometry(CAR_LENGTH * 0.04, CAR_WIDTH * 0.18, CAR_HEIGHT * 0.18);
    for (const sy of [-1, 1]) {
      const hl = new THREE.Mesh(hlGeom, headlightMat);
      hl.position.set(CAR_LENGTH * 0.53, sy * CAR_WIDTH * 0.28, CAR_HEIGHT * 0.05);
      this.mesh.add(hl);
    }

    // Rear boost nozzle — dark metal w/ subtle hot inner emissive.
    const nozzleMat = new THREE.MeshPhysicalMaterial({
      color: 0x14161a,
      metalness: 0.85,
      roughness: 0.35,
      clearcoat: 0.3,
      envMapIntensity: 1.0,
    });
    const nozzleInnerMat = new THREE.MeshStandardMaterial({
      color: 0x080808,
      emissive: 0xff7a1a,
      emissiveIntensity: 2.5,
    });
    const nozzleGeom = new THREE.CylinderGeometry(8, 10, 14, 16);
    this.nozzle = new THREE.Mesh(nozzleGeom, nozzleMat);
    this.nozzle.rotation.z = Math.PI / 2;
    this.nozzle.position.set(-CAR_LENGTH * 0.5 - 6, 0, 0);
    this.mesh.add(this.nozzle);
    // Inner glow disc just behind the nozzle.
    const nozzleInner = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 6, 1, 16),
      nozzleInnerMat,
    );
    nozzleInner.rotation.z = Math.PI / 2;
    nozzleInner.position.set(-CAR_LENGTH * 0.5 - 12, 0, 0);
    this.mesh.add(nozzleInner);

    // --- Wheels: rubber tires + metallic rims ---
    const tireMat = new THREE.MeshPhysicalMaterial({
      color: 0x06080c,
      roughness: 0.95,
      metalness: 0.0,
      clearcoat: 0.1,
      clearcoatRoughness: 0.6,
      envMapIntensity: 0.5,
    });
    const rimMat = new THREE.MeshPhysicalMaterial({
      color: 0xb0b6c0,
      roughness: 0.25,
      metalness: 1.0,
      clearcoat: 0.4,
      clearcoatRoughness: 0.15,
      envMapIntensity: 1.3,
    });
    // Tinted accent ring at the rim center — team-colored, dim emissive so it shows in shadow.
    const rimAccentMat = new THREE.MeshStandardMaterial({
      color: 0x101418,
      emissive: accent,
      emissiveIntensity: 1.8,
    });
    const tireGeom = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 20);
    const rimGeom = new THREE.CylinderGeometry(WHEEL_RADIUS * 0.62, WHEEL_RADIUS * 0.62, WHEEL_WIDTH + 0.6, 14);
    const rimAccentGeom = new THREE.CylinderGeometry(WHEEL_RADIUS * 0.3, WHEEL_RADIUS * 0.3, WHEEL_WIDTH + 1, 12);

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
      const tire = new THREE.Mesh(tireGeom, tireMat);
      tire.castShadow = true;
      spinGroup.add(tire);
      const rim = new THREE.Mesh(rimGeom, rimMat);
      spinGroup.add(rim);
      const rimAcc = new THREE.Mesh(rimAccentGeom, rimAccentMat);
      spinGroup.add(rimAcc);
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
      // Roll: see geometric notes in prior revision — sign flipped to roll forward
      // with positive forward speed.
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
