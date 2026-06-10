// Elaborate night-stadium arena. Geometry mirrors collision dimensions from constants.
// Heavy use of InstancedMesh + merged BufferGeometry to keep draw calls in check.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  ARENA_HALF_WIDTH,
  ARENA_HALF_LENGTH,
  ARENA_HEIGHT,
  CORNER_WALL_DIST,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  GOAL_DEPTH,
} from '../constants.js';

const BLUE = 0x0a84ff;
const BLUE_BRIGHT = 0x36c5ff;
const ORANGE = 0xff6a00;
const ORANGE_BRIGHT = 0xffb24d;
const WALL_DARK = 0x1a2030;
const WALL_TRIM = 0x2a3550;
const FLOOR_DARK = 0x0a1018;

const WALL_LOW_HEIGHT = 900;
// Corner-bevel chord length on each axis: walls span |x| up to 4096 and |y| up to (8064-4096)=3968 on the x-walls;
// the bevel intercepts at x=4096,y=3968 and meets the y-wall at x=3968,y=5120. Width of the diagonal:
// length = sqrt((4096-3968)^2 + (5120-3968)^2) along each axis, but we use proper geometry below.

export function createArenaMesh() {
  const group = new THREE.Group();
  group.name = 'arena';

  group.add(buildPitch());
  group.add(buildLowerWalls());
  group.add(buildUpperGlassAndStands());
  group.add(buildCornerBevels());
  group.add(buildCeilingAndTrusses());
  group.add(buildGoals());
  group.add(buildFloodlightTowers());
  group.add(buildAdBoards());
  group.add(buildFloorFillets());

  return group;
}

// ---------------------------------------------------------------------------
// Pitch
// ---------------------------------------------------------------------------
function buildPitch() {
  const g = new THREE.Group();

  const tex = makePitchTexture();
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.85,
    metalness: 0.0,
    color: 0xffffff,
  });
  const geom = new THREE.PlaneGeometry(ARENA_HALF_WIDTH * 2, ARENA_HALF_LENGTH * 2, 1, 1);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.receiveShadow = true;
  mesh.position.z = 0.01;
  g.add(mesh);

  // Floor pieces extending into the goals (back-of-net area).
  const goalFloorMat = new THREE.MeshStandardMaterial({
    color: 0x05080d,
    roughness: 0.9,
    metalness: 0.0,
  });
  const goalFloorGeom = new THREE.PlaneGeometry(GOAL_HALF_WIDTH * 2, GOAL_DEPTH);
  for (const sy of [-1, 1]) {
    const f = new THREE.Mesh(goalFloorGeom, goalFloorMat);
    f.position.set(0, sy * (ARENA_HALF_LENGTH + GOAL_DEPTH * 0.5), 0.01);
    f.receiveShadow = true;
    g.add(f);
  }

  return g;
}

function makePitchTexture() {
  // High-res grass texture with team-tinted areas and white lines.
  const W = 2048;
  const H = 2560;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');

  // Mow stripes (light/dark green alternating along y).
  const stripes = 16;
  for (let i = 0; i < stripes; i++) {
    const t = i / stripes;
    const dark = (i & 1) === 0;
    ctx.fillStyle = dark ? '#0d3a1a' : '#0f4622';
    ctx.fillRect(0, Math.floor(t * H), W, Math.ceil(H / stripes) + 1);
  }

  // Team-tinted goal-area shading (large rectangles at each end).
  const goalAreaW = (GOAL_HALF_WIDTH * 2 * 1.8) / (ARENA_HALF_WIDTH * 2) * W;
  const goalAreaH = 0.18 * H;
  // Blue defends y<0 → bottom of canvas (texture y grows down, world y... we just pick a side).
  ctx.fillStyle = 'rgba(10, 132, 255, 0.16)';
  ctx.fillRect((W - goalAreaW) / 2, H - goalAreaH, goalAreaW, goalAreaH);
  ctx.fillStyle = 'rgba(255, 106, 0, 0.16)';
  ctx.fillRect((W - goalAreaW) / 2, 0, goalAreaW, goalAreaH);

  // Field lines.
  ctx.strokeStyle = '#f0f4ff';
  ctx.lineWidth = 6;

  // Perimeter
  const pad = 24;
  ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2);

  // Halfway line
  ctx.beginPath();
  ctx.moveTo(pad, H / 2);
  ctx.lineTo(W - pad, H / 2);
  ctx.stroke();

  // Center circle (radius ~1150 uu in 4096 half-width → ratio).
  const cx = W / 2;
  const cy = H / 2;
  const r = (1150 / ARENA_HALF_WIDTH) * (W / 2);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Center dot
  ctx.fillStyle = '#f0f4ff';
  ctx.beginPath();
  ctx.arc(cx, cy, 12, 0, Math.PI * 2);
  ctx.fill();

  // Goal boxes (team-end rectangles).
  const gbW = goalAreaW * 0.62;
  const gbH = 0.12 * H;
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#dfe6ff';
  ctx.strokeRect((W - gbW) / 2, H - gbH - pad, gbW, gbH);
  ctx.strokeRect((W - gbW) / 2, pad, gbW, gbH);

  // Subtle vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.7);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// ---------------------------------------------------------------------------
