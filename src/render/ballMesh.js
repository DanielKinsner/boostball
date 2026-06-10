// BallVisual — photoreal soccer ball: glossy PBR (MeshPhysicalMaterial) with a
// clearcoat for the leather-panel "sheen". Reflections come from scene.environment.
import * as THREE from 'three';
import { BALL_RADIUS } from '../constants.js';

// Module-level scratch objects to avoid per-frame allocation.
const _omega = new THREE.Vector3();
const _qSpin = new THREE.Quaternion();
const _axis = new THREE.Vector3();

export class BallVisual {
  constructor() {
    this.mesh = new THREE.Group();
    this.mesh.name = 'ballVisual';

    const albedo = makeBallTexture();
    const roughMap = makeBallRoughnessMap();
    const normalMap = makeBallNormalMap();

    // Glossy leather-panel ball: high envMapIntensity so the stadium reflects in
    // the white panels, clearcoat for the slight gloss layer over the panels,
    // restrained emissive (no glow) — we want reflective realism, not neon.
    const mat = new THREE.MeshPhysicalMaterial({
      map: albedo,
      color: 0xffffff,
      roughness: 0.45,
      roughnessMap: roughMap,
      metalness: 0.0,
      normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      clearcoat: 0.6,
      clearcoatRoughness: 0.25,
      envMapIntensity: 1.6,
    });
    const geom = new THREE.SphereGeometry(BALL_RADIUS, 64, 48);
    this.body = new THREE.Mesh(geom, mat);
    this.body.castShadow = true;
    this.body.receiveShadow = false;
    this.mesh.add(this.body);

    // Visual spin quaternion (separate from physics quaternion — physics ball has no quat).
    this._spinQ = new THREE.Quaternion();
  }

  /**
   * @param {{ position: THREE.Vector3, angularVelocity: THREE.Vector3, velocity: THREE.Vector3 }} ball
   * @param {number} dt
   */
  update(ball, dt) {
    this.mesh.position.copy(ball.position);

    // Integrate visual spin from angular velocity.
    _omega.copy(ball.angularVelocity);
    const omegaMag = _omega.length();
    if (omegaMag > 1e-5 && dt > 0) {
      _axis.copy(_omega).multiplyScalar(1 / omegaMag);
      const angle = omegaMag * dt;
      _qSpin.setFromAxisAngle(_axis, angle);
      this._spinQ.premultiply(_qSpin).normalize();
    }
    this.body.quaternion.copy(this._spinQ);
  }
}

// Pentagon-and-hexagon pattern (white leather + black accent pentagons).
function makeBallTexture() {
  const W = 1024;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  // Off-white leather base with subtle warmth.
  ctx.fillStyle = '#eef0ef';
  ctx.fillRect(0, 0, W, H);
  // Pentagons in pseudo-truncated-icosahedron layout.
  ctx.fillStyle = '#1a1d22';
  const cells = 6;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells * 2; i++) {
      const odd = (j & 1) === 1;
      const cx = ((i + (odd ? 0.5 : 0)) / (cells * 2)) * W;
      const cy = ((j + 0.5) / cells) * H;
      if ((i + j) % 3 === 0) {
        drawPentagon(ctx, cx, cy, Math.min(W / (cells * 2), H / cells) * 0.32);
      }
    }
  }
  // Seam lines (slightly darker, sub-pixel).
  ctx.strokeStyle = 'rgba(40, 44, 52, 0.55)';
  ctx.lineWidth = 1.5;
  for (let j = 0; j < cells; j++) {
    ctx.beginPath();
    ctx.moveTo(0, (j / cells) * H);
    ctx.lineTo(W, (j / cells) * H);
    ctx.stroke();
  }
  // Subtle leather grain noise.
  const img = ctx.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  return tex;
}

// Roughness variation — slight gloss change between leather panels and seams.
function makeBallRoughnessMap() {
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#7a7a7a'; // base 0.48
  ctx.fillRect(0, 0, W, H);
  // Slightly rougher seams (lighter = rougher).
  ctx.strokeStyle = '#a0a0a0';
  ctx.lineWidth = 4;
  const cells = 6;
  for (let j = 0; j < cells; j++) {
    ctx.beginPath();
    ctx.moveTo(0, (j / cells) * H);
    ctx.lineTo(W, (j / cells) * H);
    ctx.stroke();
  }
  // Noise sprinkles for realism.
  const img = ctx.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 24;
    const v = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  // Roughness maps must be linear (not sRGB).
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// Faint normal map giving panel edges a hint of relief.
function makeBallNormalMap() {
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  // Neutral normal = (128, 128, 255) = flat surface
  ctx.fillStyle = '#8080ff';
  ctx.fillRect(0, 0, W, H);
  // Dark grooves at seams → small dip in surface
  ctx.strokeStyle = 'rgba(96, 96, 255, 1)';
  ctx.lineWidth = 4;
  const cells = 6;
  for (let j = 0; j < cells; j++) {
    ctx.beginPath();
    ctx.moveTo(0, (j / cells) * H);
    ctx.lineTo(W, (j / cells) * H);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function drawPentagon(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k / 5) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}
