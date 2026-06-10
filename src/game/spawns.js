// Spawn / respawn pose helpers.
// All poses use z-up; car local +X is forward (see makeCarQuaternion).

import * as THREE from 'three';
import {
  KICKOFF_SPAWNS_BLUE,
  RESPAWN_POINTS_BLUE,
  CAR_REST_Z,
  TEAM_BLUE,
} from '../constants.js';
import { makeCarQuaternion } from '../physics/car.js';

// Module-level scratch (not returned) to avoid alloc in tight callers.
const _scratchForward = new THREE.Vector3();

/**
 * Pick `numPerTeam` distinct kickoff spawns; orange mirrors blue (negate x and y).
 * Cars face the ball (origin).
 * @param {number} numPerTeam
 * @returns {{ blue: Array<{position:THREE.Vector3, quaternion:THREE.Quaternion}>,
 *             orange: Array<{position:THREE.Vector3, quaternion:THREE.Quaternion}> }}
 */
export function pickKickoffSpawns(numPerTeam) {
  const n = Math.max(0, Math.min(numPerTeam | 0, KICKOFF_SPAWNS_BLUE.length));
  // Build & shuffle index pool (Fisher–Yates) so picks are distinct.
  const idxs = new Array(KICKOFF_SPAWNS_BLUE.length);
  for (let i = 0; i < idxs.length; i++) idxs[i] = i;
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = idxs[i]; idxs[i] = idxs[j]; idxs[j] = tmp;
  }

  const blue = [];
  const orange = [];
  for (let k = 0; k < n; k++) {
    const sp = KICKOFF_SPAWNS_BLUE[idxs[k]];
    blue.push(_facePose(sp.x, sp.y, 0, 0));
    orange.push(_facePose(-sp.x, -sp.y, 0, 0));
  }
  return { blue, orange };
}

/**
 * Demo/post-goal respawn pose. Random point from RESPAWN_POINTS_BLUE (mirrored for orange).
 * Cars face midfield (+y for blue, -y for orange).
 * @param {'blue'|'orange'} team
 * @returns {{position:THREE.Vector3, quaternion:THREE.Quaternion}}
 */
export function respawnPose(team) {
  const pt = RESPAWN_POINTS_BLUE[Math.floor(Math.random() * RESPAWN_POINTS_BLUE.length)];
  const isBlue = team === TEAM_BLUE;
  const px = isBlue ? pt.x : -pt.x;
  const py = isBlue ? pt.y : -pt.y;
  // Facing midfield: forward = +y for blue, -y for orange. No "look at origin" math here.
  _scratchForward.set(0, isBlue ? 1 : -1, 0);
  return {
    position: new THREE.Vector3(px, py, CAR_REST_Z),
    quaternion: makeCarQuaternion(_scratchForward),
  };
}

// Build a pose at (x, y, CAR_REST_Z) facing (tx, ty, 0). If degenerate, default forward = +y.
function _facePose(x, y, tx, ty) {
  let fx = tx - x;
  let fy = ty - y;
  const len = Math.hypot(fx, fy);
  if (len < 1e-6) { fx = 0; fy = 1; }
  else { fx /= len; fy /= len; }
  _scratchForward.set(fx, fy, 0);
  return {
    position: new THREE.Vector3(x, y, CAR_REST_Z),
    quaternion: makeCarQuaternion(_scratchForward),
  };
}
