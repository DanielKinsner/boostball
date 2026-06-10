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

let ballCam = true;
let paused = false;
const pendingRespawns = []; // { carId, t }

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
  if (toggles.pause) { paused = !paused; hud.setPaused(paused); }
  if (toggles.mute) sfx.toggleMute();
  if (toggles.help) hud.toggleHelp();
  if (toggles.restart && state.phase === 'over') restartMatch();

  if (paused) { sceneMgr.render(dt); return; }

  acc += dt;
  while (acc >= C.PHYSICS_DT) {
    acc -= C.PHYSICS_DT;
    stepGame(C.PHYSICS_DT);
  }

  // Per-frame rendering
  ballVisual.update(world.ball, dt);
  for (const car of world.cars) visuals.get(car.id).update(car, dt);
  effects.update(dt, { cars: world.cars, ball: world.ball, visuals });
  cameraRig.update(dt, { car: playerCar, ball: world.ball, ballCam, phase: state.phase });
  hud.update(dt, { state, playerCar, ball: world.ball });
  sfx.update(dt, { playerCar, ball: world.ball, state });
  sceneMgr.render(dt);
}

function stepGame(dt) {
  const frozen = state.isFrozen();
  const controlsById = {
    [playerCar.id]: frozen ? zeroControls() : input.getControls(),
    [botCar.id]: frozen ? zeroControls() : bot.update(dt, state.phase),
  };

  const events = world.step(dt, controlsById, { freeze: frozen });
  events.push(...boostPads.update(dt, world.cars));

  // Demo respawn scheduling
  for (const ev of events) {
    if (ev.type === 'demo') pendingRespawns.push({ carId: ev.victimId, t: C.DEMO_RESPAWN_TIME });
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
}

requestAnimationFrame(frame);
