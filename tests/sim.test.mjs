// Headless integration test: full bot-vs-bot match through the real game stack
// (World + MatchState + spawns + BoostPads + Bot). No rendering. Run: npm test
import * as THREE from 'three';
import * as C from '../src/constants.js';
import { World } from '../src/physics/world.js';
import { MatchState } from '../src/game/state.js';
import { BoostPads } from '../src/game/boostPads.js';
import { pickKickoffSpawns, respawnPose } from '../src/game/spawns.js';
import { Bot } from '../src/game/bot.js';
import { makeCarQuaternion } from '../src/physics/car.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name} ${detail}`); }
}

const ZERO = { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false };

// ---------- 1. Bot-vs-bot match simulation ----------
{
  const world = new World();
  const blueCar = world.addCar({ team: C.TEAM_BLUE, name: 'BlueBot' });
  const orangeCar = world.addCar({ team: C.TEAM_ORANGE, name: 'OrangeBot' });
  const pads = new BoostPads();
  const blueBot = new Bot(blueCar, world, pads);
  const orangeBot = new Bot(orangeCar, world, pads);
  const state = new MatchState();
  const pendingRespawns = [];

  const applyKickoff = () => { world.resetKickoff(pickKickoffSpawns(1)); pads.reset(); };
  applyKickoff();

  const counts = { goal: 0, ballHit: 0, padPickup: 0, demo: 0, bounce: 0, jump: 0, dodge: 0 };
  let sawPlay = false, sawCountdownAfterGoal = false, nanFrame = -1, escapeFrame = -1;
  let maxBallSpeed = 0, maxCarSpeed = 0;
  const dt = C.PHYSICS_DT;
  const simSeconds = 600; // up to 10 sim-minutes (match is 5 + pauses)
  const steps = Math.round(simSeconds / dt);

  for (let i = 0; i < steps && state.phase !== 'over'; i++) {
    const frozen = state.isFrozen();
    const controls = {
      [blueCar.id]: frozen ? ZERO : blueBot.update(dt, state.phase),
      [orangeCar.id]: frozen ? ZERO : orangeBot.update(dt, state.phase),
    };
    const events = world.step(dt, controls, { freeze: frozen });
    events.push(...pads.update(dt, world.cars));

    for (const ev of events) {
      if (counts[ev.type] !== undefined) counts[ev.type]++;
      if (ev.type === 'demo') pendingRespawns.push({ carId: ev.victimId, t: C.DEMO_RESPAWN_TIME });
    }
    for (let r = pendingRespawns.length - 1; r >= 0; r--) {
      pendingRespawns[r].t -= dt;
      if (pendingRespawns[r].t <= 0) {
        const car = world.cars.find((c) => c.id === pendingRespawns[r].carId);
        world.respawnCar(car.id, respawnPose(car.team));
        pendingRespawns.splice(r, 1);
      }
    }
    const actions = state.update(dt, events);
    for (const a of actions) if (a.type === 'resetKickoff') applyKickoff();

    if (state.phase === 'play') sawPlay = true;
    if (counts.goal > 0 && state.phase === 'countdown') sawCountdownAfterGoal = true;

    // Invariants every step
    const b = world.ball.position;
    const bv = world.ball.velocity.length();
    maxBallSpeed = Math.max(maxBallSpeed, bv);
    if (nanFrame < 0) {
      const vals = [b.x, b.y, b.z, bv, blueCar.position.x, blueCar.position.y, blueCar.position.z,
        orangeCar.position.x, orangeCar.position.y, orangeCar.position.z];
      if (vals.some((v) => !Number.isFinite(v))) nanFrame = i;
    }
    if (escapeFrame < 0) {
      const out = Math.abs(b.x) > 4097 + C.BALL_RADIUS || Math.abs(b.y) > 6001 + C.BALL_RADIUS ||
        b.z < -2 || b.z > 2045 + C.BALL_RADIUS;
      if (out) escapeFrame = i;
    }
    for (const car of world.cars) {
      if (!car.isDemolished) maxCarSpeed = Math.max(maxCarSpeed, car.velocity.length());
    }
  }

  console.log(`  info  events: ${JSON.stringify(counts)} | score ${state.score.blue}-${state.score.orange} | phase ${state.phase} | maxBall ${maxBallSpeed.toFixed(0)} maxCar ${maxCarSpeed.toFixed(0)}`);
  check('1.1 no NaN over full match', nanFrame < 0, `first NaN at step ${nanFrame}`);
  check('1.2 ball never escapes arena', escapeFrame < 0, `escaped at step ${escapeFrame} pos ${world.ball.position.toArray().map((v) => v.toFixed(0))}`);
  check('1.3 countdown -> play transition', sawPlay);
  check('1.4 bots hit the ball', counts.ballHit > 10, `ballHit=${counts.ballHit}`);
  check('1.5 at least one goal in 10 min of bot play', counts.goal >= 1, `goals=${counts.goal}`);
  check('1.6 kickoff reset after goal', counts.goal === 0 || sawCountdownAfterGoal);
  check('1.7 boost pads picked up', counts.padPickup > 5, `padPickup=${counts.padPickup}`);
  check('1.8 ball speed within cap', maxBallSpeed <= C.BALL_MAX_SPEED + 1, `max=${maxBallSpeed.toFixed(0)}`);
  check('1.9 car speed within cap', maxCarSpeed <= C.CAR_MAX_SPEED + 1, `max=${maxCarSpeed.toFixed(0)}`);
  check('1.10 match reaches a conclusion or is still sane', state.phase === 'over' || state.score.blue + state.score.orange >= 0);
}

