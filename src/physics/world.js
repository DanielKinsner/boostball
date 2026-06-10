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
  ARENA_HALF_LENGTH,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  GRAVITY,
  TEAM_BLUE,
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

      // 3. Car-ball collisions. Tick per-car ball-contact cooldown so the
      // Psyonix kick only fires once per hit event, not every substep an
      // embedded car keeps overlapping the ball.
      for (const car of this.cars) {
        if (car.isDemolished) continue;
        if (car._ballContactCooldown > 0) {
          car._ballContactCooldown -= subDt;
          if (car._ballContactCooldown < 0) car._ballContactCooldown = 0;
        }
        const result = collideCarBall(car, this.ball);
        if (result) {
          const meta = classifyBallHit(car, this.ball, result);
          events.push({
            type: 'ballHit',
            carId: car.id,
            team: car.team,
            speed: result.speed,
            postBallSpeed: result.postBallSpeed,
            power: result.power,
            aerial: result.aerial,
            dodge: result.dodge,
            soft: result.soft,
            front: result.front,
            shot: meta.shot,
            save: meta.save,
            clear: meta.clear,
            mechanic: meta.mechanic,
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
      // Clear transient Car-private state so leftover jump/dodge timers from a
      // mid-air demolish don't suppress controls on respawn.
      car._jumpHoldT = 0;
      car._holdingJump = false;
      car._airTime = 0;
      car._usedDoubleJump = false;
      car._jumpedSinceGround = false;
      car._timeSinceJump = 0;
      car._dodgeTorqueT = 0;
      car._jumpPrev = false;
      car._groundLockoutT = 0;
      car._wasOnGround = true;
      car._groundNormal.set(0, 0, 1);
      car.isOnGround = true;
      car.isSupersonic = false;
      car._ballContactCooldown = 0;
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
    // Clear transient Car-private state so leftover jump/dodge timers from a
    // mid-air demolish don't suppress controls on respawn.
    car._jumpHoldT = 0;
    car._holdingJump = false;
    car._airTime = 0;
    car._usedDoubleJump = false;
    car._jumpedSinceGround = false;
    car._timeSinceJump = 0;
    car._dodgeTorqueT = 0;
    car._jumpPrev = false;
    car._groundLockoutT = 0;
    car._wasOnGround = true;
    car._groundNormal.set(0, 0, 1);
    car.isOnGround = true;
    car.isSupersonic = false;
    car._ballContactCooldown = 0;
  }
}

function classifyBallHit(car, ball, result) {
  const shotSign = car.team === TEAM_BLUE ? 1 : -1;
  const ownSign = -shotSign;
  const shot = isShotOnTarget(ball.position, ball.velocity, shotSign, result.postBallSpeed);

  const onOwnHalf = ball.position.y * ownSign > ARENA_HALF_LENGTH * 0.45;
  const nearOwnMouth =
    onOwnHalf &&
    Math.abs(ball.position.y) > ARENA_HALF_LENGTH * 0.58 &&
    Math.abs(ball.position.x) < GOAL_HALF_WIDTH * 2.2;
  const wasThreatening =
    nearOwnMouth &&
    result.preBallVelY * ownSign > 650;
  const nowRelieved =
    result.postBallVelY * ownSign < 250 ||
    result.postBallVelY * shotSign > 450;
  const save = wasThreatening && nowRelieved;
  const clear = !save && onOwnHalf && result.postBallVelY * shotSign > 700;

  let mechanic = 'touch';
  if (save) mechanic = 'save';
  else if (shot) mechanic = 'shot';
  else if (result.dodge && result.power > 0.35) mechanic = 'flip';
  else if (result.aerial && result.power > 0.25) mechanic = 'aerial';
  else if (clear) mechanic = 'clear';
  else if (result.soft) mechanic = 'soft';
  else if (result.power > 0.72) mechanic = 'power';

  return { shot, save, clear, mechanic };
}

function isShotOnTarget(position, velocity, sign, speed) {
  if (speed < 900) return false;
  if (velocity.y * sign <= 650) return false;

  const goalY = sign * ARENA_HALF_LENGTH;
  const distToGoalPlane = goalY - position.y;
  if (distToGoalPlane * sign <= 0) return false;
  const t = distToGoalPlane / velocity.y;
  if (!isFinite(t) || t < 0 || t > 3.5) return false;

  const xAtGoal = position.x + velocity.x * t;
  const zAtGoal = position.z + velocity.z * t - 0.5 * GRAVITY * t * t;
  return (
    Math.abs(xAtGoal) < GOAL_HALF_WIDTH * 1.22 &&
    zAtGoal > BALL_RADIUS * 0.35 &&
    zAtGoal < GOAL_HEIGHT + BALL_RADIUS * 1.2
  );
}
