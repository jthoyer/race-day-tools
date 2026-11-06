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
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
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
// RD-031. The floating step bar: four links, the current one marked, each at least 44 px.
async function stepBarIs(current, where) {
  const links = page.locator('nav.stepbar a');
  const plain = (t) => t.replace(/,\s*done/, '').trim(); // a done step also says ", done" to a screen reader
  const names = (await links.allInnerTexts()).map(plain);
  const cur = plain(await page.locator('nav.stepbar a[aria-current="step"]').innerText().catch(() => ''));
  const tall = await links.evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height >= 44 && e.getBoundingClientRect().width >= 44));
  check(names.join(',') === 'Race,Pacing,Fuel,Card' && cur.trim() === current && tall, `${where} has the step bar, with ${current} marked`);
}
const settle = () => page.waitForTimeout(700); // the fuel and targets screens redraw 400 ms after typing stops

// Home, empty
await page.goto(base + '/index.html');
await page.getByRole('heading', { name: 'Race with a plan.' }).waitFor();
await shot('home-empty');
const blankText = await page.locator('.app').innerText();
// RD-033. The first screen says what the app is for, in four steps, with two ways in.
check(await page.locator('.splash').isVisible(), 'First screen is the splash');
check(await page.locator('img.splash-logo').evaluate((i) => i.complete && i.naturalWidth > 0 && i.getAttribute('alt') === 'TRI Momentum'), 'Splash shows the logo, with alt text');
check(/Pace targets and a timed fuel plan for your triathlon, on one race card for your bike\./.test(blankText), 'Splash says what the app is for');
check(JSON.stringify(await page.locator('.splash-steps li').allInnerTexts()) === JSON.stringify(['1\nChoose a race', '2\nChoose pacing', '3\nReview nutrition', '4\nGet your race card for your top tube']), 'Splash lists the four steps in order');
check(!/Countdown|Debrief|Coming later/.test(blankText), 'Splash hides Countdown and Debrief');
check(!/account/i.test(await page.getByRole('link').allInnerTexts().then((t) => t.join(' '))), 'Splash offers no sign-in: the app has no accounts');
check(await page.getByRole('link', { name: 'Just plan my fuel' }).isVisible(), 'First screen keeps "Just plan my fuel"');
check(await page.locator('.splash .btn, .splash .linkbtn').evaluateAll((els) => els.length === 2 && els.every((e) => e.getBoundingClientRect().height >= 44)), 'Splash has two actions, each at least 44 px high');
check(/Not medical advice/i.test(blankText), 'Splash keeps "Not medical advice"');
const gcards = page.locator('a.gcard');
check((await gcards.count()) === 2, 'Guides show as two gallery cards');
check(JSON.stringify(await gcards.evaluateAll((els) => els.map((e) => e.getAttribute('href')))) === '["guides/race-fuel.html","guides/bike-pacing.html"]', 'Gallery cards link to both guides');
check((await gcards.evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height >= 44))), 'Gallery cards are at least 44 px high');
check(/Draft/.test(await gcards.first().innerText()), 'Gallery cards say Draft while the guides are unchecked');
// The probe is expected to be refused; its console errors are dropped at the end by its unique address.
const sent = await page.evaluate(() => fetch('/__csp_probe__').then(() => true, () => false));
check(sent === false, 'Content policy blocks every network request (connect-src none)');
await noHorizontalScroll('home');
for (const w of [360, 320]) {
  await page.setViewportSize({ width: w, height: 844 });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(sw <= w, `splash has no sideways scroll at ${w}px (${sw}px)`);
  check(await page.locator('.splash .btn, .splash .linkbtn, a.gcard').evaluateAll((els) => els.length === 4 && els.every((e) => e.getBoundingClientRect().height >= 44)), `splash actions and guide cards are at least 44 px high at ${w}px`);
}
await page.setViewportSize({ width: 390, height: 844 });

