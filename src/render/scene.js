// SceneManager — renderer, scene, camera, lighting, post-processing.
// z-up world. Bloom-tuned for Rocket-League-neon night-stadium look.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
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

    // --- Renderer ---
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // --- Scene ---
    this.scene = new THREE.Scene();
    this.scene.background = makeSkyTexture();
    // Dark blue-black fog stretching past the far walls for depth.
    this.scene.fog = new THREE.Fog(0x05070d, 6000, 22000);

    // --- Camera (z-up) ---
    const aspect = (canvas.clientWidth || window.innerWidth) / (canvas.clientHeight || window.innerHeight);
    this.camera = new THREE.PerspectiveCamera(80, aspect, 5, 40000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(0, -7000, 1800);
    this.camera.lookAt(0, 0, 200);

    // --- Lighting ---
    // Dim bluish hemisphere fill — sky tone above, deep field below.
    const hemi = new THREE.HemisphereLight(0x4a6fb0, 0x0a0c14, 0.45);
    hemi.position.set(0, 0, 1);
    this.scene.add(hemi);

    // Key directional light (the "stadium roof" lights baked into one big sun).
    const key = new THREE.DirectionalLight(0xfff2e0, 1.6);
    key.position.set(2500, -2000, 6000);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(4096, 4096);
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.5;
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

    // Goal-end rim lights (no shadows; just colored kicker for bloom feed).
    const blueRim = new THREE.DirectionalLight(0x36c5ff, 0.55);
    blueRim.position.set(0, -8000, 1200);
    blueRim.target.position.set(0, 0, 500);
    this.scene.add(blueRim);
    this.scene.add(blueRim.target);

    const orangeRim = new THREE.DirectionalLight(0xffa15a, 0.55);
    orangeRim.position.set(0, 8000, 1200);
    orangeRim.target.position.set(0, 0, 500);
    this.scene.add(orangeRim);
    this.scene.add(orangeRim.target);

    // Subtle ambient so deep wall recesses don't go fully black.
    this.scene.add(new THREE.AmbientLight(0x141a26, 0.25));

    // --- Post-processing ---
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.setSize(
      canvas.clientWidth || window.innerWidth,
      canvas.clientHeight || window.innerHeight,
    );
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(
        canvas.clientWidth || window.innerWidth,
        canvas.clientHeight || window.innerHeight,
      ),
      0.55, // strength
      0.6, // radius
      0.85, // threshold
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
function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  // Deep blue near top, blue-black near bottom (looking up from field).
  g.addColorStop(0.0, '#06091a');
  g.addColorStop(0.5, '#0a1230');
  g.addColorStop(1.0, '#02040a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 512);
  // Faint starfield.
  ctx.fillStyle = 'rgba(220, 230, 255, 0.85)';
  for (let i = 0; i < 32; i++) {
    const y = Math.floor(Math.random() * 256);
    const x = Math.floor(Math.random() * 16);
    ctx.fillRect(x, y, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
