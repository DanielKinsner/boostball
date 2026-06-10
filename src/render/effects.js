// Effects — boost flames, trails, supersonic streaks, pad indicators, goal/demo/hit bursts.
// All particles run on a pooled THREE.Points system (CPU-updated attributes).
import * as THREE from 'three';
import {
  BIG_PAD_RADIUS,
  SMALL_PAD_RADIUS,
  PAD_HEIGHT,
  BALL_RADIUS,
  TEAM_BLUE,
} from '../constants.js';

// ---------- Particle pool ----------
const MAX_PARTICLES = 1500;

// Scratch
const _v = new THREE.Vector3();
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _color = new THREE.Color();

class ParticlePool {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    this.capacity = MAX_PARTICLES;
    this.positions = new Float32Array(this.capacity * 3);
    this.colors = new Float32Array(this.capacity * 3);
    this.sizes = new Float32Array(this.capacity);
    // Particle state (CPU-side, not uploaded to GPU each frame except positions/colors/sizes).
    this.vx = new Float32Array(this.capacity);
    this.vy = new Float32Array(this.capacity);
    this.vz = new Float32Array(this.capacity);
    this.life = new Float32Array(this.capacity);
    this.maxLife = new Float32Array(this.capacity);
    this.r0 = new Float32Array(this.capacity);
    this.g0 = new Float32Array(this.capacity);
    this.b0 = new Float32Array(this.capacity);
    this.size0 = new Float32Array(this.capacity);
    this.gravityMul = new Float32Array(this.capacity);
    this.drag = new Float32Array(this.capacity);
    this.fadeMode = new Uint8Array(this.capacity); // 0 = linear, 1 = ease-out
    this.alive = new Uint8Array(this.capacity);
    this.nextSearch = 0;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geom.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    // Use a fixed draw range = 0..capacity, but invisible particles are scaled to size 0.
    const mat = new THREE.PointsMaterial({
      size: 40,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: makeSoftDiscTexture(),
    });
    // sizes attribute is unused by default PointsMaterial (it uses material.size); but we still write per-point
    // sizes for our own custom envelope: we multiply per-particle by hacking the geometry to use a custom shader?
    // Simpler approach: scale alpha via color (RGB encodes intensity), and use material.size as max. We'll keep per-
    // particle size for future extension but PointsMaterial reads only material.size. To get per-point sizing, we
    // emulate by writing alpha into the color (PointsMaterial uses vertexColors with no separate alpha attr).
    // → Effective approach: keep size constant; fade by scaling color toward black (additive blending makes that = fade out).

    this.points = new THREE.Points(geom, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.geom = geom;
    this.mat = mat;
  }

  /**
   * Spawn a particle.
   * @param {THREE.Vector3} pos
   * @param {THREE.Vector3} vel
   * @param {number} r 0..1
   * @param {number} g 0..1
   * @param {number} b 0..1
   * @param {number} size base size (color intensity proxy)
   * @param {number} lifeSec
   * @param {number} gravityMul gravity multiplier (1 = full -z gravity)
   * @param {number} drag per-second drag factor (0 = none)
   * @param {number} fadeMode 0 linear, 1 ease-out
   */
  spawn(pos, vel, r, g, b, size, lifeSec, gravityMul, drag, fadeMode) {
    let idx = -1;
    for (let k = 0; k < this.capacity; k++) {
      const i = (this.nextSearch + k) % this.capacity;
      if (!this.alive[i]) { idx = i; break; }
    }
    if (idx < 0) return; // pool full; drop
    this.nextSearch = (idx + 1) % this.capacity;

    this.alive[idx] = 1;
    this.positions[idx * 3 + 0] = pos.x;
    this.positions[idx * 3 + 1] = pos.y;
    this.positions[idx * 3 + 2] = pos.z;
    this.vx[idx] = vel.x;
    this.vy[idx] = vel.y;
    this.vz[idx] = vel.z;
    this.life[idx] = lifeSec;
    this.maxLife[idx] = lifeSec;
    this.r0[idx] = r;
    this.g0[idx] = g;
    this.b0[idx] = b;
    this.size0[idx] = size;
    this.sizes[idx] = size;
    this.colors[idx * 3 + 0] = r * size;
    this.colors[idx * 3 + 1] = g * size;
    this.colors[idx * 3 + 2] = b * size;
    this.gravityMul[idx] = gravityMul;
    this.drag[idx] = drag;
    this.fadeMode[idx] = fadeMode;
  }

