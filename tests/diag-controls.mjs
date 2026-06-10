// Who is driving car 1? Sample the controls object + car facing during kickoff drive.
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e)));
await page.goto('http://localhost:5173');
await page.waitForFunction(() => window.__BOOSTBALL?.state?.phase === 'play', null, { timeout: 15000 });
await page.mouse.click(640, 360);

const probe = () => page.evaluate(() => {
  const g = window.__BOOSTBALL;
  const c = g.playerCar;
  const ctrl = window.__BB_CTRL?.[c.id];
  const f = c.forward;
  return {
    ctrl: ctrl ? { t: ctrl.throttle, s: ctrl.steer, p: ctrl.pitch, j: ctrl.jump, b: ctrl.boost } : null,
    fwd: [Math.round(f.x * 100) / 100, Math.round(f.y * 100) / 100, Math.round(f.z * 100) / 100],
    pos: [Math.round(c.position.x), Math.round(c.position.y), Math.round(c.position.z)],
    boost: Math.round(c.boost),
  };
});

console.log('at play start:', JSON.stringify(await probe()));
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(150);
  console.log(`${String(i * 150 + 150).padStart(4)}ms (no input)`, JSON.stringify(await probe()));
}
await browser.close();
