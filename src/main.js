import * as C from './constants.js';
import { World } from './physics/world.js';
import { InputManager, zeroControls } from './game/input.js';
import { MatchState } from './game/state.js';
import { BoostPads } from './game/boostPads.js';
import { pickKickoffSpawns, respawnPose } from './game/spawns.js';
import { Bot } from './game/bot.js';
import { SceneManager } from './render/scene.js';
import { createArenaMesh } from './render/arenaMesh.js';
import { BallVisual } from './render/ballMesh.js';
import { CarVisual } from './render/carMesh.js';
import { CameraRig } from './render/camera.js';
import { Effects } from './render/effects.js';
import { HUD } from './render/hud.js';
import { SFX } from './audio/sfx.js';
import { Music } from './audio/music.js';

const canvas = document.getElementById('game-canvas');
const hudRoot = document.getElementById('hud-root');

// --- Construction ---
const sceneMgr = new SceneManager(canvas);
sceneMgr.scene.add(createArenaMesh());

const world = new World();
const playerCar = world.addCar({ team: C.TEAM_BLUE, name: 'You' });
const botCar = world.addCar({ team: C.TEAM_ORANGE, name: 'Bot' });

const ballVisual = new BallVisual();
sceneMgr.scene.add(ballVisual.mesh);
const visuals = new Map();
for (const car of world.cars) {
  const v = new CarVisual(car.team);
  visuals.set(car.id, v);
  sceneMgr.scene.add(v.mesh);
}

const boostPads = new BoostPads();
const input = new InputManager();
const bot = new Bot(botCar, world, boostPads);
const state = new MatchState();
const hud = new HUD(hudRoot, playerCar.id);
const effects = new Effects(sceneMgr.scene);
effects.attachPads(boostPads);
const cameraRig = new CameraRig(sceneMgr.camera);
const sfx = new SFX(playerCar.id);
const music = new Music();

let ballCam = true;
let paused = false;
const pendingRespawns = []; // { carId, t }

// Cinematic slow-mo: time scale dips to `floor` then eases back to 1 over `dur` real seconds.
const slowmo = { t: 0, dur: 1, floor: 0.3 };
function triggerSlowmo(dur, floor) {
  slowmo.t = dur;
  slowmo.dur = dur;
  slowmo.floor = floor;
}

function applyKickoff() {
  world.resetKickoff(pickKickoffSpawns(1));
  boostPads.reset();
  effects.reset();
  pendingRespawns.length = 0;
}

function restartMatch() {
  state.reset();
  applyKickoff();
}

applyKickoff();

// --- Fixed-timestep loop ---
let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  const toggles = input.pollToggles();
  if (toggles.ballCam) ballCam = !ballCam;
  if (toggles.pause) { paused = !paused; hud.setPaused(paused); sfx.setPaused(paused); }
  if (toggles.mute) sfx.toggleMute();
  if (toggles.music) music.toggle();
  if (toggles.help) hud.toggleHelp();
  if (toggles.restart && state.phase === 'over') restartMatch();

  if (paused) { sceneMgr.render(dt); return; }

  let timeScale = 1;
  if (slowmo.t > 0) {
    slowmo.t = Math.max(0, slowmo.t - dt);
    const p = 1 - slowmo.t / slowmo.dur;
    timeScale = slowmo.floor + (1 - slowmo.floor) * p * p;
  }
  const simDt = dt * timeScale;

  acc += simDt;
  while (acc >= C.PHYSICS_DT) {
    acc -= C.PHYSICS_DT;
    stepGame(C.PHYSICS_DT);
  }

  // Per-frame rendering. World-anchored visuals run on scaled time so slow-mo
  // reads as cinematic; the camera runs on real time so it stays fluid.
  ballVisual.update(world.ball, simDt);
  for (const car of world.cars) visuals.get(car.id).update(car, simDt);
  effects.update(simDt, { cars: world.cars, ball: world.ball, visuals });
  cameraRig.update(dt, { car: playerCar, ball: world.ball, ballCam, phase: state.phase });
  hud.update(dt, { state, playerCar, ball: world.ball });
  sfx.update(dt, { playerCar, ball: world.ball, state });
  music.update(dt, { state });
  sceneMgr.render(dt);
}

function stepGame(dt) {
  const frozen = state.isFrozen();
  // Always tick the bot so it observes phase transitions (e.g. countdown->play
  // for the kickoff trigger). bot.update returns zero controls itself during
  // non-play phases, so this is safe; we still gate the output on `frozen`.
  const botControls = bot.update(dt, state.phase);
  const controlsById = {
    [playerCar.id]: frozen ? zeroControls() : input.getControls(),
    [botCar.id]: frozen ? zeroControls() : botControls,
  };

  window.__BB_CTRL = controlsById; // diagnostics
  const events = world.step(dt, controlsById, { freeze: frozen });
  events.push(...boostPads.update(dt, world.cars));

  // Demo respawn scheduling + cinematic/impact feedback
  for (const ev of events) {
    if (ev.type === 'demo') {
      pendingRespawns.push({ carId: ev.victimId, t: C.DEMO_RESPAWN_TIME });
      triggerSlowmo(0.6, 0.45);
      cameraRig.addShake(0.7);
    } else if (ev.type === 'goal') {
      triggerSlowmo(1.5, 0.25);
      cameraRig.addShake(1.0);
    } else if (ev.type === 'ballHit' && ev.speed > 1700) {
      cameraRig.addShake(Math.min(0.35, (ev.speed - 1700) / 4000));
    }
  }
  for (let i = pendingRespawns.length - 1; i >= 0; i--) {
    const r = pendingRespawns[i];
    r.t -= dt;
    if (r.t <= 0) {
      const car = world.cars.find((c) => c.id === r.carId);
      world.respawnCar(r.carId, respawnPose(car.team));
      pendingRespawns.splice(i, 1);
    }
  }

  const actions = state.update(dt, events);
  for (const a of actions) {
    if (a.type === 'resetKickoff') applyKickoff();
    // 'matchEnd' is reflected by state.phase === 'over'; HUD reads it directly.
  }

  effects.handleEvents(events);
  hud.handleEvents(events);
  sfx.handleEvents(events);
  music.handleEvents(events);
}

requestAnimationFrame(frame);

// Debug/diagnostics handle (also used by automated browser tests).
window.__BOOSTBALL = { world, playerCar, botCar, state, input, boostPads };
