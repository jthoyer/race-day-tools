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
check(tiles.length === 3 && /Swim/.test(tiles[0]) && /Bike/.test(tiles[1]) && /Run/.test(tiles[2]) && tiles.every((t) => /h:mm/.test(t)), 'Fuel shows the pace splits as three tiles');
const bikeTile = (/(\d:\d\d)/.exec(tiles[1]) || [])[1];
check(!!bikeTile && new RegExp('Bike · ' + bikeTile).test(fuelText), 'The bike tile is the time the fuel plan uses');
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
check(/The plan uses Gel at 25 g a serve and Sports drink at 30 g per 500 ml\./.test(fuelText), 'The fuel step says which gel and drink the plan uses, with their carbs');
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
await page.getByRole('button', { name: 'Save to my race card' }).click();

// C1 Race card
await page.locator('.racecard').waitFor();
const card = await page.locator('.racecard').innerText();
check(/Spring 70\.3/.test(card) && /175–185/.test(card) && /g\/hr/.test(card), 'Race card shows pace and fuel');
check(/Gel at \d/.test(card) && /Sip about \d+ ml of (Sports drink( and water)?|water) every 15 min/.test(card), 'Race card names the gel and the drink');
check(!/Countdown|Debrief|Coming later/.test(card), 'Race card hides Countdown and Debrief until they exist');
check(/6:40am start/.test(card) && /Transition opens 5:30am/.test(card), 'Race card shows the start and when the transition opens');
check(card.includes('· about ' + wantClock(6 * 60 + 40)), 'Race card shows the finish as a time of day');
await shot('c1-card');

// Print view
await page.emulateMedia({ media: 'print' });
await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
const tt = await page.locator('.tt').textContent();
check(/Bike fuel/.test(tt) && /175–185 W/.test(tt), 'Print card has pace and fuel');
check(!(await page.locator('.app').isVisible()), 'Print hides the app');
check(/Transition opens 5:30am/.test(tt), 'Print card shows when the transition opens');
check(tt.includes('About ' + wantClock(6 * 60 + 40)), 'Print card shows the finish as a time of day');
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
check((await page.locator('select').first().innerText()).includes('Test gel 40'), 'A new product shows in the fuel step');
check(!/generic starter products/.test(await page.locator('.app').innerText()), 'Once the person has their own products the starter note goes');
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
// The product the person picks is named in the plan rows, so the choice shows where it is used.
await page.locator('select').first().selectOption({ label: 'Test gel 40' });
const planText = await page.locator('.app').innerText();
check(/1 serve of Test gel 40/.test(planText) && !/1 serve of gel or chews/.test(planText), 'The plan rows name the gel the person picked');
check(/The plan uses Test gel 40 at 40 g a serve and /.test(planText), 'The "plan uses" line follows the gel the person picked, with its carbs');
const sipRow = await page.locator('.prow', { hasText: 'Every 15 min' }).innerText();
const mixRow = (await page.locator('.prow', { hasText: 'Mix' }).count()) ? await page.locator('.prow', { hasText: 'Mix' }).first().innerText() : '';
check(!/of drink\s*$/.test(sipRow.trim()) && /Sports drink|water/.test(sipRow + mixRow), 'The sip row names what is in the bottle');
await page.locator('select').nth(1).selectOption({ label: 'Water only' });
check(/ml of water/.test(await page.locator('.prow', { hasText: 'Every 15 min' }).innerText()), 'Water only shows as water in the sip row');
check(/The plan uses Test gel 40 at 40 g a serve, with water only\./.test(await page.locator('.app').innerText()), 'The "plan uses" line says water only when no drink is picked');

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
