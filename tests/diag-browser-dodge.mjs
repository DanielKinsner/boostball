// Browser-level dodge reproduction: real Chromium key events through the full stack.
// Requires dev server on :5173. Run: node tests/diag-browser-dodge.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5173');

const probe = () => page.evaluate(() => {
  const g = window.__BOOSTBALL;
  const c = g.playerCar;
  const planar = Math.hypot(c.velocity.x, c.velocity.y);
  return {
    phase: g.state.phase,
    planar: Math.round(planar),
    vz: Math.round(c.velocity.z),
    z: Math.round(c.position.z),
    grounded: c.isOnGround,
    angVel: Math.round(c.angularVelocity.length() * 100) / 100,
    airTime: c._airTime,
    usedDouble: c._usedDoubleJump,
    dodgeT: c._dodgeTorqueT,
  };
});

// Wait for play phase (3s countdown)
await page.waitForFunction(() => window.__BOOSTBALL?.state?.phase === 'play', null, { timeout: 15000 });
await page.mouse.click(640, 360); // focus

// Sterilize: park bot and ball far away so nothing touches the player.
await page.evaluate(() => {
  const g = window.__BOOSTBALL;
  g.botCar.position.set(3500, 4500, 17);
  g.botCar.velocity.set(0, 0, 0);
  g.world.ball.position.set(-3000, 4000, 92);
  g.world.ball.velocity.set(0, 0, 0);
  g.world.ball.angularVelocity.set(0, 0, 0);
});

// Drive forward 1.8s
await page.keyboard.down('w');
await page.waitForTimeout(1800);
console.log('after drive:   ', JSON.stringify(await probe()));

// First jump: tap space (90ms hold)
await page.keyboard.down(' ');
await page.waitForTimeout(90);
await page.keyboard.up(' ');
await page.waitForTimeout(160);
console.log('after jump1:   ', JSON.stringify(await probe()));

// Second tap with W still held -> expect forward dodge
await page.keyboard.down(' ');
await page.waitForTimeout(90);
await page.keyboard.up(' ');
await page.waitForTimeout(60);
console.log('after jump2:   ', JSON.stringify(await probe()));
await page.waitForTimeout(400);
console.log('mid-flip:      ', JSON.stringify(await probe()));
await page.keyboard.up('w');

console.log('pageerrors:', errors.length ? errors : 'none');
await browser.close();
