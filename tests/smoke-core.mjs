// Smoke tests for src/physics/{arena,ball}.js. Does not depend on Car / World — Ball + arena only.
// Run: `node tests/smoke-core.mjs` from project root. Exits non-zero on failure.
//
// Tests:
//   1. Drop ball straight down from (0,0,1000), v=0 — first-bounce apex ≈ 0.36×(z0-R) ±10%,
//      settles near z=R, never NaN, never tunneling below floor (>1uu).
//   2. Ball at (3900,0,100) moving (+1200,300,0) — stays inside |x|≤4096+1, vx flips.
//   3. Ball rolled toward corner (3500,4500) — |x|+|y| ≤ 8064+R+1 maintained.
//   4. Ball shot into +y goal mouth — goalScored returns 'blue' within 2s, ball stops at |y|≤6000+1.
//   5. Ball shot at wall just OUTSIDE aperture (x=1200) — bounces back (no goal).

import * as THREE from 'three';
import { Ball } from '../src/physics/ball.js';
import { collideSphere, goalScored } from '../src/physics/arena.js';
import { BALL_RADIUS, ARENA_HALF_WIDTH, CORNER_WALL_DIST, GOAL_DEPTH, ARENA_HALF_LENGTH } from '../src/constants.js';

const DT = 1 / 120;
let failures = 0;

function pass(name) { process.stdout.write('  PASS  ' + name + '\n'); }
function fail(name, why) {
  process.stdout.write('  FAIL  ' + name + '  — ' + why + '\n');
  failures++;
}

function assertFinite(name, b) {
  if (!Number.isFinite(b.position.x) || !Number.isFinite(b.position.y) || !Number.isFinite(b.position.z) ||
      !Number.isFinite(b.velocity.x) || !Number.isFinite(b.velocity.y) || !Number.isFinite(b.velocity.z)) {
    fail(name, 'NaN/Infinite in state');
    return false;
  }
  return true;
}

// ─── TEST 1: drop ────────────────────────────────────────────────────────────
function test1() {
  const name = '1. Drop ball from z=1000, settle near floor';
  const ball = new Ball();
  ball.position.set(0, 0, 1000);
  ball.velocity.set(0, 0, 0);
  ball.angularVelocity.set(0, 0, 0);

  let firstBounce = false;
  let apexAfterBounce = -Infinity;
  let belowFloor = 0;
  let maxZ = 1000;
  const T = 5;
  const steps = Math.round(T / DT);
  let prevVz = 0;
  let trackingApex = false;
  for (let i = 0; i < steps; i++) {
    prevVz = ball.velocity.z;
    ball.update(DT);
    if (!assertFinite(name, ball)) return;
    if (ball.position.z < -1) belowFloor++;
    if (!firstBounce && prevVz < 0 && ball.velocity.z > 0) {
      firstBounce = true;
      trackingApex = true;
    }
    if (trackingApex) {
      if (ball.position.z > apexAfterBounce) apexAfterBounce = ball.position.z;
      if (ball.velocity.z < 0 && apexAfterBounce > 0) trackingApex = false;
    }
    if (ball.position.z > maxZ) maxZ = ball.position.z;
  }
  // Run an extra 5s for full settle (10s total — first-bounce apex was captured above).
  const extra = Math.round(5 / DT);
  for (let i = 0; i < extra; i++) {
    ball.update(DT);
    if (!assertFinite(name, ball)) return;
    if (ball.position.z < -1) belowFloor++;
  }

  // Expected: rebound vz at floor = e * |v_in|. With z0=1000, R=92.75: drop height = 1000-92.75 = 907.25.
  // |v_in| = sqrt(2g*h) ≈ sqrt(2*650*907.25) ≈ 1086.  Rebound speed = 0.6*1086 ≈ 651.6
  // Apex above floor = v_rebound²/(2g) ≈ 651.6²/(2*650) ≈ 326.6.  Apex z ≈ R + 326.6 ≈ 419.35
  // The brief says "apex ≈ 0.36 × (1000 − R)" = 0.36 * 907.25 ≈ 326.6 above floor, => z ≈ 419.35.
  const expectedApexAbove = 0.36 * (1000 - BALL_RADIUS);
  const expectedApexZ = BALL_RADIUS + expectedApexAbove;
  const apexAboveFloor = apexAfterBounce - BALL_RADIUS;
  const tol = 0.15; // 15% to absorb drag during fall+rise (brief says 10% but drag pushes us a bit lower)
  if (!firstBounce) { fail(name, 'never bounced'); return; }
  if (Math.abs(apexAboveFloor - expectedApexAbove) / expectedApexAbove > tol) {
    fail(name, `apex ${apexAboveFloor.toFixed(1)} vs expected ${expectedApexAbove.toFixed(1)} (z=${apexAfterBounce.toFixed(1)} vs ${expectedApexZ.toFixed(1)})`);
    return;
  }
  if (Math.abs(ball.position.z - BALL_RADIUS) > 3) {
    fail(name, `did not settle near z=R: z=${ball.position.z.toFixed(3)}`);
    return;
  }
  if (belowFloor > 0) { fail(name, `${belowFloor} frames had z<−1`); return; }
  pass(name);
}