// Lower solid walls (with cutouts for goal mouths) + emissive trim
// ---------------------------------------------------------------------------
function buildLowerWalls() {
  const g = new THREE.Group();

  const wallMat = new THREE.MeshStandardMaterial({
    color: WALL_DARK,
    roughness: 0.65,
    metalness: 0.3,
    map: makeWallPanelTexture(),
  });

  // X walls (left/right): full span, no goal cutout.
  const xWallLen = (ARENA_HALF_LENGTH - (CORNER_WALL_DIST - ARENA_HALF_WIDTH)) * 2; // length along y between bevels
  // x-wall meets bevel where x = ARENA_HALF_WIDTH and bevel plane |x|+|y|=8064 → y = 8064-4096 = 3968
  const xWallEndY = CORNER_WALL_DIST - ARENA_HALF_WIDTH; // 3968
  const xWallLength = xWallEndY * 2;
  for (const sx of [-1, 1]) {
    const geom = new THREE.PlaneGeometry(xWallLength, WALL_LOW_HEIGHT);
    const m = new THREE.Mesh(geom, wallMat);
    m.position.set(sx * ARENA_HALF_WIDTH, 0, WALL_LOW_HEIGHT / 2);
    // Plane default faces +z; rotate so it faces inward along -sx*x.
    m.rotation.set(Math.PI / 2, sx * Math.PI / 2, 0);
    m.receiveShadow = true;
    g.add(m);
  }

  // Y walls (goal-end) with goal opening cut.
  const yWallEndX = CORNER_WALL_DIST - ARENA_HALF_LENGTH; // 8064-5120 = 2944
  // We build each y-wall as 4 strips: left/right of opening, above opening, then full-height pieces beyond opening (toward corners).
  for (const sy of [-1, 1]) {
    // Side panels (between |x| = GOAL_HALF_WIDTH and |x| = yWallEndX)
    const sideW = yWallEndX - GOAL_HALF_WIDTH;
    if (sideW > 0) {
      const sideGeom = new THREE.PlaneGeometry(sideW, WALL_LOW_HEIGHT);
      for (const sx of [-1, 1]) {
        const m = new THREE.Mesh(sideGeom, wallMat);
        m.position.set(sx * (GOAL_HALF_WIDTH + sideW / 2), sy * ARENA_HALF_LENGTH, WALL_LOW_HEIGHT / 2);
        // Face inward toward -sy*y
        m.rotation.set(Math.PI / 2, 0, sy > 0 ? Math.PI : 0);
        m.receiveShadow = true;
        g.add(m);
      }
    }
    // Lintel above the goal opening (from z=GOAL_HEIGHT to z=WALL_LOW_HEIGHT).
    const lintelH = WALL_LOW_HEIGHT - GOAL_HEIGHT;
    if (lintelH > 0) {
      const lintelGeom = new THREE.PlaneGeometry(GOAL_HALF_WIDTH * 2, lintelH);
      const m = new THREE.Mesh(lintelGeom, wallMat);
      m.position.set(0, sy * ARENA_HALF_LENGTH, GOAL_HEIGHT + lintelH / 2);
      m.rotation.set(Math.PI / 2, 0, sy > 0 ? Math.PI : 0);
      m.receiveShadow = true;
      g.add(m);
    }
  }

  // Emissive trim strip along the floor — one per wall (team-tinted on goal walls).
  const trimGeoX = new THREE.BoxGeometry(xWallLength, 14, 6);
  for (const sx of [-1, 1]) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x202840,
      emissive: 0xffffff,
      emissiveIntensity: 0.9,
    });
    const m = new THREE.Mesh(trimGeoX, mat);
    m.position.set(sx * (ARENA_HALF_WIDTH - 4), 0, 6);
    m.rotation.z = Math.PI / 2;
    g.add(m);
  }

  // Goal-wall trim (skipping the goal mouth) — team color.
  for (const sy of [-1, 1]) {
    const color = sy < 0 ? BLUE_BRIGHT : ORANGE_BRIGHT;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x141826,
      emissive: color,
      emissiveIntensity: 1.4,
    });
    const sideW = yWallEndX - GOAL_HALF_WIDTH;
    if (sideW > 0) {
      const geom = new THREE.BoxGeometry(sideW, 14, 6);
      for (const sx of [-1, 1]) {
        const m = new THREE.Mesh(geom, mat);
        m.position.set(sx * (GOAL_HALF_WIDTH + sideW / 2), sy * (ARENA_HALF_LENGTH - 4), 6);
        g.add(m);
      }
    }
  }

  // Hex panel highlights as InstancedMesh along walls (lots of repeating elements).
  g.add(buildWallHexAccents());

  return g;
}

function makeWallPanelTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#171c2a';
  ctx.fillRect(0, 0, 512, 128);
  // Panel seams every 64 px
  ctx.strokeStyle = '#0a0d18';
  ctx.lineWidth = 2;
  for (let x = 0; x <= 512; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 128);
    ctx.stroke();
  }
  // Top accent strip
  ctx.fillStyle = '#222a3e';
  ctx.fillRect(0, 0, 512, 8);
  ctx.fillStyle = '#2a3550';
  ctx.fillRect(0, 8, 512, 2);
  // Bottom accent
  ctx.fillStyle = '#0c0f18';
  ctx.fillRect(0, 122, 512, 6);
  // Subtle hex shimmer
  ctx.fillStyle = 'rgba(58, 74, 110, 0.18)';
  for (let i = 0; i < 50; i++) {
    const x = Math.random() * 512;
    const y = 20 + Math.random() * 90;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const px = x + Math.cos(a) * 6;
      const py = y + Math.sin(a) * 6;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(8, 1);
  void WALL_TRIM;
  return tex;
}

function buildWallHexAccents() {
  // Small emissive hex dots dotted along the lower walls.
  const hexGeom = new THREE.CircleGeometry(18, 6);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x0a1020,
    emissive: 0x39b6ff,
    emissiveIntensity: 1.2,
    side: THREE.DoubleSide,
  });
  // Two sets: x-walls and y-walls, side-walls only (skip goal area).
  const groupCount = 64; // per x-wall * 2 sides
  const ySpan = (CORNER_WALL_DIST - ARENA_HALF_WIDTH) * 2; // 7936
  const xWallInst = new THREE.InstancedMesh(hexGeom, mat, groupCount * 2);
  let i = 0;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (const sx of [-1, 1]) {
    const yaw = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    q.setFromEuler(new THREE.Euler(0, yaw, 0));
    for (let k = 0; k < groupCount; k++) {
      const t = (k + 0.5) / groupCount;
      const y = -ySpan / 2 + t * ySpan;
      const z = 280 + (k % 2 === 0 ? 0 : 220);
      m.compose(new THREE.Vector3(sx * (ARENA_HALF_WIDTH - 2), y, z), q, new THREE.Vector3(1, 1, 1));
      xWallInst.setMatrixAt(i++, m);
    }
  }
  xWallInst.instanceMatrix.needsUpdate = true;
  return xWallInst;
}

// ---------------------------------------------------------------------------
// Upper "glass" + stadium stands + crowd dots
// ---------------------------------------------------------------------------
function buildUpperGlassAndStands() {
  const g = new THREE.Group();

  const upperHeight = ARENA_HEIGHT - WALL_LOW_HEIGHT; // 1144
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0c1428,
    roughness: 0.2,
    metalness: 0.5,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
  });

  const xWallEndY = CORNER_WALL_DIST - ARENA_HALF_WIDTH; // 3968
  const yWallEndX = CORNER_WALL_DIST - ARENA_HALF_LENGTH; // 2944
  const xLen = xWallEndY * 2;
  const yLen = yWallEndX * 2;

  // Glass on x-walls
  const xGlassGeom = new THREE.PlaneGeometry(xLen, upperHeight);
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(xGlassGeom, glassMat);
    m.position.set(sx * ARENA_HALF_WIDTH, 0, WALL_LOW_HEIGHT + upperHeight / 2);
    m.rotation.set(Math.PI / 2, sx * Math.PI / 2, 0);
    g.add(m);
  }
  // Glass on y-walls
  const yGlassGeom = new THREE.PlaneGeometry(yLen, upperHeight);
  for (const sy of [-1, 1]) {
    const m = new THREE.Mesh(yGlassGeom, glassMat);
    m.position.set(0, sy * ARENA_HALF_LENGTH, WALL_LOW_HEIGHT + upperHeight / 2);
    m.rotation.set(Math.PI / 2, 0, sy > 0 ? Math.PI : 0);
    g.add(m);
  }

  // --- Stadium stands silhouette (behind the glass) ---
  // A simple tiered ring formed by a few box meshes outside each wall.
  const standMat = new THREE.MeshStandardMaterial({
    color: 0x070a14,
    roughness: 0.95,
    metalness: 0.0,
  });
  const standDepth = 1400;
  const standH = upperHeight + 400;
  for (const sx of [-1, 1]) {
    const geom = new THREE.BoxGeometry(standDepth, xLen + 800, standH);
    const m = new THREE.Mesh(geom, standMat);
    m.position.set(sx * (ARENA_HALF_WIDTH + standDepth / 2 + 60), 0, WALL_LOW_HEIGHT + standH / 2 - 200);
    g.add(m);
  }
  for (const sy of [-1, 1]) {
    const geom = new THREE.BoxGeometry(yLen + 800, standDepth, standH);
    const m = new THREE.Mesh(geom, standMat);
    m.position.set(0, sy * (ARENA_HALF_LENGTH + standDepth / 2 + 60), WALL_LOW_HEIGHT + standH / 2 - 200);
    g.add(m);
  }

  // --- Crowd dots: ~2000 emissive instances in tiered arcs ---
  g.add(buildCrowdDots());

  return g;
}

