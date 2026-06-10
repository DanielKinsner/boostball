// Boost pad pickups. Cylindrical pickup volume; pads disable for a cooldown after pickup.

import * as THREE from 'three';
import {
  BIG_PADS,
  SMALL_PADS,
  BIG_PAD_RADIUS,
  SMALL_PAD_RADIUS,
  BIG_PAD_COOLDOWN,
  SMALL_PAD_COOLDOWN,
  BIG_PAD_AMOUNT,
  SMALL_PAD_AMOUNT,
  BOOST_MAX,
  PAD_HEIGHT,
} from '../constants.js';

export class BoostPads {
  constructor() {
    /** @type {Array<{position:THREE.Vector3, big:boolean, active:boolean, cooldown:number}>} */
    this.pads = [];
    for (let i = 0; i < BIG_PADS.length; i++) {
      const p = BIG_PADS[i];
      this.pads.push({
        position: new THREE.Vector3(p.x, p.y, 0),
        big: true,
        active: true,
        cooldown: 0,
      });
    }
    for (let i = 0; i < SMALL_PADS.length; i++) {
      const p = SMALL_PADS[i];
      this.pads.push({
        position: new THREE.Vector3(p.x, p.y, 0),
        big: false,
        active: true,
        cooldown: 0,
      });
    }
  }

  reset() {
    for (let i = 0; i < this.pads.length; i++) {
      const pad = this.pads[i];
      pad.active = true;
      pad.cooldown = 0;
    }
  }

  /**
   * Tick cooldowns, detect pickups.
   * @param {number} dt
   * @param {Array<{id:number, position:THREE.Vector3, boost:number, isDemolished:boolean}>} cars
   * @returns {Array<{type:'padPickup', carId:number, big:boolean, position:THREE.Vector3}>}
   */
  update(dt, cars) {
    const events = [];
    for (let i = 0; i < this.pads.length; i++) {
      const pad = this.pads[i];
      if (!pad.active) {
        pad.cooldown -= dt;
        if (pad.cooldown <= 0) {
          pad.cooldown = 0;
          pad.active = true;
        }
        continue;
      }
      const pickupR = pad.big ? BIG_PAD_RADIUS : SMALL_PAD_RADIUS;
      const r2 = pickupR * pickupR;
      const px = pad.position.x;
      const py = pad.position.y;
      for (let j = 0; j < cars.length; j++) {
        const car = cars[j];
        if (!car || car.isDemolished) continue;
        if (car.boost >= BOOST_MAX) continue;
        const cz = car.position.z;
        if (cz < 0 || cz > PAD_HEIGHT) continue;
        const dx = car.position.x - px;
        const dy = car.position.y - py;
        if (dx * dx + dy * dy >= r2) continue;
        const amount = pad.big ? BIG_PAD_AMOUNT : SMALL_PAD_AMOUNT;
        car.boost = Math.min(BOOST_MAX, car.boost + amount);
        pad.active = false;
        pad.cooldown = pad.big ? BIG_PAD_COOLDOWN : SMALL_PAD_COOLDOWN;
        events.push({
          type: 'padPickup',
          carId: car.id,
          big: pad.big,
          position: pad.position.clone(),
        });
        break; // pad consumed; move on
      }
    }
    return events;
  }
}