  update(dt) {
    const gravity = 650;
    let anyAlive = false;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) {
        // Make sure dead particles aren't visible — collapse color to black.
        this.colors[i * 3] = 0; this.colors[i * 3 + 1] = 0; this.colors[i * 3 + 2] = 0;
        continue;
      }
      anyAlive = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alive[i] = 0;
        this.colors[i * 3] = 0; this.colors[i * 3 + 1] = 0; this.colors[i * 3 + 2] = 0;
        continue;
      }
      // Apply drag
      if (this.drag[i] > 0) {
        const f = Math.max(0, 1 - this.drag[i] * dt);
        this.vx[i] *= f; this.vy[i] *= f; this.vz[i] *= f;
      }
      // Gravity (world -z)
      this.vz[i] -= gravity * this.gravityMul[i] * dt;
      // Integrate
      this.positions[i * 3 + 0] += this.vx[i] * dt;
      this.positions[i * 3 + 1] += this.vy[i] * dt;
      this.positions[i * 3 + 2] += this.vz[i] * dt;
      if (this.positions[i * 3 + 2] < 4) {
        this.positions[i * 3 + 2] = 4;
        this.vz[i] = Math.abs(this.vz[i]) * 0.25;
        this.vx[i] *= 0.7;
        this.vy[i] *= 0.7;
      }
      // Fade
      const t = this.life[i] / this.maxLife[i];
      const tt = this.fadeMode[i] === 1 ? t * t : t;
      this.colors[i * 3 + 0] = this.r0[i] * this.size0[i] * tt;
      this.colors[i * 3 + 1] = this.g0[i] * this.size0[i] * tt;
      this.colors[i * 3 + 2] = this.b0[i] * this.size0[i] * tt;
    }
    this.geom.attributes.position.needsUpdate = true;
    this.geom.attributes.color.needsUpdate = true;
    void anyAlive;
  }

  killAll() {
    for (let i = 0; i < this.capacity; i++) {
      this.alive[i] = 0;
      this.colors[i * 3] = 0; this.colors[i * 3 + 1] = 0; this.colors[i * 3 + 2] = 0;
    }
    this.geom.attributes.color.needsUpdate = true;
  }
}

function makeSoftDiscTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- Shockwave ring pool (a small set of expanding flat rings) ----------
class ShockwavePool {
  constructor(scene) {
    this.scene = scene;
    this.capacity = 6;
    this.rings = [];
    const geom = new THREE.RingGeometry(1, 1.2, 64);
    for (let i = 0; i < this.capacity; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.visible = false;
      mesh.rotation.x = 0; // ring lies in xy plane (normal +z) — perfect for floor blast
      scene.add(mesh);
      this.rings.push({ mesh, mat, life: 0, maxLife: 1, startR: 0, endR: 1, color: new THREE.Color() });
    }
  }

  emit(pos, color, startR, endR, life) {
    for (const r of this.rings) {
      if (r.life <= 0) {
        r.mesh.position.copy(pos);
        r.mesh.position.z = Math.max(pos.z, 5);
        r.life = life;
        r.maxLife = life;
        r.startR = startR;
        r.endR = endR;
        r.color.set(color);
        r.mat.color.copy(r.color);
        r.mesh.visible = true;
        return;
      }
    }
  }

  update(dt) {
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.mesh.visible = false;
        r.mat.opacity = 0;
        continue;
      }
      const t = 1 - r.life / r.maxLife;
      const radius = r.startR + (r.endR - r.startR) * t;
      r.mesh.scale.set(radius, radius, 1);
      r.mat.opacity = (1 - t) * 0.85;
    }
  }

  killAll() {
    for (const r of this.rings) {
      r.life = 0;
      r.mesh.visible = false;
      r.mat.opacity = 0;
    }
  }
}

