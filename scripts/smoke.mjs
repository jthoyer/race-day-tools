// Browser smoke test: walks the full journey on a phone-sized screen and fails on any page error.
// Run: npm run smoke   (needs Playwright with Chromium; set SHOTS=dir to save screenshots)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const SHOTS = process.env.SHOTS || '';

// Serve public/_headers as a host would, so a content policy that breaks the app fails this test.
const HEADERS = {};
{
  const text = await readFile(join(ROOT, '_headers'), 'utf8');
  let on = false;
  for (const line of text.split('\n')) {
    if (/^\S/.test(line)) on = line.trim() === '/*';
    else if (on && line.includes(':')) {
      const i = line.indexOf(':');
      HEADERS[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  if (!HEADERS['Content-Security-Policy']) throw new Error('public/_headers has no content policy for /*');
}

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(ROOT, path.endsWith('/') ? path + 'index.html' : path));
    res.writeHead(200, { ...HEADERS, 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const problems = [];
page.on('pageerror', (e) => problems.push('page error: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) problems.push('console: ' + m.text()); });
// A content-policy violation shows as a console error above, and as a securitypolicyviolation event here.
await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error('CSP blocked ' + e.violatedDirective + ' ' + e.blockedURI)));
// Fonts come from Google; the test must not depend on the network.
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));

let n = 0;
async function shot(name) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true }); }
function check(cond, msg) { if (!cond) problems.push('failed: ' + msg); else console.log('ok  ' + msg); }
async function noHorizontalScroll(where) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  check(w <= 390, `no sideways scroll on ${where} (${w}px)`);
}

// Home, empty
await page.goto(base + '/index.html');
await page.getByRole('heading', { name: 'Name your race' }).waitFor();
await shot('home-empty');
const blankText = await page.locator('.app').innerText();
check(await page.locator('.racecard.blank').isVisible(), 'First screen is a blank race card');
check(!/Countdown|Debrief|Coming later/.test(blankText), 'Blank card hides Countdown and Debrief');
check(await page.getByRole('link', { name: 'Just plan my fuel' }).isVisible(), 'First screen keeps "Just plan my fuel"');
const gcards = page.locator('a.gcard');
check((await gcards.count()) === 2, 'Guides show as two gallery cards');
check(JSON.stringify(await gcards.evaluateAll((els) => els.map((e) => e.getAttribute('href')))) === '["guides/race-fuel.html","guides/bike-pacing.html"]', 'Gallery cards link to both guides');
check((await gcards.evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height >= 44))), 'Gallery cards are at least 44 px high');
check(/Draft/.test(await gcards.first().innerText()), 'Gallery cards say Draft while the guides are unchecked');
// The probe is expected to be refused; its console errors are dropped at the end by its unique address.
const sent = await page.evaluate(() => fetch('/__csp_probe__').then(() => true, () => false));
check(sent === false, 'Content policy blocks every network request (connect-src none)');
await noHorizontalScroll('home');

// F1 Which race?
await page.getByRole('link', { name: 'Start my race card' }).click();
await page.getByRole('heading', { name: 'Which race?' }).waitFor();
// Cancelling step 1 leaves a race with no name, date or plan. That is still the blank card.
await page.getByRole('link', { name: 'Cancel' }).click();
await page.getByRole('heading', { name: 'Name your race' }).waitFor();
check(await page.locator('.racecard.blank').isVisible(), 'Cancelling step 1 leaves the blank card');
await page.getByRole('link', { name: 'Start my race card' }).click();
await page.getByRole('heading', { name: 'Which race?' }).waitFor();
check(await page.getByText('Tap the date to choose it.').isVisible(), 'F1 says what to do with an empty date');
await page.getByLabel('Race name').fill('Spring 70.3');
await page.getByRole('button', { name: '70.3' }).click();
const d = new Date(Date.now() + 20 * 86400000);
const iso = d.toISOString().slice(0, 10);
await page.getByLabel('Race date').fill(iso);
await page.getByLabel('Start time').fill('06:40');
// Transition opening is optional, and it must come before the start. A bad pair is not saved.
await page.getByLabel('Transition opens').fill('07:30');
check(await page.getByText('Transition should open before the race starts.').isVisible(), 'F1 refuses a transition that opens after the start');
await page.getByRole('button', { name: 'Next: about you' }).click();
check(await page.getByRole('heading', { name: 'Which race?' }).isVisible(), 'F1 does not move on with the times in the wrong order');
await page.getByLabel('Transition opens').fill('05:30');
check(!(await page.getByText('Transition should open before the race starts.').isVisible()), 'F1 accepts a transition that opens before the start');
check(await page.getByRole('button', { name: 'Clear transition time' }).isVisible(), 'F1 offers to clear a time that is set');
check(await page.getByText('Swim 1.9 km · Bike 90 km · Run 21.1 km').isVisible(), 'F1 shows the 70.3 leg distances');
check(await page.getByText(/days to go/).first().isVisible(), 'F1 shows days to go');
// The date and time fields sit side by side. They must stay inside the page, with a gap between them,
// at phone widths. The bug was seen in iOS Safari and this runs in Chromium, so it guards the layout only.
for (const w of [390, 360, 320]) {
  await page.setViewportSize({ width: w, height: 844 });
  const box = await page.evaluate(() => {
    const a = document.querySelector('input[type=date]').getBoundingClientRect();
    const b = document.querySelector('input[type=time]').getBoundingClientRect();
    return { aRight: a.right, bLeft: b.left, bRight: b.right, w: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth };
  });
  check(box.bRight <= box.w && box.bLeft - box.aRight >= 8 && box.sw <= w, `F1 date and time fields fit, with a gap, at ${w}px`);
}
await page.setViewportSize({ width: 390, height: 844 });
await shot('f1');
await noHorizontalScroll('F1');
await page.getByRole('button', { name: 'Next: about you' }).click();

