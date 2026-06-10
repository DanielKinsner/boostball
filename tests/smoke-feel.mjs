// Feel-pass regression checks: wall-drive transition, fall-without-jump flip (wavedash rule),
// self-righting from upside-down, fillet raycast.
import * as THREE from 'three';
import * as C from '../src/constants.js';
import { Car, makeCarQuaternion } from '../src/physics/car.js';
import * as arena from '../src/physics/arena.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name} ${detail}`); }
}
const dt = C.PHYSICS_DT / C.PHYSICS_SUBSTEPS;
const mk = (over = {}) => ({ throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false, ...over });

// 1. Fillet raycast: ray from inside the fillet zone pointing at the corner must hit the curve.
{
  const hit = arena.raycast(new THREE.Vector3(3900, 0, 100), new THREE.Vector3(1, 0, -1).normalize(), 400);
  check('1.1 fillet raycast returns a hit', !!hit, 'null');
  if (hit) {
    const blended = hit.normal.x < -0.05 && hit.normal.z > 0.05;
    check('1.2 fillet normal blends wall+floor', blended, JSON.stringify(hit.normal));
  }
  // Plain floor ray still works.
  const floorHit = arena.raycast(new THREE.Vector3(0, 0, 50), new THREE.Vector3(0, 0, -1), 100);
  check('1.3 floor raycast intact', !!floorHit && floorHit.normal.z === 1 && Math.abs(floorHit.dist - 50) < 1e-6);
}

// 2. Wall drive: car driving at the +x wall transitions up it via the fillet.
{
  const car = new Car({ id: 1, team: 'blue' });
  car.position.set(3000, 0, C.CAR_REST_Z);
  car.quaternion.copy(makeCarQuaternion(new THREE.Vector3(1, 0, 0)));
  car.velocity.set(1300, 0, 0);
  let maxZ = 0, onWall = false;
  for (let i = 0; i < Math.round(3 / dt); i++) {
    car.update(dt, mk({ throttle: 1 }));
    maxZ = Math.max(maxZ, car.position.z);
    const upX = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion).x;
    if (car.isOnGround && upX < -0.7 && car.position.z > 300) onWall = true;
  }
  check('2.1 car drives up the wall via fillet', onWall, `maxZ=${maxZ.toFixed(0)} grounded=${car.isOnGround}`);
}

// 3. Wavedash rule: drive off the goal crossbar... simpler: launch car airborne WITHOUT jumping,
//    wait longer than DOUBLE_JUMP_WINDOW, dodge must still fire.
{
  const car = new Car({ id: 2, team: 'blue' });
  car.position.set(0, 0, 1000);
  car.quaternion.copy(makeCarQuaternion(new THREE.Vector3(0, 1, 0)));
  car.velocity.set(0, 800, 120);
  let events = [];
  for (let i = 0; i < Math.round(1.5 / dt); i++) events.push(...car.update(dt, mk()));
  check('3.1 still airborne after 1.5s fall window', !car.isOnGround);
  events = [];
  for (let i = 0; i < Math.round(0.05 / dt); i++) events.push(...car.update(dt, mk({ jump: true, pitch: -1 })));
  check('3.2 dodge fires after >1.25s of falling (never jumped)', events.some((e) => e.type === 'dodge'),
    JSON.stringify(events.map((e) => e.type)));
}

// 4. Jumped cars still lose the flip after the window.
{
  const car = new Car({ id: 3, team: 'blue' });
  car.position.set(0, 0, C.CAR_REST_Z);
  car.quaternion.copy(makeCarQuaternion(new THREE.Vector3(0, 1, 0)));
  let events = [];
  // Full jump hold (0.2s) so the car stays airborne well past the 1.25s window.
  for (let i = 0; i < Math.round(0.2 / dt); i++) car.update(dt, mk({ jump: true }));
  for (let i = 0; i < Math.round(1.3 / dt); i++) car.update(dt, mk());
  for (let i = 0; i < Math.round(0.05 / dt); i++) events.push(...car.update(dt, mk({ jump: true, pitch: -1 })));
  check('4.1 flip window expires 1.25s after jumping', !events.some((e) => e.type === 'dodge' || e.type === 'jump'),
    JSON.stringify(events.map((e) => e.type)));
}

// 5. Self-righting: car dropped upside down ends wheels-down within 3s.
{
  const car = new Car({ id: 4, team: 'blue' });
  car.position.set(0, 0, 120);
  car.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI); // roof down
  car.velocity.set(0, 0, 0);
  for (let i = 0; i < Math.round(3 / dt); i++) car.update(dt, mk());
  const upZ = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion).z;
  check('5.1 upside-down car rights itself within 3s', upZ > 0.8, `upZ=${upZ.toFixed(2)} z=${car.position.z.toFixed(0)}`);
}

console.log(failures === 0 ? '\nFEEL OK' : `\nFEEL FAILED — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