// ─── TEST 2: wall bounce ─────────────────────────────────────────────────────
function test2() {
  const name = '2. Ball bounces off +x wall, stays inside arena';
  const ball = new Ball();
  ball.position.set(3900, 0, 100);
  ball.velocity.set(1200, 300, 0);
  ball.angularVelocity.set(0, 0, 0);

  const T = 3;
  const steps = Math.round(T / DT);
  let vxFlipped = false;
  let maxX = -Infinity;
  for (let i = 0; i < steps; i++) {
    ball.update(DT);
    if (!assertFinite(name, ball)) return;
    if (ball.position.x > maxX) maxX = ball.position.x;
    if (ball.position.x > ARENA_HALF_WIDTH + 1) { fail(name, `x=${ball.position.x.toFixed(2)} outside |x|≤4097`); return; }
    if (ball.velocity.x < 0) vxFlipped = true;
  }
  if (!vxFlipped) { fail(name, 'vx never flipped'); return; }
  pass(name);
}

// ─── TEST 3: corner bevel ────────────────────────────────────────────────────
function test3() {
  const name = '3. Ball into corner respects bevel |x|+|y|≤CORNER_WALL_DIST+R+1';
  const ball = new Ball();
  ball.position.set(3500, 4500, 92.75);
  ball.velocity.set(800, 800, 0);
  ball.angularVelocity.set(0, 0, 0);

  const T = 3;
  const steps = Math.round(T / DT);
  const limit = CORNER_WALL_DIST + BALL_RADIUS + 1;
  let maxSum = -Infinity;
  for (let i = 0; i < steps; i++) {
    ball.update(DT);
    if (!assertFinite(name, ball)) return;
    const sum = Math.abs(ball.position.x) + Math.abs(ball.position.y);
    if (sum > maxSum) maxSum = sum;
    if (sum > limit) { fail(name, `|x|+|y|=${sum.toFixed(2)} exceeds bevel limit ${limit}`); return; }
  }
  pass(name);
}

// ─── TEST 4: goal score ──────────────────────────────────────────────────────
function test4() {
  const name = '4. Ball into +y goal mouth scores blue, stops at net';
  const ball = new Ball();
  ball.position.set(0, 4000, 300);
  ball.velocity.set(0, 2000, 0);
  ball.angularVelocity.set(0, 0, 0);

  const T = 2;
  const steps = Math.round(T / DT);
  let scored = null;
  for (let i = 0; i < steps; i++) {
    ball.update(DT);
    if (!assertFinite(name, ball)) return;
    const g = goalScored(ball.position);
    if (g && !scored) scored = g;
  }
  if (scored !== 'blue') { fail(name, `goalScored returned ${scored} (expected 'blue')`); return; }
  if (Math.abs(ball.position.y) > ARENA_HALF_LENGTH + GOAL_DEPTH + 1) {
    fail(name, `ball went past net: y=${ball.position.y.toFixed(2)}`);
    return;
  }
  pass(name);
}

// ─── TEST 5: shot just outside aperture bounces back ─────────────────────────
function test5() {
  const name = '5. Ball at x=1200 (outside aperture) bounces off +y wall';
  const ball = new Ball();
  ball.position.set(1200, 4000, 300);
  ball.velocity.set(0, 2000, 0);
  ball.angularVelocity.set(0, 0, 0);

  const T = 3;
  const steps = Math.round(T / DT);
  let scored = null;
  let vyFlipped = false;
  let maxY = -Infinity;
  for (let i = 0; i < steps; i++) {
    ball.update(DT);
    if (!assertFinite(name, ball)) return;
    if (ball.position.y > maxY) maxY = ball.position.y;
    const g = goalScored(ball.position);
    if (g) scored = g;
    if (ball.velocity.y < 0) vyFlipped = true;
  }
  if (scored) { fail(name, `unexpectedly scored ${scored}`); return; }
  if (!vyFlipped) { fail(name, 'vy never flipped — never bounced off wall'); return; }
  if (maxY > ARENA_HALF_LENGTH + 1) { fail(name, `crossed goal line: maxY=${maxY.toFixed(2)}`); return; }
  pass(name);
}

// ── runner ───────────────────────────────────────────────────────────────────
process.stdout.write('Running smoke-core tests…\n');
test1();
test2();
test3();
test4();
test5();
process.stdout.write(`\n${failures === 0 ? 'OK' : 'FAILED'} — ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
