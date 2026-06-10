// CarVisual — photoreal procedural Octane-ish car. +X forward, +Y left, +Z up.
// Body is built from an ExtrudeGeometry over a 2D side-profile Shape (the Octane
// silhouette: low nose, rising over the front wheels, peak at the cabin,
// tapering tail with a slight rear kick), beveled for rounded sills and
// extruded across the car's width.
//
// Materials: MeshPhysicalMaterial car paint (clearcoat), tinted glass canopy,
// rubber tires (rough/dark), metallic rims. Restrained HDR emissive accents only
// where bloom should catch.
import * as THREE from 'three';
import { CAR_LENGTH, CAR_WIDTH, CAR_HEIGHT, CAR_REST_Z, TEAM_BLUE } from '../constants.js';

const WHEEL_RADIUS = 17;
const WHEEL_RADIUS_REAR = 19; // RL rear wheels read slightly chunkier
const WHEEL_WIDTH = 14;
// Wheel axle local Z = CAR_REST_Z subtracted from world ground touch point:
// world axle z = WHEEL_RADIUS → local axle z = WHEEL_RADIUS - CAR_REST_Z ≈ -0.01.
const WHEEL_AXLE_Z = WHEEL_RADIUS - CAR_REST_Z;
const WHEEL_AXLE_Z_REAR = WHEEL_RADIUS_REAR - CAR_REST_Z;

// Total visual body length/width/height (the physics hitbox is ~118x84x36).
// We push the body taller than the hitbox (~36 above chassis center) per RL look —
// the hitbox itself only defines collisions, not the silhouette.
//
// Profile-shape coords: x = forward (-L/2..+L/2), z = up (BODY_FLOOR..BODY_HEIGHT).
// BODY_FLOOR is the belly line (sits just above the ground when resting on wheels).
// BODY_HEIGHT is the absolute roof line above the chassis center.
const BODY_LENGTH = 118;
const BODY_WIDTH = 84;
const BODY_HEIGHT = 30; // cabin roof above chassis center (Octane is long & low)
const BODY_FLOOR = -10; // belly above chassis center bottom

// Body paint — fully saturated team color (the clearcoat darkens it slightly).
const BLUE_BODY = 0x0a3a82;
const BLUE_ACCENT = 0x36c5ff;
const ORANGE_BODY = 0x8a2c00;
const ORANGE_ACCENT = 0xffb24d;

// Scratch
const _v = new THREE.Vector3();
const _vFwd = new THREE.Vector3();

/**
 * Build the Octane-ish side-profile Shape.
 * Local coords on the shape plane: x = car-forward, y = up (will become world Z
 * after we rotate the extruded geometry -90° around X).
 *
 * Octane silhouette goals:
 *   - long low hood sloping up over the front wheel hump
 *   - cabin peak slightly aft of center
 *   - mostly flat rear deck dropping to a short rear bumper
 *   - belly clearance for the wheels to sit underneath
 */