function buildCrowdDots() {
  const count = 2000;
  const geom = new THREE.SphereGeometry(14, 4, 3);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x303848,
    emissive: 0xffffff,
    emissiveIntensity: 0.7,
    vertexColors: true,
  });
  const inst = new THREE.InstancedMesh(geom, mat, count);
  inst.castShadow = false;
  inst.receiveShadow = false;

  const color = new THREE.Color();
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3(1, 1, 1);

  const xWallEndY = CORNER_WALL_DIST - ARENA_HALF_WIDTH; // 3968
  const yWallEndX = CORNER_WALL_DIST - ARENA_HALF_LENGTH; // 2944

  let i = 0;
  // Distribute among 4 walls in proportion to span.
  const xSpan = xWallEndY * 2;
  const ySpan = yWallEndX * 2;
  const total = xSpan * 2 + ySpan * 2;
  const xCount = Math.floor((count * (xSpan * 2)) / total / 2); // per x-wall side
  const yCount = Math.floor((count * (ySpan * 2)) / total / 2);

  const tiers = 6;
  const tierGap = 220;
  const tierStartZ = WALL_LOW_HEIGHT + 120;
  const placeOnXWall = (sx) => {
    for (let k = 0; k < xCount && i < count; k++) {
      const tier = k % tiers;
      const along = ((k / tiers) % (xCount / tiers)) / (xCount / tiers);
      const y = -xWallEndY + along * xSpan + (Math.random() - 0.5) * 60;
      const z = tierStartZ + tier * tierGap + (Math.random() - 0.5) * 60;
      const x = sx * (ARENA_HALF_WIDTH + 220 + tier * 110);
      pos.set(x, y, z);
      const s = 0.6 + Math.random() * 0.9;
      scl.set(s, s, s);
      m.compose(pos, q, scl);
      inst.setMatrixAt(i, m);
      // Slight palette: warm/cool/neutral
      const t = Math.random();
      if (t < 0.35) color.setRGB(0.2, 0.55, 1.0);
      else if (t < 0.55) color.setRGB(1.0, 0.55, 0.2);
      else color.setRGB(0.9, 0.9, 1.0);
      inst.setColorAt(i, color);
      i++;
    }
  };
  const placeOnYWall = (sy) => {
    for (let k = 0; k < yCount && i < count; k++) {
      const tier = k % tiers;
      const along = ((k / tiers) % (yCount / tiers)) / (yCount / tiers);
      const x = -yWallEndX + along * ySpan + (Math.random() - 0.5) * 60;
      const z = tierStartZ + tier * tierGap + (Math.random() - 0.5) * 60;
      const y = sy * (ARENA_HALF_LENGTH + 220 + tier * 110);
      pos.set(x, y, z);
      const s = 0.6 + Math.random() * 0.9;
      scl.set(s, s, s);
      m.compose(pos, q, scl);
      inst.setMatrixAt(i, m);
      const t = Math.random();
      if (t < 0.35) color.setRGB(0.2, 0.55, 1.0);
      else if (t < 0.55) color.setRGB(1.0, 0.55, 0.2);
      else color.setRGB(0.9, 0.9, 1.0);
      inst.setColorAt(i, color);
      i++;
    }
  };
  placeOnXWall(-1);
  placeOnXWall(1);
  placeOnYWall(-1);
  placeOnYWall(1);

  inst.count = i;
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  return inst;
}