// F2 About you: Next with nothing entered must show errors and stay
await page.getByRole('heading', { name: 'About you' }).waitFor();
await page.getByRole('button', { name: 'Next: fitness numbers' }).click();
check(await page.getByRole('heading', { name: 'About you' }).isVisible(), 'F2 refuses to move on with empty fields');
check((await page.getByRole('alert').count()) >= 2, 'F2 shows field errors');
await page.getByLabel('Body weight').fill('72');
await page.getByLabel('Carbs your gut handles').fill('70');
await shot('f2');
await page.getByRole('button', { name: 'Next: fitness numbers' }).click();

// F3 Fitness numbers
await page.getByRole('heading', { name: 'Fitness numbers' }).waitFor();
await page.getByLabel('CSS, your threshold swim pace').fill('1:45');
await page.getByLabel('FTP', { exact: true }).fill('240');
await page.getByLabel('Run threshold pace').fill('4:50');
await shot('f3');
await page.getByRole('button', { name: 'Next: course and heat' }).click();

// F4 Course and heat
await page.getByRole('heading', { name: 'Course and heat' }).waitFor();
await page.getByRole('button', { name: /Rolling/ }).click();
await page.getByRole('button', { name: /Warm/ }).click();
await shot('f4');
await page.getByRole('button', { name: 'See my pace targets' }).click();

// F5 Pace targets
await page.getByRole('heading', { name: 'Your pace targets' }).waitFor();
const targets = await page.locator('.targets').innerText();
check(/175–185 W/.test(targets), 'F5 bike target is 175–185 W');
check(/5:15–5:30 \/km/.test(targets), 'F5 run target is 5:15–5:30 /km');
check(/FINISH\s*\n?\s*\d:\d\d–\d:\d\d/.test(targets), 'F5 finish is a range');
check(await page.getByText('How we got these').isVisible(), 'F5 shows how we got these');
await shot('f5');
await noHorizontalScroll('F5');
await page.getByRole('button', { name: 'Save to my race card' }).click();

// F6 Saved
await page.getByText('Pace targets saved to your race card').waitFor();
await shot('f6');
await page.getByRole('link', { name: 'Plan my fuel' }).click();

// A2 Fuel
await page.getByRole('heading', { name: 'Fuel plan' }).waitFor();
check(await page.getByText('From your pace plan').isVisible(), 'Fuel uses the pace splits');
const fuelText = await page.locator('.app').innerText();
check(/Capped at what your gut has trained: 70 g an hour/.test(fuelText), 'Fuel shows the gut cap');
check(/not medical advice/i.test(fuelText), 'Fuel shows not medical advice');
await shot('a2-fuel');
await noHorizontalScroll('Fuel');
await page.getByRole('button', { name: 'Save to my race card' }).click();

// C1 Race card
await page.locator('.racecard').waitFor();
const card = await page.locator('.racecard').innerText();
check(/Spring 70\.3/.test(card) && /175–185/.test(card) && /g\/hr/.test(card), 'Race card shows pace and fuel');
check(!/Countdown|Debrief|Coming later/.test(card), 'Race card hides Countdown and Debrief until they exist');
check(/6:40am start/.test(card) && /Transition opens 5:30am/.test(card), 'Race card shows the start and when the transition opens');
await shot('c1-card');

// Print view
await page.emulateMedia({ media: 'print' });
await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
const tt = await page.locator('.tt').textContent();
check(/Bike fuel/.test(tt) && /175–185 W/.test(tt), 'Print card has pace and fuel');
check(!(await page.locator('.app').isVisible()), 'Print hides the app');
check(/Transition opens 5:30am/.test(tt), 'Print card shows when the transition opens');
await shot('print');
await page.emulateMedia({ media: 'screen' });

