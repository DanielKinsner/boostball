// Rocket League physics constants. Units: Unreal Units (uu), 1 uu = 1 cm.
// Everything (physics AND rendering) works in uu. Z is up in physics space;
// the renderer maps physics (x, y, z) -> three.js (x, z-up via rotation) — see render/scene.js.
// We use THREE.Vector3 with .x/.y lateral and .z up throughout physics code.

// ---------- World ----------
export const GRAVITY = 650;            // uu/s^2, downward (-z)
export const PHYSICS_DT = 1 / 120;     // fixed physics timestep
export const PHYSICS_SUBSTEPS = 2;     // substeps per step() call

// ---------- Arena (standard Soccar field, DFH Stadium dimensions) ----------
export const ARENA_HALF_WIDTH = 4096;   // |x| wall
export const ARENA_HALF_LENGTH = 5120;  // |y| wall (goal walls)
export const ARENA_HEIGHT = 2044;       // ceiling z
export const CORNER_WALL_DIST = 8064;   // corner bevel plane: |x| + |y| <= 8064 (45 deg)
export const FLOOR_Z = 0;

// Goals (opening in each y wall)
export const GOAL_HALF_WIDTH = 892.755; // |x| < this is inside goal mouth
export const GOAL_HEIGHT = 642.775;     // z < this is inside goal mouth
export const GOAL_DEPTH = 880;          // goal box extends to |y| = 5120 + 880 = 6000

// ---------- Ball ----------
export const BALL_RADIUS = 91.25;
export const BALL_MASS = 30;
export const BALL_RESTITUTION = 0.6;        // normal bounce coefficient
export const BALL_FRICTION_MU = 0.285;      // tangential bounce friction (Sam Mish model)
export const BALL_FRICTION_Y = 2.0;         // ratio clamp factor in bounce friction
export const BALL_SPIN_A = 0.0003;          // angular impulse coupling on bounce
export const BALL_DRAG = 0.03;            // linear damping per second
export const BALL_MAX_SPEED = 6000;
export const BALL_MAX_ANG_VEL = 6.0;        // rad/s

// ---------- Car (Octane hitbox) ----------
export const CAR_LENGTH = 118.01;
export const CAR_WIDTH = 84.2;
export const CAR_HEIGHT = 36.16;
export const CAR_MASS = 180;
export const CAR_REST_Z = 17.0;            // chassis center height when resting on ground
export const CAR_MAX_SPEED = 2300;          // hard cap on |velocity|
export const CAR_MAX_ANG_VEL = 5.5;         // rad/s hard cap
export const SUPERSONIC_ON = 2200;          // becomes supersonic at/above
export const SUPERSONIC_OFF = 2100;         // stops being supersonic below (hysteresis)

// Ground driving
export const THROTTLE_MAX_SPEED = 1410;     // max speed from throttle alone
// Throttle acceleration curve: linear interp on (speed -> accel uu/s^2)
export const THROTTLE_ACCEL_CURVE = [
  [0, 1600],
  [1400, 160],
  [1410, 0],
];
export const BRAKE_ACCEL = 3500;            // braking deceleration
export const COAST_DECEL = 525;             // coasting deceleration
// Steering curvature curve (speed -> curvature 1/uu); angular speed = v * k * steer
export const STEER_CURVE = [
  [0, 0.0069],
  [500, 0.00398],
  [1000, 0.00235],
  [1500, 0.001375],
  [1750, 0.0011],
  [2500, 0.00088],
];
export const HANDBRAKE_GRIP = 0.18;         // lateral grip multiplier while powersliding (1 = full grip)
export const LATERAL_GRIP = 1.0;            // normal lateral friction strength (fraction of lateral vel killed per ~0.05s)
export const STICKY_FORCE = 325;            // extra downward accel while grounded (wall driving stick)

// Boost
export const BOOST_ACCEL = 991.667;         // uu/s^2 while boosting on ground (2975/3)
export const BOOST_ACCEL_AIR = 1058.333;    // uu/s^2 while boosting airborne (3175/3)
export const BOOST_CONSUMPTION = 33.3;      // boost units per second
export const BOOST_MAX = 100;
export const BOOST_SPAWN_AMOUNT = 33.3;     // boost at kickoff/respawn
export const SMALL_PAD_AMOUNT = 12;
export const BIG_PAD_AMOUNT = 100;
export const SMALL_PAD_COOLDOWN = 4;        // seconds
export const BIG_PAD_COOLDOWN = 10;
export const SMALL_PAD_RADIUS = 144;        // pickup cylinder radius
export const BIG_PAD_RADIUS = 208;
export const PAD_HEIGHT = 165;              // pickup cylinder height