// ---------- Flash sprite pool ----------
class FlashPool {
  constructor(scene) {
    this.scene = scene;
    this.capacity = 4;
    this.items = [];
    const geom = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < this.capacity; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.items.push({ mesh, mat, life: 0, maxLife: 1 });
    }
  }

  emit(pos, size, color, life) {
    for (const it of this.items) {
      if (it.life <= 0) {
        it.mesh.position.copy(pos);
        it.mesh.scale.set(size, size, size);
        it.mat.color.set(color);
        it.life = life;
        it.maxLife = life;
        it.mesh.visible = true;
        return;
      }
    }
  }

  update(dt, cameraPos) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) {
        it.mesh.visible = false;
        it.mat.opacity = 0;
        continue;
      }
      const t = it.life / it.maxLife;
      it.mat.opacity = t;
      if (cameraPos) it.mesh.lookAt(cameraPos);
    }
  }

  killAll() {
    for (const it of this.items) {
      it.life = 0;
      it.mesh.visible = false;
      it.mat.opacity = 0;
    }
  }
}

// ---------- Effects (main) ----------
export class Effects {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    this.particles = new ParticlePool(scene);
    this.shockwaves = new ShockwavePool(scene);
    this.flashes = new FlashPool(scene);
    this.boostPads = null;
    this.padMeshes = []; // per-pad mesh + base intensity record
    /** @type {Map<number, {lastSpawn: number}>} */
    this._boostState = new Map();
    /** @type {Map<number, {lastSpawn: number}>} */
    this._streakState = new Map();
    this._ballTrail = { lastSpawn: 0 };
  }

  /** @param {{ pads: Array<{ position: THREE.Vector3, big: boolean, active: boolean }> }} boostPads */
  attachPads(boostPads) {
    this.boostPads = boostPads;
    const group = new THREE.Group();
    group.name = 'boostPads';
    const padDiscGeom = new THREE.CircleGeometry(SMALL_PAD_RADIUS, 24);
    const padOrbGeom = new THREE.CylinderGeometry(BIG_PAD_RADIUS * 0.55, BIG_PAD_RADIUS * 0.75, PAD_HEIGHT, 16);
    for (const pad of boostPads.pads) {
      const isBig = pad.big;
      const color = isBig ? 0xffd84a : 0xffc04a;
      const mat = new THREE.MeshStandardMaterial({
        color: 0x161208,
        emissive: color,
        emissiveIntensity: 1.2, // softer, less neon
        transparent: true,
        opacity: 1,
        side: THREE.DoubleSide,
      });
      const ringMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.4, // softer halo on the floor
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      let primary;
      let ring = null;
      if (isBig) {
        primary = new THREE.Mesh(padOrbGeom, mat);
        primary.rotation.x = Math.PI / 2;
        primary.position.set(pad.position.x, pad.position.y, PAD_HEIGHT / 2);
        // Glowing base ring on the ground
        const ringGeom = new THREE.RingGeometry(BIG_PAD_RADIUS * 0.5, BIG_PAD_RADIUS * 1.05, 28);
        ring = new THREE.Mesh(ringGeom, ringMat);
        ring.position.set(pad.position.x, pad.position.y, 2);
      } else {
        primary = new THREE.Mesh(padDiscGeom, mat);
        primary.position.set(pad.position.x, pad.position.y, 4);
      }
      group.add(primary);
      if (ring) group.add(ring);
      this.padMeshes.push({ pad, mesh: primary, ring, mat, ringMat, baseIntensity: 1.2 });
    }
    this.scene.add(group);
  }

  /**
   * @param {number} dt
   * @param {{ cars: any[], ball: any, visuals: Map<number, any> }} args
   */
  update(dt, { cars, ball, visuals }) {
    // Pad indicators (active vs cooldown)
    for (const p of this.padMeshes) {
      const active = p.pad.active;
      const targetIntensity = active ? p.baseIntensity : p.baseIntensity * 0.15;
      const targetScale = active ? 1.0 : 0.6;
      // Snap to target (cheap; could smooth but not necessary).
      p.mat.emissiveIntensity = targetIntensity;
      p.mesh.scale.set(targetScale, targetScale, targetScale);
      if (p.ring) p.ringMat.opacity = active ? 0.4 : 0.12;
    }

    // Boost flames + supersonic streaks per car.
    for (const car of cars) {
      if (car.isDemolished) continue;
      const visual = visuals.get(car.id);
      if (!visual) continue;
      const ctrls = car.lastControls;
      const boosting = !!(ctrls && ctrls.boost) && car.boost > 0;
      if (boosting) {
        this._spawnBoostFlame(dt, car, visual);
      }
      // Supersonic speed streaks
      if (car.isSupersonic) {
        this._spawnSupersonicStreaks(dt, car);
      }
    }

    // Ball trail when fast
    const ballSpeed = ball.velocity.length();
    if (ballSpeed > 2000) {
      this._spawnBallTrail(dt, ball, ballSpeed);
    }

    // Step pools
    this.particles.update(dt);
    this.shockwaves.update(dt);
    this.flashes.update(dt, this._camPos());
  }

  _camPos() {
    // We don't have direct camera access; sprite billboarding is "good enough" facing world up.
    // Returning null disables lookAt — the flat planes still look fine with bloom + additive blending.
    return null;
  }

  _spawnBoostFlame(dt, car, visual) {
    let st = this._boostState.get(car.id);
    if (!st) { st = { lastSpawn: 0 }; this._boostState.set(car.id, st); }
    st.lastSpawn += dt;
    const rate = 1 / 110; // denser flame for fire-like body
    while (st.lastSpawn >= rate) {
      st.lastSpawn -= rate;
      visual.nozzleWorldPos(_v);
      // Velocity: opposite the car's forward + small random spread.
      _vA.copy(car.forward).multiplyScalar(-1).multiplyScalar(900 + Math.random() * 400);
      _vA.x += (Math.random() - 0.5) * 200;
      _vA.y += (Math.random() - 0.5) * 200;
      _vA.z += (Math.random() - 0.5) * 200;
      // Color: white-hot core (close to nozzle, low spread) → orange (longer life).
      // We approximate by biasing: short-lived = brighter/whiter, long-lived = oranger.
      const heat = Math.random(); // 0..1; high = young/hot
      let r, g, b, life, size;
      if (heat > 0.7) {
        // White-hot core
        r = 1.4; g = 1.25; b = 0.85;
        size = 0.7 + Math.random() * 0.2;
        life = 0.12 + Math.random() * 0.08;
      } else if (heat > 0.35) {
        // Yellow-orange body
        r = 1.3; g = 0.75; b = 0.2;
        size = 0.9 + Math.random() * 0.25;
        life = 0.22 + Math.random() * 0.12;
      } else {
        // Cooler orange-red tail
        r = 1.2; g = 0.4; b = 0.1;
        size = 1.0 + Math.random() * 0.3;
        life = 0.32 + Math.random() * 0.15;
      }
      this.particles.spawn(_v, _vA, r, g, b, size, life, 0.05, 4.0, 1);
    }
  }

  _spawnSupersonicStreaks(dt, car) {
    let st = this._streakState.get(car.id);
    if (!st) { st = { lastSpawn: 0 }; this._streakState.set(car.id, st); }
    st.lastSpawn += dt;
    const rate = 1 / 40;
    while (st.lastSpawn >= rate) {
      st.lastSpawn -= rate;
      // Spawn small white particles offset around the car, moving opposite to velocity.
      _v.copy(car.position);
      _v.x += (Math.random() - 0.5) * 240;
      _v.y += (Math.random() - 0.5) * 240;
      _v.z += (Math.random() - 0.5) * 120;
      _vA.copy(car.velocity).multiplyScalar(-0.6);
      // Add small lateral randomness
      _vA.x += (Math.random() - 0.5) * 100;
      _vA.y += (Math.random() - 0.5) * 100;
      this.particles.spawn(_v, _vA, 0.95, 0.98, 1.0, 0.7, 0.2, 0, 2.0, 1);
    }
  }

  _spawnBallTrail(dt, ball, speed) {
    this._ballTrail.lastSpawn += dt;
    const rate = 1 / Math.min(60, 25 + speed * 0.01);
    while (this._ballTrail.lastSpawn >= rate) {
      this._ballTrail.lastSpawn -= rate;
      _v.copy(ball.position);
      _v.x += (Math.random() - 0.5) * BALL_RADIUS * 0.5;
      _v.y += (Math.random() - 0.5) * BALL_RADIUS * 0.5;
      _v.z += (Math.random() - 0.5) * BALL_RADIUS * 0.5;
      _vA.copy(ball.velocity).multiplyScalar(-0.15);
      // White-cyan
      this.particles.spawn(_v, _vA, 0.7, 0.95, 1.0, 0.85, 0.45, 0, 1.0, 1);
    }
  }

  /** @param {any[]} events */
  handleEvents(events) {
    for (const ev of events) {
      if (ev.type === 'goal') {
        this._goalBurst(ev.team);
      } else if (ev.type === 'demo') {
        this._demoBurst(ev.position);
      } else if (ev.type === 'ballHit') {
        if (ev.speed > 1000) this._sparkPuff(ev.position, Math.min(80, ev.speed * 0.04));
      } else if (ev.type === 'bounce') {
        const speed = ev.speed || 0;
        if (speed > 300) this._dustPuff(ev.position, Math.min(30, speed * 0.05));
      }
    }
  }

  _goalBurst(team) {
    // Burst at world origin (ball is being reset; use last ball position would be nice, but we don't have it here).
    // Use the goal end the scoring team scored into: blue scored = +y goal, orange scored = -y goal.
    const teamColor = team === TEAM_BLUE ? 0x36c5ff : 0xffb24d;
    _color.set(teamColor);
    const goalY = team === TEAM_BLUE ? 5000 : -5000;
    _vA.set(0, goalY, 200);
    // 320 particles in a sphere outward.
    for (let i = 0; i < 320; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(2 * Math.random() - 1);
      const speed = 700 + Math.random() * 1400;
      _vB.set(
        Math.sin(v) * Math.cos(u) * speed,
        Math.sin(v) * Math.sin(u) * speed,
        Math.cos(v) * speed,
      );
      _v.copy(_vA);
      this.particles.spawn(
        _v, _vB,
        _color.r * 1.4, _color.g * 1.4, _color.b * 1.4,
        1.4 + Math.random() * 0.6,
        0.9 + Math.random() * 0.6,
        0.6, 0.5, 1,
      );
    }
    // Shockwave (flat ring)
    this.shockwaves.emit(_vA, teamColor, 50, 1800, 0.9);
    // Flash sprite
    _v.copy(_vA); _v.z += 100;
    this.flashes.emit(_v, 1200, 0xffffff, 0.25);
  }

  _demoBurst(position) {
    _vA.copy(position);
    for (let i = 0; i < 140; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(2 * Math.random() - 1);
      const speed = 400 + Math.random() * 900;
      _vB.set(
        Math.sin(v) * Math.cos(u) * speed,
        Math.sin(v) * Math.sin(u) * speed,
        Math.cos(v) * speed,
      );
      const orange = Math.random() < 0.6;
      const r = orange ? 1.0 : 0.15;
      const g = orange ? 0.5 + Math.random() * 0.3 : 0.12;
      const b = orange ? 0.05 : 0.1;
      this.particles.spawn(_vA, _vB, r, g, b, 1.0 + Math.random() * 0.5, 0.6 + Math.random() * 0.4, 0.8, 0.6, 1);
    }
    this.shockwaves.emit(_vA, 0xff7a1a, 30, 600, 0.5);
    this.flashes.emit(_vA, 400, 0xffd0a0, 0.2);
  }

  _sparkPuff(position, mag) {
    _vA.copy(position);
    const count = Math.floor(20 + mag * 2);
    for (let i = 0; i < count; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(2 * Math.random() - 1);
      const speed = 200 + Math.random() * 600;
      _vB.set(
        Math.sin(v) * Math.cos(u) * speed,
        Math.sin(v) * Math.sin(u) * speed,
        Math.cos(v) * speed,
      );
      this.particles.spawn(_vA, _vB, 1.0, 0.9, 0.6, 0.7 + Math.random() * 0.3, 0.25 + Math.random() * 0.2, 0.3, 2.0, 1);
    }
  }

  _dustPuff(position, mag) {
    _vA.copy(position);
    _vA.z = Math.max(_vA.z, 6);
    const count = Math.floor(10 + mag);
    for (let i = 0; i < count; i++) {
      const u = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 180;
      _vB.set(Math.cos(u) * speed, Math.sin(u) * speed, 40 + Math.random() * 60);
      this.particles.spawn(_vA, _vB, 0.55, 0.55, 0.6, 0.6 + Math.random() * 0.2, 0.35, 0.05, 2.5, 0);
    }
  }

  reset() {
    this.particles.killAll();
    this.shockwaves.killAll();
    this.flashes.killAll();
    this._boostState.clear();
    this._streakState.clear();
    this._ballTrail.lastSpawn = 0;
  }
}