// F1 Which race?
await page.getByRole('link', { name: 'Start my race card' }).click();
await page.getByRole('heading', { name: 'Which race?' }).waitFor();
// Cancelling step 1 leaves a race with no name, date or plan. That is still the splash.
await page.getByRole('link', { name: 'Cancel' }).click();
await page.getByRole('heading', { name: 'Race with a plan.' }).waitFor();
check(await page.locator('.splash').isVisible(), 'Cancelling step 1 returns to the splash');
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
await stepBarIs('Race', 'F1');
// RD-011, RD-031. Taper length: our guide (14 days for a 70.3) is marked, one tap changes it, and a picked day works.
const taperStore = () => page.evaluate(() => JSON.parse(localStorage.getItem('race-day-tools.v1')).race.taperDays);
check((await page.getByRole('button', { name: /14 days/ }).getAttribute('aria-pressed')) === 'true' && /14 days \(our guide\)/.test(await page.getByRole('button', { name: /14 days/ }).innerText()), 'F1 marks our 14-day taper guide for a 70.3');
const taperBefore = await page.locator('.countdown .n').innerText();
await page.getByRole('button', { name: /21 days/ }).click();
check((await taperStore()) === 21 && (await page.locator('.countdown .n').innerText()) !== taperBefore, 'Picking a 21-day taper saves it and moves the start');
// The race is 20 days away, so a 21-day taper has already started.
check(/You are in your taper/.test(await page.locator('.countdown .n').innerText()), 'A taper longer than the days to go says you are in it');
const raceDay = new Date(Date.now() + 20 * 86400000);
const isoLocal = (dt) => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
const sevenBefore = new Date(raceDay.getFullYear(), raceDay.getMonth(), raceDay.getDate() - 7);
await page.getByLabel('Or pick the day your taper starts').fill(isoLocal(sevenBefore));
check((await taperStore()) === 7, 'Picking the day the taper starts saves a 7-day taper');
const after = new Date(raceDay.getFullYear(), raceDay.getMonth(), raceDay.getDate() + 3);
await page.getByLabel('Or pick the day your taper starts').fill(isoLocal(after));
check(await page.getByText(/Pick a day 1 to 42 days before race day/).isVisible() && (await taperStore()) === 7 && (await page.getByLabel('Or pick the day your taper starts').inputValue()) === isoLocal(after), 'A taper day after the race is refused, not saved, and stays on screen with its message');
await page.getByRole('button', { name: /14 days/ }).click();
check((await taperStore()) == null && !(await page.getByText(/Pick a day 1 to 42/).isVisible()), 'Going back to 14 days uses our guide again');
check(!(await page.getByRole('button', { name: 'Save and back to race card' }).count()), 'A first pass through the steps has no "back to race card" yet');
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
const f2Text = await page.locator('.app').innerText();
check(/It does not change your fuel plan/.test(f2Text) && !/fluid and sodium/.test(f2Text.split('Sweat rate')[0]), 'F2 weight help says why we ask, and does not claim fluid or sodium');
await page.getByLabel('Body weight').fill('72');
await page.getByLabel('Carbs your gut handles').fill('70');
check(!(await page.getByText(/Enter a body weight/).isVisible()) && !(await page.getByText(/Enter 0 to 120 g an hour/).isVisible()), 'F2 errors go once a number is typed');
await shot('f2');
await page.getByRole('button', { name: 'Next: fitness numbers' }).click();

