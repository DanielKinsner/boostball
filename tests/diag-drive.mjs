// Instrument a straight drive: sample every 100ms, find the takeoff moment.
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5173');

await page.waitForFunction(() => window.__BOOSTBALL?.state?.phase === 'play', null, { timeout: 15000 });
await page.mouse.click(640, 360);
await page.evaluate(() => {
  const g = window.__BOOSTBALL;
  g.botCar.position.set(3500, 4500, 17);
  g.botCar.velocity.set(0, 0, 0);
  g.world.ball.position.set(-3000, 4000, 92);
  g.world.ball.velocity.set(0, 0, 0);
  g.world.ball.angularVelocity.set(0, 0, 0);
  // Park player mid-field on flat ground facing +y for a known-clean run.
  const c = g.playerCar;
  c.position.set(0, -4000, 17);
  c.velocity.set(0, 0, 0);
  c.angularVelocity.set(0, 0, 0);
  c.quaternion.set(0, 0, 0.7071067811865476, 0.7071067811865476); // +90° about z: +x -> +y
});

const probe = () => page.evaluate(() => {
  const g = window.__BOOSTBALL;
  const c = g.playerCar;
  return {
    x: Math.round(c.position.x), y: Math.round(c.position.y), z: Math.round(c.position.z * 10) / 10,
    planar: Math.round(Math.hypot(c.velocity.x, c.velocity.y)),
    vz: Math.round(c.velocity.z),
    g: c.isOnGround,
    w: Math.round(c.angularVelocity.length() * 100) / 100,
  };
});

await page.keyboard.down('w');
for (let i = 0; i < 25; i++) {
  await page.waitForTimeout(100);
  const p = await probe();
  console.log(`${String(i * 100 + 100).padStart(4)}ms`, JSON.stringify(p));
  if (!p.g && i > 1) { console.log('=== TAKEOFF DETECTED ==='); }
}
await page.keyboard.up('w');
console.log('pageerrors:', errors.length ? errors : 'none');
await browser.close();