// ---------------------------------------------------------------------------
// Corner 45° bevels (|x|+|y| = 8064)
// ---------------------------------------------------------------------------
function buildCornerBevels() {
  const g = new THREE.Group();
  const xWallEndY = CORNER_WALL_DIST - ARENA_HALF_WIDTH; // 3968 — point on x-wall
  const yWallEndX = CORNER_WALL_DIST - ARENA_HALF_LENGTH; // 2944 — point on y-wall
  // Length of bevel chord:
  const chord = Math.hypot(ARENA_HALF_WIDTH - yWallEndX, ARENA_HALF_LENGTH - xWallEndY);
  const mat = new THREE.MeshStandardMaterial({
    color: WALL_DARK,
    roughness: 0.5,
    metalness: 0.4,
    map: makeWallPanelTexture(),
  });

  // Lower bevel up to upperHeight start.
  const lowerGeom = new THREE.PlaneGeometry(chord, WALL_LOW_HEIGHT);
  const upperGeom = new THREE.PlaneGeometry(chord, ARENA_HEIGHT - WALL_LOW_HEIGHT);
  const upperMat = new THREE.MeshStandardMaterial({
    color: 0x0c1428,
    roughness: 0.2,
    metalness: 0.5,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
  });

  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      // Midpoint of the bevel chord (inside corner).
      const mx = sx * (ARENA_HALF_WIDTH + yWallEndX) / 2;
      const my = sy * (ARENA_HALF_LENGTH + xWallEndY) / 2;
      // Outward normal is +(sx, sy)/sqrt(2). The face should face inward, i.e. -(sx, sy)/sqrt(2).
      // We rotate so plane (xy local) maps to a vertical wall facing the field origin from this corner.
      // Plane defaults: normal +Z (camera-facing). We want normal pointing roughly to origin from (mx,my).
      // Easier: build via lookAt for the mesh.
      const mLow = new THREE.Mesh(lowerGeom, mat);
      mLow.position.set(mx, my, WALL_LOW_HEIGHT / 2);
      // Set rotation so the plane's +Z (normal) points toward -(sx, sy) inward.
      const targetDir = new THREE.Vector3(-sx, -sy, 0).normalize();
      mLow.lookAt(mLow.position.clone().add(targetDir));
      mLow.receiveShadow = true;
      g.add(mLow);

      const mUp = new THREE.Mesh(upperGeom, upperMat);
      mUp.position.set(mx, my, WALL_LOW_HEIGHT + (ARENA_HEIGHT - WALL_LOW_HEIGHT) / 2);
      mUp.lookAt(mUp.position.clone().add(targetDir));
      g.add(mUp);

      // Bevel emissive trim along the floor.
      const trim = new THREE.Mesh(
        new THREE.BoxGeometry(chord, 14, 6),
        new THREE.MeshStandardMaterial({ color: 0x141a2a, emissive: 0xffffff, emissiveIntensity: 0.9 }),
      );
      trim.position.set(mx, my, 6);
      // Yaw so its long axis points along the chord.
      const yaw = Math.atan2(sy * (ARENA_HALF_LENGTH - xWallEndY), -sx * (ARENA_HALF_WIDTH - yWallEndX));
      trim.rotation.z = yaw;
      g.add(trim);
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// Ceiling with truss girders + hanging lights
// ---------------------------------------------------------------------------
function buildCeilingAndTrusses() {
  const g = new THREE.Group();

  // Ceiling plane (faces down).
  const ceilGeom = new THREE.PlaneGeometry(ARENA_HALF_WIDTH * 2, ARENA_HALF_LENGTH * 2);
  const ceilMat = new THREE.MeshStandardMaterial({
    color: 0x06080f,
    roughness: 0.9,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const ceil = new THREE.Mesh(ceilGeom, ceilMat);
  ceil.position.set(0, 0, ARENA_HEIGHT - 0.5);
  ceil.rotation.x = Math.PI;
  g.add(ceil);

  // Truss girders — InstancedMesh along x.
  const trussCount = 9;
  const trussGeom = new THREE.BoxGeometry(ARENA_HALF_WIDTH * 2 - 200, 40, 50);
  const trussMat = new THREE.MeshStandardMaterial({
    color: 0x1a1f2e,
    roughness: 0.7,
    metalness: 0.5,
  });
  const trussInst = new THREE.InstancedMesh(trussGeom, trussMat, trussCount);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  for (let i = 0; i < trussCount; i++) {
    const t = (i + 0.5) / trussCount;
    const y = -ARENA_HALF_LENGTH + t * ARENA_HALF_LENGTH * 2;
    pos.set(0, y, ARENA_HEIGHT - 80);
    m.compose(pos, q, scl);
    trussInst.setMatrixAt(i, m);
  }
  trussInst.instanceMatrix.needsUpdate = true;
  trussInst.castShadow = false;
  g.add(trussInst);

  // Hanging light banks — emissive boxes under each truss.
  const banksPerTruss = 3;
  const totalBanks = trussCount * banksPerTruss;
  const bankGeom = new THREE.BoxGeometry(420, 60, 40);
  const bankMat = new THREE.MeshStandardMaterial({
    color: 0x202428,
    emissive: 0xfff0c8,
    emissiveIntensity: 1.6,
  });
  const bankInst = new THREE.InstancedMesh(bankGeom, bankMat, totalBanks);
  let bi = 0;
  for (let i = 0; i < trussCount; i++) {
    const t = (i + 0.5) / trussCount;
    const y = -ARENA_HALF_LENGTH + t * ARENA_HALF_LENGTH * 2;
    for (let j = 0; j < banksPerTruss; j++) {
      const x = -2000 + j * 2000;
      pos.set(x, y, ARENA_HEIGHT - 160);
      m.compose(pos, q, scl);
      bankInst.setMatrixAt(bi++, m);
    }
  }
  bankInst.instanceMatrix.needsUpdate = true;
  g.add(bankInst);

  return g;
}

// ---------------------------------------------------------------------------
// Goals: emissive frame, dark interior, wireframe net, glowing goal-line strip
// ---------------------------------------------------------------------------
function buildGoals() {
  const g = new THREE.Group();
  for (const sy of [-1, 1]) {
    const team = sy < 0 ? 'blue' : 'orange';
    g.add(buildOneGoal(sy, team));
  }
  return g;
}

function buildOneGoal(sy, team) {
  const g = new THREE.Group();
  const color = team === 'blue' ? BLUE : ORANGE;
  const colorBright = team === 'blue' ? BLUE_BRIGHT : ORANGE_BRIGHT;

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x101522,
    emissive: colorBright,
    emissiveIntensity: 2.2,
    metalness: 0.3,
    roughness: 0.4,
  });

  const frameThick = 32;
  // Side posts
  const postGeom = new THREE.BoxGeometry(frameThick, frameThick, GOAL_HEIGHT + frameThick);
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(postGeom, frameMat);
    m.position.set(sx * GOAL_HALF_WIDTH, sy * ARENA_HALF_LENGTH, (GOAL_HEIGHT + frameThick) / 2);
    g.add(m);
  }
  // Crossbar
  const crossGeom = new THREE.BoxGeometry(GOAL_HALF_WIDTH * 2 + frameThick, frameThick, frameThick);
  const cross = new THREE.Mesh(crossGeom, frameMat);
  cross.position.set(0, sy * ARENA_HALF_LENGTH, GOAL_HEIGHT + frameThick / 2);
  g.add(cross);

  // Goal-line floor strip (thin emissive line at z≈1)
  const stripMat = new THREE.MeshStandardMaterial({
    color: 0x101522,
    emissive: colorBright,
    emissiveIntensity: 2.0,
  });
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(GOAL_HALF_WIDTH * 2, 14, 2),
    stripMat,
  );
  strip.position.set(0, sy * ARENA_HALF_LENGTH, 1.5);
  g.add(strip);

  // Goal interior (dark walls, back-of-net at |y| = ARENA_HALF_LENGTH + GOAL_DEPTH = 6000).
  const interiorMat = new THREE.MeshStandardMaterial({
    color: 0x05070d,
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  // Side walls
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_DEPTH, GOAL_HEIGHT), interiorMat);
    m.position.set(sx * GOAL_HALF_WIDTH, sy * (ARENA_HALF_LENGTH + GOAL_DEPTH / 2), GOAL_HEIGHT / 2);
    m.rotation.set(Math.PI / 2, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 0);
    g.add(m);
  }
  // Back wall
  const back = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_HALF_WIDTH * 2, GOAL_HEIGHT), interiorMat);
  back.position.set(0, sy * (ARENA_HALF_LENGTH + GOAL_DEPTH), GOAL_HEIGHT / 2);
  back.rotation.set(Math.PI / 2, 0, sy > 0 ? 0 : Math.PI);
  g.add(back);
  // Roof
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_HALF_WIDTH * 2, GOAL_DEPTH), interiorMat);
  roof.position.set(0, sy * (ARENA_HALF_LENGTH + GOAL_DEPTH / 2), GOAL_HEIGHT);
  roof.rotation.x = Math.PI;
  g.add(roof);

  // Net (wireframe-style on the 3 interior faces). Use a grid of LineSegments via merged BufferGeometry.
  g.add(buildNet(sy, color));

  return g;
}

