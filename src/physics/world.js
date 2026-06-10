// World — orchestrates the ball, cars, and inter-entity collisions across PHYSICS_SUBSTEPS
// substeps per step() call. Emits a flat event array per step (in order of occurrence within
// the step). Goal events are LATCHED — after one 'goal' fires, no further goals emit until
// resetKickoff() clears the latch.
//
// Contract reminders:
//   - addCar({team, name}) assigns a unique integer id and pushes onto this.cars.
//   - step(dt, controlsById, { freeze }) — if `freeze`, returns [] without integrating.
//   - resetKickoff({ blue: [pose...], orange: [pose...] }) — first car in each team list gets
//     spawn[0], second gets spawn[1], etc. Ball reset to (0,0,BALL_RADIUS).
//   - respawnCar(id, pose) — undemo + pose + zero velocities + spawn boost.
//
// Demolished cars are skipped from car-ball and car-car collisions and from update() (the Car
// itself handles its own isDemolished short-circuit, but we belt-and-braces skip them here too).

import {
  PHYSICS_SUBSTEPS,
  BOOST_SPAWN_AMOUNT,
  BALL_RADIUS,
} from '../constants.js';
import { Ball } from './ball.js';
import { goalScored } from './arena.js';
import { Car } from './car.js';
import { collideCarBall } from './carBall.js';
import { collideCarCar } from './carCar.js';

// Zero-controls fallback for when a car has no entry in controlsById.
const ZERO_CONTROLS = Object.freeze({
  throttle: 0,
  steer: 0,
  pitch: 0,
  yaw: 0,
  roll: 0,
  jump: false,
  boost: false,
  handbrake: false,
});

export class World {
  constructor() {
    this.ball = new Ball();
    this.cars = [];
    this._nextId = 1;
    this._goalLatched = false;
  }

  /** Create a new Car and append it to this.cars. */
  addCar({ team, name }) {
    const id = this._nextId++;
    const car = new Car({ id, team, name });
    car.id = id;
    car.team = team;
    car.name = name;
    car.boost = BOOST_SPAWN_AMOUNT;
    car.isDemolished = false;
    this.cars.push(car);
    return car;
  }

  /**
   * Run physics for `dt` seconds across PHYSICS_SUBSTEPS substeps. Returns aggregated events.
   * If options.freeze is truthy, returns [] without integrating anything (countdown phase).
   */
  step(dt, controlsById, options) {
    const freeze = !!(options && options.freeze);
    if (freeze) return [];

    const events = [];
    const subDt = dt / PHYSICS_SUBSTEPS;

    for (let s = 0; s < PHYSICS_SUBSTEPS; s++) {
      // 1. Ball integration
      const ballEvents = this.ball.update(subDt);
      if (ballEvents && ballEvents.length) {
        for (const e of ballEvents) events.push(e);
      }

      // 2. Car integration (skip demolished cars)
      for (const car of this.cars) {
        if (car.isDemolished) continue;
        const ctrl = controlsById[car.id] || ZERO_CONTROLS;
        const carEvents = car.update(subDt, ctrl);
        if (carEvents && carEvents.length) {
          for (const e of carEvents) events.push(e);
        }
      }

      // 3. Car-ball collisions
      for (const car of this.cars) {
        if (car.isDemolished) continue;
        const result = collideCarBall(car, this.ball);
        if (result) {
          events.push({
            type: 'ballHit',
            carId: car.id,
            speed: result.speed,
            position: result.position,
          });
        }
      }

      // 4. Car-car collisions (skip if either demolished)
      for (let i = 0; i < this.cars.length; i++) {
        const a = this.cars[i];
        if (a.isDemolished) continue;
        for (let j = i + 1; j < this.cars.length; j++) {
          const b = this.cars[j];
          if (b.isDemolished) continue;
          const result = collideCarCar(a, b);
          if (!result) continue;
          if (result.type === 'demo') {
            result.victim.isDemolished = true;
            events.push({
              type: 'demo',
              victimId: result.victim.id,
              attackerId: result.attacker.id,
              position: result.position,
            });
          } else if (result.type === 'bump') {
            events.push({
              type: 'bump',
              carId: result.attacker.id,
              otherId: result.victim.id,
              position: result.position,
            });
          }
        }
      }

      // 5. Goal check (latched)
      if (!this._goalLatched) {
        const scoredBy = goalScored(this.ball.position);
        if (scoredBy) {
          this._goalLatched = true;
          events.push({ type: 'goal', team: scoredBy });
        }
      }
    }

    return events;
  }

  /**
   * Reset for kickoff. Ball returns to center on the floor; each team's cars are placed at the
   * provided poses in order (extras are left in place). All velocities zeroed, boost restored
   * to spawn amount, demolished states cleared, goal latch cleared.
   */
  resetKickoff(spawns) {
    this.ball.position.set(0, 0, BALL_RADIUS);
    this.ball.velocity.set(0, 0, 0);
    this.ball.angularVelocity.set(0, 0, 0);

    const bluePoses = (spawns && spawns.blue) || [];
    const orangePoses = (spawns && spawns.orange) || [];
    const blueIdx = { i: 0 };
    const orangeIdx = { i: 0 };

    for (const car of this.cars) {
      const poses = car.team === 'orange' ? orangePoses : bluePoses;
      const idx = car.team === 'orange' ? orangeIdx : blueIdx;
      const pose = poses[idx.i++];
      if (pose) {
        car.position.copy(pose.position);
        car.quaternion.copy(pose.quaternion);
      }
      car.velocity.set(0, 0, 0);
      car.angularVelocity.set(0, 0, 0);
      car.boost = BOOST_SPAWN_AMOUNT;
      car.isDemolished = false;
      // Clear transient car state that may have been set by the Car class.
      if (typeof car._jumpHoldT === 'number') car._jumpHoldT = 0;
      if (typeof car._airTimer === 'number') car._airTimer = 0;
      if (typeof car._dodgeTimer === 'number') car._dodgeTimer = 0;
    }

    this._goalLatched = false;
  }

  /**
   * Respawn a single car (after demo timer). Pose-only — does not touch the ball or goal latch.
   */
  respawnCar(id, pose) {
    const car = this.cars.find((c) => c.id === id);
    if (!car) return;
    car.position.copy(pose.position);
    car.quaternion.copy(pose.quaternion);
    car.velocity.set(0, 0, 0);
    car.angularVelocity.set(0, 0, 0);
    car.boost = BOOST_SPAWN_AMOUNT;
    car.isDemolished = false;
    if (typeof car._jumpHoldT === 'number') car._jumpHoldT = 0;
    if (typeof car._airTimer === 'number') car._airTimer = 0;
    if (typeof car._dodgeTimer === 'number') car._dodgeTimer = 0;
  }
}