// F3 Fitness numbers
await page.getByRole('heading', { name: 'Fitness numbers' }).waitFor();
check(/Your steady swim pace per 100 m in a pool/.test(await page.locator('.app').innerText()), 'F3 says what CSS is');
// The pace choice changes the bike and the run and never the swim, so it sits between them and the swim.
const topOf3 = (loc) => loc.evaluate((e) => e.getBoundingClientRect().top);
const swimTop3 = await topOf3(page.getByText('Swim', { exact: true }));
const choiceTop = await topOf3(page.getByText('How do you pace the bike and run?'));
const bikeTop3 = await topOf3(page.getByText('Bike', { exact: true }));
check(swimTop3 < choiceTop && choiceTop < bikeTop3, 'F3 puts the pace choice between Swim and Bike');
check(await page.getByText(/Power needs your FTP\. Heart rate needs/).isVisible(), 'F3 says what each pace mode needs');
// Switching mode shows what that mode needs and keeps what was typed for the others.
await page.getByLabel('FTP', { exact: true }).fill('240');
await page.getByRole('button', { name: 'Heart rate' }).click();
check((await page.getByLabel('Bike threshold heart rate').isVisible()) && (await page.getByLabel('Run threshold heart rate').isVisible()), 'Heart rate mode asks for both threshold heart rates');
await page.getByRole('button', { name: 'Power' }).click();
check((await page.getByLabel('FTP', { exact: true }).inputValue()) === '240', 'Switching pace mode keeps the FTP that was typed');
// Time entry: digits become a time, a dot works, one or two digits are refused, and an error goes as soon as the entry reads.
const cssBox = page.getByLabel('Critical swim speed (CSS)');
await cssBox.fill('45');
await page.getByRole('button', { name: 'Next: course and heat' }).click();
check(await page.getByText('Type minutes and seconds, such as 1:45 or 145.').isVisible(), 'F3 refuses 45 and says what to type');
check(await page.getByRole('heading', { name: 'Fitness numbers' }).isVisible(), 'F3 does not move on with an unreadable time');
await cssBox.fill('175');
await page.getByRole('button', { name: 'Next: course and heat' }).click();
check(await page.getByText('Seconds go up to 59.').isVisible(), 'F3 refuses 175 because seconds stop at 59');
await cssBox.fill('130');
check(!(await page.getByText('Seconds go up to 59.').isVisible()), 'The error goes as soon as the entry reads');
await cssBox.blur();
check((await cssBox.inputValue()) === '1:30', 'Typing 130 shows 1:30 when the person leaves the field');
await cssBox.fill('1.45');
await cssBox.blur();
check((await cssBox.inputValue()) === '1:45', 'A dot works like a colon: 1.45 shows 1:45');
await page.getByLabel('FTP', { exact: true }).fill('240');
const runBox = page.getByLabel('Run threshold pace');
await runBox.fill('450');
await runBox.blur();
check((await runBox.inputValue()) === '4:50', 'Typing 450 shows 4:50');
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
// The finish as a time of day is the start plus the finish range shown, to the minute. The expected text is
// worked out here from the range on screen, so this does not just repeat the app's own sum.
const fin = /FINISH\s*\n?\s*(\d+):(\d\d)–(\d+):(\d\d)/.exec(targets);
const finLo = Number(fin[1]) * 60 + Number(fin[2]);
const finHi = Number(fin[3]) * 60 + Number(fin[4]);
const clock12 = (m) => { const m1 = m % 1440; const h24 = Math.floor(m1 / 60); return (h24 % 12 || 12) + ':' + String(m1 % 60).padStart(2, '0') + (h24 < 12 ? 'am' : 'pm'); };
const wantClock = (startMin) => `${clock12(startMin + finLo)}–${clock12(startMin + finHi)}` + (startMin + finHi >= 1440 ? ', next day' : '');
check((await page.locator('.targets .fclock').innerText()).trim() === 'About ' + wantClock(6 * 60 + 40), `F5 shows the finish as a time of day: about ${wantClock(6 * 60 + 40)}`);
check(await page.getByText('How we got these').isVisible(), 'F5 shows how we got these');
check(await page.getByText(/your CSS \(your steady pool pace\) of 1:45/).isVisible(), 'F5 says what CSS is where it first uses it');
await stepBarIs('Pacing', 'F5');
// RD-031. Your own T1: the finish moves by exactly the difference, and the legs still add up to it.
const finishOf = async () => { const m = /FINISH\s*\n?\s*(\d+):(\d\d)–(\d+):(\d\d)/.exec(await page.locator('.targets').innerText()); return [Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])]; };
const t1Row = await page.locator('.targets .leg', { hasText: 'T1' }).innerText();
check(/Our guide/.test(t1Row) && /0:04–0:05/.test(t1Row), 'F5 shows T1 on its own row, with our guide');
await page.getByLabel('T1, swim to bike').fill('10');
await settle();
const fin10 = await finishOf();
check(fin10[0] - finLo === 6 && fin10[1] - finHi === 5, `A 10-minute T1 moves the finish from our 4–5 minute guide by 6 and 5 minutes (${fin10})`);
const legSum = await page.evaluate(() => {
  const mins = (t) => { const m = /(\d+):(\d\d)(?:–(\d+):(\d\d))?/.exec(t); return m ? [Number(m[1]) * 60 + Number(m[2]), m[3] ? Number(m[3]) * 60 + Number(m[4]) : Number(m[1]) * 60 + Number(m[2])] : [0, 0]; };
  return [...document.querySelectorAll('.targets .leg .s')].map((e) => mins(e.textContent)).reduce((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]);
});
check(legSum[0] === fin10[0] && legSum[1] === fin10[1], 'The legs and changeovers on screen add up to the finish with your own T1');
await page.getByLabel('T1, swim to bike').fill('4.5');
await settle();
check(await page.getByText(/Enter whole minutes, 1 to 30/).isVisible(), 'A T1 that is not whole minutes shows a message');
await page.getByRole('button', { name: 'Save to my race card' }).click();
check(await page.getByRole('heading', { name: 'Your pace targets' }).isVisible(), 'Save waits for a T1 that can be used');
await page.getByLabel('T1, swim to bike').fill('');
await settle();
const finBack = await finishOf();
check(finBack[0] === finLo && finBack[1] === finHi && !(await page.getByText(/Enter whole minutes/).isVisible()), 'A blank T1 goes back to our guide, never zero');
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
// The splits show as the same tiles as the race card, and they are the numbers the plan uses.
const tiles = await page.locator('.fromplan .stat').allInnerTexts();
check(tiles.length === 3 && /Swim/.test(tiles[0]) && /Bike/.test(tiles[1]) && /Run/.test(tiles[2]) && /~\d:\d\d \/100m/.test(tiles[0]) && /~\d+ km\/h/.test(tiles[1]) && /~\d:\d\d \/km/.test(tiles[2]), 'Fuel shows the pace splits as three tiles');
const bikeTile = (/(\d:\d\d)/.exec(tiles[1]) || [])[1];
check(!!bikeTile && new RegExp('Bike · ' + bikeTile).test(fuelText), 'The bike tile is the time the fuel plan uses');
// RD-025. Each gel time shows about how far into the leg it is. The time comes first, and the km is worked out
// here from the leg time on screen and the 70.3 bike distance (90 km), not by calling the app's own helper.
const bikeGelRow = await page.locator('.prow', { hasText: '1 serve of' }).first().innerText();
const bikeLegMin = Number(bikeTile.split(':')[0]) * 60 + Number(bikeTile.split(':')[1]);
const gelKm = [...bikeGelRow.matchAll(/(\d+):(\d\d)\s+~(\d+) km/g)];
check(gelKm.length >= 1 && gelKm.every((m) => Number(m[3]) === Math.round(((Number(m[1]) * 60 + Number(m[2])) / bikeLegMin) * 90)), 'Each bike gel time shows its km, worked out from the leg time and 90 km');
check(gelKm.length >= 1 && /^\d+:\d\d\s+~/.test(bikeGelRow), 'The time comes first and the km second');
check(!/NaN|undefined|null/.test(fuelText), 'The fuel plan shows no NaN, undefined or null');
check((await page.getByText(/Go by the clock: never take a gel earlier than its time\./).count()) >= 1, 'The fuel plan says to go by the clock beside the km');
// The pickers, the line that says what the plan uses and the carry list share one "Your fuel" card.
// The legs come after it, and the cap and safety note stays last.
const topOf = (loc) => loc.evaluate((e) => e.getBoundingClientRect().top);
const carryTop = await topOf(page.getByText('Carry list', { exact: true }));
const swimTop = await topOf(page.getByRole('heading', { name: 'Before the swim' }));
const capTop = await topOf(page.getByText(/Capped at what your gut has trained/));
const runTop = await topOf(page.getByRole('heading', { name: /^Run · / }));
check(carryTop < swimTop && swimTop < runTop && runTop < capTop, 'The carry list sits above the legs and the cap and safety note stays last');
const fuelCard = page.locator('section.card', { has: page.getByText('Your fuel', { exact: true }) });
check((await fuelCard.count()) === 1 && (await fuelCard.locator('select').count()) === 2 && (await fuelCard.getByText('Carry list', { exact: true }).count()) === 1,
  'One "Your fuel" card holds both pickers and the carry list');
