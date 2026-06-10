// Final smoke: force a goal to exercise slow-mo, camera shake, goalPause orbit,
// HUD banner, and goal explosion. Capture pageerrors + screenshots.
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5173');
await page.waitForFunction(() => window.__BOOSTBALL?.state?.phase === 'play', null, { timeout: 15000 });

// Fire the ball into the orange goal from midfield.
await page.evaluate(() => {
  const g = window.__BOOSTBALL;
  g.world.ball.position.set(0, 3000, 300);
  g.world.ball.velocity.set(0, 4500, 0);
});
await page.waitForFunction(() => window.__BOOSTBALL?.state?.phase === 'goalPause', null, { timeout: 10000 });
await page.waitForTimeout(900); // mid slow-mo + orbit + explosion
await page.screenshot({ path: 'C:\\Users\\DANIEL~1\\AppData\\Local\\Temp\\bb-goal.png' });
const mid = await page.evaluate(() => ({
  phase: window.__BOOSTBALL.state.phase,
  score: window.__BOOSTBALL.state.score,
  hudText: document.querySelector('#hud-root').innerText.replace(/\s+/g, ' ').slice(0, 120),
}));
console.log('during celebration:', JSON.stringify(mid));

// Ride through reset back to play.
await page.waitForFunction(() => window.__BOOSTBALL?.state?.phase === 'play', null, { timeout: 15000 });
await page.waitForTimeout(2000);
const end = await page.evaluate(() => ({
  phase: window.__BOOSTBALL.state.phase,
  ballZ: Math.round(window.__BOOSTBALL.world.ball.position.z),
}));
console.log('after kickoff reset:', JSON.stringify(end));
console.log('pageerrors:', errors.length ? errors : 'none');
await browser.close();
