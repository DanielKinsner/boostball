import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.goto('http://localhost:5173');
await p.waitForFunction(() => window.__BOOSTBALL?.state?.phase === 'play', null, { timeout: 15000 });
const info = await p.evaluate(() => {
  const g = window.__BOOSTBALL;
  return {
    playerId: g.playerCar.id, playerTeam: g.playerCar.team, playerName: g.playerCar.name,
    botId: g.botCar.id, botTeam: g.botCar.team,
    worldCars: g.world.cars.map(c => ({ id: c.id, team: c.team, name: c.name })),
    samePlayerRef: g.playerCar === g.world.cars[0],
    sameBotRef: g.botCar === g.world.cars[1],
  };
});
console.log(JSON.stringify(info, null, 1));
await b.close();
