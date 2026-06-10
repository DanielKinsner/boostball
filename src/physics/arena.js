// Analytic collision against the arena interior.
// Coordinate system: z-up, x in ±ARENA_HALF_WIDTH, y in ±ARENA_HALF_LENGTH, z in 0..ARENA_HEIGHT.
// Corner bevels at 45° satisfy |x| + |y| = CORNER_WALL_DIST.
// Quarter-cylinder fillets of radius R round floor↔(any vertical plane) and ceiling↔(any vertical plane).
// Goal aperture in each |y|=ARENA_HALF_LENGTH wall: |x|<GOAL_HALF_WIDTH && z<GOAL_HEIGHT.
// Inside that aperture rectangle the wall is absent; near its border the sphere collides with the
// goal-frame "post/crossbar" formed by clamping its center to the rectangle border in the wall plane.
//
// All exported functions are pure and allocate only short-lived THREE.Vector3 instances. Hot paths
// (collideSphere) reuse module-scratch vectors where possible.

import * as THREE from 'three';
import {
  ARENA_HALF_WIDTH,
  ARENA_HALF_LENGTH,
  ARENA_HEIGHT,
  CORNER_WALL_DIST,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  GOAL_DEPTH,
} from '../constants.js';

const FILLET_R = 300;
const SQRT2_INV = 1 / Math.SQRT2;
const GOAL_BACK_Y = ARENA_HALF_LENGTH + GOAL_DEPTH; // 6000

// Inward-facing plane: n is unit, d is plane offset such that signed dist of point p is (p·n − d).
// Interior of arena is where (p·n − d) ≥ 0 for every plane.
//
// Vertical walls / bevels — these are the planes participating in fillets with floor/ceiling.
// Each has nz = 0 so they form proper quarter cylinders with the horizontal planes.
const VERTICAL_PLANES = [
  // +X wall, normal points −X
  { nx: -1, ny: 0, nz: 0, d: -ARENA_HALF_WIDTH, kind: 'wallX', sign: +1 },
  // −X wall, normal points +X
  { nx: 1, ny: 0, nz: 0, d: -ARENA_HALF_WIDTH, kind: 'wallX', sign: -1 },
  // +Y wall (blue scores into this), normal points −Y. Has goal aperture.
  { nx: 0, ny: -1, nz: 0, d: -ARENA_HALF_LENGTH, kind: 'goalWall', sign: +1 },
  // −Y wall, normal points +Y. Has goal aperture.
  { nx: 0, ny: 1, nz: 0, d: -ARENA_HALF_LENGTH, kind: 'goalWall', sign: -1 },
  // Four 45° corner bevels |x|+|y| = CORNER_WALL_DIST. Inward normal points toward origin.
  { nx: -SQRT2_INV, ny: -SQRT2_INV, nz: 0, d: -CORNER_WALL_DIST * SQRT2_INV, kind: 'bevel', sx: +1, sy: +1 },
  { nx: +SQRT2_INV, ny: -SQRT2_INV, nz: 0, d: -CORNER_WALL_DIST * SQRT2_INV, kind: 'bevel', sx: -1, sy: +1 },
  { nx: -SQRT2_INV, ny: +SQRT2_INV, nz: 0, d: -CORNER_WALL_DIST * SQRT2_INV, kind: 'bevel', sx: +1, sy: -1 },
  { nx: +SQRT2_INV, ny: +SQRT2_INV, nz: 0, d: -CORNER_WALL_DIST * SQRT2_INV, kind: 'bevel', sx: -1, sy: -1 },
];

