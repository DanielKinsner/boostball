// Smoke tests for src/physics/car.js, carBall.js, carCar.js.
// Run with: node tests/smoke-car.mjs  (from project root)

import * as THREE from 'three';
import * as C from '../src/constants.js';
import { Car, makeCarQuaternion } from '../src/physics/car.js';
import { collideCarBall } from '../src/physics/carBall.js';
import { collideCarCar } from '../src/physics/carCar.js';
import { Ball } from '../src/physics/ball.js';

const DT = 1 / 120;

function zeroCtl() {
  return { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0,
           jump: false, boost: false, handbrake: false };
}

function makeCar(opts = {}) {
  const car = new Car({ team: 'blue', name: 'test', ...opts });
  car.position.set(0, 0, C.CAR_REST_Z);
  car.velocity.set(0, 0, 0);
  car.angularVelocity.set(0, 0, 0);
  car.quaternion.copy(makeCarQuaternion(new THREE.Vector3(1, 0, 0)));
  car.boost = 0;
  return car;
}

function simulate(car, ctl, seconds, perStep) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const events = car.update(DT, ctl);
    if (perStep) perStep(i, events);
  }
}

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, info = '') {
  if (ok) { pass++; }
  else { fail++; failures.push(`${name} :: ${info}`); }
}

// ============================================================
// Test 1: throttle from rest reaches 1400..1415 cap.
// Use peak (any time during 6s of throttle) to avoid wall-collision distortion.
// ============================================================
{
  const car = makeCar();
  car.position.set(-3500, 0, C.CAR_REST_Z);
  const ctl = zeroCtl();
  ctl.throttle = 1;
  let peakFwd = 0;
  const steps = Math.round(6 / DT);
  for (let i = 0; i < steps; i++) {
    car.update(DT, ctl);
    if (!car.isOnGround) continue; // ignore samples while airborne (e.g., wall climb)
    const fwd = new THREE.Vector3(1,0,0).applyQuaternion(car.quaternion);
    const v = car.velocity.dot(fwd);
    if (v > peakFwd) peakFwd = v;
  }
  check('T1 throttle cap', peakFwd >= 1395 && peakFwd <= 1420,
        `peakFwd=${peakFwd.toFixed(2)}`);
}

// ============================================================
// Test 2: boost reaches near 2300 cap, with refill mid-test.
// ============================================================
{
  const car = makeCar();
  const ctl = zeroCtl();
  ctl.throttle = 1;
  ctl.boost = true;
  car.boost = 100;
  // 6 seconds with periodic refill
  const totalSteps = Math.round(6 / DT);
  let peakSpeed = 0;
  for (let i = 0; i < totalSteps; i++) {
    if (i % 60 === 0) car.boost = 100; // refill every 0.5s
    car.update(DT, ctl);
    const s = car.velocity.length();
    if (s > peakSpeed) peakSpeed = s;
  }
  check('T2 boost cap',
        peakSpeed >= 2280 && peakSpeed <= 2300.5,
        `peakSpeed=${peakSpeed.toFixed(2)}`);
}

// ============================================================
// Test 3: jump from ground, apex z 100..280, lands, emits land event.
// ============================================================
{
  const car = makeCar();
  const ctl = zeroCtl();
  let apexZ = car.position.z;
  let sawLand = false;
  let landed = false;

  // Hold jump for 0.2s, then release
  const jumpStartSteps = Math.round(0.2 / DT);
  let leftGround = false;
  let stepCount = 0;
  // Run up to 4 seconds (full jump + fall back)
  const totalSteps = Math.round(4 / DT);
  for (let i = 0; i < totalSteps; i++) {
    ctl.jump = i < jumpStartSteps;
    const evs = car.update(DT, ctl);
    if (car.position.z > apexZ) apexZ = car.position.z;
    if (!car.isOnGround) leftGround = true;
    if (leftGround && car.isOnGround) landed = true;
    for (const e of evs) {
      if (e.type === 'land') sawLand = true;
    }
    stepCount++;
    if (landed) break;
  }
  const height = apexZ - C.CAR_REST_Z;
  check('T3 jump apex height',
        height >= 100 && height <= 280,
        `apexZ=${apexZ.toFixed(2)} height=${height.toFixed(2)} landed=${landed} sawLand=${sawLand}`);
  check('T3 land event', sawLand, `sawLand=${sawLand} landed=${landed}`);
}

// ============================================================
// Test 4: forward dodge mid-air increases planar speed by ~500, zeros vz.
// ============================================================
{
  const car = makeCar();
  const ctl = zeroCtl();
  // First, drive forward to get some baseline speed
  ctl.throttle = 1;
  simulate(car, ctl, 1.5); // ~ ~~ 600 uu/s
  const fwdSpeedBefore = car.velocity.dot(new THREE.Vector3(1,0,0).applyQuaternion(car.quaternion));

  // Initial jump
  ctl.throttle = 0;
  ctl.jump = true;
  car.update(DT, ctl); // first jump press
  // Release jump
  ctl.jump = false;
  for (let i = 0; i < Math.round(0.15 / DT); i++) car.update(DT, ctl);
  // Press jump with forward direction (pitch = -1 -> nose down -> forward dodge)
  // Capture velocity right before and after dodge
  const vBefore = car.velocity.clone();
  const planarBefore = Math.hypot(vBefore.x, vBefore.y);
  ctl.jump = true;
  ctl.pitch = -1;
  const evs = car.update(DT, ctl);
  const vAfter = car.velocity.clone();
  const planarAfter = Math.hypot(vAfter.x, vAfter.y);
  const sawDodge = evs.some((e) => e.type === 'dodge');

  // After dodge, vz should be ~0 (then immediately gravity has applied for one substep)
  // gravity for one substep: -650 * (1/120) = ~ -5.4
  const vzOk = Math.abs(vAfter.z) < 20;
  const planarDelta = planarAfter - planarBefore;
  // DODGE_IMPULSE = 500; we should see approx +500 along forward (some baseline speed already included)
  check('T4 dodge planar speed gain',
        planarDelta >= 400 && planarDelta <= 700,
        `planarBefore=${planarBefore.toFixed(2)} planarAfter=${planarAfter.toFixed(2)} delta=${planarDelta.toFixed(2)}`);
  check('T4 dodge vz zeroed',
        vzOk,
        `vAfter.z=${vAfter.z.toFixed(2)}`);
  check('T4 dodge event', sawDodge, `events=${JSON.stringify(evs.map(e=>e.type))}`);
}

