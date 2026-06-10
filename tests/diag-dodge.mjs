// Diagnose: hold W (throttle+pitch-1), double-tap space => should forward-dodge.
import * as THREE from 'three';
import * as C from '../src/constants.js';
import { Car, makeCarQuaternion } from '../src/physics/car.js';

const car = new Car({ id: 1, team: 'blue' });
car.position.set(0, 0, C.CAR_REST_Z);
car.quaternion.copy(makeCarQuaternion(new THREE.Vector3(0, 1, 0)));
car.velocity.set(0, 0, 0);

const dt = C.PHYSICS_DT / C.PHYSICS_SUBSTEPS; // world steps cars at subDt
const mk = (over = {}) => ({ throttle: 1, steer: 0, pitch: -1, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false, ...over });

let events = [];
const run = (seconds, controls) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) events.push(...car.update(dt, controls));
};

// drive 2s to ~speed
run(2.0, mk());
const driveSpeed = car.velocity.length();
console.log(`after drive: speed=${driveSpeed.toFixed(0)} grounded=${car.isOnGround}`);

// first jump: hold space 0.05s, release 0.10s
run(0.05, mk({ jump: true }));
run(0.10, mk());
console.log(`after jump1: z=${car.position.z.toFixed(1)} vz=${car.velocity.z.toFixed(0)} grounded=${car.isOnGround} airTime=${car._airTime.toFixed(3)} usedDouble=${car._usedDoubleJump}`);

// second press with W held
const fwdBefore = car.velocity.clone(); fwdBefore.z = 0;
run(0.05, mk({ jump: true }));
console.log(`after press2: events=${JSON.stringify(events.map((e) => e.type))}`);
const fwdAfter = car.velocity.clone(); fwdAfter.z = 0;
console.log(`planar speed before=${fwdBefore.length().toFixed(0)} after=${fwdAfter.length().toFixed(0)} (expect +~500)`);
console.log(`dodgeTorqueT=${car._dodgeTorqueT.toFixed(2)} angVel=${car.angularVelocity.toArray().map((v) => v.toFixed(2))}`);

// let flip play out
run(0.5, mk());
const e = new THREE.Euler().setFromQuaternion(car.quaternion, 'ZYX');
console.log(`0.5s later: angVel len=${car.angularVelocity.length().toFixed(2)} pitch-ish=${e.x.toFixed(2)},${e.y.toFixed(2)} z=${car.position.z.toFixed(0)}`);
console.log(`dodge events: ${events.filter((ev) => ev.type === 'dodge').length}, jump events: ${events.filter((ev) => ev.type === 'jump').length}`);