check((await page.getByText('What you use', { exact: true }).count()) === 0, 'The old "What you use" card is gone');
check(!/typical/i.test(await fuelCard.innerText()), 'No product name says "typical"');
check(/generic starter products/.test(await fuelCard.innerText()), 'The card says the products are generic starters until you edit them');
// A line right under the product choice says what the plan uses, with the carbs per serve.
check(/The plan uses Gel at 25g a serve and Sports drink at 30g per 500 ml\./.test(fuelText), 'The fuel step says which gel and drink the plan uses, with their carbs');
await stepBarIs('Fuel', 'Fuel');
check((await page.locator('nav.stepbar a.done').allInnerTexts()).map((t) => t.replace(/,\s*done/, '').trim()).join(',') === 'Race,Pacing', 'The step bar marks Race and Pacing done');
const useTop = await topOf(page.getByText(/The plan uses /));
const selTop = await topOf(page.locator('select').first());
check(selTop < useTop && useTop < carryTop, 'That line sits under the product choice and above the carry list');
// A row label may wrap at spaces but is never broken in the middle of a word ("Bottle / s"). A label's box can never be
// narrower than its longest word, so measure each word in the label's own font and compare.
const brokenLabels = () => page.evaluate(() => {
  const ctx = document.createElement('canvas').getContext('2d');
  return [...document.querySelectorAll('.prow span:first-child')].filter((el) => {
    const cs = getComputedStyle(el);
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const longest = Math.max(...el.textContent.split(/\s+/).filter(Boolean).map((w) => ctx.measureText(w).width));
    return el.getBoundingClientRect().width + 0.5 < longest;
  }).map((el) => el.textContent.trim());
});
for (const w of [390, 360, 320]) {
  await page.setViewportSize({ width: w, height: 844 });
  const broken = await brokenLabels();
  check(broken.length === 0, `Plan row labels are not broken mid-word at ${w}px` + (broken.length ? ` (broken: ${broken.join(', ')})` : ''));
}
await page.setViewportSize({ width: 390, height: 844 });
await shot('a2-fuel');
await noHorizontalScroll('Fuel');
// RD-031. Your own gel times: the first, then one every so many minutes.
const suggestedBike = await page.locator('#gel-timing .timing').first().innerText();
check(/Suggested: \d+:\d\d/.test(suggestedBike), 'Gel timing shows the suggested bike times');
await page.getByLabel('Bike: first gel at').fill('030');
await page.getByLabel('Bike: then every').fill('60');
await settle();
const ownBike = await page.locator('#gel-timing .timing').first().innerText();
check(/Your times: 0:30 · 1:30 · 2:30/.test(ownBike), 'Your own bike gel times are used: 0:30, 1:30, 2:30');
const ownRow = await page.locator('.prow', { hasText: '1 serve of' }).first().innerText();
check(/^0:30\s+~\d+ km\s+1:30\s+~\d+ km\s+2:30\s+~\d+ km/.test(ownRow.trim()), 'The bike plan rows follow your own times, with km beside each');
// A gel every 10 minutes is past the 70 g gut figure: refused with a message, and the suggested times stay.
await page.getByLabel('Bike: then every').fill('10');
await settle();
check(await page.getByText(/over your gut figure of 70 g/).isVisible() && /Suggested: /.test(await page.locator('#gel-timing .timing').first().innerText()), 'Gel times past the gut figure are refused, and the suggested times stay');
check(!/Capped at what your gut has trained: (?!70 g)/.test(await page.locator('.app').innerText()), 'The gut cap does not move');
await page.getByLabel('Bike: then every').fill('60');
await settle();
check(/Your times: 0:30 · 1:30 · 2:30/.test(await page.locator('#gel-timing .timing').first().innerText()), 'Going back to every 60 minutes uses your times again');
await shot('a2-fuel-timing');
await noHorizontalScroll('Fuel with gel timing');
await page.getByRole('button', { name: 'Save to my race card' }).click();

