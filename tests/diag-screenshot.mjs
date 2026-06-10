// One-off screenshot tool for visual iteration on car/pad meshes.
// Uses chase/ball cam orientations by positioning the player car + ball so the
// game's native cameras frame the subject. Pauses gameplay (P) and continuously
// re-pins the car position via a setInterval so any gamepad input the human is
// providing can't drag the car off-frame. Usage:
//   node tests/diag-screenshot.mjs [outPathBase]
import { chromium } from 'playwright';

const out = process.argv[2] || 'screenshot.png';
const outSide = out.replace(/\.png$/, '_side.png');
const outChase = out.replace(/\.png$/, '_chase.png');
const outTop = out.replace(/\.png$/, '_34.png');
const outPads = out.replace(/\.png$/, '_pads.png');

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('console: ' + msg.text());
});

await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__BOOSTBALL, null, { timeout: 20000 });
await page.waitForFunction(
  () => window.__BOOSTBALL?.state?.phase === 'play',
  null,
  { timeout: 20000 },
).catch(() => {});
await page.waitForTimeout(600);
await page.mouse.click(640, 400); // focus

// Helper: pin the player car at a pose every frame so gamepad input can't drift it.
// quat = {x,y,z,w}; pos = [x,y,z]; ballPos = [x,y,z]; pinBot = optional [x,y,z]
async function pinAndSettle(page, { pos, quat, ballPos, pinBot, waitMs }) {
  await page.evaluate(({ pos, quat, ballPos, pinBot }) => {
    if (window.__bbPinHandle) {
      clearInterval(window.__bbPinHandle);
      window.__bbPinHandle = null;
    }
    const g = window.__BOOSTBALL;
    const apply = () => {
      const c = g.playerCar;
      c.position.set(pos[0], pos[1], pos[2]);
      c.velocity.set(0, 0, 0);
      c.angularVelocity.set(0, 0, 0);
      c.quaternion.set(quat.x, quat.y, quat.z, quat.w);
      if (pinBot) {
        g.botCar.position.set(pinBot[0], pinBot[1], pinBot[2]);
        g.botCar.velocity.set(0, 0, 0);
        g.botCar.angularVelocity.set(0, 0, 0);
      }
      if (ballPos) {
        g.world.ball.position.set(ballPos[0], ballPos[1], ballPos[2]);
        g.world.ball.velocity.set(0, 0, 0);
        g.world.ball.angularVelocity.set(0, 0, 0);
      }
    };
    apply();
    window.__bbPinHandle = setInterval(apply, 16);
  }, { pos, quat, ballPos, pinBot });
  await page.waitForTimeout(waitMs);
}

async function unpin(page) {
  await page.evaluate(() => {
    if (window.__bbPinHandle) {
      clearInterval(window.__bbPinHandle);
      window.__bbPinHandle = null;
    }
  });
}

// Quaternion helpers (z-axis yaw).
function qYaw(theta) {
  return { x: 0, y: 0, z: Math.sin(theta / 2), w: Math.cos(theta / 2) };
}

// --- Side view: ball at +y so ball cam frames car from -y side ---
// Force ball cam ON.
await page.keyboard.press('KeyT');
await pinAndSettle(page, {
  pos: [0, 0, 17],
  quat: qYaw(0), // forward = +x
  ballPos: [0, 3000, 92],
  pinBot: [3500, 4500, 17],
  waitMs: 2400,
});
await page.screenshot({ path: outSide, fullPage: false });

// --- Chase view: chase cam, car at origin facing +x ---
await page.keyboard.press('KeyT'); // back to chase
await pinAndSettle(page, {
  pos: [0, 0, 17],
  quat: qYaw(0),
  ballPos: [0, 5000, 92], // far away
  pinBot: [3500, 4500, 17],
  waitMs: 2200,
});
await page.screenshot({ path: outChase, fullPage: false });

// --- 3/4 view: ball cam, ball at +x +y, slight elevation ---
await page.keyboard.press('KeyT'); // ball cam on
await pinAndSettle(page, {
  pos: [0, 0, 17],
  quat: qYaw(0),
  ballPos: [1500, 1500, 200],
  pinBot: [3500, 4500, 17],
  waitMs: 2200,
});
await page.screenshot({ path: outTop, fullPage: false });

// --- Pads view: chase, park near big pad at (-3584, 0) facing -x ---
await page.keyboard.press('KeyT'); // chase
await pinAndSettle(page, {
  pos: [-3300, 0, 17],
  quat: qYaw(Math.PI),
  ballPos: [0, 5000, 92],
  pinBot: [3500, 4500, 17],
  waitMs: 2000,
});
await page.screenshot({ path: outPads, fullPage: false });

// --- Small-pad view: park near a small pad and look toward it ---
const outSmallPads = out.replace(/\.png$/, '_smallpads.png');
await pinAndSettle(page, {
  pos: [-700, -1024, 17],
  quat: qYaw(Math.PI / 2), // facing +y
  ballPos: [0, 5000, 92],
  pinBot: [3500, 4500, 17],
  waitMs: 2000,
});
await page.screenshot({ path: outSmallPads, fullPage: false });
console.log('small pads:', outSmallPads);

await unpin(page);

console.log('side:   ', outSide);
console.log('chase:  ', outChase);
console.log('3/4:    ', outTop);
console.log('pads:   ', outPads);
console.log('pageerrors:', errors.length ? errors : 'none');
await browser.close();
