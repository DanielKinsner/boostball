// SceneManager — renderer, scene, camera, lighting, post-processing.
// z-up world. Photoreal PBR pipeline: ACES filmic tone mapping, HDR multisampled
// composer, PMREM environment IBL (RoomEnvironment), restrained bloom for highlight
// glare only, physically-plausible night-stadium light rig.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  ARENA_HALF_WIDTH,
  ARENA_HALF_LENGTH,
  ARENA_HEIGHT,
} from '../constants.js';

export class SceneManager {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;

    const w0 = canvas.clientWidth || window.innerWidth;
    const h0 = canvas.clientHeight || window.innerHeight;

    // --- Renderer ---
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w0, h0, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // --- Scene ---
    this.scene = new THREE.Scene();
    this.scene.background = makeSkyTexture();
    // Dark blue-black fog stretching past the far walls for depth.
    this.scene.fog = new THREE.Fog(0x05070d, 8000, 28000);

    // --- Camera (z-up) ---
    const aspect = w0 / h0;
    this.camera = new THREE.PerspectiveCamera(80, aspect, 5, 40000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(0, -7000, 1800);
    this.camera.lookAt(0, 0, 200);

    // --- Environment IBL ---
    // PMREM of RoomEnvironment gives PBR materials believable specular reflections
    // without a real HDR file. We dim it via environmentIntensity to preserve the
    // night-stadium mood (real arena reflections come from the lights and walls).
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
    const roomEnv = new RoomEnvironment();
    this.envRT = this.pmrem.fromScene(roomEnv, 0.04);
    this.scene.environment = this.envRT.texture;
    // r165 supports scene.environmentIntensity — keep IBL subtle so it doesn't wash
    // out the dark stadium look. Stronger on metals than diffuse, by design.
    this.scene.environmentIntensity = 0.35;

    // --- Lighting (night-stadium, physically plausible) ---
    // Cool sky / warm ground hemisphere fill — represents the stadium dome above
    // and the dark pitch below. Kept low so directional + emissives carry the look.
    const hemi = new THREE.HemisphereLight(0x6a90c8, 0x0a0c14, 0.35);
    hemi.position.set(0, 0, 1);
    this.scene.add(hemi);

    // Key directional light — the "stadium roof floods" baked into one shadow-caster.
    // Cool white (~5500K). Intensity is moderate; the real bright look comes from
    // the bloomed emissive floodlight heads (in arenaMesh) feeding the composer.
    const key = new THREE.DirectionalLight(0xfff4e2, 3.2);
    key.position.set(2500, -2000, 6000);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(4096, 4096);
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.6;
    key.shadow.radius = 4;
    const sc = key.shadow.camera;
    sc.near = 1000;
    sc.far = 16000;
    sc.left = -5600;
    sc.right = 5600;
    sc.top = 5600;
    sc.bottom = -5600;
    sc.updateProjectionMatrix();
    this.scene.add(key);
    this.scene.add(key.target);

    // Fill light from the opposite side so the side facing away from the key isn't
    // crushed black. Slightly cooler than the key.
    const fill = new THREE.DirectionalLight(0xb8d0ff, 0.7);
    fill.position.set(-2500, 2500, 5000);
    fill.target.position.set(0, 0, 0);
    this.scene.add(fill);
    this.scene.add(fill.target);

    // Goal-end rim lights (no shadows; subtle colored bounce from the lit goal frames).
    const blueRim = new THREE.DirectionalLight(0x36c5ff, 0.35);
    blueRim.position.set(0, -8000, 1200);
    blueRim.target.position.set(0, 0, 500);
    this.scene.add(blueRim);
    this.scene.add(blueRim.target);

    const orangeRim = new THREE.DirectionalLight(0xffa15a, 0.35);
    orangeRim.position.set(0, 8000, 1200);
    orangeRim.target.position.set(0, 0, 500);
    this.scene.add(orangeRim);
    this.scene.add(orangeRim.target);

    // Ambient floor so deep recesses don't go fully black with our dim IBL.
    this.scene.add(new THREE.AmbientLight(0x1a2030, 0.18));

    // --- Post-processing: multisampled HDR composer ---
    const renderTarget = new THREE.WebGLRenderTarget(w0, h0, {
      samples: 4, // MSAA — survives the post chain
      type: THREE.HalfFloatType, // HDR — bloom thresholds work in linear-light
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    this.composer = new EffectComposer(this.renderer, renderTarget);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.setSize(w0, h0);

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    // Restrained bloom — only true HDR emissives (intensity > ~1.0 in linear) catch.
    // Strength low so the image doesn't bloom-wash; radius moderate for soft halos.
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w0, h0),
      0.32, // strength — floodlight glare level
      0.7,  // radius — soft falloff
      1.0,  // threshold — only HDR-bright pixels bloom
    );
    this.composer.addPass(this.bloomPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    // --- Resize handling ---
    this._onResize = () => this._handleResize();
    window.addEventListener('resize', this._onResize);

    // Touch silently to avoid unused-var lints if user removes lights later.
    void ARENA_HALF_WIDTH; void ARENA_HALF_LENGTH; void ARENA_HEIGHT;
  }

  _handleResize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** @param {number} _dt */
  render(_dt) {
    this.composer.render();
  }
}

// --- Procedural sky background ---
// Subtle dark night sky with a hint of horizon glow — gives reflective surfaces
// something to pull from at the horizon line; PMREM env gives the rest.
function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0.0, '#04060f'); // top (zenith)
  g.addColorStop(0.55, '#0a1224'); // mid
  g.addColorStop(0.85, '#0c1830'); // near-horizon (slight ambient glow)
  g.addColorStop(1.0, '#02040a'); // below horizon
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 512);
  // Faint starfield in the upper half.
  ctx.fillStyle = 'rgba(220, 230, 255, 0.7)';
  for (let i = 0; i < 28; i++) {
    const y = Math.floor(Math.random() * 240);
    const x = Math.floor(Math.random() * 16);
    ctx.fillRect(x, y, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