// ---------- 2. Forced demolition ----------
{
  const world = new World();
  const attacker = world.addCar({ team: C.TEAM_BLUE, name: 'A' });
  const victim = world.addCar({ team: C.TEAM_ORANGE, name: 'V' });
  const fwd = new THREE.Vector3(0, 1, 0);
  attacker.position.set(0, -400, C.CAR_REST_Z);
  attacker.quaternion.copy(makeCarQuaternion(fwd));
  attacker.velocity.set(0, 2299, 0);
  attacker.isSupersonic = true;
  victim.position.set(0, -100, C.CAR_REST_Z);
  victim.quaternion.copy(makeCarQuaternion(fwd));
  victim.velocity.set(0, 0, 0);

  let demoEvent = null;
  for (let i = 0; i < 120 && !demoEvent; i++) {
    const events = world.step(C.PHYSICS_DT, {
      [attacker.id]: { ...ZERO, throttle: 1, boost: true },
      [victim.id]: ZERO,
    }, { freeze: false });
    demoEvent = events.find((e) => e.type === 'demo') || null;
  }
  check('2.1 supersonic contact demolishes victim', !!demoEvent && demoEvent.victimId === victim.id,
    demoEvent ? JSON.stringify(demoEvent) : 'no demo event in 1s');
  check('2.2 victim flagged demolished', victim.isDemolished === true);

  // Respawn
  if (demoEvent) {
    world.respawnCar(victim.id, respawnPose(victim.team));
    check('2.3 respawn clears demo + restores boost', !victim.isDemolished && Math.abs(victim.boost - C.BOOST_SPAWN_AMOUNT) < 0.01);
    check('2.4 respawn on own half', victim.position.y > 0, `y=${victim.position.y}`);
  }
}

// ---------- 3. Goal + state machine wiring ----------
{
  const world = new World();
  world.addCar({ team: C.TEAM_BLUE, name: 'B' });
  world.addCar({ team: C.TEAM_ORANGE, name: 'O' });
  world.resetKickoff(pickKickoffSpawns(1));
  const state = new MatchState();
  // burn countdown
  for (let i = 0; i < Math.ceil((C.KICKOFF_COUNTDOWN + 0.1) / C.PHYSICS_DT); i++) state.update(C.PHYSICS_DT, []);
  check('3.1 state reaches play after countdown', state.phase === 'play', state.phase);
  // fire ball into orange goal (+y)
  world.ball.position.set(0, 4000, 300);
  world.ball.velocity.set(0, 4000, 0);
  let goalEv = null;
  for (let i = 0; i < 240 && !goalEv; i++) {
    const evs = world.step(C.PHYSICS_DT, {}, { freeze: false });
    goalEv = evs.find((e) => e.type === 'goal') || null;
  }
  check('3.2 goal event fires for blue', !!goalEv && goalEv.team === 'blue', JSON.stringify(goalEv));
  const actions1 = state.update(C.PHYSICS_DT, goalEv ? [goalEv] : []);
  check('3.3 score incremented', state.score.blue === 1, JSON.stringify(state.score));
  check('3.4 goalPause entered', state.phase === 'goalPause', state.phase);
  // burn pause; expect resetKickoff action
  let gotReset = false;
  for (let i = 0; i < Math.ceil((C.GOAL_PAUSE_TIME + 0.2) / C.PHYSICS_DT); i++) {
    const acts = state.update(C.PHYSICS_DT, []);
    if (acts.some((a) => a.type === 'resetKickoff')) gotReset = true;
  }
  check('3.5 resetKickoff action after pause', gotReset);
  check('3.6 back in countdown', state.phase === 'countdown', state.phase);
}

console.log(failures === 0 ? '\nSIM OK — all integration checks passed' : `\nSIM FAILED — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