// Jumps / dodges
export const JUMP_IMPULSE = 292;            // instant z-velocity (car-up) on jump press
export const JUMP_HOLD_ACCEL = 1458;        // extra accel while holding jump
export const JUMP_HOLD_MAX_TIME = 0.2;      // seconds of hold force
export const DOUBLE_JUMP_IMPULSE = 292;
export const DOUBLE_JUMP_WINDOW = 1.25;     // seconds after leaving ground to use 2nd jump/dodge
export const DODGE_IMPULSE = 500;           // planar velocity impulse on dodge
export const DODGE_BACKWARD_SCALE = 2.5;    // backward dodges (RocketSim FLIP_BACKWARD_IMPULSE_MAX_SPEED_SCALE)
export const DODGE_SIDE_SCALE = 1.9;        // sideways dodges
export const DODGE_TORQUE_TIME = 0.65;      // flip animation/torque duration
export const DODGE_ANG_VEL = 5.5;           // flip angular speed rad/s

// Air control torques (rad/s^2) and damping (rad/s^2 per rad/s) — RLUtilities values
export const AIR_TORQUE_PITCH = 12.146;
export const AIR_TORQUE_YAW = 8.92;
export const AIR_TORQUE_ROLL = 36.08;
export const AIR_DAMP_PITCH = 2.798;  // only when no pitch input
export const AIR_DAMP_YAW = 1.886;
export const AIR_DAMP_ROLL = 4.47;

// Car-ball interaction ("Psyonix impulse")
export const BALL_HIT_Z_SCALE = 0.35;       // flatten contact dir z before extra impulse
// rel-speed -> impulse scale factor (multiplied by rel speed and ball mass / not car mass)
export const BALL_HIT_SCALE_CURVE = [
  [0, 0.65],
  [500, 0.65],
  [2300, 0.55],
  [4600, 0.30],
];

// Demos / bumps
export const DEMO_SPEED = 2200;             // attacker must be supersonic
export const DEMO_ALIGNMENT = 0.45;         // dot(attacker vel dir, dir to victim) threshold
export const DEMO_RESPAWN_TIME = 3;         // seconds
export const BUMP_IMPULSE_SCALE = 0.65;     // non-demo bump strength factor

// ---------- Match ----------
export const MATCH_LENGTH = 300;            // 5 minutes
export const KICKOFF_COUNTDOWN = 3;         // seconds
export const GOAL_PAUSE_TIME = 3.5;         // celebration pause before kickoff reset

// Teams: blue defends y < 0 goal (scores into y > 0), orange defends y > 0.
export const TEAM_BLUE = 'blue';
export const TEAM_ORANGE = 'orange';

// Kickoff spawns for blue (negative y half). Orange mirrors (negate x and y).
// On kickoff every car FACES THE BALL (origin) — compute facing from position, no yaw stored.
export const KICKOFF_SPAWNS_BLUE = [
  { x: -2048, y: -2560 }, // right corner
  { x: 2048, y: -2560 },  // left corner
  { x: -256, y: -3840 },  // back right
  { x: 256, y: -3840 },   // back left
  { x: 0, y: -4608 },     // far back
];
// Demo/post-goal respawn points for blue (orange mirrors). Cars face midfield (+y for blue).
export const RESPAWN_POINTS_BLUE = [
  { x: -2304, y: -4608 },
  { x: -1152, y: -4608 },
  { x: 1152, y: -4608 },
  { x: 2304, y: -4608 },
];

// Boost pad layout (standard Soccar). Big pads give 100, small give 12.
export const BIG_PADS = [
  { x: -3584, y: 0 }, { x: 3584, y: 0 },
  { x: -3072, y: -4096 }, { x: 3072, y: -4096 },
  { x: -3072, y: 4096 }, { x: 3072, y: 4096 },
];
export const SMALL_PADS = [
  { x: 0, y: -4240 }, { x: -1792, y: -4184 }, { x: 1792, y: -4184 },
  { x: -940, y: -3308 }, { x: 940, y: -3308 }, { x: 0, y: -2816 },
  { x: -3584, y: -2484 }, { x: 3584, y: -2484 },
  { x: -1788, y: -2300 }, { x: 1788, y: -2300 },
  { x: -2048, y: -1036 }, { x: 0, y: -1024 }, { x: 2048, y: -1036 },
  { x: -1024, y: 0 }, { x: 1024, y: 0 },
  { x: 0, y: 4240 }, { x: -1792, y: 4184 }, { x: 1792, y: 4184 },
  { x: -940, y: 3308 }, { x: 940, y: 3308 }, { x: 0, y: 2816 },
  { x: -3584, y: 2484 }, { x: 3584, y: 2484 },
  { x: -1788, y: 2300 }, { x: 1788, y: 2300 },
  { x: -2048, y: 1036 }, { x: 0, y: 1024 }, { x: 2048, y: 1036 },
];

// Utility: piecewise-linear curve lookup
export function curveLerp(curve, x) {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (x <= curve[i][0]) {
      const [x0, y0] = curve[i - 1];
      const [x1, y1] = curve[i];
      return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
    }
  }
  return curve[curve.length - 1][1];
}