// Goal interior walls (only relevant when |y| > ARENA_HALF_LENGTH and ball/car is inside the box).
// Side walls x = ±GOAL_HALF_WIDTH (inward = toward x=0), roof z = GOAL_HEIGHT, back of net |y| = GOAL_BACK_Y.
const GOAL_INTERIOR_PLANES = [
  { nx: -1, ny: 0, nz: 0, d: -GOAL_HALF_WIDTH, kind: 'goalSide' },  // +X side, push −X
  { nx: 1, ny: 0, nz: 0, d: -GOAL_HALF_WIDTH, kind: 'goalSide' },   // −X side, push +X
  { nx: 0, ny: 0, nz: -1, d: -GOAL_HEIGHT, kind: 'goalRoof' },      // roof, push down
  // Back of net in either goal — orientation determined per-call from sphere y sign.
];

// Module-scratch vectors to avoid per-call allocation in hot paths.
const _vTmp = new THREE.Vector3();
const _vTmp2 = new THREE.Vector3();

/**
 * Determine whether a point (px,py,pz) projected onto a y-wall is inside the goal aperture.
 * Returns true if the open aperture entirely contains the sphere's center (in wall-plane coords).
 */
function pointInAperture(px, pz) {
  return Math.abs(px) < GOAL_HALF_WIDTH && pz < GOAL_HEIGHT && pz > 0;
}

/**
 * For a goal-wall plane (one of the y=±L walls), evaluate the contact for a sphere at p with radius r.
 * Returns { normal, depth } or null. Handles:
 *   - sphere center inside the aperture rectangle → no wall contact (the wall is absent here)
 *   - sphere center outside aperture but near the rectangle border → goalpost/crossbar contact
 *     (clamp center to aperture-rectangle border in the wall plane, normal = (center − clamped)/dist).
 *   - otherwise normal wall contact.
 *
 * The aperture rectangle on the wall plane (y = sign * L) is { |x| < GW, 0 ≤ z < GH }.
 * The "border" we clamp to is that rectangle: x ∈ [−GW, GW], z ∈ [0, GH].
 */
function goalWallContact(p, r, plane) {
  const sign = plane.sign; // +1 → wall at y=+L (normal −y), −1 → wall at y=−L (normal +y)
  const wallY = sign * ARENA_HALF_LENGTH;
  const distToPlane = sign * (wallY - p.y); // interior distance (positive when inside arena)
  // If sphere is "behind" wall (negative interior dist) we let goal-interior planes deal with it.
  if (distToPlane >= r) return null; // not close to wall
  // Sphere center projected onto wall plane gives (p.x, p.z) in the wall's local 2D space.
  // First check if center sits inside the open aperture rectangle.
  if (pointInAperture(p.x, p.z)) {
    // Sphere center is inside the aperture; even if sphere bulges over the wall plane, the wall
    // is absent here. The post/crossbar contact is handled below for centers outside the rectangle.
    return null;
  }

  // Center is outside the aperture rectangle. If it's within reach of the rectangle border,
  // produce a post/crossbar contact. Otherwise normal wall contact.
  const cx = Math.max(-GOAL_HALF_WIDTH, Math.min(GOAL_HALF_WIDTH, p.x));
  const czClamped = Math.max(0, Math.min(GOAL_HEIGHT, p.z));
  // Distance from center to rectangle (in 2D wall-plane coords).
  const dx = p.x - cx;
  const dz = p.z - czClamped;
  const planeDist2 = dx * dx + dz * dz;
  // Also distance along the wall normal — small if sphere is very close to the wall plane.
  const along = distToPlane; // already positive
  // 3D distance from sphere center to nearest aperture-edge point.
  const edgeDist3 = Math.sqrt(planeDist2 + along * along);

  // If the sphere is far from the aperture edge (in the wall plane), it can't be touching a post.
  // Compare to radius — a true contact requires the 3D distance < r.
  if (edgeDist3 < r && planeDist2 > 1e-6) {
    // Goalpost / crossbar contact. Normal points from clamped border point toward sphere center.
    // Clamped point in 3D: (cx, wallY, czClamped). Direction = sphereCenter − clamped.
    const nx = (p.x - cx) / edgeDist3;
    const ny = (p.y - wallY) / edgeDist3;
    const nz = (p.z - czClamped) / edgeDist3;
    return {
      normal: new THREE.Vector3(nx, ny, nz),
      depth: r - edgeDist3,
    };
  }

  // Otherwise — normal flat wall contact.
  return {
    normal: new THREE.Vector3(plane.nx, plane.ny, plane.nz),
    depth: r - distToPlane,
  };
}

