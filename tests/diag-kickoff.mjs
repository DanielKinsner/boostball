// Instrument a straight drive FROM THE REAL KICKOFF SPAWN (no teleport).
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5173');

await page.waitForFunction(() => window.__BOOSTBALL?.state?.phase === 'play', null, { timeout: 15000 });
await page.mouse.click(640, 360);
// Park only the bot + ball; leave the player exactly where kickoff put it.
await page.evaluate(() => {
  const g = window.__BOOSTBALL;
  g.botCar.position.set(3500, 4500, 17);
  g.botCar.velocity.set(0, 0, 0);
  g.world.ball.position.set(-3500, 4500, 92);
  g.world.ball.velocity.set(0, 0, 0);
  g.world.ball.angularVelocity.set(0, 0, 0);
});

const probe = () => page.evaluate(() => {
  const g = window.__BOOSTBALL;
  const c = g.playerCar;
  const e = {
    x: Math.round(c.position.x), y: Math.round(c.position.y), z: Math.round(c.position.z * 10) / 10,
    planar: Math.round(Math.hypot(c.velocity.x, c.velocity.y)),
    vz: Math.round(c.velocity.z),
    g: c.isOnGround,
    w: Math.round(c.angularVelocity.length() * 100) / 100,
    boost: Math.round(c.boost),
    super: c.isSupersonic,
  };
  return e;
});

console.log('spawn:', JSON.stringify(await probe()));
await page.keyboard.down('w');
let off = false;
for (let i = 0; i < 25; i++) {
  await page.waitForTimeout(100);
  const p = await probe();
  console.log(`${String(i * 100 + 100).padStart(4)}ms`, JSON.stringify(p));
  if (!p.g && !off) { off = true; console.log('   ^^^ TAKEOFF'); }
}
await page.keyboard.up('w');
console.log('pageerrors:', errors.length ? errors : 'none');
await browser.close();