function buildNet(sy, color) {
  const grids = [];
  // Back wall grid
  grids.push(makeGridGeom(GOAL_HALF_WIDTH * 2, GOAL_HEIGHT, 16, 8, (x, y) => [x, sy * (ARENA_HALF_LENGTH + GOAL_DEPTH - 2), y]));
  // Side walls
  grids.push(makeGridGeom(GOAL_DEPTH, GOAL_HEIGHT, 10, 8, (x, y) => [-GOAL_HALF_WIDTH + 2, sy * (ARENA_HALF_LENGTH + x), y]));
  grids.push(makeGridGeom(GOAL_DEPTH, GOAL_HEIGHT, 10, 8, (x, y) => [GOAL_HALF_WIDTH - 2, sy * (ARENA_HALF_LENGTH + x), y]));
  // Roof
  grids.push(makeGridGeom(GOAL_HALF_WIDTH * 2, GOAL_DEPTH, 16, 10, (x, y) => [x, sy * (ARENA_HALF_LENGTH + y), GOAL_HEIGHT - 2]));

  const merged = mergeGeometries(grids, false);
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.55,
  });
  return new THREE.LineSegments(merged, mat);
}

// Build a grid as LineSegments BufferGeometry. mapFn(u, v) → world [x, y, z].
function makeGridGeom(w, h, divU, divV, mapFn) {
  const positions = [];
  // Horizontal lines (along u for each v)
  for (let j = 0; j <= divV; j++) {
    const v = (j / divV) * h - h / 2;
    for (let i = 0; i < divU; i++) {
      const u0 = (i / divU) * w - w / 2;
      const u1 = ((i + 1) / divU) * w - w / 2;
      const p0 = mapFn(u0, v + h / 2);
      const p1 = mapFn(u1, v + h / 2);
      positions.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]);
    }
  }
  // Vertical lines
  for (let i = 0; i <= divU; i++) {
    const u = (i / divU) * w - w / 2;
    for (let j = 0; j < divV; j++) {
      const v0 = (j / divV) * h;
      const v1 = ((j + 1) / divV) * h;
      const p0 = mapFn(u, v0);
      const p1 = mapFn(u, v1);
      positions.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geom;
}

// ---------------------------------------------------------------------------
// Floodlight towers at the 4 outer corners
// ---------------------------------------------------------------------------
function buildFloodlightTowers() {
  const g = new THREE.Group();

  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x1a1f2e,
    roughness: 0.5,
    metalness: 0.6,
  });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x202428,
    emissive: 0xfff0c8,
    emissiveIntensity: 2.2,
  });
  const poleGeom = new THREE.CylinderGeometry(40, 60, ARENA_HEIGHT + 1600, 12);
  const headGeom = new THREE.BoxGeometry(420, 320, 90);

  const corners = [
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ];
  for (const [sx, sy] of corners) {
    const cx = sx * (ARENA_HALF_WIDTH + 900);
    const cy = sy * (ARENA_HALF_LENGTH + 900);
    const pole = new THREE.Mesh(poleGeom, poleMat);
    pole.position.set(cx, cy, (ARENA_HEIGHT + 1600) / 2);
    pole.rotation.x = Math.PI / 2;
    g.add(pole);

    // Cluster of 6 emissive heads near the top, angled toward the field.
    const head = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const h = new THREE.Mesh(headGeom, headMat);
      const row = Math.floor(i / 3);
      const col = i % 3;
      h.position.set(-280 + col * 280, 0, row * 110);
      head.add(h);
    }
    head.position.set(cx, cy, ARENA_HEIGHT + 1500);
    // Yaw head to face origin.
    head.rotation.z = Math.atan2(-cy, -cx);
    g.add(head);
  }

  return g;
}

