// Photoreal night-stadium arena. Geometry mirrors collision dimensions from constants.
// PBR materials throughout. Heavy use of InstancedMesh + merged BufferGeometry to keep
// draw calls down. Reflections come from scene.environment (PMREM in scene.js).
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
const FLOOR_DARK = 0x0a1018;

const WALL_LOW_HEIGHT = 900;

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
// Pitch — PBR grass with subtle normal map for floodlight sheen
// ---------------------------------------------------------------------------
function buildPitch() {
  const g = new THREE.Group();

  const tex = makePitchTexture();
  const normal = makeGrassNormalMap();
  const rough = makePitchRoughnessMap();
  // Tile the small noise normal map across the pitch.
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.repeat.set(40, 50);
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  rough.repeat.set(20, 25);

  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughnessMap: rough,
    roughness: 0.85,
    metalness: 0.0,
    color: 0xffffff,
    envMapIntensity: 0.4,
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
  const H = 2048;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');

  // Mow stripes — darker base so floodlight sheen reads against shadow.
  const stripes = 16;
  for (let i = 0; i < stripes; i++) {
    const t = i / stripes;
    const dark = (i & 1) === 0;
    ctx.fillStyle = dark ? '#082a13' : '#0c361b';
    ctx.fillRect(0, Math.floor(t * H), W, Math.ceil(H / stripes) + 1);
  }

  // Fine grass-blade noise so the field doesn't look like flat plastic.
  const img = ctx.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n * 0.5));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n * 0.4));
  }
  ctx.putImageData(img, 0, 0);

  // Team-tinted goal-area shading (large rectangles at each end).
  const goalAreaW = (GOAL_HALF_WIDTH * 2 * 1.8) / (ARENA_HALF_WIDTH * 2) * W;
  const goalAreaH = 0.18 * H;
  ctx.fillStyle = 'rgba(10, 132, 255, 0.13)';
  ctx.fillRect((W - goalAreaW) / 2, H - goalAreaH, goalAreaW, goalAreaH);
  ctx.fillStyle = 'rgba(255, 106, 0, 0.13)';
  ctx.fillRect((W - goalAreaW) / 2, 0, goalAreaW, goalAreaH);

  // Field lines — slightly worn (lower alpha than crisp white).
  ctx.strokeStyle = 'rgba(232, 238, 248, 0.78)';
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
  ctx.fillStyle = 'rgba(232, 238, 248, 0.78)';
  ctx.beginPath();
  ctx.arc(cx, cy, 12, 0, Math.PI * 2);
  ctx.fill();

  // Goal boxes (team-end rectangles).
  const gbW = goalAreaW * 0.62;
  const gbH = 0.12 * H;
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(220, 228, 248, 0.72)';
  ctx.strokeRect((W - gbW) / 2, H - gbH - pad, gbW, gbH);
  ctx.strokeRect((W - gbW) / 2, pad, gbW, gbH);

  // Soft vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.7);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// Tiny tileable normal map — turbulent noise so the pitch catches floodlight sheen.
function makeGrassNormalMap() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  // Start from neutral normal (128,128,255).
  const img = ctx.createImageData(S, S);
  // Build a small height field then convert to normals.
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // Multi-octave value noise (cheap pseudo-noise).
      let v = 0;
      v += Math.sin(x * 0.32 + y * 0.21) * 0.5;
      v += Math.sin(x * 0.91 - y * 0.55) * 0.25;
      v += (Math.random() - 0.5) * 0.5;
      h[y * S + x] = v;
    }
  }
  // Compute normals from height gradient.
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const xp = (x + 1) % S;
      const xm = (x - 1 + S) % S;
      const yp = (y + 1) % S;
      const ym = (y - 1 + S) % S;
      const dx = h[y * S + xp] - h[y * S + xm];
      const dy = h[yp * S + x] - h[ym * S + x];
      // Pack normal: x→R, y→G, z→B.
      const nx = -dx * 0.5;
      const ny = -dy * 0.5;
      const nz = 1.0;
      const len = Math.hypot(nx, ny, nz);
      const r = ((nx / len) * 0.5 + 0.5) * 255;
      const g = ((ny / len) * 0.5 + 0.5) * 255;
      const b = ((nz / len) * 0.5 + 0.5) * 255;
      const idx = (y * S + x) * 4;
      img.data[idx] = r;
      img.data[idx + 1] = g;
      img.data[idx + 2] = b;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// Slight roughness variation — drier patches reflect light a bit more.