// C1 Race card
await page.locator('.racecard').waitFor();
const card = await page.locator('.racecard').innerText();
check(/Spring 70\.3/.test(card) && /175–185/.test(card) && /g\/hr/.test(card), 'Race card shows pace and fuel');
const gelRow = await page.locator('.racecard .tl .tlrow').first().innerText();
check(/^\d+:\d\d\s+Gel\b/.test(gelRow) && /Sip about \d+ ml of (Sports drink( and water)?|water) every 15 min/.test(card), 'Race card lists each gel as a row and names the drink');
check(/~\d+ km/.test(gelRow) && /Go by the clock/.test(card), 'Race card shows km beside the gel times, with the go-by-the-clock line');
check(!/typical/i.test(card), 'Race card has no "typical" in it');
check(!/Countdown|Debrief|Coming later/.test(card), 'Race card hides Countdown and Debrief until they exist');
check(/6:40am start/.test(card) && /Transition opens 5:30am/.test(card), 'Race card shows the start and when the transition opens');
check(card.includes('· about ' + wantClock(6 * 60 + 40)), 'Race card shows the finish as a time of day');
await stepBarIs('Card', 'Race card');
check(/^0:30\s+Gel/.test(gelRow), 'Race card shows your own first gel time');
check(/Changeovers: T1 0:04–0:05 · T2 0:02–0:04/.test(card), 'Race card shows the changeovers the finish includes');
check(/Taper starts|In your taper/.test(card), 'Race card shows when the taper starts');
for (const w of [390, 360, 320]) {
  await page.setViewportSize({ width: w, height: 844 });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  const bar = await page.locator('nav.stepbar a').evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height >= 44 && e.getBoundingClientRect().width >= 44));
  check(sw <= w && bar, `The step bar fits with 44 px targets at ${w}px`);
}
await page.setViewportSize({ width: 390, height: 844 });
await shot('c1-card');