function buildOctaneProfile() {
  const L = BODY_LENGTH;
  const xF = L * 0.5;       // +xF = front nose tip
  const xR = -L * 0.5;      // -xR = rear bumper face
  const yBelly = BODY_FLOOR;        // belly line
  const yLoHood = BODY_FLOOR + 10;  // bottom of hood at the very nose
  const yHood = BODY_FLOOR + 14;    // hood plateau height
  const yPeak = BODY_HEIGHT;        // cabin peak
  const yDeck = BODY_FLOOR + 22;    // rear deck height

  const shape = new THREE.Shape();
  // Start at the front-bottom corner and trace clockwise around the silhouette.
  shape.moveTo(xF - 6, yBelly);
  // Forward splitter lip protruding slightly.
  shape.lineTo(xF, yBelly + 3);
  // Soft chamfer up the nose face.
  shape.quadraticCurveTo(xF + 3, yLoHood - 2, xF - 2, yLoHood);
  // Long low hood that gradually rises over the front wheel hump.
  shape.bezierCurveTo(
    xF - 18, yHood - 1,   // just past nose
    xF - 30, yHood + 1,   // over front wheels
    xF - 42, yHood + 4,   // approaching the cabin base
  );
  // Windshield ramp from hood up to cabin peak.
  shape.bezierCurveTo(
    xF - 50, yHood + 10,
    xF - 56, yPeak - 4,
    -8,      yPeak,         // cabin peak slightly aft of center
  );
  // Cabin roof dome (short flat-ish top).
  shape.bezierCurveTo(
    -16, yPeak,
    -22, yPeak - 1,
    -28, yPeak - 3,
  );
  // Rear window slope from cabin down to the rear deck.
  shape.bezierCurveTo(
    -36, yPeak - 8,
    -42, yDeck + 2,
    -48, yDeck,
  );
  // Flat rear deck.
  shape.lineTo(xR + 8, yDeck);
  // Slight duck-tail kick.
  shape.quadraticCurveTo(xR + 3, yDeck + 1, xR, yDeck - 2);
  // Down the rear bumper face.
  shape.bezierCurveTo(
    xR - 1, yDeck - 8,
    xR - 1, yBelly + 6,
    xR + 4, yBelly + 2,
  );
  // Across the rear belly back to start.
  shape.lineTo(xR + 8, yBelly);
  shape.lineTo(xF - 6, yBelly);
  return shape;
}

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

    // ----- Main body: extrude the Octane side profile across the car width -----
    // Build profile in local (x_forward, z_up) plane, then extrude along z and
    // rotate so extrusion runs along world Y (the car-width axis).
    const profile = buildOctaneProfile();
    const extrudeSettings = {
      depth: BODY_WIDTH,             // extrude width across Y
      bevelEnabled: true,
      bevelSegments: 4,
      bevelSize: 5.5,                // rounded sills (~4-6 uu requested)
      bevelThickness: 5.5,
      curveSegments: 10,
    };
    const bodyGeom = new THREE.ExtrudeGeometry(profile, extrudeSettings);
    // ExtrudeGeometry extrudes along +Z in shape-local space. Rotate so the
    // extrusion axis aligns with car-local +Y (width), and the profile sits in
    // the local XZ plane (x_forward / z_up).
    bodyGeom.rotateX(-Math.PI / 2);
    // Center the extrusion across Y so the car is symmetric.
    bodyGeom.translate(0, BODY_WIDTH / 2, 0);
    const body = new THREE.Mesh(bodyGeom, chassisMat);
    body.castShadow = true;
    body.receiveShadow = true;
    this.mesh.add(body);

    // Lower fender / side-skirt insets (dark contrast strip along the sills).
    const skirtMat = new THREE.MeshPhysicalMaterial({
      color: 0x14171c,
      roughness: 0.4,
      metalness: 0.7,
      clearcoat: 0.6,
      clearcoatRoughness: 0.15,
      envMapIntensity: 1.0,
    });
    {
      // Thin rectangular sill strip across most of the body length, hugging the side.
      const sillGeom = new THREE.BoxGeometry(BODY_LENGTH * 0.7, 1.5, 6);
      for (const sy of [-1, 1]) {
        const sill = new THREE.Mesh(sillGeom, skirtMat);
        sill.position.set(-2, sy * (BODY_WIDTH * 0.5 + 0.5), BODY_FLOOR + 5);
        sill.castShadow = true;
        this.mesh.add(sill);
      }
    }

    // Front splitter lip — a thin plate hanging just under the nose.
    {
      const splitter = new THREE.Mesh(
        new THREE.BoxGeometry(12, BODY_WIDTH * 0.95, 1.6),
        skirtMat,
      );
      splitter.position.set(BODY_LENGTH * 0.46, 0, BODY_FLOOR + 1.5);
      splitter.castShadow = true;
      this.mesh.add(splitter);
    }

    // Side air intakes — shallow inset boxes behind each front wheel arch.
    {
      const intakeMat = new THREE.MeshStandardMaterial({
        color: 0x05070a,
        roughness: 0.85,
        metalness: 0.2,
      });
      const intakeGeom = new THREE.BoxGeometry(20, 2, 7);
      for (const sy of [-1, 1]) {
        const intake = new THREE.Mesh(intakeGeom, intakeMat);
        intake.position.set(BODY_LENGTH * 0.12, sy * (BODY_WIDTH * 0.5 + 0.4), BODY_FLOOR + 14);
        this.mesh.add(intake);
      }
    }

    // Wheel arches (visual flares around each wheel well — partial torus segments).
    {
      const archMat = new THREE.MeshPhysicalMaterial({
        color: 0x0a0c11,
        roughness: 0.55,
        metalness: 0.45,
        clearcoat: 0.4,
        clearcoatRoughness: 0.2,
        envMapIntensity: 0.9,
      });
      const wx = BODY_LENGTH * 0.34;
      const wxR = -BODY_LENGTH * 0.34;
      const arcRadius = 22;
      const arcTube = 3.2;
      // TorusGeometry(radius, tube, radialSegments, tubularSegments, arc).
      const archGeom = new THREE.TorusGeometry(arcRadius, arcTube, 6, 14, Math.PI);
      for (const [cx, cz] of [
        [wx,  WHEEL_AXLE_Z + 2],
        [wxR, WHEEL_AXLE_Z_REAR + 2],
      ]) {
        for (const sy of [-1, 1]) {
          const arch = new THREE.Mesh(archGeom, archMat);
          // Place at wheel center, just outside the body sill.
          arch.position.set(cx, sy * (BODY_WIDTH * 0.5 - 1), cz);
          // Torus lies in XY by default; we want its plane vertical (XZ) so the
          // half-arc lifts upward over the wheel. Rotate around X by π/2.
          arch.rotation.x = Math.PI / 2;
          arch.castShadow = true;
          this.mesh.add(arch);
        }
      }
    }

    // Cabin canopy — dark tinted glossy "glass" pressed onto the cabin peak.
    // A squashed sphere reads as a curved windscreen/canopy bubble.
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
    {
      // Squashed ellipsoid forming the windscreen/canopy bubble.
      // Sit it ON the cabin peak so the dark glass appears as a hood-to-trunk dome.
      const canopyGeom = new THREE.SphereGeometry(1, 18, 12);
      const canopy = new THREE.Mesh(canopyGeom, canopyMat);
      // Squashed ellipsoid: long along x, narrower across y, ~1/3 the body height.
      canopy.scale.set(BODY_LENGTH * 0.28, BODY_WIDTH * 0.36, 12);
      // Slightly aft of center, height set so the dome's top sits just above the
      // body peak (z=BODY_HEIGHT) without floating.
      canopy.position.set(-BODY_LENGTH * 0.04, 0, BODY_HEIGHT - 5);
      canopy.castShadow = true;
      this.mesh.add(canopy);
    }

    // Rear spoiler — small wing on twin struts, mounted at the rear deck kick.
    const spoilerMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0c12,
      metalness: 0.35,
      roughness: 0.45,
      clearcoat: 0.5,
      clearcoatRoughness: 0.2,
      envMapIntensity: 0.9,
    });
    {
      // Spoiler sits just above the rear deck. Deck z ≈ BODY_FLOOR + 22 = 12.
      const deckZ = BODY_FLOOR + 22;
      const spoiler = new THREE.Mesh(
        new THREE.BoxGeometry(11, BODY_WIDTH * 0.78, 2.2),
        spoilerMat,
      );
      spoiler.position.set(-BODY_LENGTH * 0.43, 0, deckZ + 8);
      spoiler.castShadow = true;
      this.mesh.add(spoiler);
      // Twin struts
      const strutGeom = new THREE.BoxGeometry(2.4, 2.4, 8);
      for (const sy of [-1, 1]) {
        const s = new THREE.Mesh(strutGeom, spoilerMat);
        s.position.set(-BODY_LENGTH * 0.43, sy * BODY_WIDTH * 0.3, deckZ + 4);
        this.mesh.add(s);
      }
    }

    // Emissive trim stripes along the lower flanks (HDR — bloom catches them).
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: accent,
      emissiveIntensity: 4.5,
      toneMapped: true,
    });
    {
      const trimGeom = new THREE.BoxGeometry(BODY_LENGTH * 0.78, 1.2, 1.8);
      for (const sy of [-1, 1]) {
        const t = new THREE.Mesh(trimGeom, trimMat);
        t.position.set(-2, sy * (BODY_WIDTH * 0.5 + 0.9), BODY_FLOOR + 10);
        this.mesh.add(t);
      }
    }
    // Hood center accent — short bright stripe up the hood center line.
    {
      const hoodTrim = new THREE.Mesh(
        new THREE.BoxGeometry(BODY_LENGTH * 0.22, 1.5, 1.0),
        trimMat,
      );
      hoodTrim.position.set(BODY_LENGTH * 0.22, 0, BODY_FLOOR + 14);
      this.mesh.add(hoodTrim);
    }

    // Headlight cluster — small HDR emissive blocks set into the nose.
    {
      const headlightMat = new THREE.MeshStandardMaterial({
        color: 0x101418,
        emissive: 0xfff5d8,
        emissiveIntensity: 3.0,
      });
      const hlGeom = new THREE.BoxGeometry(2.5, 12, 3.5);
      for (const sy of [-1, 1]) {
        const hl = new THREE.Mesh(hlGeom, headlightMat);
        hl.position.set(BODY_LENGTH * 0.485, sy * BODY_WIDTH * 0.3, BODY_FLOOR + 13);
        this.mesh.add(hl);
      }
    }

    // Antenna (thin cylinder + small sphere bobble). Kept static — no per-frame
    // allocation, no rotation; reads as a small detail on the rear deck.
    {
      const antennaMat = new THREE.MeshStandardMaterial({
        color: 0x14161a,
        metalness: 0.6,
        roughness: 0.5,
      });
      const tipMat = new THREE.MeshStandardMaterial({
        color: 0x101418,
        emissive: accent,
        emissiveIntensity: 1.4,
      });
      const antennaShaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.4, 12, 6),
        antennaMat,
      );
      // Cylinder default axis is +Y; rotate so it stands vertically (+Z).
      antennaShaft.rotation.x = Math.PI / 2;
      const deckZ = BODY_FLOOR + 22;
      antennaShaft.position.set(-BODY_LENGTH * 0.30, BODY_WIDTH * 0.28, deckZ + 7);
      this.mesh.add(antennaShaft);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(1.0, 8, 6), tipMat);
      tip.position.set(-BODY_LENGTH * 0.30, BODY_WIDTH * 0.28, deckZ + 13);
      this.mesh.add(tip);
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
    {
      const nozzleZ = BODY_FLOOR + 16; // tucked just under the rear deck
      const nozzleGeom = new THREE.CylinderGeometry(7, 9, 12, 16);
      this.nozzle = new THREE.Mesh(nozzleGeom, nozzleMat);
      // Cylinder axis defaults to +Y; rotate to +X so it points rearward.
      this.nozzle.rotation.z = Math.PI / 2;
      this.nozzle.position.set(-BODY_LENGTH * 0.5 - 4, 0, nozzleZ);
      this.mesh.add(this.nozzle);

      const nozzleInner = new THREE.Mesh(
        new THREE.CylinderGeometry(5, 5, 1, 16),
        nozzleInnerMat,
      );
      nozzleInner.rotation.z = Math.PI / 2;
      nozzleInner.position.set(-BODY_LENGTH * 0.5 - 9.5, 0, nozzleZ);
      this.mesh.add(nozzleInner);
      this._nozzleZ = nozzleZ;
    }

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

    const wxF = BODY_LENGTH * 0.36;
    const wxR = -BODY_LENGTH * 0.34;
    const wy = BODY_WIDTH * 0.46;
    /** @type {Array<{mesh: THREE.Group, isFront: boolean, side: number, spinMesh: THREE.Mesh}>} */
    this.wheels = [];
    const wheelDefs = [
      { x: wxF, y:  wy, isFront: true,  side:  1, r: WHEEL_RADIUS,      axleZ: WHEEL_AXLE_Z },
      { x: wxF, y: -wy, isFront: true,  side: -1, r: WHEEL_RADIUS,      axleZ: WHEEL_AXLE_Z },
      { x: wxR, y:  wy, isFront: false, side:  1, r: WHEEL_RADIUS_REAR, axleZ: WHEEL_AXLE_Z_REAR },
      { x: wxR, y: -wy, isFront: false, side: -1, r: WHEEL_RADIUS_REAR, axleZ: WHEEL_AXLE_Z_REAR },
    ];
    for (const wd of wheelDefs) {
      // Outer group: steers (yaw).
      const steerGroup = new THREE.Group();
      steerGroup.position.set(wd.x, wd.y, wd.axleZ);
      // Inner group: rotates the wheel cylinder so its axis aligns with car +Y, then spins around that axle.
      const spinGroup = new THREE.Group();
      const tireGeom = new THREE.CylinderGeometry(wd.r, wd.r, WHEEL_WIDTH, 20);
      const rimGeom = new THREE.CylinderGeometry(wd.r * 0.62, wd.r * 0.62, WHEEL_WIDTH + 0.6, 14);
      const rimAccentGeom = new THREE.CylinderGeometry(wd.r * 0.3, wd.r * 0.3, WHEEL_WIDTH + 1, 12);
      const tire = new THREE.Mesh(tireGeom, tireMat);
      tire.castShadow = true;
      spinGroup.add(tire);
      const rim = new THREE.Mesh(rimGeom, rimMat);
      spinGroup.add(rim);
      const rimAcc = new THREE.Mesh(rimAccentGeom, rimAccentMat);
      spinGroup.add(rimAcc);
      steerGroup.add(spinGroup);
      this.mesh.add(steerGroup);
      this.wheels.push({
        mesh: steerGroup,
        isFront: wd.isFront,
        side: wd.side,
        spinMesh: spinGroup,
        radius: wd.r,
      });
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
    // Use the small wheel radius as the reference; rear wheels under-spin a hair
    // (visually negligible at game speeds).
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
      // Roll: sign flipped so positive forward speed rolls the wheel forward.
      w.spinMesh.rotation.y = -this._wheelAngle;
    }

    void _v;
    void CAR_LENGTH; void CAR_WIDTH; void CAR_HEIGHT;
  }

  /**
   * World-space position of the boost nozzle tip (rear of car).
   * Returns a reference to a scratch Vector3 — caller must copy if storing.
   * @param {THREE.Vector3} [out]
   * @returns {THREE.Vector3}
   */
  nozzleWorldPos(out) {
    const target = out || _v;
    // Local nozzle tip in car space: just past the rear of the body, at nozzle height.
    target.set(-BODY_LENGTH * 0.5 - 11, 0, this._nozzleZ ?? (BODY_FLOOR + 16));
    target.applyQuaternion(this.mesh.quaternion);
    target.add(this.mesh.position);
    return target;
  }
}