// ============================================================
// Test 5: steering circle. Throttle + steer at ~1000 uu/s, radius ~425 (±40%).
// ============================================================
{
  const car = makeCar();
  const ctl = zeroCtl();
  // Get up to ~1000 uu/s
  ctl.throttle = 1;
  // Drive forward to ~1000 uu/s. From 0 with curve avg ~880 uu/s^2, takes ~1.1s.
  simulate(car, ctl, 1.5);
  const speedReached = car.velocity.length();
  ctl.steer = 1;
  // Sample positions over ~2 sec to estimate circle radius
  const samples = [];
  const totalSteps = Math.round(2.0 / DT);
  for (let i = 0; i < totalSteps; i++) {
    car.update(DT, ctl);
    if (i % 10 === 0) samples.push(car.position.clone());
  }
  // Fit circle to the samples in xy plane: center = mean; radius = mean |p-center|
  let cx = 0, cy = 0;
  for (const p of samples) { cx += p.x; cy += p.y; }
  cx /= samples.length; cy /= samples.length;
  let avgR = 0;
  for (const p of samples) {
    avgR += Math.hypot(p.x - cx, p.y - cy);
  }
  avgR /= samples.length;
  // 1/0.00235 ≈ 425
  const target = 425;
  const lo = target * 0.6;
  const hi = target * 1.4;
  check('T5 steering circle radius',
        avgR >= lo && avgR <= hi,
        `avgR=${avgR.toFixed(2)} target=${target} speedReached=${speedReached.toFixed(1)}`);
}

// ============================================================
// Test 6: collideCarBall — car driving forward into stationary ball.
// ============================================================
{
  const car = makeCar();
  car.position.set(-3500, 0, C.CAR_REST_Z);
  const ctl = zeroCtl();
  ctl.throttle = 1;
  // Get to ~1400 uu/s
  simulate(car, ctl, 4);
  const fwdSpeed = car.velocity.length();
  // Place a stationary ball just in front of the car at chassis height + radius offset
  const ball = new Ball();
  // Car is at (driven distance, 0, CAR_REST_Z). Put ball directly in front at chassis-front + a bit.
  // Use car.position.x + car length/2 + ball radius (just touching)
  const fwdVec = new THREE.Vector3(1, 0, 0).applyQuaternion(car.quaternion);
  ball.position.copy(car.position).addScaledVector(fwdVec, (C.CAR_LENGTH / 2 + ball.radius) - 5); // slight penetration to ensure contact
  ball.velocity.set(0, 0, 0);
  ball.angularVelocity.set(0, 0, 0);

  const result = collideCarBall(car, ball);
  const bs = ball.velocity.length();
  const dirOk = bs > 0 && ball.velocity.dot(fwdVec) / bs > 0.6;
  const nanOk = !Number.isNaN(ball.velocity.x) && !Number.isNaN(ball.velocity.y) && !Number.isNaN(ball.velocity.z);
  check('T6 ball-collision result',
        result !== null,
        `fwdSpeed=${fwdSpeed.toFixed(1)} result=${result}`);
  check('T6 ball speed range',
        bs >= 1300 && bs <= 2600,
        `ballSpeed=${bs.toFixed(2)}`);
  check('T6 ball forward direction',
        dirOk,
        `ball.v=(${ball.velocity.x.toFixed(1)},${ball.velocity.y.toFixed(1)},${ball.velocity.z.toFixed(1)})`);
  check('T6 no NaN', nanOk, '');
}

// ============================================================
// Test 7: collideCarCar demo — attacker at 2250 uu/s into stationary victim.
// ============================================================
{
  const attacker = makeCar();
  const victim = makeCar();
  // Place victim ~80 uu in front of attacker (within sphere overlap r=55*2=110)
  victim.position.set(80, 0, C.CAR_REST_Z);
  // Attacker velocity in forward direction
  attacker.velocity.set(2250, 0, 0);
  attacker.isSupersonic = true; // explicitly above SUPERSONIC_ON
  const result = collideCarCar(attacker, victim);
  check('T7 demo result type',
        result && result.type === 'demo',
        `result=${JSON.stringify(result && {type:result.type})}`);
  check('T7 demo attacker is faster',
        result && result.attacker === attacker,
        `attacker is attacker? ${result && result.attacker === attacker}`);
}

// ============================================================
// Summary
// ============================================================
console.log(`\n=== SMOKE RESULT ===`);
console.log(`Passed: ${pass}`);
console.log(`Failed: ${fail}`);
if (fail > 0) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}
process.exit(0);
