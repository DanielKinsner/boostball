// One-off screenshot tool for visual iteration on car/pad meshes.
// Uses chase/ball cam orientations by positioning the player car + ball so the
// game's native cameras frame the subject. Usage:
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
// Wait until the play phase (kickoff countdown finishes).
await page.waitForFunction(
  () => window.__BOOSTBALL?.state?.phase === 'play',
  null,
  { timeout: 20000 },
).catch(() => {});
await page.waitForTimeout(800);
await page.mouse.click(640, 400); // focus the page

// --- Side view: ball at +y, ball cam frames car from -y side ---
await page.evaluate(() => {
  const g = window.__BOOSTBALL;
  const c = g.playerCar;
  c.position.set(0, 0, 17);
  c.velocity.set(0, 0, 0);
  c.angularVelocity.set(0, 0, 0);
  c.quaternion.set(0, 0, 0, 1); // forward = +x
  g.botCar.position.set(3500, 4500, 17);
  g.botCar.velocity.set(0, 0, 0);
  g.world.ball.position.set(0, 3000, 92);
  g.world.ball.velocity.set(0, 0, 0);
});
await page.keyboard.press('KeyT'); // toggle ball cam
await page.waitForTimeout(2400);
await page.screenshot({ path: outSide, fullPage: false });

// --- Chase view: turn off ball cam, frame car from behind (forward = +x) ---
await page.keyboard.press('KeyT');
await page.evaluate(() => {
  const g = window.__BOOSTBALL;
  const c = g.playerCar;
  c.position.set(0, 0, 17);
  c.velocity.set(0, 0, 0);
  c.quaternion.set(0, 0, 0, 1);
});
await page.waitForTimeout(2000);
await page.screenshot({ path: outChase, fullPage: false });

// --- 3/4 view via ball cam with the ball at +x +y elevated ---
await page.keyboard.press('KeyT');
await page.evaluate(() => {
  const g = window.__BOOSTBALL;
  const c = g.playerCar;
  c.position.set(0, 0, 17);
  c.velocity.set(0, 0, 0);
  c.quaternion.set(0, 0, 0, 1);
  g.world.ball.position.set(800, 1500, 250);
});
await page.waitForTimeout(2000);
await page.screenshot({ path: outTop, fullPage: false });

// --- Pads view: park car near a big pad ---
await page.keyboard.press('KeyT'); // back to chase
await page.evaluate(() => {
  const g = window.__BOOSTBALL;
  const c = g.playerCar;
  c.position.set(-3000, 0, 17);
  c.velocity.set(0, 0, 0);
  c.quaternion.setFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI);
});
await page.waitForTimeout(1800);
await page.screenshot({ path: outPads, fullPage: false });

console.log('side:   ', outSide);
console.log('chase:  ', outChase);
console.log('3/4:    ', outTop);
console.log('pads:   ', outPads);
console.log('pageerrors:', errors.length ? errors : 'none');
await browser.close();