/**
 * Compute interior distance of a sphere center from a generic plane (with optional aperture handling
 * by the caller). Returns positive when sphere is inside the arena.
 */
function planeInteriorDist(p, plane) {
  return p.x * plane.nx + p.y * plane.ny + p.z * plane.nz - plane.d;
}

/**
 * Test fillet contact between a vertical plane and a horizontal one (floor or ceiling).
 * Returns { normal, depth } or null. Only produces a contact when sphere center is in the
 * fillet zone (a_v < R AND a_h < R). The fillet replaces both individual plane contacts.
 *
 * Math: in the 2D cross-section local to the fillet, the fillet is a circular arc of radius R
 * centered at (a_v=R, a_h=R) from the corner. Let q = (R − a_v, R − a_h). The sphere center's
 * shortest distance to the arc is R − |q|. Outward fillet-normal is (n_v, n_h) blended by q.
 */
function filletContact(p, r, vp, horiz) {
  const aV = planeInteriorDist(p, vp);
  const aH = planeInteriorDist(p, horiz);
  if (aV >= FILLET_R || aH >= FILLET_R) return null;
  // Allow slightly negative distances (sphere bulging past plane) — those still need contact.
  const qx = FILLET_R - aV;
  const qy = FILLET_R - aH;
  const qLen = Math.sqrt(qx * qx + qy * qy);
  if (qLen < 1e-9) return null;
  const distToSurface = FILLET_R - qLen;
  if (distToSurface >= r) return null;
  // Outward normal (toward interior): weighted combo of the two plane normals.
  const nx = (vp.nx * qx + horiz.nx * qy) / qLen;
  const ny = (vp.ny * qx + horiz.ny * qy) / qLen;
  const nz = (vp.nz * qx + horiz.nz * qy) / qLen;
  // Normalize (should already be ≈unit because vp and horiz are orthogonal unit vectors).
  const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return {
    normal: new THREE.Vector3(nx / nLen, ny / nLen, nz / nLen),
    depth: r - distToSurface,
    _vp: vp,
    _horiz: horiz,
  };
}

/**
 * Returns true if the sphere center is "inside" the goal box (past the y wall, between side walls
 * and below the roof). When inside the goal box we collide against goal-interior planes instead of
 * the outer y-wall and corner bevels.
 */
function isInsideGoalBox(p) {
  return Math.abs(p.y) > ARENA_HALF_LENGTH && Math.abs(p.x) < GOAL_HALF_WIDTH + 1 && p.z < GOAL_HEIGHT + 1 && p.z > -1;
}

/**
 * Main collision query — returns an array of { normal, depth } contacts (inward-facing normals).
 * Caller will resolve them one at a time (push position along normal by depth, reflect velocity).
 */