function makePitchRoughnessMap() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c8c8c8'; // base ~0.78
  ctx.fillRect(0, 0, S, S);
  const img = ctx.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 50;
    const v = Math.max(140, Math.min(220, img.data[i] + n));
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Lower walls — PBR concrete/composite panels with roughness variation
// ---------------------------------------------------------------------------
function buildLowerWalls() {
  const g = new THREE.Group();

  const wallTex = makeWallPanelTexture();
  const wallRough = makeWallRoughnessMap();
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  wallTex.repeat.set(8, 1);
  wallRough.wrapS = wallRough.wrapT = THREE.RepeatWrapping;
  wallRough.repeat.set(8, 1);

  const wallMat = new THREE.MeshStandardMaterial({
    color: WALL_DARK,
    roughness: 0.7,
    roughnessMap: wallRough,
    metalness: 0.2,
    map: wallTex,
    side: THREE.DoubleSide,
    envMapIntensity: 0.6,
  });

  // X walls (left/right): full span, no goal cutout.
  const xWallEndY = CORNER_WALL_DIST - ARENA_HALF_WIDTH; // 3968
  const xWallLength = xWallEndY * 2;
  for (const sx of [-1, 1]) {
    const geom = new THREE.PlaneGeometry(xWallLength, WALL_LOW_HEIGHT);
    const m = new THREE.Mesh(geom, wallMat);
    m.position.set(sx * ARENA_HALF_WIDTH, 0, WALL_LOW_HEIGHT / 2);
    m.rotation.set(Math.PI / 2, sx * Math.PI / 2, 0);
    m.receiveShadow = true;
    g.add(m);
  }

  // Y walls (goal-end) with goal opening cut.
  const yWallEndX = CORNER_WALL_DIST - ARENA_HALF_LENGTH; // 2944
  for (const sy of [-1, 1]) {
    // Side panels (between |x| = GOAL_HALF_WIDTH and |x| = yWallEndX)
    const sideW = yWallEndX - GOAL_HALF_WIDTH;
    if (sideW > 0) {
      const sideGeom = new THREE.PlaneGeometry(sideW, WALL_LOW_HEIGHT);
      for (const sx of [-1, 1]) {
        const m = new THREE.Mesh(sideGeom, wallMat);
        m.position.set(sx * (GOAL_HALF_WIDTH + sideW / 2), sy * ARENA_HALF_LENGTH, WALL_LOW_HEIGHT / 2);
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

  // Lit floor trim — restrained HDR emissive (slim white strip).
  const trimGeoX = new THREE.BoxGeometry(xWallLength, 14, 6);
  for (const sx of [-1, 1]) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x101424,
      emissive: 0xffffff,
      emissiveIntensity: 1.6,
    });
    const m = new THREE.Mesh(trimGeoX, mat);
    m.position.set(sx * (ARENA_HALF_WIDTH - 4), 0, 6);
    m.rotation.z = Math.PI / 2;
    g.add(m);
  }

  // Goal-wall trim (skipping the goal mouth) — team color, HDR.
  for (const sy of [-1, 1]) {
    const color = sy < 0 ? BLUE_BRIGHT : ORANGE_BRIGHT;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0d1018,
      emissive: color,
      emissiveIntensity: 2.2,
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
  // Subtle concrete grime noise on each panel.
  const img = ctx.getImageData(0, 0, 512, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Wall roughness variation — panel edges slightly rougher than panel faces.
function makeWallRoughnessMap() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#a0a0a0'; // base 0.63
  ctx.fillRect(0, 0, 512, 128);
  // Rougher seams (lighter)
  ctx.strokeStyle = '#d0d0d0';
  ctx.lineWidth = 4;
  for (let x = 0; x <= 512; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 128);
    ctx.stroke();
  }
  // Patchy noise
  const img = ctx.getImageData(0, 0, 512, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 30;
    const v = Math.max(120, Math.min(220, img.data[i] + n));
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Upper "glass" + stadium stands + crowd dots
// ---------------------------------------------------------------------------
function buildUpperGlassAndStands() {
  const g = new THREE.Group();

  const upperHeight = ARENA_HEIGHT - WALL_LOW_HEIGHT; // 1144
  // Believable stadium glass — high envMapIntensity for reflections, slight tint,
  // not transmissive (too heavy) but a transparent dark layer with high reflectivity.
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0a1424,
    roughness: 0.05,
    metalness: 0.0,
    transparent: true,
    opacity: 0.32,
    side: THREE.DoubleSide,
    envMapIntensity: 1.4,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    ior: 1.5,
    reflectivity: 0.7,
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

  // --- Crowd dots: warmer, dimmer, more believable as distant crowd ---
  g.add(buildCrowdDots());

  return g;
}

function buildCrowdDots() {
  const count = 2000;
  const geom = new THREE.SphereGeometry(14, 4, 3);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a1814,
    emissive: 0xffffff,
    emissiveIntensity: 0.35, // dimmer — distant crowd light
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
  const xSpan = xWallEndY * 2;
  const ySpan = yWallEndX * 2;
  const total = xSpan * 2 + ySpan * 2;
  const xCount = Math.floor((count * (xSpan * 2)) / total / 2);
  const yCount = Math.floor((count * (ySpan * 2)) / total / 2);

  const tiers = 6;
  const tierGap = 220;
  const tierStartZ = WALL_LOW_HEIGHT + 120;

  // Warm-leaning palette: mostly amber/dim-white crowd, a few cool phone-flash bright spots.
  const pickColor = () => {
    const t = Math.random();
    if (t < 0.06) {
      // bright phone flash — cool white, brighter
      color.setRGB(1.0, 1.05, 1.1);
    } else if (t < 0.55) {
      // warm dim crowd
      color.setRGB(0.65, 0.45, 0.25);
    } else if (t < 0.75) {
      // dim amber
      color.setRGB(0.55, 0.4, 0.22);
    } else {
      // near-neutral dim
      color.setRGB(0.45, 0.42, 0.4);
    }
  };

  const placeOnXWall = (sx) => {
    for (let k = 0; k < xCount && i < count; k++) {
      const tier = k % tiers;
      const along = ((k / tiers) % (xCount / tiers)) / (xCount / tiers);
      const y = -xWallEndY + along * xSpan + (Math.random() - 0.5) * 60;
      const z = tierStartZ + tier * tierGap + (Math.random() - 0.5) * 60;
      const x = sx * (ARENA_HALF_WIDTH + 220 + tier * 110);
      pos.set(x, y, z);
      const s = 0.55 + Math.random() * 0.7;
      scl.set(s, s, s);
      m.compose(pos, q, scl);
      inst.setMatrixAt(i, m);
      pickColor();
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
      const s = 0.55 + Math.random() * 0.7;
      scl.set(s, s, s);
      m.compose(pos, q, scl);
      inst.setMatrixAt(i, m);
      pickColor();
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
  const chord = Math.hypot(ARENA_HALF_WIDTH - yWallEndX, ARENA_HALF_LENGTH - xWallEndY);

  const wallTex = makeWallPanelTexture();
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  wallTex.repeat.set(4, 1);
  const wallRough = makeWallRoughnessMap();
  wallRough.wrapS = wallRough.wrapT = THREE.RepeatWrapping;
  wallRough.repeat.set(4, 1);

  const mat = new THREE.MeshStandardMaterial({
    color: WALL_DARK,
    roughness: 0.6,
    roughnessMap: wallRough,
    metalness: 0.25,
    map: wallTex,
    envMapIntensity: 0.7,
  });

  // Lower bevel up to upperHeight start.
  const lowerGeom = new THREE.PlaneGeometry(chord, WALL_LOW_HEIGHT);
  const upperGeom = new THREE.PlaneGeometry(chord, ARENA_HEIGHT - WALL_LOW_HEIGHT);
  const upperMat = new THREE.MeshPhysicalMaterial({
    color: 0x0a1424,
    roughness: 0.05,
    metalness: 0.0,
    transparent: true,
    opacity: 0.32,
    side: THREE.DoubleSide,
    envMapIntensity: 1.4,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
  });

  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const mx = sx * (ARENA_HALF_WIDTH + yWallEndX) / 2;
      const my = sy * (ARENA_HALF_LENGTH + xWallEndY) / 2;
      const mLow = new THREE.Mesh(lowerGeom, mat);
      mLow.position.set(mx, my, WALL_LOW_HEIGHT / 2);
      const targetDir = new THREE.Vector3(-sx, -sy, 0).normalize();
      mLow.lookAt(mLow.position.clone().add(targetDir));
      mLow.receiveShadow = true;
      g.add(mLow);

      const mUp = new THREE.Mesh(upperGeom, upperMat);
      mUp.position.set(mx, my, WALL_LOW_HEIGHT + (ARENA_HEIGHT - WALL_LOW_HEIGHT) / 2);
      mUp.lookAt(mUp.position.clone().add(targetDir));
      g.add(mUp);

      // Bevel emissive trim along the floor — restrained.
      const trim = new THREE.Mesh(
        new THREE.BoxGeometry(chord, 14, 6),
        new THREE.MeshStandardMaterial({ color: 0x101424, emissive: 0xffffff, emissiveIntensity: 1.4 }),
      );
      trim.position.set(mx, my, 6);
      const yaw = Math.atan2(sy * (ARENA_HALF_LENGTH - xWallEndY), -sx * (ARENA_HALF_WIDTH - yWallEndX));
      trim.rotation.z = yaw;
      g.add(trim);
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// Ceiling with metal truss girders + hanging light banks
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

  // Metal truss girders — full PBR metal.
  const trussCount = 9;
  const trussGeom = new THREE.BoxGeometry(ARENA_HALF_WIDTH * 2 - 200, 40, 50);
  const trussMat = new THREE.MeshStandardMaterial({
    color: 0x2a3040,
    roughness: 0.4,
    metalness: 1.0,
    envMapIntensity: 0.9,
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

  // Hanging light banks — emissive boxes under each truss (HDR feeds bloom).
  const banksPerTruss = 3;
  const totalBanks = trussCount * banksPerTruss;
  const bankGeom = new THREE.BoxGeometry(420, 60, 40);
  const bankMat = new THREE.MeshStandardMaterial({
    color: 0x202428,
    emissive: 0xfff0c8,
    emissiveIntensity: 2.6, // bright enough to feed bloom
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
// Goals: lit frame, dark interior, wireframe net, glowing goal-line strip
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

  // Lit structure — emissive metal painted frame (not pure neon).
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x14182a,
    emissive: colorBright,
    emissiveIntensity: 2.4,
    metalness: 0.5,
    roughness: 0.45,
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
    color: 0x14182a,
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

  // Net (wireframe-style on the 3 interior faces).
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
  // Horizontal lines
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
// Floodlight towers — visibly the SOURCE of the key light. Bright HDR heads.
// ---------------------------------------------------------------------------
function buildFloodlightTowers() {
  const g = new THREE.Group();

  // Metal pole.
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x2a2f3e,
    roughness: 0.45,
    metalness: 1.0,
    envMapIntensity: 0.8,
  });
  // Head fixture body (metal housing).
  const headBodyMat = new THREE.MeshStandardMaterial({
    color: 0x14171f,
    roughness: 0.5,
    metalness: 0.9,
  });
  // The actual emissive bulb face — HDR, feeds bloom strongly.
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xfff0c8,
    emissive: 0xfff8e0,
    emissiveIntensity: 6.0, // very bright — this is the light source
  });
  const poleGeom = new THREE.CylinderGeometry(40, 60, ARENA_HEIGHT + 1600, 12);
  const headBodyGeom = new THREE.BoxGeometry(440, 340, 110);
  const bulbGeom = new THREE.BoxGeometry(380, 280, 18);

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

    // Cluster of 6 head fixtures with their bright bulb faces aimed at the field.
    const head = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const row = Math.floor(i / 3);
      const col = i % 3;
      const localX = -290 + col * 290;
      const localZ = row * 130;

      const body = new THREE.Mesh(headBodyGeom, headBodyMat);
      body.position.set(localX, 0, localZ);
      head.add(body);

      // Emissive face on the inward side (the part you see glow from the field).
      const bulb = new THREE.Mesh(bulbGeom, bulbMat);
      bulb.position.set(localX, -60, localZ);
      head.add(bulb);
    }
    head.position.set(cx, cy, ARENA_HEIGHT + 1500);
    // Yaw head to face origin.
    head.rotation.z = Math.atan2(-cy, -cx);
    g.add(head);
  }

  return g;
}

// ---------------------------------------------------------------------------
// Ad boards — LED-style emissive panels (slight emissive, not nuclear)
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
        emissiveIntensity: 0.9, // LED-board level, not "nuclear"
        roughness: 0.5,
        metalness: 0.1,
        side: THREE.DoubleSide,
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
          emissiveIntensity: 0.9,
          side: THREE.DoubleSide,
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
  ctx.fillStyle = '#050608';
  ctx.fillRect(0, 0, W, H);
  // LED dot matrix subtle background
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
  // Faint LED-pixel grid overlay so it reads as an LED board, not a printed banner.
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let x = 0; x < W; x += 6) {
    ctx.fillRect(x, 0, 1, H);
  }
  for (let y = 0; y < H; y += 6) {
    ctx.fillRect(0, y, W, 1);
  }
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
    emissiveIntensity: 0.4,
    roughness: 0.5,
    metalness: 0.4,
    envMapIntensity: 0.7,
  });
  const xWallEndY = CORNER_WALL_DIST - ARENA_HALF_WIDTH;
  const yWallEndX = CORNER_WALL_DIST - ARENA_HALF_LENGTH;

  const R = 80;
  const sweep = 16;

  for (const sx of [-1, 1]) {
    const len = xWallEndY * 2;
    const thetaStart = sx > 0 ? Math.PI : (3 * Math.PI) / 2;
    const geom = new THREE.CylinderGeometry(R, R, len, sweep, 1, false, thetaStart, Math.PI / 2);
    const m = new THREE.Mesh(geom, mat);
    m.position.set(sx * (ARENA_HALF_WIDTH - R), 0, R);
    g.add(m);
  }
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
