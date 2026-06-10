# Rocket Clone — Architecture Contract

Browser game: Rocket League 1v1 (player vs bot). Vanilla JS ES modules + three.js. **No TypeScript, no frameworks.**

**This file is the frozen contract.** `src/main.js` (already written) consumes every module exactly as specified here. Builders implement modules to satisfy `main.js` — read it before coding. `src/constants.js` (already written) holds all tunables; import from it, never hardcode a physics number that exists there.

## Coordinate system & units

- Physics AND render space are the same: **z-up, units = uu (1 cm)**. Field: x ∈ ±4096, y ∈ ±5120, z ∈ 0..2044.
- Blue team defends the y<0 goal and scores into y>0. Orange mirrors.
- The three.js scene uses z-up directly (`camera.up.set(0,0,1)`). No axis remapping anywhere.
- Car local frame: **+X forward, +Y left, +Z up** (right-handed). `car.quaternion` maps local→world.
- Use `THREE.Vector3` / `THREE.Quaternion` for all math (`import * as THREE from 'three'`).

## Shared shapes

```js
// controls (produced by InputManager and Bot, consumed by Car):
{ throttle: -1..1, steer: -1..1, pitch: -1..1, yaw: -1..1, roll: -1..1,
  jump: bool, boost: bool, handbrake: bool }   // jump/boost are HELD state; Car edge-detects internally

// pose:
{ position: THREE.Vector3, quaternion: THREE.Quaternion }

// event (returned in arrays from world/pads; consumed by state/effects/hud/sfx — ignore unknown types):
{ type: 'goal', team }                                  // team that SCORED
{ type: 'demo', victimId, attackerId, position }        // position: Vector3 clone
{ type: 'bump', carId, otherId, position }
{ type: 'ballHit', carId, speed, position }             // speed = relative impact speed
{ type: 'bounce', speed, position }                     // ball-arena impact, only when speed > 250
{ type: 'jump', carId } | { type: 'dodge', carId } | { type: 'land', carId, speed }
{ type: 'padPickup', carId, big, position }
```

## Modules & owners

### `src/physics/arena.js` — owner: physics-core
- `export function collideSphere(position, radius)` → `[{ normal: Vector3 (pushes object inward), depth: number }, ...]` (empty array if none).
  Surfaces: floor z=0, ceiling z=2044, walls x=±4096, goal walls y=±5120 **with goal aperture** (|x|<892.755 && z<642.775 → no wall contact; near-aperture-edge → goalpost/crossbar contact by clamping center to aperture rectangle border in the wall plane), 4 corner bevels |x|+|y|=8064, **fillets** (quarter-cylinder, R=300) between floor↔every wall plane and ceiling↔every wall plane (in the fillet zone emit the fillet contact, not the two plane contacts), goal interior box (side walls x=±892.755, roof z=642.775, back-of-net |y|=6000, floor continues).
- `export function raycast(origin, dir, maxDist)` → `{ point, normal, dist }` or `null`. Planes only is fine (used for car suspension). Must include floor, walls, corner bevels, ceiling, goal interior.
- `export function goalScored(ballPos)` → `null | 'blue' | 'orange'` — scoring team once ball center is past ±(5120 + BALL_RADIUS) in y (past +y line ⇒ 'blue' scored).

