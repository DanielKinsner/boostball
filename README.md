# BOOSTBALL

A Rocket League–style car soccer game that runs in your browser. Custom physics engine built to Rocket League's published physics constants (gravity 650 uu/s², supersonic 2200 uu/s, ball restitution 0.6, real boost pad layout, Octane hitbox), full arena with goals, boost economy, demolitions, and a bot opponent. 1v1, first to outscore in 5 minutes; golden-goal overtime if tied.

## Play

```
npm install
npm run dev
```

Open http://localhost:5173 in Chrome or Edge.

## Controls

### Keyboard
| Key | Action |
| --- | --- |
| W / S | Throttle / reverse (pitch in air) |
| A / D | Steer (yaw in air) |
| Q / E | Air roll left / right |
| Space | Jump / double jump / dodge (with a direction held) |
| Shift | Boost |
| X | Powerslide / handbrake |
| C | Toggle ball cam |
| P / Esc | Pause |
| M | Mute |
| H | Help overlay |
| Enter | Restart (after match ends) |

### Gamepad (recommended — plug in before or during play)
| Button | Action |
| --- | --- |
| Left stick | Steer / pitch / yaw |
| A / Cross | Jump / dodge |
| B / Circle | Boost |
| X / Square | Powerslide (+ hold for air roll on stick) |
| Y / Triangle | Ball cam |
| RT / LT | Throttle / reverse |
| Start | Pause |

## The game

- **Boost**: 34 pads on the field — 6 big pads (100 boost, 10s respawn) on the standard Rocket League layout, 28 small pads (+12, 4s respawn). Boosting accelerates you past the 1410 uu/s driving cap up to 2300 uu/s (supersonic).
- **Demolitions**: hit an opponent while supersonic and roughly head-on — they explode and respawn after 3 seconds.
- **Aerials**: jump, then hold boost and pitch back to fly. Double-tap jump with a direction held to dodge/flip.
- **Wall driving**: sticky wheels — drive up the walls and curved transitions like the real thing.

## Dev

- `npm run dev` — dev server with HMR
- `npm run build` / `npm run preview` — production build
- `npm test` — headless physics simulation tests (node, no browser needed)
- `ARCHITECTURE.md` — module contract / code map