// ---------------------------------------------------------------------------
// Ad boards — emissive text strips along walls (alternating team colors)
// ---------------------------------------------------------------------------
function buildAdBoards() {
  const g = new THREE.Group();
  const labels = ['BOOSTBALL', 'SUPERSONIC', 'NEON FIELD', 'DEMO ZONE'];
  const boardHeight = 110;
  const boardZ = WALL_LOW_HEIGHT - boardHeight / 2 - 20;

  const xWallEndY = CORNER_WALL_DIST - ARENA_HALF_WIDTH;
  const yWallEndX = CORNER_WALL_DIST - ARENA_HALF_LENGTH;

  const segPerXWall = 4;
  const segWidthX = (xWallEndY * 2) / segPerXWall;
  for (const sx of [-1, 1]) {
    for (let i = 0; i < segPerXWall; i++) {
      const label = labels[i % labels.length];
      const teamColor = i % 2 === 0 ? BLUE_BRIGHT : ORANGE_BRIGHT;
      const tex = makeAdTexture(label, teamColor);
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        emissiveMap: tex,
        emissive: 0xffffff,
        emissiveIntensity: 1.3,
        roughness: 0.6,
        metalness: 0.1,
      });
      const geom = new THREE.PlaneGeometry(segWidthX, boardHeight);
      const m = new THREE.Mesh(geom, mat);
      const y = -xWallEndY + (i + 0.5) * segWidthX;
      m.position.set(sx * (ARENA_HALF_WIDTH - 8), y, boardZ);
      m.rotation.set(Math.PI / 2, sx * Math.PI / 2, 0);
      g.add(m);
    }
  }

  const segPerYWall = 3;
  // Place ad boards on y-walls only outside the goal opening area.
  const yBoardWidth = (yWallEndX - GOAL_HALF_WIDTH);
  for (const sy of [-1, 1]) {
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < segPerYWall; i++) {
        const label = labels[(i + 1) % labels.length];
        const teamColor = i % 2 === 0 ? ORANGE_BRIGHT : BLUE_BRIGHT;
        const tex = makeAdTexture(label, teamColor);
        const mat = new THREE.MeshStandardMaterial({
          map: tex,
          emissiveMap: tex,
          emissive: 0xffffff,
          emissiveIntensity: 1.3,
        });
        const w = yBoardWidth / segPerYWall;
        const geom = new THREE.PlaneGeometry(w, boardHeight);
        const m = new THREE.Mesh(geom, mat);
        const x = side * (GOAL_HALF_WIDTH + (i + 0.5) * w);
        m.position.set(x, sy * (ARENA_HALF_LENGTH - 8), boardZ);
        m.rotation.set(Math.PI / 2, 0, sy > 0 ? Math.PI : 0);
        g.add(m);
      }
    }
  }

  return g;
}