// Print view
await page.emulateMedia({ media: 'print' });
await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
const tt = await page.locator('.tt').textContent();
check(/Bike fuel/.test(tt) && /175–185 W/.test(tt), 'Print card has pace and fuel');
check(/Gel 0:30 · 1:30 · 2:30/.test(tt), 'Print card shows your own bike gel times');
check(/at ~\d+ km/.test(tt) && /Go by the clock/.test(tt) && /Gel \d+:\d\d/.test(tt), 'Print card keeps the times and adds the km and the go-by-the-clock line');
check(!(await page.locator('.app').isVisible()), 'Print hides the app');
check(/Transition opens 5:30am/.test(tt), 'Print card shows when the transition opens');
check(tt.includes('About ' + wantClock(6 * 60 + 40)), 'Print card shows the finish as a time of day');
await shot('print');
await page.emulateMedia({ media: 'screen' });

// Survives a reload: everything was saved on the device
await page.reload();
await page.locator('.racecard').waitFor();
check(/175–185/.test(await page.locator('.racecard').innerText()), 'Race card survives a reload');

// A plan saved before the " (typical)" tag was dropped still holds the tagged names: the card shows them plain
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('race-day-tools.v1'));
  s.race.fuel.carry.gelName = 'Gel (typical)';
  if (s.race.fuel.carry.drink) s.race.fuel.carry.drink = 'Sports drink (typical)';
  localStorage.setItem('race-day-tools.v1', JSON.stringify(s));
});
await page.reload();
await page.locator('.racecard').waitFor();
const oldSave = await page.locator('.racecard').innerText();
check(!/typical/i.test(oldSave) && /Gel/.test(oldSave), 'A plan saved with "(typical)" in its names shows them plain on the card');