### `src/physics/ball.js` — owner: physics-core
- `export class Ball` — fields `position, velocity, angularVelocity` (Vector3s), `radius`.
  `update(dt)` → events. Gravity, linear drag (BALL_DRAG/s), arena collision with the Sam Mish bounce model:
  ```
  vPerp = (v·n)n ; vPara = v − vPerp ; vSpin = R·(n × ω) ; s = vPara + vSpin
  Δv = −(1+e)·vPerp  −  min(1, Y·|vPerp|/|s|)·μ·s          (e=0.6, μ=0.285, Y=2.0)
  ω += A·R·(Δv_para × n)                                    (A=0.0003)
  ```
  Also positional depenetration, BALL_MAX_SPEED / BALL_MAX_ANG_VEL caps, rest behavior (don't jitter on floor).

### `src/physics/car.js` — owner: physics-car
- `export class Car` — fields: `id, team, name, position (chassis center), velocity, angularVelocity, quaternion, boost (0..100), isOnGround, isSupersonic, isDemolished, lastControls`. Getters `forward, up, right` → world-space Vector3.
  `update(dt, controls)` → events. Skips everything if `isDemolished`.
  - **Ground**: suspension ray from chassis center along −up (maxDist ≈ CAR_REST_Z + 30) via `arena.raycast`; grounded if hit && surface normal·up > 0.4. Spring to hover height CAR_REST_Z (critically damped-ish), align car up→surface normal (slerp rate ~10/s). Throttle via THROTTLE_ACCEL_CURVE, brake when throttle opposes velocity, coast decel. Yaw rate = forwardSpeed × curveLerp(STEER_CURVE) × steer (sign flips in reverse). Lateral velocity killed at LATERAL_GRIP rate (HANDBRAKE_GRIP multiplier while handbrake → drifts). STICKY_FORCE along −up while grounded (enables wall driving). Gravity always world −z.
  - **Air**: torques (AIR_TORQUE_*) by pitch/yaw/roll inputs, damping (AIR_DAMP_*; pitch damping only when no pitch input). Quaternion integrated from angularVelocity.
  - **Jumps**: first jump = JUMP_IMPULSE along up + JUMP_HOLD_ACCEL while held ≤0.2s. Within DOUBLE_JUMP_WINDOW after leaving ground: second press with no directional input → DOUBLE_JUMP_IMPULSE; with directional input → **dodge**: planar impulse DODGE_IMPULSE in input direction (car-relative, backward ×1.33), zero vertical velocity component first, flip torque (DODGE_ANG_VEL around the matching axis) for DODGE_TORQUE_TIME.
  - **Boost**: BOOST_ACCEL along forward while held && boost>0, consumes 33.3/s, works in air, allows exceeding 1410 up to 2300 cap.
  - Caps: CAR_MAX_SPEED (clamp |v|), CAR_MAX_ANG_VEL. Supersonic hysteresis (SUPERSONIC_ON/OFF).
  - Chassis-vs-arena: collide 4 spheres (r = CAR_HEIGHT/2) at hitbox corners via `arena.collideSphere`, restitution 0.3.
- `export function makeCarQuaternion(forwardVec3)` → Quaternion with +X→forward (z-up). Used by spawns.

### `src/physics/carBall.js` — owner: physics-car
- `export function collideCarBall(car, ball)` → `null | { speed, position }`. OBB (CAR_LENGTH×CAR_WIDTH×CAR_HEIGHT at car pose) vs sphere. Depenetrate ball; impulse with mass ratio 180:30, restitution ≈0; then add **Psyonix impulse**: dir = normalize(ballPos−carPos with z×0.35), magnitude = |relVel| × curveLerp(BALL_HIT_SCALE_CURVE, |relVel|), applied to ball velocity. Small reaction on car (×0.35). Ball spin from tangential contact.

### `src/physics/carCar.js` — owner: physics-car
- `export function collideCarCar(a, b)` → `null | { type: 'bump'|'demo', attacker, victim, position }` (attacker/victim = Car refs). Contact test: spheres r≈55 at each chassis center (skip if either demolished). Demo: attacker `isSupersonic` && normalize(attacker.velocity)·normalize(victim.pos−attacker.pos) > DEMO_ALIGNMENT — faster car is attacker. Else bump: exchange impulses along contact normal ×BUMP_IMPULSE_SCALE, depenetrate.

### `src/physics/world.js` — owner: physics-core
- `export class World`:
  - `ball` (Ball), `cars` (Car[]).
  - `addCar({ team, name })` → Car (assigns unique `id`, ints).
  - `step(dt, controlsById, { freeze })` → events. `controlsById` = plain object id→controls. If `freeze`: skip ALL integration, return []. Runs PHYSICS_SUBSTEPS substeps: ball.update, car.update each, collideCarBall pairs, collideCarCar pairs (demo ⇒ set `victim.isDemolished = true`, emit), goalScored check **latched** (emit 'goal' once; clear latch only in resetKickoff).
  - `resetKickoff({ blue: [pose...], orange: [pose...] })` — ball to (0,0,BALL_RADIUS) zero vel/spin; each team's cars to poses in order; zero velocities; boost = BOOST_SPAWN_AMOUNT; clears demolished states & goal latch.
  - `respawnCar(id, pose)` — clears isDemolished, sets pose, zero velocities, boost = BOOST_SPAWN_AMOUNT.

### `src/game/spawns.js` — owner: game
- `export function pickKickoffSpawns(numPerTeam)` → `{ blue: [pose...], orange: [pose...] }`. Random mirrored selection from KICKOFF_SPAWNS_BLUE (no duplicates); cars **face the ball** (origin). Uses `makeCarQuaternion`. z = CAR_REST_Z.
- `export function respawnPose(team)` → pose. Random RESPAWN_POINTS_BLUE (mirrored for orange), facing midfield.

### `src/game/input.js` — owner: game
- `export class InputManager` — constructor(). Keyboard + Gamepad API (poll in `getControls`).
  - `getControls()` → controls. Keyboard: W/S throttle (and pitch: S=nose up? **W = pitch down/nose-down? No — RL keyboard: W=forward & pitch nose-down in air; S = reverse & nose-up**), A/D steer+yaw, Q/E air roll, Space jump, Shift boost, X handbrake. Arrow keys mirror WASD.
  - Gamepad (standard mapping): left stick steer/pitch/yaw, A(0) jump, B(1) boost, X(2) handbrake+air-roll-modifier (stick X becomes roll while held), RT(7) throttle, LT(6) reverse, Y(3) ball cam.
  - `pollToggles()` → `{ ballCam, pause, mute, help, restart }` — true only on the frame the key was pressed (C=ballCam, P/Esc=pause, M=mute, H=help, Enter=restart). Include gamepad Y → ballCam, Start(9) → pause.
- `export function zeroControls()` → all-zero controls object.

### `src/game/state.js` — owner: game
- `export class MatchState`:
  - Fields: `phase` ('countdown'|'play'|'goalPause'|'over'), `score {blue, orange}`, `clock` (sec remaining; counts UP in overtime), `overtime` (bool), `countdownT`, `winner` (null|team), `lastGoalTeam`.
  - `update(dt, events)` → actions: `[{ type: 'resetKickoff' }]` and/or `[{ type: 'matchEnd', winner }]`. Flow: countdown(3s, frozen) → play (clock runs) → on 'goal' event: score++, goalPause(3.5s) → emit resetKickoff → countdown → … Clock hits 0 during play: tied ⇒ overtime (golden goal, clock counts up from 0, kickoff reset first via resetKickoff + countdown); else phase 'over', winner set, matchEnd action.
  - `isFrozen()` → phase === 'countdown'.
  - `reset()` → fresh match (score 0-0, clock MATCH_LENGTH, countdown phase).
  - Construct in countdown phase.

### `src/game/boostPads.js` — owner: game
- `export class BoostPads` — `pads`: `[{ position: Vector3 (z=0), big, active, cooldown }]` from BIG_PADS/SMALL_PADS.
  - `update(dt, cars)` → padPickup events. Pickup: car not demolished, horizontal dist < pad radius, car z < PAD_HEIGHT, pad active, car.boost < 100 → add amount (clamp 100), deactivate for cooldown.
  - `reset()` — all active.

### `src/game/bot.js` — owner: bot-audio
- `export class Bot` — `constructor(car, world, boostPads)`; `update(dt, phase)` → controls.
  States: kickoff rush (phase 'countdown'→'play' start: drive at ball, boost, dodge into it close), attack (drive through ball toward opponent goal: target = ball + offset away from goal line), defend/retreat when ball is behind it relative to own goal, grab nearest active big pad when boost < 25 and ball far, opportunistic demo if player car nearly in path, jump/dodge to hit ball when close & reachable (ball z < 250), powerslide for sharp turns, recovery (orient wheels-down) in air. Must drive competently: aim with steer proportional control, boost on long straights, never get stuck in corners (if speed < 100 for >1s, reverse-turn for 0.7s).

### `src/render/scene.js` — owner: render
- `export class SceneManager` — `constructor(canvas)`. WebGLRenderer (antialias, shadows PCFSoft), `scene` (fog, bg), `camera` (PerspectiveCamera fov 80, far 40000, up=(0,0,1)), stadium lighting (hemisphere + directional w/ shadow + goal-colored accents), bloom via EffectComposer (UnrealBloomPass, threshold ~0.85) — import from 'three/addons/...'. `render(dt)`, auto-resize.

### `src/render/arenaMesh.js` — owner: render
- `export function createArenaMesh()` → THREE.Group. **Elaborate**: striped pitch (procedural canvas texture) w/ field lines (center circle, halfway line, goal boxes), team-tinted goal zones, walls with emissive panel/hex detailing, 45° corner bevel walls, semi-transparent upper "glass" with stadium stands + animated-feel crowd dot lights behind, ceiling truss/girders, glowing goal frames (blue/orange) + visible net + goal interior box, floodlight towers, ad-board strips with emissive text ("ROCKET CLONE" etc. via canvas textures), subtle skybox gradient. Receives shadows. Geometry must MATCH collision dims from constants (walls at ±4096/±5120, bevels |x|+|y|=8064, ceiling 2044, goals 892.755×642.775×880).

### `src/render/ballMesh.js` — owner: render
- `export class BallVisual` — `mesh` (Group). Soccer-ball-like w/ emissive seam glow, radius BALL_RADIUS, casts shadow. `update(ball, dt)`: position + integrate visual spin from ball.angularVelocity.

### `src/render/carMesh.js` — owner: render
- `export class CarVisual` — `constructor(team)`; `mesh` (Group). Procedural Octane-ish body (~118×84×36 uu, +X forward): chassis, cabin, 4 wheels (spin with speed, front steer with controls.steer), team paint + emissive trim, boost nozzle at rear. `update(car, dt)`: pose copy, wheel anim from car.velocity/lastControls, `visible = !car.isDemolished`. `nozzleWorldPos()` → Vector3.

### `src/render/camera.js` — owner: render
- `export class CameraRig` — `constructor(camera)`. `update(dt, { car, ball, ballCam, phase })`. Ball cam ON: camera sits behind car on the car→ball line (dist ~430, height ~120), looks at ball. OFF: chase cam behind car velocity/facing, looks ahead of car. Smooth (exp damping), never below z=20. phase 'goalPause': slow orbit around ball. Handles demolished car (orbit ball).

### `src/render/effects.js` — owner: render
- `export class Effects` — `constructor(scene)`.
  - `attachPads(boostPads)` — glowing discs/orbs per pad (big = tall orb), bright when active, dim+shrunk on cooldown; updated in `update`.
  - `update(dt, { cars, ball, visuals })` — visuals: Map carId→CarVisual. Boost flame + trail when car.lastControls.boost && boost>0 (at nozzleWorldPos), supersonic speed streaks, ball trail when |ball.velocity| > 2000.
  - `handleEvents(events)` — goal: explosion particle burst + expanding shockwave ring (team color); demo: orange/black burst; ballHit > 1000: small impact sparks; land/bounce: dust puff.
  - `reset()` — clear transient particles/trails.
- Particles: THREE.Points or small instanced meshes; pooled; must not leak.

### `src/render/hud.js` — owner: game
- `export class HUD` — `constructor(rootEl, playerCarId)` builds all DOM inside rootEl (inject own `<style>`; RL-style angular/skewed scoreboard). Uses playerCarId to tell player events from bot events.
  - Scoreboard top-center: blue score | clock (m:ss, red+"OT" in overtime) | orange score.
  - Bottom-right: boost gauge (big number + circular arc), speed bar w/ SUPERSONIC flash state.
  - `update(dt, { state, playerCar, ball })`.
  - `handleEvents(events)` — "GOAL!" banner w/ team color, demo notice ("DEMOLISHED!" if victim is player / "DEMOLITION!" if attacker), pad pickup +12/+100 float.
  - Countdown overlay 3-2-1-GO from state.countdownT; goalPause shows banner; phase 'over' → win/lose screen + "Press Enter to restart"; pause overlay via `setPaused(bool)`; help overlay via `toggleHelp()` (keyboard+gamepad table, shown on boot until first input).

### `src/audio/sfx.js` — owner: bot-audio
- `export class SFX` — all WebAudio, fully procedural (no asset files). `constructor(playerCarId)` lazy AudioContext (resume on first user gesture — install own listener).
  - `update(dt, { playerCar, ball, state })` — engine loop (pitch w/ speed), boost roar while player boosting, supersonic wind, countdown beeps + GO blip (track state.countdownT transitions internally), overtime sting.
  - `handleEvents(events)` — ball hit thump (gain ∝ speed), bounce, goal: horn + crowd cheer swell (noise), demo explosion, jump/dodge whoosh, pad blip (player only).
  - `toggleMute()` → bool (new state).

## Style rules (all builders)
- Plain ES modules, JSDoc where signatures aren't obvious. No external deps beyond `three`.
- Import constants from `../constants.js` — never duplicate values.
- No `console.log` left in. No per-frame allocations in hot loops where avoidable (reuse scratch Vector3s).
- Each module file is self-contained; ONLY touch the files you own.