function makeAdTexture(label, hexColor) {
  const W = 1024;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  // Side accent stripes
  const colorCss = '#' + hexColor.toString(16).padStart(6, '0');
  ctx.fillStyle = colorCss;
  ctx.fillRect(0, 0, 16, H);
  ctx.fillRect(W - 16, 0, 16, H);
  ctx.fillRect(0, 0, W, 6);
  ctx.fillRect(0, H - 6, W, 6);
  // Text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 72px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, W / 2, H / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Floor-to-wall cosmetic fillet strips (visual only; collision handles R=300 corner)
// ---------------------------------------------------------------------------
function buildFloorFillets() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x0a1020,
    emissive: 0x0c1830,
    emissiveIntensity: 0.6,
    roughness: 0.7,
    metalness: 0.2,
  });
  const xWallEndY = CORNER_WALL_DIST - ARENA_HALF_WIDTH;
  const yWallEndX = CORNER_WALL_DIST - ARENA_HALF_LENGTH;

  // Quarter-cylinder along each wall at the floor-wall seam, R~80 (cosmetic).
  const R = 80;
  const sweep = 16;

  // x-walls — fillet axis along world Y. CylinderGeometry axis = local Y by default → no rotation needed.
  // thetaStart=Math.PI sweeps from -X toward +X around the axis; we want the quarter cylinder open inward.
  // For the +X wall: visible quadrant is between -X face (wall side) and -Z face (floor side) → start at PI, sweep PI/2 toward 3PI/2.
  for (const sx of [-1, 1]) {
    const len = xWallEndY * 2;
    const thetaStart = sx > 0 ? Math.PI : (3 * Math.PI) / 2;
    const geom = new THREE.CylinderGeometry(R, R, len, sweep, 1, false, thetaStart, Math.PI / 2);
    const m = new THREE.Mesh(geom, mat);
    m.position.set(sx * (ARENA_HALF_WIDTH - R), 0, R);
    g.add(m);
  }
  // y-walls — fillet axis along world X. Rotate so cylinder axis points world X.
  for (const sy of [-1, 1]) {
    const len = yWallEndX * 2;
    const thetaStart = sy > 0 ? (3 * Math.PI) / 2 : Math.PI;
    const geom = new THREE.CylinderGeometry(R, R, len, sweep, 1, false, thetaStart, Math.PI / 2);
    const m = new THREE.Mesh(geom, mat);
    m.position.set(0, sy * (ARENA_HALF_LENGTH - R), R);
    m.rotation.z = Math.PI / 2;
    g.add(m);
  }
  void FLOOR_DARK;
  return g;
}