// Home with a race
await page.goto(base + '/index.html#/');
await page.getByRole('heading', { name: 'Spring 70.3' }).waitFor();
const homeText = await page.locator('.app').innerText();
check(/2 of 2 done/.test(homeText), 'Home shows 2 of 2 done');
check(!/Countdown|Debrief|Later/.test(homeText), 'Home hides Countdown and Debrief until they exist');
await shot('a1-home');

// RD-031. Jump between steps from the bar, and come back to the card.
await page.goto(base + '/index.html#/card');
await page.locator('nav.stepbar').getByRole('link', { name: /Race/ }).click();
await page.getByRole('heading', { name: 'Which race?' }).waitFor();
await stepBarIs('Race', 'F1 opened from the card');
await page.getByRole('button', { name: 'Save and back to race card' }).click();
await page.locator('.racecard').waitFor();
check(true, 'F1 has "Save and back to race card" once the card has a plan');
await page.locator('nav.stepbar').getByRole('link', { name: /Pacing/ }).click();
await page.getByRole('heading', { name: 'Your pace targets' }).waitFor();
check(true, 'Pacing in the step bar opens the targets once pace is saved');
// Change a number and leave by the step bar without saving: the card says the targets are out of date.
await page.goto(base + '/index.html#/setup/3');
await page.getByLabel('FTP', { exact: true }).fill('260');
await page.locator('nav.stepbar').getByRole('link', { name: /Card/ }).click();
await page.locator('.racecard').waitFor();
check(/Your numbers changed since these targets/.test(await page.locator('.racecard').innerText()), 'Leaving a pacing step by the bar after a change flags the targets as out of date');
// "Save and back to race card" works the targets out again.
await page.goto(base + '/index.html#/setup/3');
await page.getByRole('button', { name: 'Save and back to race card' }).click();
await page.locator('.racecard').waitFor();
const ftp260 = await page.locator('.racecard').innerText();
check(!/Your numbers changed since these targets/.test(ftp260) && !/175–185/.test(ftp260), 'Save and back to race card updates the targets and clears the flag');
await page.goto(base + '/index.html#/setup/3');
await page.getByLabel('FTP', { exact: true }).fill('240');
await page.getByRole('button', { name: 'Save and back to race card' }).click();
await page.locator('.racecard').waitFor();
check(/175–185/.test(await page.locator('.racecard').innerText()), 'Putting FTP back to 240 gives 175–185 W again');

// Lower the gut figure after saving fuel: the card must say the fuel plan is out of date
await page.goto(base + '/index.html#/setup/2');
await page.getByLabel('Carbs your gut handles').fill('50');
await page.goto(base + '/index.html#/card');
check(/changed since this plan/.test(await page.locator('.racecard').innerText()), 'Card flags fuel as out of date after a details change');
await page.goto(base + '/index.html#/fuel');
await page.getByRole('button', { name: 'Update my race card' }).click();
await page.locator('.racecard').waitFor();
const updated = await page.locator('.racecard').innerText();
const bikeG = Number((/Bike\s+(\d+) g\/hr/.exec(updated) || [])[1]);
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
check(/Add a start time to see your finish time of day/.test(noTimes) && !/· about \d/.test(noTimes), 'With no start time the card says so and shows no finish time of day');
// Midnight is a real time and not the same as blank.
await page.goto(base + '/index.html#/setup/1');
await page.getByLabel('Start time').fill('00:00');
await page.goto(base + '/index.html#/card');
const midnightCard = await page.locator('.racecard').innerText();
check(/12:00am start/.test(midnightCard), 'A midnight start shows as 12:00am and not as blank');
check(midnightCard.includes('· about ' + wantClock(0)), 'A midnight start still gives a finish time of day');
// A finish after midnight says so.
await page.goto(base + '/index.html#/setup/1');
await page.getByLabel('Start time').fill('23:00');
await page.goto(base + '/index.html#/card');
check((await page.locator('.racecard').innerText()).includes('· about ' + wantClock(23 * 60)), 'A finish after midnight says next day');