export function collideSphere(position, radius) {
  const contacts = [];
  const p = position;
  const r = radius;

  // ── 1. Goal interior box: when sphere is past one of the y walls (inside goal), only collide
  //    against the box interior (side walls, roof, back-of-net) and the floor. The outer y-wall
  //    is no longer relevant because the sphere is on the wrong side of it.
  if (isInsideGoalBox(p)) {
    // Floor (z=0): always present in goal too.
    const dFloor = p.z;
    if (dFloor < r) {
      contacts.push({ normal: new THREE.Vector3(0, 0, 1), depth: r - dFloor });
    }
    // Side walls (x = ±GOAL_HALF_WIDTH, inward normal toward x=0)
    for (const plane of GOAL_INTERIOR_PLANES) {
      const dist = planeInteriorDist(p, plane);
      if (dist < r) {
        contacts.push({
          normal: new THREE.Vector3(plane.nx, plane.ny, plane.nz),
          depth: r - dist,
        });
      }
    }
    // Back of net |y| = GOAL_BACK_Y, inward normal toward center.
    const sign = Math.sign(p.y) || 1;
    const distBack = sign * (sign * GOAL_BACK_Y - p.y); // = GOAL_BACK_Y − |p.y|
    if (distBack < r) {
      contacts.push({
        normal: new THREE.Vector3(0, -sign, 0),
        depth: r - distBack,
      });
    }
    return contacts;
  }

  // ── 2. Floor + ceiling distances (used for fillet decisions too).
  const dFloor = p.z;
  const dCeil = ARENA_HEIGHT - p.z;

  // Track which vertical planes are "consumed" by a fillet so we don't double-emit.
  const consumedFloor = new Set();
  const consumedCeil = new Set();

  // Horizontal-plane stubs for fillet math.
  const FLOOR = { nx: 0, ny: 0, nz: 1, d: 0 };
  const CEIL = { nx: 0, ny: 0, nz: -1, d: -ARENA_HEIGHT };

  // ── 3. Fillets between floor↔each vertical plane, ceiling↔each vertical plane.
  for (let i = 0; i < VERTICAL_PLANES.length; i++) {
    const vp = VERTICAL_PLANES[i];
    // For goal walls, only emit a fillet if the sphere is NOT crossing into the aperture region
    // (otherwise rolling under the crossbar onto the floor would snag on a phantom fillet).
    // We test by checking if the sphere center lies inside the aperture-x range AND low z.
    // (We still emit fillets for x outside the aperture; the goalpost itself is a separate contact.)
    if (vp.kind === 'goalWall') {
      // Skip fillet if the sphere's center x is inside the aperture x-range AND z below GOAL_HEIGHT
      // — the wall (and its lower fillet to floor) is absent there.
      if (Math.abs(p.x) < GOAL_HALF_WIDTH && p.z < GOAL_HEIGHT) continue;
    }

    // Floor fillet
    const cF = filletContact(p, r, vp, FLOOR);
    if (cF) {
      contacts.push({ normal: cF.normal, depth: cF.depth });
      consumedFloor.add(i);
    }
    // Ceiling fillet
    const cC = filletContact(p, r, vp, CEIL);
    if (cC) {
      contacts.push({ normal: cC.normal, depth: cC.depth });
      consumedCeil.add(i);
    }
  }

  // ── 4. Floor / ceiling flat contacts (skip if a fillet on the same side has consumed this region).
  //    Floor/ceiling are emitted normally unless the sphere is in a fillet zone for ALL nearby
  //    vertical planes — actually the cleaner rule from the brief is: if a fillet fires, suppress
  //    the two individual plane contacts that compose it. So we suppress floor only if any
  //    consumedFloor fired AND we're geometrically close enough that emitting floor would cause
  //    a double-push. Simpler & safe: emit the flat plane unless ANY fillet consumed it.
  if (dFloor < r && consumedFloor.size === 0) {
    contacts.push({ normal: new THREE.Vector3(0, 0, 1), depth: r - dFloor });
  }
  if (dCeil < r && consumedCeil.size === 0) {
    contacts.push({ normal: new THREE.Vector3(0, 0, -1), depth: r - dCeil });
  }

  // ── 5. Vertical planes (walls + bevels + goal walls). Suppress one whose fillet already fired
  //    on either floor or ceiling.
  for (let i = 0; i < VERTICAL_PLANES.length; i++) {
    if (consumedFloor.has(i) || consumedCeil.has(i)) continue;
    const plane = VERTICAL_PLANES[i];

    if (plane.kind === 'goalWall') {
      const c = goalWallContact(p, r, plane);
      if (c) contacts.push(c);
      continue;
    }

    if (plane.kind === 'bevel') {
      // Bevels only apply in their own corner quadrant (sx, sy) where sx*x > 0 and sy*y > 0.
      // Outside that quadrant the plane is irrelevant.
      if (plane.sx * p.x < 0 || plane.sy * p.y < 0) continue;
      const dist = planeInteriorDist(p, plane);
      if (dist < r) {
        contacts.push({
          normal: new THREE.Vector3(plane.nx, plane.ny, plane.nz),
          depth: r - dist,
        });
      }
      continue;
    }

    // wallX
    const dist = planeInteriorDist(p, plane);
    if (dist < r) {
      contacts.push({
        normal: new THREE.Vector3(plane.nx, plane.ny, plane.nz),
        depth: r - dist,
      });
    }
  }

  return contacts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Raycast (planes only — no fillets). Used by car suspension and any line-of-sight checks.
// ─────────────────────────────────────────────────────────────────────────────

/** Test ray vs a plane defined by (n, d) with n unit. Returns t≥0 of intersection or Infinity. */
function rayPlane(ox, oy, oz, dx, dy, dz, nx, ny, nz, d) {
  const denom = dx * nx + dy * ny + dz * nz;
  if (Math.abs(denom) < 1e-9) return Infinity;
  const t = (d - (ox * nx + oy * ny + oz * nz)) / denom;
  if (t < 0) return Infinity;
  return t;
}

/**
 * Cast a ray and return the nearest interior surface hit, or null if no hit within maxDist.
 * Output: { point: Vector3, normal: Vector3 (pointing into the interior), dist }.
 *
 * Considers floor, ceiling, walls (with goal aperture as a pass-through), corner bevels and
 * goal-interior side walls / back-of-net / roof. Fillets are skipped (planes are enough for
 * suspension queries which fire mostly downward to the floor).
 */
export function raycast(origin, dir, maxDist) {
  // Normalize dir defensively.
  const dLen = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
  const dx = dir.x / dLen;
  const dy = dir.y / dLen;
  const dz = dir.z / dLen;
  const ox = origin.x;
  const oy = origin.y;
  const oz = origin.z;

  let bestT = Infinity;
  let bestN = null;

  const consider = (t, nx, ny, nz) => {
    if (t < bestT && t <= maxDist) {
      bestT = t;
      bestN = { nx, ny, nz };
    }
  };

  // Floor (z=0, n=+z, d=0)
  consider(rayPlane(ox, oy, oz, dx, dy, dz, 0, 0, 1, 0), 0, 0, 1);
  // Ceiling (n=−z, d=−ARENA_HEIGHT, so plane equation −z = −H ⇒ z = H)
  consider(rayPlane(ox, oy, oz, dx, dy, dz, 0, 0, -1, -ARENA_HEIGHT), 0, 0, -1);
  // X walls
  consider(rayPlane(ox, oy, oz, dx, dy, dz, -1, 0, 0, -ARENA_HALF_WIDTH), -1, 0, 0);
  consider(rayPlane(ox, oy, oz, dx, dy, dz, 1, 0, 0, -ARENA_HALF_WIDTH), 1, 0, 0);

  // Y walls — must respect aperture: a ray that passes through the aperture should not hit the wall.
  // We test each candidate t against the wall's aperture rectangle in plane-local coords.
  const tryGoalWall = (sign /* +1 → y=+L, −1 → y=−L */) => {
    const nx = 0;
    const ny = -sign; // inward
    const nz = 0;
    const d = -ARENA_HALF_LENGTH;
    const t = rayPlane(ox, oy, oz, dx, dy, dz, nx, ny, nz, d);
    if (!isFinite(t) || t > maxDist) return;
    const hx = ox + dx * t;
    const hz = oz + dz * t;
    if (Math.abs(hx) < GOAL_HALF_WIDTH && hz < GOAL_HEIGHT && hz > 0) {
      // Passes through aperture — skip wall hit; the ray may still hit goal-interior planes below.
      return;
    }
    consider(t, nx, ny, nz);
  };
  tryGoalWall(+1);
  tryGoalWall(-1);

  // Corner bevels (4) — only consider the hit if it's in the correct quadrant.
  for (const plane of VERTICAL_PLANES) {
    if (plane.kind !== 'bevel') continue;
    const t = rayPlane(ox, oy, oz, dx, dy, dz, plane.nx, plane.ny, plane.nz, plane.d);
    if (!isFinite(t) || t > maxDist) continue;
    const hx = ox + dx * t;
    const hy = oy + dy * t;
    if (plane.sx * hx < 0 || plane.sy * hy < 0) continue;
    consider(t, plane.nx, plane.ny, plane.nz);
  }

  // Goal interior planes — only relevant if ray crosses past |y|=ARENA_HALF_LENGTH.
  // We always test them; the t-comparison will pick the nearest valid hit. Side walls
  // and roof of goal are infinite planes in this formulation, but they only matter when
  // the hit point is within the goal box (else we ignore).
  const tryGoalInteriorSide = (sx /* +1 → x=+GW (push −x), -1 */) => {
    const nx = -sx;
    const d = -GOAL_HALF_WIDTH;
    const t = rayPlane(ox, oy, oz, dx, dy, dz, nx, 0, 0, d);
    if (!isFinite(t) || t > maxDist) return;
    const hy = oy + dy * t;
    const hz = oz + dz * t;
    if (Math.abs(hy) <= ARENA_HALF_LENGTH || Math.abs(hy) > GOAL_BACK_Y) return;
    if (hz < 0 || hz > GOAL_HEIGHT) return;
    consider(t, nx, 0, 0);
  };
  tryGoalInteriorSide(+1);
  tryGoalInteriorSide(-1);

  // Goal roof z = GOAL_HEIGHT, normal −z
  {
    const t = rayPlane(ox, oy, oz, dx, dy, dz, 0, 0, -1, -GOAL_HEIGHT);
    if (isFinite(t) && t <= maxDist) {
      const hx = ox + dx * t;
      const hy = oy + dy * t;
      if (Math.abs(hy) > ARENA_HALF_LENGTH && Math.abs(hy) <= GOAL_BACK_Y && Math.abs(hx) <= GOAL_HALF_WIDTH) {
        consider(t, 0, 0, -1);
      }
    }
  }

  // Back of net |y|=GOAL_BACK_Y
  for (const sign of [+1, -1]) {
    const ny = -sign;
    const d = -GOAL_BACK_Y;
    const t = rayPlane(ox, oy, oz, dx, dy, dz, 0, ny, 0, d);
    if (!isFinite(t) || t > maxDist) continue;
    const hx = ox + dx * t;
    const hz = oz + dz * t;
    if (Math.abs(hx) > GOAL_HALF_WIDTH || hz < 0 || hz > GOAL_HEIGHT) continue;
    consider(t, 0, ny, 0);
  }

  if (!isFinite(bestT)) return null;
  return {
    point: new THREE.Vector3(ox + dx * bestT, oy + dy * bestT, oz + dz * bestT),
    normal: new THREE.Vector3(bestN.nx, bestN.ny, bestN.nz),
    dist: bestT,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Goal scoring check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns 'blue' if blue team scored (ball fully crossed +y goal line), 'orange' for the −y side,
 * else null. "Fully crossed" means center past ±(ARENA_HALF_LENGTH + BALL_RADIUS). We import the
 * ball radius via parameter avoidance: the brief specifies BALL_RADIUS — to keep this module
 * pure we read the ball's effective scoring threshold from a fixed import at top-of-file. Since
 * BALL_RADIUS lives in constants.js, import it here.
 */
import { BALL_RADIUS } from '../constants.js';
const SCORE_THRESHOLD = ARENA_HALF_LENGTH + BALL_RADIUS;

export function goalScored(ballPos) {
  if (ballPos.y > SCORE_THRESHOLD) return 'blue';
  if (ballPos.y < -SCORE_THRESHOLD) return 'orange';
  return null;
}
