// BallVisual — soccer-pattern sphere with emissive seam glow.
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

    const tex = makeBallTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      color: 0xffffff,
      roughness: 0.45,
      metalness: 0.1,
      emissive: 0xffffff,
      emissiveMap: makeBallEmissive(),
      emissiveIntensity: 0.45,
    });
    const geom = new THREE.SphereGeometry(BALL_RADIUS, 48, 32);
    this.body = new THREE.Mesh(geom, mat);
    this.body.castShadow = true;
    this.body.receiveShadow = false;
    this.mesh.add(this.body);

    // Thin rim halo for bloom feed.
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xb6ddff,
      transparent: true,
      opacity: 0.25,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const haloGeom = new THREE.SphereGeometry(BALL_RADIUS * 1.06, 24, 16);
    this.halo = new THREE.Mesh(haloGeom, haloMat);
    this.mesh.add(this.halo);

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

function makeBallTexture() {
  const W = 1024;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  // White base
  ctx.fillStyle = '#f3f4f8';
  ctx.fillRect(0, 0, W, H);
  // Black pentagon-suggesting blobs in a pseudo-buckminster pattern.
  ctx.fillStyle = '#101218';
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
  // Subtle gridlines suggesting seams.
  ctx.strokeStyle = 'rgba(20, 24, 36, 0.4)';
  ctx.lineWidth = 2;
  for (let j = 0; j < cells; j++) {
    ctx.beginPath();
    ctx.moveTo(0, (j / cells) * H);
    ctx.lineTo(W, (j / cells) * H);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function makeBallEmissive() {
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  // Glowing seams ringing the ball
  ctx.strokeStyle = '#5fc2ff';
  ctx.lineWidth = 3;
  for (let j = 1; j < 4; j++) {
    ctx.beginPath();
    ctx.moveTo(0, (j / 4) * H);
    ctx.lineTo(W, (j / 4) * H);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
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