// Survives a reload: everything was saved on the device
await page.reload();
await page.locator('.racecard').waitFor();
check(/175–185/.test(await page.locator('.racecard').innerText()), 'Race card survives a reload');

// Home with a race
await page.goto(base + '/index.html#/');
await page.getByRole('heading', { name: 'Spring 70.3' }).waitFor();
const homeText = await page.locator('.app').innerText();
check(/2 of 2 done/.test(homeText), 'Home shows 2 of 2 done');
check(!/Countdown|Debrief|Later/.test(homeText), 'Home hides Countdown and Debrief until they exist');
await shot('a1-home');

// Lower the gut figure after saving fuel: the card must say the fuel plan is out of date
await page.goto(base + '/index.html#/setup/2');
await page.getByLabel('Carbs your gut handles').fill('50');
await page.goto(base + '/index.html#/card');
check(/changed since this plan/.test(await page.locator('.racecard').innerText()), 'Card flags fuel as out of date after a details change');
await page.goto(base + '/index.html#/fuel');
await page.getByRole('button', { name: 'Update my race card' }).click();
await page.locator('.racecard').waitFor();
const updated = await page.locator('.racecard').innerText();
const bikeG = Number((/Bike (\d+) g\/hr/.exec(updated) || [])[1]);
check(!/changed since this plan/.test(updated) && bikeG > 0 && bikeG <= 50, `Updating fuel clears the flag and keeps under the new gut figure (${bikeG} g/hr)`);

// Both times are optional. Clearing them saves blanks, never midnight, and the plan still shows.
await page.goto(base + '/index.html#/setup/1');
await page.getByRole('button', { name: 'Clear start time' }).click();
await page.getByRole('button', { name: 'Clear transition time' }).click();
const blanks = await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('race-day-tools.v1')).race; return [r.start, r.transitionOpens]; });
check(blanks[0] === '' && blanks[1] === '', 'Clearing the times saves blanks');
await page.goto(base + '/index.html#/card');
const noTimes = await page.locator('.racecard').innerText();
check(!/\d:\d\d(am|pm) start|Transition opens/.test(noTimes) && /175–185/.test(noTimes), 'A race with no times still shows its plan, and no time text');
// Midnight is a real time and not the same as blank.
await page.goto(base + '/index.html#/setup/1');
await page.getByLabel('Start time').fill('00:00');
await page.goto(base + '/index.html#/card');
check(/12:00am start/.test(await page.locator('.racecard').innerText()), 'A midnight start shows as 12:00am and not as blank');

// Products: add one, it appears in the fuel step
await page.goto(base + '/index.html#/products');
await page.getByRole('button', { name: 'Add a product' }).click();
const names = page.getByLabel('Name');
await names.last().fill('Test gel 40');
await page.getByLabel('Carbs per serve (g)').last().fill('40');
await page.getByRole('link', { name: 'Done' }).click();
await page.getByRole('heading', { name: 'Fuel plan' }).waitFor();
check((await page.locator('select').first().innerText()).includes('Test gel 40'), 'A new product shows in the fuel step');

// Guide: bike target works alone, then saves into a plan with FTP and course carried over
const g = await browser.newPage({ viewport: { width: 390, height: 844 } });
g.on('pageerror', (e) => problems.push('guide page error: ' + e.message));
g.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) problems.push('guide console: ' + m.text()); });
await g.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error('CSP blocked ' + e.violatedDirective + ' ' + e.blockedURI)));
await g.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await g.goto(base + '/guides/bike-pacing.html');
await g.getByLabel('Your FTP').fill('240');
check(/175–185 W/.test(await g.locator('.result').innerText()), 'Guide gives 175–185 W for FTP 240, rolling');
await g.getByRole('button', { name: 'Hilly' }).click();
check(!/175–185 W/.test(await g.locator('.result').innerText()), 'Guide target changes for a hilly course');
if (SHOTS) await g.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-guide-bike.png`, fullPage: true });
g.on('dialog', (dl) => dl.accept());
await g.getByRole('button', { name: 'Save to a race plan' }).click();
await g.getByRole('heading', { name: 'Which race?' }).waitFor();
const saved = await g.evaluate(() => JSON.parse(localStorage.getItem('race-day-tools.v1')));
check(saved.fitness.ftp === 240 && saved.race.course === 'hilly', 'Guide carries FTP and course into the new plan');

// Fuel guide works with no race and no typing
await g.goto(base + '/guides/race-fuel.html');
check(/g\/hr/.test(await g.locator('.tool').innerText()), 'Fuel guide shows a plan from its defaults');
if (SHOTS) await g.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-guide-fuel.png`, fullPage: true });

await browser.close();
server.close();

const real = problems.filter((x) => !x.includes('__csp_probe__'));
problems.length = 0;
problems.push(...real);
if (problems.length) {
  console.error('\n' + problems.join('\n'));
  process.exit(1);
}
console.log('\nSmoke test passed.');