// Products: add one, it appears in the fuel step
await page.goto(base + '/index.html#/products');
await page.getByRole('button', { name: 'Add a product' }).click();
const names = page.getByLabel('Name');
await names.last().fill('Test gel 40');
const carbsList = page.getByLabel('Carbs per serve (g)');
check((await carbsList.last().locator('option').allInnerTexts()).join(',') === '20 g,25 g,30 g,35 g,40 g,45 g,50 g,Other', 'Carbs per serve is a list of 20 g to 50 g in 5 g steps, plus Other');
await carbsList.last().selectOption({ label: '40 g' });
await page.getByRole('link', { name: 'Done' }).click();
await page.getByRole('heading', { name: 'Fuel plan' }).waitFor();
check(!/generic starter products/.test(await page.locator('.app').innerText()), 'Once the person has their own products the starter note goes');
check((await page.locator('select').first().locator('option').allInnerTexts()).join(',') === '20g,25g,30g,40g', 'The fuel step offers the gel carb loads 20g, 25g, 30g and 40g, with the unit in the label');
check((await page.evaluate(() => JSON.parse(localStorage.getItem('race-day-tools.v1')).products.slice(-1)[0].carbs)) === 40, 'Picking 40 g from the list saves exactly 40');
// A figure off the list is typed under Other, kept, and shown as typed after a reload. It is never rounded to a step.
await page.goto(base + '/index.html#/products');
await carbsList.last().selectOption('other');
await page.getByLabel('Exact figure (g)').last().fill('22');
await page.reload();
check((await carbsList.last().inputValue()) === 'other' && (await page.getByLabel('Exact figure (g)').last().inputValue()) === '22', 'A carb figure off the list shows as typed under Other, not rounded');
const saved22 = await page.evaluate(() => JSON.parse(localStorage.getItem('race-day-tools.v1')).products.slice(-1)[0].carbs);
check(saved22 === 22, 'The saved carb figure is exactly 22');
await carbsList.last().selectOption({ label: '40 g' });
check((await page.getByLabel('Exact figure (g)').count()) === (await page.evaluate(() => JSON.parse(localStorage.getItem('race-day-tools.v1')).products.filter((p) => ![20, 25, 30, 35, 40, 45, 50].includes(p.carbs)).length)), 'Picking a step from Other hides the typed box again');
await page.getByRole('link', { name: 'Done' }).click();
await page.getByRole('heading', { name: 'Fuel plan' }).waitFor();
// The carbs the person picks are the carbs the plan uses, and the product's name stays in the rows (RD-009).
await page.locator('select').first().selectOption({ label: '30g' });
const planText = await page.locator('.app').innerText();
check(/1 serve of Gel/.test(planText) && !/1 serve of gel or chews/.test(planText), 'The plan rows still name the gel');
check(/The plan uses Gel at 30g a serve and /.test(planText), 'The "plan uses" line follows the carbs the person picked');
const savedChoice = await page.evaluate(() => JSON.parse(localStorage.getItem('race-day-tools.v1')).choice);
check(savedChoice.gelCarbs === 30, 'The picked gel carbs are saved exactly');
const sipRow = await page.locator('.prow', { hasText: 'Every 15 min' }).innerText();
const mixRow = (await page.locator('.prow', { hasText: 'Mix' }).count()) ? await page.locator('.prow', { hasText: 'Mix' }).first().innerText() : '';
check(!/of drink\s*$/.test(sipRow.trim()) && /Sports drink|water/.test(sipRow + mixRow), 'The sip row names what is in the bottle');
await page.locator('select').nth(1).selectOption({ label: 'Water only' });
check(/ml of water/.test(await page.locator('.prow', { hasText: 'Every 15 min' }).innerText()), 'Water only shows as water in the sip row');
check(/The plan uses Gel at 30g a serve, with water only\./.test(await page.locator('.app').innerText()), 'The "plan uses" line says water only when no drink is picked');

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
const guideTool = await g.locator('.tool').innerText();
check(/at \d+:\d\d \(~\d+ km\)/.test(guideTool) && /Go by the clock/.test(guideTool) && !/NaN/.test(guideTool), 'Fuel guide shows km beside the run gel times, with the go-by-the-clock line');
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
