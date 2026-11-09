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
const problems = [];
let n = 0;
let page; // the page the checks below talk to
const KEY = 'race-day-tools.v1';

// Every scenario below says how it is isolated. A "fresh" one is a new browser context: empty storage, no shared module state.
async function fresh(label, { width = 390, init } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => problems.push(`page error (${label}): ` + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) problems.push(`console (${label}): ` + m.text()); });
  // A content-policy violation shows as a console error above, and as a securitypolicyviolation event here.
  await p.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error('CSP blocked ' + e.violatedDirective + ' ' + e.blockedURI)));
  // Fonts come from Google; the test must not depend on the network.
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  if (init) await p.addInitScript(init.fn, init.arg);
  page = p;
  return p;
}
async function shot(name) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true }); }
function check(cond, msg) { if (!cond) problems.push('failed: ' + msg); else console.log('ok  ' + msg); }
async function noHorizontalScroll(where, w = 390) {
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(sw <= w, `no sideways scroll on ${where} at ${w}px (${sw}px)`);
}
const store = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
const settle = () => page.waitForTimeout(700); // the nutrition and targets screens redraw 400 ms after typing stops
const topOf = (loc) => loc.evaluate((e) => e.getBoundingClientRect().top);
const appText = () => page.locator('body').innerText();
const plainName = (t) => t.replace(/,\s*done/, '').replace(/^\d\s*/, '').trim(); // a done step also says ", done" to a screen reader
const isoLocal = (dt) => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
const inDays = (d) => isoLocal(new Date(Date.now() + d * 86400000));
const CLOCK = /\d{1,2}:\d\d ?(am|pm)/i;

// 28 and 29: no whole word "fuel" and no "Standard" in what a person reads.
async function wordsClean(where) {
  const t = await appText();
  check(!/\bfuel\b/i.test(t) && !/\bstandard\b/i.test(t) && !/Race-day tools/.test(t), `${where} has no "fuel", "Standard" or "Race-day tools" in its words`);
}
// 5 and 6. The header and the rail.
async function headerIs(where, { myPlan = true } = {}) {
  const mark = page.locator('header.top').getByRole('link', { name: 'TRI Momentum' });
  const plan = page.locator('header.top').getByRole('link', { name: 'My plan' });
  const tall = async (l) => (await l.count()) > 0 && (await l.evaluate((e) => e.getBoundingClientRect().height >= 44 && e.getBoundingClientRect().width >= 44));
  check((await tall(mark)) && ((await tall(plan)) === myPlan) && /^Momentum$/.test((await mark.innerText()).replace(/\s+/g, ' ').replace(/^T\s*R\s*I\s*/, '').trim()), `${where} header has the wordmark${myPlan ? ' and My plan' : ' and no My plan'}, at least 44 px`);
}
async function railIs(current, where) {
  const links = page.locator('nav.rail a');
  const names = (await links.allInnerTexts()).map(plainName);
  const cur = plainName(await page.locator('nav.rail a[aria-current="step"]').innerText().catch(() => ''));
  // A step not yet done shows its number; a done one shows a tick in the same circle.
  const numbered = (await links.evaluateAll((els) => els.map((e) => [e.classList.contains('done'), e.innerText]))).every(([done, t], i) => done || t.includes(String(i + 1)));
  const tall = await links.evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height >= 44 && e.getBoundingClientRect().width >= 44));
  check(names.join(',') === 'Race,Pacing,Nutrition,Race card' && cur === current && tall && numbered && (await page.locator('nav.rail a[aria-current="step"]').count()) === 1, `${where} has the rail, with ${current} marked`);
  check((await page.locator('nav.stepbar').count()) === 0, `${where} has no old step bar`);
}

// ---------------------------------------------------------------------------------------------------------------
// Scenario 1: front page. Isolation: fresh context, empty storage.
await fresh('front page');
await page.goto(base + '/index.html');
await page.getByRole('heading', { name: 'Race with a plan.' }).waitFor();
await shot('s0');
check((await page.title()) === 'TRI Momentum', 'The tab title is TRI Momentum');
check(await page.getByRole('img', { name: 'TRI Momentum' }).isVisible(), 'S0 shows the wordmark, named TRI Momentum');
check(await page.getByText('Pace targets and a timed nutrition plan for your triathlon, on one race card for your bike.', { exact: true }).isVisible(), 'S0 has the subtitle');
const items = await page.locator('ol.steps li').allInnerTexts();
check(items.length === 4 && items.map((t) => t.replace(/^\d\s*/, '').trim()).join('|') === 'Choose a race|Choose pacing|Review nutrition|Get your race card for your top tube', 'S0 lists the four steps in order');
check(await page.locator('ol.steps li.goal').count() === 1 && /Get your race card/.test(await page.locator('ol.steps li.goal').innerText()), 'S0 puts step 4 on the light blue');
const goalBg = await page.locator('ol.steps li.goal').evaluate((e) => getComputedStyle(e).backgroundColor);
check(goalBg === 'rgb(234, 247, 252)', `S0 step 4 is the --info-bg colour (${goalBg})`);
check(await page.getByText('Free. No account needed. Saved on this phone only.', { exact: true }).isVisible(), 'S0 has the free and on-this-phone note');
check((await page.locator('.btn').count()) === 1 && (await page.getByRole('link', { name: 'Get started' }).isVisible()), 'S0 has one yellow action, "Get started"');
const s0text = await appText();
check(!/Just plan my|Countdown|Debrief|Coming later/.test(s0text) && (await page.getByRole('link', { name: /account/i }).count()) === 0 && (await page.locator('nav.rail').count()) === 0 && (await page.locator('.gallery,.gcard').count()) === 0, 'S0 has no "Just plan my" link, no account link, no rail, no Countdown or Debrief, no gallery');
// The wordmark, the h1, the steps and then the button come in that order.
const s0tops = [await topOf(page.getByRole('img', { name: 'TRI Momentum' })), await topOf(page.getByRole('heading', { name: 'Race with a plan.' })), await topOf(page.locator('ol.steps')), await topOf(page.getByRole('link', { name: 'Get started' }))];
check(s0tops.every((v, i) => i === 0 || v > s0tops[i - 1]), 'S0 shows wordmark, heading, steps and button in order');
// O1, resolved by the owner: the guide links sit at the very bottom of S0, as plain links, each tagged Draft.
const guides = page.locator('section.guides');
const gl = guides.getByRole('link');
check((await guides.locator('.label').innerText()).trim().toLowerCase() === 'guides' && (await gl.count()) === 2, 'S0 has a Guides label and two guide links');
check((await gl.allInnerTexts()).every((t) => /Draft/.test(t)) && /How many gels for a 70\.3\?/.test(await gl.nth(0).innerText()) && /How hard should you ride a 70\.3 bike\?/.test(await gl.nth(1).innerText()), 'S0 guide links use the guides\' own titles and say Draft');
check(await gl.evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height >= 44)), 'S0 guide links are at least 44 px high');
check((await guides.locator('.btn, button').count()) === 0, 'S0 guide links are plain links, not buttons or cards');
check((await topOf(page.getByText('Free. No account needed.'))) < (await topOf(guides)) && (await guides.evaluate((e) => e.getBoundingClientRect().bottom)) >= (await page.locator('body').evaluate((b) => b.getBoundingClientRect().bottom)) - 40, 'S0 puts the guides below the note, at the very bottom');
await wordsClean('S0');
// The probe is expected to be refused; its console errors are dropped at the end by its unique address.
const sent = await page.evaluate(() => fetch('/__csp_probe__').then(() => true, () => false));
check(sent === false, 'Content policy blocks every network request (connect-src none)');
await noHorizontalScroll('S0');
for (const [i, href] of ['guides/race-fuel.html', 'guides/bike-pacing.html'].entries()) {
  await page.goto(base + '/index.html');
  await page.locator('section.guides').getByRole('link').nth(i).click();
  await page.waitForURL('**/' + href);
  check(/· TRI Momentum$/.test(await page.title()), `The S0 guide link ${i + 1} opens ${href}`);
}
await page.context().close();

// ---------------------------------------------------------------------------------------------------------------
// Scenario 2: the main journey. Isolation: fresh context. This one deliberately shares a session from step to step,
// because a plan is built by walking the steps and what is saved is what the later steps read. Reloads are used
// where a check is about what was persisted.
await fresh('journey');
await page.goto(base + '/index.html');
await page.getByRole('link', { name: 'Get started' }).click();
await page.getByRole('heading', { name: 'Choose a race' }).waitFor();
// 2. Leaving step 1 empty returns to S0.
await headerIs('Step 1');
await railIs('Race', 'Step 1');
await page.locator('header.top').getByRole('link', { name: 'My plan' }).click();
await page.getByRole('heading', { name: 'Race with a plan.' }).waitFor();
check((await page.getByRole('link', { name: 'Get started' }).isVisible()) && (await page.locator('nav.rail').count()) === 0, 'My plan on an empty step 1 goes back to the front page');
const keysNew = await store();
check(!('start' in keysNew.race) && !('transitionOpens' in keysNew.race), 'A new race is made without start or transitionOpens');
await page.getByRole('link', { name: 'Get started' }).click();
await page.getByRole('heading', { name: 'Choose a race' }).waitFor();
check(await page.getByText('Tap the date to choose it.').isVisible(), 'Step 1 says what to do with an empty date');
const s1text = await appText();
check(/Every step works back from race day\./.test(s1text) && !/Start time|Transition opens|Clear start|Clear transition/.test(s1text) && (await page.locator('input[type=time]').count()) === 0, 'Step 1 has its subtitle and no start time, no Transition opens, no Clear buttons');
check(!(await page.getByRole('button', { name: 'Save and back to race card' }).count()), 'A first pass through the steps has no "back to race card" yet');
await page.getByLabel('Race name').fill('Spring 70.3');
// Olympic stores "standard", shows its legs, and marks 10 days as our guide.
await page.getByLabel('Race date').fill(inDays(20));
await page.getByRole('button', { name: 'Olympic' }).click();
check((await store()).race.distance === 'standard' && (await page.getByText('Swim 1.5 km · Bike 40 km · Run 10 km').isVisible()) && /10 days \(our guide\)/.test(await page.getByRole('button', { name: /10 days/ }).innerText()), 'Choosing Olympic stores "standard", shows 1.5 / 40 / 10 km and marks 10 days (our guide)');
check(!/\bstandard\b/i.test(await appText()), 'Step 1 never shows "Standard"');
await page.getByRole('button', { name: '70.3', exact: true }).click();
check(await page.getByText('Swim 1.9 km · Bike 90 km · Run 21.1 km').isVisible() && (await store()).race.distance === '70.3', 'Choosing 70.3 shows the 70.3 leg distances');
check(await page.getByText(/days to go/).first().isVisible(), 'Step 1 shows days to go');
// RD-011, RD-031. Taper length: our guide (14 days for a 70.3) is marked, one tap changes it, and a picked day works.
const taperStore = async () => (await store()).race.taperDays;
check((await page.getByRole('button', { name: /14 days/ }).getAttribute('aria-pressed')) === 'true' && /14 days \(our guide\)/.test(await page.getByRole('button', { name: /14 days/ }).innerText()), 'Step 1 marks our 14-day taper guide for a 70.3');
const taperBefore = await page.locator('.countdown .n').innerText();
await page.getByRole('button', { name: /21 days/ }).click();
check((await taperStore()) === 21 && (await page.locator('.countdown .n').innerText()) !== taperBefore, 'Picking a 21-day taper saves it and moves the start');
check(/You are in your taper/.test(await page.locator('.countdown .n').innerText()), 'A taper longer than the days to go says you are in it');
const raceDay = new Date(Date.now() + 20 * 86400000);
const sevenBefore = new Date(raceDay.getFullYear(), raceDay.getMonth(), raceDay.getDate() - 7);
await page.getByLabel('Or pick the day your taper starts').fill(isoLocal(sevenBefore));
check((await taperStore()) === 7, 'Picking the day the taper starts saves a 7-day taper');
const after = new Date(raceDay.getFullYear(), raceDay.getMonth(), raceDay.getDate() + 3);
await page.getByLabel('Or pick the day your taper starts').fill(isoLocal(after));
check(await page.getByText(/Pick a day 1 to 42 days before race day/).isVisible() && (await taperStore()) === 7 && (await page.getByLabel('Or pick the day your taper starts').inputValue()) === isoLocal(after), 'A taper day after the race is refused, not saved, and stays on screen with its message');
await page.getByRole('button', { name: /14 days/ }).click();
check((await taperStore()) == null && !(await page.getByText(/Pick a day 1 to 42/).isVisible()), 'Going back to 14 days uses our guide again');
await wordsClean('Step 1');
for (const w of [390, 360, 320]) { await page.setViewportSize({ width: w, height: 844 }); await noHorizontalScroll('Step 1', w); }
await page.setViewportSize({ width: 390, height: 844 });
await shot('step1');
await page.getByRole('button', { name: 'Next: choose pacing' }).click();

// Step 2, part 1: Your fitness.
await page.getByRole('heading', { name: 'Choose pacing' }).waitFor();
await headerIs('Pacing part 1');
await railIs('Pacing', 'Pacing part 1');
const bar = (await page.locator('.progress').innerText()).replace(/\s+/g, ' ');
check(/Pacing · part 1 of 3/i.test(bar) && (await page.locator('.progress .seg').count()) === 3 && /Your fitness · Course and heat · Your targets/.test(bar) && (await page.locator('.progress .parts b').innerText()) === 'Your fitness', 'Part 1 shows "Pacing · part 1 of 3", three segments and the part line with Your fitness in bold');
check(await page.getByText('How will you pace the bike and the run?').isVisible() && (await page.getByText('Power needs your FTP. The swim always uses your CSS.').isVisible()), 'Part 1 has its subtitle and says what Power needs');
// S2 order: the choice, CSS, the bike fields, run threshold, weight.
const p1tops = [await topOf(page.getByRole('button', { name: 'Power' })), await topOf(page.getByLabel('CSS, your critical swim speed')), await topOf(page.getByLabel('FTP', { exact: true })), await topOf(page.getByLabel('Run threshold', { exact: true })), await topOf(page.getByLabel('Body weight'))];
check(p1tops.every((v, i) => i === 0 || v > p1tops[i - 1]), 'Part 1 is in S2 order: mode choice, CSS, FTP, run threshold, body weight');
check(/Your steady swim pace per 100 m in a pool/.test(await appText()) && (await page.getByText('Turns your power into a bike time. It does not change your nutrition plan.').isVisible()), 'Part 1 says what CSS is and has the owner\'s weight line');
check(await page.getByText('When did you test it?').isVisible() && (await page.getByRole('button', { name: 'In the last 6 weeks' }).isVisible()) && (await page.getByRole('button', { name: 'Longer ago' }).isVisible()), 'Part 1 asks when FTP was tested, with two options');
// Next with nothing typed stays put and shows a message by CSS, FTP, run threshold and weight.
await page.getByRole('button', { name: 'Next: course and heat' }).click();
check(await page.getByRole('heading', { name: 'Choose pacing' }).isVisible(), 'Part 1 refuses to move on with empty fields');
const invalid = await page.locator('[aria-invalid="true"]').evaluateAll((els) => els.map((e) => e.id).sort());
check(invalid.join(',') === 'f-details-weight,f-fitness-css,f-fitness-ftp,f-fitness-runThreshold' && (await page.getByRole('alert').count()) >= 4, `Part 1 marks CSS, FTP, run threshold and weight invalid (${invalid})`);
await wordsClean('Pacing part 1');
// Switching mode keeps what was typed.
await page.getByLabel('FTP', { exact: true }).fill('240');
await page.getByRole('button', { name: 'Heart rate' }).click();
check((await page.getByLabel('Bike threshold heart rate').isVisible()) && (await page.getByLabel('Run threshold heart rate').isVisible()), 'Heart rate mode asks for both threshold heart rates');
await page.getByRole('button', { name: 'Power' }).click();
check((await page.getByLabel('FTP', { exact: true }).inputValue()) === '240', 'Switching pace mode keeps the FTP that was typed');
// Weight: 20 is refused with the message, a blank is never zero.
await page.getByLabel('Body weight').fill('20');
await page.getByRole('button', { name: 'Next: course and heat' }).click();
check(await page.getByText('Enter a body weight between 35 and 150 kg.').isVisible() && (await page.getByLabel('Body weight').getAttribute('aria-invalid')) === 'true', 'A weight of 20 is refused with its message');
await page.getByLabel('Body weight').fill('');
check((await store()).details.weight === null, 'A blank weight is stored as null, never zero');
// Time entry: digits become a time, a dot works, one or two digits are refused, and an error goes as soon as the entry reads.
const cssBox = page.getByLabel('CSS, your critical swim speed');
await cssBox.fill('45');
await page.getByRole('button', { name: 'Next: course and heat' }).click();
check(await page.getByText('Type minutes and seconds, such as 1:45 or 145.').isVisible() && (await page.getByRole('heading', { name: 'Choose pacing' }).isVisible()), 'Part 1 refuses 45 and says what to type');
await cssBox.fill('175');
await page.getByRole('button', { name: 'Next: course and heat' }).click();
check(await page.getByText('Seconds go up to 59.').isVisible(), 'Part 1 refuses 175 because seconds stop at 59');
await cssBox.fill('130');
check(!(await page.getByText('Seconds go up to 59.').isVisible()), 'The error goes as soon as the entry reads');
await cssBox.blur();
check((await cssBox.inputValue()) === '1:30', 'Typing 130 shows 1:30 when the person leaves the field');
await cssBox.fill('1.45');
await cssBox.blur();
check((await cssBox.inputValue()) === '1:45', 'A dot works like a colon: 1.45 shows 1:45');
const runBox = page.getByLabel('Run threshold', { exact: true });
await runBox.fill('450');
await runBox.blur();
check((await runBox.inputValue()) === '4:50', 'Typing 450 shows 4:50');
await page.getByLabel('Body weight').fill('72');
await shot('pacing-1');
await noHorizontalScroll('Pacing part 1');
await page.getByRole('button', { name: 'Next: course and heat' }).click();

// Part 2.
await page.getByRole('heading', { name: 'Course and heat' }).waitFor();
check(/Pacing · part 2 of 3/i.test(await page.locator('.progress').innerText()) && (await page.locator('.progress .parts b').innerText()) === 'Course and heat', 'Part 2 shows part 2 of 3 with Course and heat in bold');
await railIs('Pacing', 'Pacing part 2');
await page.getByRole('button', { name: /Rolling/ }).click();
await page.getByRole('button', { name: /Warm/ }).click();
await wordsClean('Pacing part 2');
await shot('pacing-2');
check((await page.getByRole('link', { name: 'Back: your fitness' }).getAttribute('href')) === '#/pacing/1', 'Part 2 has a quiet Back to part 1');
await page.getByRole('button', { name: 'Next: your targets' }).click();

// Part 3.
await page.getByRole('heading', { name: 'Your pace targets' }).waitFor();
await railIs('Pacing', 'Pacing part 3');
const targets = await page.locator('.targets').innerText();
check(/175–185 W/.test(targets), 'Part 3 bike target is 175–185 W');
check(/5:15–5:30 \/km/.test(targets), 'Part 3 run target is 5:15–5:30 /km');
check(/FINISH\s*\n?\s*\d:\d\d–\d:\d\d/.test(targets), 'Part 3 finish is a range');
check(!CLOCK.test(await appText()) && !/Add a start time|About \d/.test(await appText()), 'Part 3 has no finish time of day and no "Add a start time"');
check(await page.getByText('How we got these').isVisible() && (await page.locator('details.why').evaluate((e) => e.open)) && /not medical advice/i.test(await appText()), 'Part 3 shows how we got these, open, and says not medical advice');
check(await page.getByText(/your CSS \(your steady pool pace\) of 1:45/).isVisible(), 'Part 3 says what CSS is where it first uses it');
const finLo0 = (() => { const m = /FINISH\s*\n?\s*(\d+):(\d\d)–(\d+):(\d\d)/.exec(targets); return Number(m[1]) * 60 + Number(m[2]); })();
const finHi0 = (() => { const m = /FINISH\s*\n?\s*(\d+):(\d\d)–(\d+):(\d\d)/.exec(targets); return Number(m[3]) * 60 + Number(m[4]); })();
const finishOf = async () => { const m = /FINISH\s*\n?\s*(\d+):(\d\d)–(\d+):(\d\d)/.exec(await page.locator('.targets').innerText()); return [Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])]; };
const legSum = () => page.evaluate(() => {
  const mins = (t) => { const m = /(\d+):(\d\d)(?:–(\d+):(\d\d))?/.exec(t); return m ? [Number(m[1]) * 60 + Number(m[2]), m[3] ? Number(m[3]) * 60 + Number(m[4]) : Number(m[1]) * 60 + Number(m[2])] : [0, 0]; };
  return [...document.querySelectorAll('.targets .leg .s')].map((e) => mins(e.textContent)).reduce((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]);
});
const sum0 = await legSum();
check(sum0[0] === finLo0 && sum0[1] === finHi0, 'The legs and changeovers on screen add up to the finish');
// RD-031. Your own T1: the finish moves by exactly the difference, and the legs still add up to it.
const t1Row = await page.locator('.targets .leg', { hasText: 'T1' }).innerText();
check(/Our guide/.test(t1Row) && /0:04–0:05/.test(t1Row), 'Part 3 shows T1 on its own row, with our guide');
await page.getByLabel('T1, swim to bike').fill('10');
await settle();
const fin10 = await finishOf();
check(fin10[0] - finLo0 === 6 && fin10[1] - finHi0 === 5, `A 10-minute T1 moves the finish from our 4–5 minute guide by 6 and 5 minutes (${fin10})`);
const sum10 = await legSum();
check(sum10[0] === fin10[0] && sum10[1] === fin10[1], 'The legs and changeovers on screen add up to the finish with your own T1');
await page.getByLabel('T1, swim to bike').fill('4.5');
await settle();
check(await page.getByText(/Enter whole minutes, 1 to 30/).isVisible(), 'A T1 that is not whole minutes shows a message');
await page.getByRole('button', { name: 'Save to my race card' }).click();
check(await page.getByRole('heading', { name: 'Your pace targets' }).isVisible(), 'Save waits for a T1 that can be used');
await page.getByLabel('T1, swim to bike').fill('');
await settle();
const finBack = await finishOf();
check(finBack[0] === finLo0 && finBack[1] === finHi0 && !(await page.getByText(/Enter whole minutes/).isVisible()), 'A blank T1 goes back to our guide, never zero');
check((await page.getByRole('link', { name: 'Back: course and heat' }).getAttribute('href')) === '#/pacing/2', 'Part 3 has a quiet Back to part 2');
await wordsClean('Pacing part 3');
await shot('pacing-3');
await noHorizontalScroll('Pacing part 3');
await page.getByRole('button', { name: 'Save to my race card' }).click();

// Step 3, first arrival: the first save opens step 3 with a status line.
await page.getByRole('heading', { name: 'Review nutrition' }).waitFor();
check(page.url().endsWith('#/fuel') && (await page.getByRole('status').filter({ hasText: 'Pace targets saved to your race card' }).isVisible()), 'The first save opens step 3 with "Pace targets saved to your race card"');
await railIs('Nutrition', 'Step 3');
check((await page.locator('nav.rail a.done').allInnerTexts()).map(plainName).join(',') === 'Race,Pacing', 'The rail marks Race and Pacing done, and never Race card');

// S5, after pacing is saved. Isolation: same session, a reload (full page load) to home.
await page.goto(base + '/index.html#/');
await page.reload();
await page.getByRole('heading', { name: 'Spring 70.3' }).waitFor();
const s5a = await appText();
check(/Two steps done, two to go\./.test(s5a) && /Next: check your gut figure and pick your carbs/.test(s5a), 'S5 after pacing says "Two steps done, two to go." and what step 3 is');
check((await page.getByRole('link', { name: 'Continue: review nutrition' }).isVisible()) && (await page.locator('.btn').count()) === 1, 'S5 after pacing has one yellow action, "Continue: review nutrition"');
check(/Bike 175–185 W · finish \d:\d\d–\d:\d\d/.test(s5a) && /days to go/i.test(s5a) && /Taper starts|In your taper/.test(s5a), 'S5 shows the days to go, the taper line and the pacing summary');
check((await page.locator('nav.rail').count()) === 0 && (await page.locator('header.top').getByRole('link', { name: 'My plan' }).count()) === 0 && (await page.locator('header.top').getByRole('link', { name: 'TRI Momentum' }).count()) === 1, 'S5 has the wordmark, no My plan and no rail');
check(!/n of 2 done|Your details|Open race card/.test(s5a) && (await page.getByRole('link', { name: 'Edit' }).count()) === 2 && (await page.getByRole('link', { name: 'Edit' }).evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height >= 44))), 'S5 has two Edit links (steps 1 and 2) at least 44 px high, and none of the old home');
check((await page.locator('section.guides').count()) === 0 && !/Guides/.test(s5a), 'S5 has no guide links (they are on S0 only)');
check(/Ready once nutrition is done/.test(s5a) && (await page.locator('li.step.goal').count()) === 1, 'S5 keeps step 4 on the light blue until it is done');
await headerIs('S5', { myPlan: false });
await wordsClean('S5');
await shot('s5-after-pacing');
await noHorizontalScroll('S5');
await page.getByRole('link', { name: 'Continue: review nutrition' }).click();
await page.getByRole('heading', { name: 'Review nutrition' }).waitFor();
check(!(await page.getByText('Pace targets saved to your race card').count()), 'The "targets saved" line is gone on a later visit to step 3');

// Step 3, first time: the gut figure has no default; the plan waits.
check((await page.getByText('Built from your pacing. Change anything that looks wrong.').isVisible()), 'Step 3 has its subtitle');
const gutBox = page.getByLabel('Carbs your gut handles');
check((await gutBox.inputValue()) === '' && !(await gutBox.getAttribute('placeholder')), 'The gut field starts with no value and no numeric placeholder');
check(/Typical for warm: 0\.8 L\/hr/.test(await appText()), 'The sweat question offers "Typical for warm: 0.8 L/hr"');
check((await page.locator('.tl').count()) === 0 && (await page.getByRole('button', { name: /Next: get your race card|Update my race card/ }).count()) === 0 && (await page.getByText('To see your plan:').isVisible()) && /gut handles/i.test(await page.locator('.info.warn').innerText()), 'With no gut figure there are no leg cards, no save button, and a message says what is needed');
await wordsClean('Step 3 (first time)');
// Bad entries show by the field once the person leaves it, and the plan does not use them.
const planGone = async () => (await page.locator('.tl').count()) === 0 && (await page.getByRole('button', { name: /Next: get your race card|Update my race card/ }).count()) === 0;
await gutBox.fill('130');
await gutBox.blur();
check((await gutBox.getAttribute('aria-invalid')) === 'true' && (await page.locator('#f-details-gut-err').isVisible()) && (await planGone()), 'A gut figure of 130 shows a message by the field and makes no plan');
await settle();
check((await gutBox.getAttribute('aria-invalid')) === 'true' && (await planGone()), 'That message and the missing plan survive the redraw');
await gutBox.fill('abc');
await gutBox.blur();
check((await gutBox.getAttribute('aria-invalid')) === 'true' && (await planGone()), 'An unreadable gut figure shows a message and makes no plan');
await gutBox.fill('');
await gutBox.blur();
check((await store()).details.gut === null && (await gutBox.getAttribute('aria-invalid')) === 'true' && (await planGone()), 'A blank gut figure shows a message and is stored as null, never zero');
// An own sweat rate: blank, unreadable and out of range are refused, never swapped for the typical rate.
await gutBox.fill('70');
await settle();
check((await page.locator('.tl').count()) === 2 && (await gutBox.getAttribute('aria-invalid')) === null, 'A gut figure of 70 clears the message and makes the plan');
await page.getByRole('button', { name: 'I know mine' }).click();
const sweatBox = page.locator('#f-details-sweat');
await sweatBox.focus();
await sweatBox.blur();
check((await sweatBox.getAttribute('aria-invalid')) === 'true' && (await planGone()), 'A blank own sweat rate shows a message and makes no plan (it is not swapped for typical)');
await sweatBox.fill('abc');
await sweatBox.blur();
check((await sweatBox.getAttribute('aria-invalid')) === 'true' && (await planGone()) && (await store()).details.sweat === null, 'An unreadable own sweat rate shows a message and makes no plan');
await sweatBox.fill('5');
await sweatBox.blur();
check((await sweatBox.getAttribute('aria-invalid')) === 'true' && (await planGone()), 'An own sweat rate of 5 shows a message and makes no plan');
await sweatBox.fill('0.9');
await settle();
check((await sweatBox.getAttribute('aria-invalid')) === null && (await page.locator('.tl').count()) === 2 && (await store()).details.sweat === 0.9, 'An own sweat rate of 0.9 is used');
check(/sweat rate of 0\.9 L an hour/.test(await appText()) && !/typical sweat rate/.test(await page.locator('.info.warn').last().innerText()), 'The cap note names the rate that was typed');
// Heat stays on step 3, and changes the typical line.
await page.getByRole('button', { name: 'I know mine' }).waitFor();
await page.getByRole('button', { name: /Hot/ }).click();
check((await store()).race.heat === 'hot' && /Typical for hot: 1\.1 L\/hr/.test(await appText()), 'Hot sets race.heat and changes the "Typical for" line');
await page.getByRole('button', { name: /Warm/ }).click();
check((await store()).race.heat === 'warm' && /Typical for warm: 0\.8 L\/hr/.test(await appText()), 'Warm sets race.heat again');
await settle();

// Order, S3 extended.
const o = [
  await topOf(page.getByRole('heading', { name: 'Review nutrition' })),
  await topOf(page.getByText('From your pacing', { exact: true })),
  await topOf(page.getByText('Your gut and sweat', { exact: true })),
  await topOf(page.getByText('Your nutrition', { exact: true })),
  await topOf(page.getByRole('heading', { name: 'Nutrition plan' })),
  await topOf(page.getByRole('heading', { name: 'Before the swim' })),
  await topOf(page.locator('.tl').first()),
  await topOf(page.locator('p.notice.go')),
  await topOf(page.getByText('Gel timing', { exact: true })),
  await topOf(page.getByText(/Capped at what your gut has trained/)),
  await topOf(page.getByRole('button', { name: 'Next: get your race card' }))
];
check(o.every((v, i) => i === 0 || v > o[i - 1]), `Step 3 is in order: heading, tiles, gut and sweat, nutrition card, plan, gel timing, cap note, actions (${o.map(Math.round)})`);
const lastBlock = await page.evaluate(() => { const a = document.querySelector('.actions'); const prev = a.previousElementSibling; return /Capped at what your gut has trained/.test(prev.textContent); });
check(lastBlock, 'The cap and safety note is the last block before the actions');

// Tiles, summary line, leg cards.
const fuelText = await page.locator('.app').innerText();
const tiles = await page.locator('.fromplan .stat').allInnerTexts();
check(tiles.length === 3 && /Swim/.test(tiles[0]) && /Bike/.test(tiles[1]) && /Run/.test(tiles[2]) && /~\d:\d\d \/100m/.test(tiles[0]) && /~\d+ km\/h/.test(tiles[1]) && /~\d:\d\d \/km/.test(tiles[2]), 'Step 3 shows the pace splits as three tiles, with the small pace line');
const bikeTile = (/(\d:\d\d)/.exec(tiles[1]) || [])[1];
const splitsSaved = (await store()).race.splits;
check(!!bikeTile && bikeTile === `${Math.floor(splitsSaved.bike / 60)}:${String(splitsSaved.bike % 60).padStart(2, '0')}` && (await page.locator('.tl').first().locator('.tlrow').count()) > 0, 'The bike tile is the time the plan uses (the saved split)');
check(/Capped at what your gut has trained: 70 g an hour/.test(fuelText) && /not medical advice/i.test(fuelText), 'Step 3 shows the gut cap and not medical advice');
check(!/NaN|undefined|null/.test(fuelText), 'Step 3 shows no NaN, undefined or null');
const summary = (await page.locator('h2.planhead + p').innerText()).trim();
const rowsN = await page.locator('.tl .tlrow').count();
const sm = /^(\d+) gels?, (water|a drink|a drink and water) on the bike, water on the run\.$/.exec(summary);
check(!!sm && Number(sm[1]) === rowsN && rowsN > 0, `The summary line "${summary}" counts the gel rows shown (${rowsN})`);
const bikeCard = page.locator('.tl').nth(0);
const runCard = page.locator('.tl').nth(1);
check(/^Bike\s+\d+ g\/hr/.test((await bikeCard.locator('header').innerText()).replace(/\s+/g, ' ')) && /^Run\s+\d+ g\/hr/.test((await runCard.locator('header').innerText()).replace(/\s+/g, ' ')), 'Each leg card has its name and a g/hr chip');
check(/^(Sports drink( and water)?|Water): about \d+ ml every 15 min$/.test((await bikeCard.locator('.tlline').first().innerText()).trim()), 'The bike card has the drink line "<what is in the bottle>: about <n> ml every 15 min"');
check(!/\(typical\)/i.test(fuelText) && /Water at each aid station/.test(await runCard.innerText()) && /Bottles: start with/.test(await bikeCard.innerText()) && /Sodium: ~\d+ mg\/hr/.test(await bikeCard.innerText()) && /Sodium: ~\d+ mg\/hr/.test(await runCard.innerText()), 'Leg cards keep the water line, bottles and sodium lines, and no "(typical)"');
// RD-025. Each bike gel row has its km, worked out here from the leg time on screen and the 70.3 bike distance (90 km).
const bikeLegMin = Number(bikeTile.split(':')[0]) * 60 + Number(bikeTile.split(':')[1]);
const gelRows = await bikeCard.locator('.tlrow').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
const gelKm = gelRows.map((t) => /^(\d+):(\d\d) (.+?) ~(\d+) km$/.exec(t)).filter(Boolean);
check(gelKm.length === gelRows.length && gelKm.length >= 1 && gelKm.every((m) => Number(m[4]) === Math.round(((Number(m[1]) * 60 + Number(m[2])) / bikeLegMin) * 90)), 'Each bike gel row is time, name, then km = round(time ÷ leg time × 90)');
check(gelKm.every((m) => m[3] === 'Gel'), 'Gel rows name the product plainly, "Gel"');
const noteEl = page.locator('p.notice.go');
const noteText = (await noteEl.innerText()).replace(/\s+/g, ' ').trim();
const kmNote = await page.evaluate(() => RD.pace.KM_NOTE);
check((await page.locator('p.notice.go').count()) === 1 && noteText === kmNote && (await noteEl.locator('b').innerText()) === 'Go by the clock.', 'One go-by-the-clock note sits under the legs, with the owner\'s words and "Go by the clock." in bold');
// The "Your nutrition" card: pickers, plan-uses line, starter note, carry list.
const nutCard = page.locator('section.card', { has: page.getByText('Your nutrition', { exact: true }) });
check((await nutCard.count()) === 1 && (await nutCard.locator('select').count()) === 2 && (await nutCard.getByText('Carry list', { exact: true }).count()) === 1 && /generic starter products/.test(await nutCard.innerText()) && !/typical/i.test(await nutCard.innerText()), 'One "Your nutrition" card holds both pickers, the starter note and the carry list');
check(/The plan uses Gel at 25g a serve and Sports drink at 30g per 500 ml\./.test(fuelText), 'Step 3 says which gel and drink the plan uses, with their carbs');
// A row label may wrap at spaces but is never broken in the middle of a word. A box can never be narrower than its
// longest word, so measure each word in the element's own font and compare.
const brokenText = () => page.evaluate(() => {
  const ctx = document.createElement('canvas').getContext('2d');
  return [...document.querySelectorAll('.tl .tlline, .tl .tlrow span, .tl h3, .tl .badge')].filter((el) => {
    const cs = getComputedStyle(el);
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const longest = Math.max(...el.textContent.split(/\s+/).filter(Boolean).map((w) => ctx.measureText(w).width));
    return el.getBoundingClientRect().width + 0.5 < longest;
  }).map((el) => el.textContent.trim());
});
for (const w of [390, 360, 320]) {
  await page.setViewportSize({ width: w, height: 844 });
  const broken = await brokenText();
  check(broken.length === 0, `Nutrition leg card text is not broken mid-word at ${w}px` + (broken.length ? ` (broken: ${broken.join(', ')})` : ''));
  await noHorizontalScroll('Step 3', w);
  const legsFit = await page.locator('.tl').evaluateAll((els) => els.every((e) => e.scrollWidth <= e.clientWidth + 1));
  check(legsFit, `The leg cards have no sideways scroll at ${w}px`);
}
await page.setViewportSize({ width: 390, height: 844 });
// The rail stays in view: after scrolling to the bottom, its top edge is inside the viewport.
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
const railTop = await page.locator('nav.rail').evaluate((e) => e.getBoundingClientRect().top);
check(railTop >= 0 && railTop < 844, `The rail stays in view after scrolling to the bottom (top ${Math.round(railTop)}px)`);
await page.evaluate(() => window.scrollTo(0, 0));
await shot('step3');

// RD-031. Your own gel times: the first, then one every so many minutes. (Gel timing sits below the plan.)
const suggestedBike = await page.locator('#gel-timing .timing').first().innerText();
check(/Suggested: \d+:\d\d/.test(suggestedBike), 'Gel timing shows the suggested bike times');
await page.getByLabel('Bike: first gel at').fill('030');
await page.getByLabel('Bike: then every').fill('60');
await settle();
check(/Your times: 0:30 · 1:30 · 2:30/.test(await page.locator('#gel-timing .timing').first().innerText()), 'Your own bike gel times are used: 0:30, 1:30, 2:30');
const ownRows = await page.locator('.tl').first().locator('.tlrow').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
check(ownRows.length === 3 && /^0:30 Gel ~\d+ km$/.test(ownRows[0]) && /^1:30 /.test(ownRows[1]) && /^2:30 /.test(ownRows[2]), 'The bike leg card follows your own times, with km beside each');
await page.getByLabel('Bike: then every').fill('10');
await settle();
check(await page.getByText(/over your gut figure of 70 g/).isVisible() && /Suggested: /.test(await page.locator('#gel-timing .timing').first().innerText()), 'Gel times past the gut figure are refused, and the suggested times stay');
check(!/Capped at what your gut has trained: (?!70 g)/.test(await page.locator('.app').innerText()), 'The gut cap does not move');
await page.getByLabel('Bike: then every').fill('60');
await settle();
check(/Your times: 0:30 · 1:30 · 2:30/.test(await page.locator('#gel-timing .timing').first().innerText()), 'Going back to every 60 minutes uses your times again');
await shot('step3-timing');
// Save: with no saved nutrition the yellow action is "Next: get your race card"; Print is outlined.
const nextBtn = page.getByRole('button', { name: 'Next: get your race card' });
check((await page.locator('.actions .btn:not(.ghost)').count()) === 1 && /ghost/.test(await page.getByRole('button', { name: 'Print top-tube card' }).getAttribute('class')), 'Step 3 has one yellow action, and Print is outlined');
await nextBtn.click();

// Step 4: the race card.
await page.locator('.racecard').waitFor();
await headerIs('The race card');
await railIs('Race card', 'The race card');
const card = await page.locator('.racecard').innerText();
check(/Spring 70\.3/.test(card) && /175–185/.test(card) && /g\/hr/.test(card), 'Race card shows pacing and nutrition');
check(/^\s*\d+\s*\n?\s*[A-Z]{3}/.test(card) && /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) · \d+ days to go/.test(card.replace(/\s+/g, ' ')), 'The card band has the date box and "<weekday> · <days text>"');
check(/Taper starts|In your taper/.test(card) && /\bPacing\b/i.test(card) && /\bNutrition\b/i.test(card), 'The card has Pacing and Nutrition sections and the taper line');
check((await page.locator('.racecard .sechead a', { hasText: 'Step 2' }).getAttribute('href')) === '#/pacing/3' && (await page.locator('.racecard .sechead a', { hasText: 'Step 3' }).getAttribute('href')) === '#/fuel', 'The card links Step 2 to pacing part 3 and Step 3 to step 3');
check(!CLOCK.test(card) && !/Transition|start time/i.test(card), 'The card has no time of day, no transition and no start time');
check(/Changeovers: T1 0:04–0:05 · T2 0:02–0:04/.test(card) && /Finish \d:\d\d–\d:\d\d/.test(card), 'Race card shows the finish range and the changeovers it includes');
const cardRows = await page.locator('.racecard .tl').first().locator('.tlrow').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
check(cardRows.length === 3 && /^0:30 Gel ~\d+ km$/.test(cardRows[0]), 'The card has the same leg cards, with your own first gel and its km');
check((await page.locator('.racecard p.notice.go').count()) === 1 && (await page.locator('.racecard p.notice.go').innerText()).replace(/\s+/g, ' ').trim() === kmNote && (await page.getByRole('link', { name: 'Change gel times' }).isVisible()), 'The card has the go-by-the-clock note once, and "Change gel times"');
check(await page.getByRole('link', { name: 'Change gel times' }).evaluate((e) => e.getBoundingClientRect().height >= 44), 'The card\'s "Change gel times" link is at least 44 px high');
check(!/typical/i.test(card) && !/Countdown|Debrief|Coming later/.test(card) && /not medical advice/i.test(await appText()), 'The card has no "(typical)", no Countdown or Debrief, and says not medical advice');
check((await page.locator('.btn:not(.ghost)').count()) === 1 && (await page.getByRole('button', { name: 'Print top-tube card' }).evaluate((e) => !e.classList.contains('ghost'))), 'With pacing and nutrition saved, Print is the one yellow action');
await wordsClean('The race card');
for (const w of [390, 360, 320]) {
  await page.setViewportSize({ width: w, height: 844 });
  const broken = await brokenText();
  check(broken.length === 0, `Card leg text is not broken mid-word at ${w}px`);
  await noHorizontalScroll('The race card', w);
  const bar = await page.locator('nav.rail a').evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height >= 44 && e.getBoundingClientRect().width >= 44));
  check(bar, `The rail has 44 px targets at ${w}px`);
}
await page.setViewportSize({ width: 390, height: 844 });
await shot('card');

// Print view
await page.emulateMedia({ media: 'print' });
await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
const tt = await page.locator('.tt').textContent();
check(/Bike nutrition/.test(tt) && /Run nutrition/.test(tt) && !/\bfuel\b/i.test(tt) && /175–185 W/.test(tt), 'Print card has pace and nutrition, with Nutrition headings');
check(/Gel 0:30 · 1:30 · 2:30/.test(tt) && /at ~\d+ km/.test(tt) && tt.includes(kmNote) && /not medical advice/i.test(tt), 'Print card has your gel times, their km, the KM_NOTE and not medical advice');
check(!CLOCK.test(tt) && !/Transition|start time/i.test(tt), 'Print card has no start time, no transition and no time of day');
check(!(await page.locator('.app').isVisible()), 'Print hides the app');
const ttw = await page.locator('.tt').evaluate((e) => e.getBoundingClientRect().width);
check(ttw > 230 && ttw < 300, `Print card is about 70 mm wide (${Math.round(ttw)} CSS px)`);
await shot('print');
await page.emulateMedia({ media: 'screen' });

// Survives a reload: everything was saved on the device
await page.reload();
await page.locator('.racecard').waitFor();
check(/175–185/.test(await page.locator('.racecard').innerText()), 'Race card survives a reload');

// Step 3 later: after a reload the gut figure shows as a summary with a Change link.
await page.goto(base + '/index.html#/fuel');
await page.reload();
await page.getByRole('heading', { name: 'Review nutrition' }).waitFor();
const gs = page.locator('section.card', { has: page.getByText('Your gut and sweat', { exact: true }) });
check(/Your gut handles\s*70 g\/hr/.test((await gs.innerText()).replace(/\n+/g, ' ')) && /Sweat rate\s*0\.9 L\/hr/.test((await gs.innerText()).replace(/\n+/g, ' ')) && (await page.getByLabel('Carbs your gut handles').count()) === 0, 'After a reload, gut and sweat show as a summary: "Your gut handles 70 g/hr", "Sweat rate 0.9 L/hr"');
const changeLink = gs.getByRole('link', { name: 'Change' });
check(await changeLink.evaluate((e) => e.getBoundingClientRect().height >= 44), 'The Change link is at least 44 px high');
check((await page.getByRole('button', { name: 'Update my race card' }).isVisible()) && (await page.locator('.actions .btn:not(.ghost)').count()) === 1, 'With a saved plan the yellow action is "Update my race card"');
await changeLink.click();
check((await page.getByLabel('Carbs your gut handles').inputValue()) === '70', 'Change opens the questions, with the current gut figure');
await page.getByRole('button', { name: /Typical for warm/ }).click();
await page.getByLabel('Carbs your gut handles').fill('0');
await settle();
await page.reload();
await page.getByRole('heading', { name: 'Review nutrition' }).waitFor();
const gs0 = (await page.locator('section.card', { has: page.getByText('Your gut and sweat', { exact: true }) }).innerText()).replace(/\n+/g, ' ');
check(/Your gut handles\s*0 g\/hr/.test(gs0) && /Typical for warm: 0\.8 L\/hr/.test(gs0) && !/null/.test(gs0), 'A gut figure of 0 counts as set and shows "0 g/hr", never "null"');
await page.getByRole('link', { name: 'Change' }).click();
await page.getByLabel('Carbs your gut handles').fill('70');
await settle();
await page.getByRole('button', { name: 'Update my race card' }).click();
await page.locator('.racecard').waitFor();

// A plan saved before the " (typical)" tag was dropped still holds the tagged names: the card shows them plain
await page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem(k));
  s.race.fuel.carry.gelName = 'Gel (typical)';
  if (s.race.fuel.carry.drink) s.race.fuel.carry.drink = 'Sports drink (typical)';
  localStorage.setItem(k, JSON.stringify(s));
}, KEY);
await page.reload();
await page.locator('.racecard').waitFor();
const oldSave = await page.locator('.racecard').innerText();
check(!/typical/i.test(oldSave) && /Gel/.test(oldSave), 'A plan saved with "(typical)" in its names shows them plain on the card');

// S5 after nutrition is saved.
await page.goto(base + '/index.html#/');
await page.reload();
await page.getByRole('heading', { name: 'Spring 70.3' }).waitFor();
const s5b = await appText();
check(/All four steps done\./.test(s5b) && (await page.getByRole('link', { name: 'Open my race card' }).isVisible()) && /Bike \d+ g\/hr · run \d+ g\/hr/.test(s5b) && /Ready to print/.test(s5b), 'S5 after nutrition says "All four steps done." with "Open my race card"');
check((await page.locator('li.step.goal').count()) === 0 && (await page.getByRole('link', { name: 'Edit' }).count()) === 3 && (await page.getByRole('link', { name: 'Open', exact: true }).count()) === 1, 'S5 shows step 4 done (no light blue) with Edit on steps 1 to 3 and Open on step 4');
await shot('s5-all-done');

// Stale targets (15 and 4). Change FTP on part 1, leave by the rail's Race card without saving.
await page.goto(base + '/index.html#/pacing/1');
await page.getByLabel('FTP', { exact: true }).fill('260');
await page.locator('nav.rail').getByRole('link', { name: /Race card/ }).click();
await page.locator('.racecard').waitFor();
check(/Your numbers changed since these targets/.test(await page.locator('.racecard').innerText()), 'Leaving part 1 by the rail after a change flags the targets as out of date');
await page.goto(base + '/index.html#/');
await page.reload();
const staleHome = await page.locator('li.step', { hasText: 'Choose pacing' }).innerText();
check(/Out of date/.test(staleHome) && (await page.locator('li.step.done', { hasText: 'Choose pacing' }).count()) === 1, 'Home shows Pacing as out of date but still done');
await page.goto(base + '/index.html#/pacing/1');
await page.getByRole('button', { name: 'Save and back to race card' }).click();
await page.locator('.racecard').waitFor();
const ftp260 = await page.locator('.racecard').innerText();
check(!/Your numbers changed since these targets/.test(ftp260) && !/175–185/.test(ftp260), 'Save and back to race card updates the targets and clears the flag');
await page.goto(base + '/index.html#/pacing/1');
await page.getByLabel('FTP', { exact: true }).fill('240');
await page.getByRole('button', { name: 'Save and back to race card' }).click();
await page.locator('.racecard').waitFor();
check(/175–185/.test(await page.locator('.racecard').innerText()), 'Putting FTP back to 240 gives 175–185 W again');
// Step 1 and part 2 have the same button.
await page.locator('nav.rail').getByRole('link', { name: /^Race(?! card)/ }).click();
await page.getByRole('heading', { name: 'Choose a race' }).waitFor();
check(await page.getByRole('button', { name: 'Save and back to race card' }).isVisible(), 'Step 1 has "Save and back to race card" once the card has a plan');
await page.goto(base + '/index.html#/pacing/2');
check(await page.getByRole('button', { name: 'Save and back to race card' }).isVisible(), 'Part 2 has "Save and back to race card" once the card has a plan');
await page.locator('nav.rail').getByRole('link', { name: /Pacing/ }).click();
await page.getByRole('heading', { name: 'Your pace targets' }).waitFor();
check(true, 'Pacing in the rail opens part 3 once pace is saved');
await page.locator('.actions').getByRole('button', { name: 'Save to my race card' }).click();
await page.locator('.racecard').waitFor();
check(true, 'A second save on part 3 opens the race card, not step 3');

// Lower the gut figure after saving nutrition: the card must say the plan is out of date.
await page.goto(base + '/index.html#/fuel');
await page.getByRole('link', { name: 'Change' }).click();
await page.getByLabel('Carbs your gut handles').fill('50');
await settle();
await page.goto(base + '/index.html#/card');
await page.reload();
check(/changed since this plan/.test(await page.locator('.racecard').innerText()), 'Card flags nutrition as out of date after a details change');
await page.emulateMedia({ media: 'print' });
await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
check(/Nutrition plan out of date\. Update it before race day\./.test(await page.locator('.tt').textContent()), 'The print card says "Nutrition plan out of date. Update it before race day."');
await page.emulateMedia({ media: 'screen' });
await page.goto(base + '/index.html#/fuel');
await page.getByRole('button', { name: 'Update my race card' }).click();
await page.locator('.racecard').waitFor();
const updated = await page.locator('.racecard').innerText();
const bikeG = Number((/Bike\s+(\d+) g\/hr/.exec(updated) || [])[1]);
check(!/changed since this plan/.test(updated) && bikeG > 0 && bikeG <= 50, `Updating nutrition clears the flag and keeps under the new gut figure (${bikeG} g/hr)`);

// Old addresses (7). Same session, full navigations.
for (const [hash, want] of [['#/setup/2', 'Choose pacing'], ['#/setup/3', 'Choose pacing'], ['#/setup/4', 'Course and heat'], ['#/setup/5', 'Your pace targets']]) {
  await page.goto(base + '/index.html' + hash);
  await page.reload();
  check(await page.getByRole('heading', { name: want }).isVisible(), `Old address ${hash} opens "${want}"`);
}
await page.goto(base + '/index.html#/saved');
await page.reload();
check(await page.locator('.racecard').isVisible(), 'Old address #/saved opens the race card');

// Products: add one, it appears in step 3.
await page.goto(base + '/index.html#/products');
await page.getByRole('button', { name: 'Add a product' }).click();
await headerIs('My products', { myPlan: false });
check(await page.getByRole('link', { name: 'Nutrition' }).first().isVisible() && (await page.locator('nav.rail').count()) === 0, 'My products keeps a back link named Nutrition and has no rail');
await wordsClean('My products');
const names = page.getByLabel('Name');
await names.last().fill('Test gel 40');
const carbsList = page.getByLabel('Carbs per serve (g)');
check((await carbsList.last().locator('option').allInnerTexts()).join(',') === '20 g,25 g,30 g,35 g,40 g,45 g,50 g,Other', 'Carbs per serve is a list of 20 g to 50 g in 5 g steps, plus Other');
await carbsList.last().selectOption({ label: '40 g' });
await page.getByRole('link', { name: 'Done' }).click();
await page.getByRole('heading', { name: 'Review nutrition' }).waitFor();
check(!/generic starter products/.test(await page.locator('.app').innerText()), 'Once the person has their own products the starter note goes');
check((await page.locator('select').first().locator('option').allInnerTexts()).join(',') === '20g,25g,30g,40g', 'Step 3 offers the gel carb loads 20g, 25g, 30g and 40g, with the unit in the label');
check((await store()).products.slice(-1)[0].carbs === 40, 'Picking 40 g from the list saves exactly 40');
await page.goto(base + '/index.html#/products');
await carbsList.last().selectOption('other');
await page.getByLabel('Exact figure (g)').last().fill('22');
await page.reload();
check((await carbsList.last().inputValue()) === 'other' && (await page.getByLabel('Exact figure (g)').last().inputValue()) === '22', 'A carb figure off the list shows as typed under Other, not rounded');
check((await store()).products.slice(-1)[0].carbs === 22, 'The saved carb figure is exactly 22');
await carbsList.last().selectOption({ label: '40 g' });
await page.getByRole('link', { name: 'Done' }).click();
await page.getByRole('heading', { name: 'Review nutrition' }).waitFor();
await page.locator('select').first().selectOption({ label: '30g' });
const planText = await page.locator('.app').innerText();
check(/The plan uses Gel at 30g a serve and /.test(planText) && /\bGel\b/.test(await page.locator('.tl .tlrow').first().innerText()), 'The "plan uses" line follows the carbs picked, and the rows still name the gel');
check((await store()).choice.gelCarbs === 30, 'The picked gel carbs are saved exactly');
await page.locator('select').nth(1).selectOption({ label: 'Water only' });
check(/^Water: about \d+ ml every 15 min/.test((await page.locator('.tl').first().locator('.tlline').first().innerText()).trim()) && /with water only\./.test(await page.locator('.app').innerText()), 'Water only shows as water in the bike drink line and in the "plan uses" line');
check(/water on the bike, water on the run\.$/.test((await page.locator('h2.planhead + p').innerText()).trim()), 'The summary line says "water on the bike" for water only');
await page.context().close();

// ---------------------------------------------------------------------------------------------------------------
// Scenario 3: an earlier plan with no gut figure typed on step 3 (solo). Isolation: fresh context, empty storage.
// Step 3 with no race: still works, has no rail, and "Save to a race plan" makes a race with no times.
await fresh('solo nutrition');
await page.goto(base + '/index.html#/fuel');
await page.getByRole('heading', { name: 'Review nutrition' }).waitFor();
check((await page.locator('nav.rail').count()) === 0 && (await page.getByRole('link', { name: 'My plan' }).isVisible()), 'Step 3 with no race has no rail, and has My plan');
check(/Add your bike and run times/.test(await appText()), 'Step 3 with no pacing asks for the bike and run times');
await page.getByLabel('Bike time').fill('245');
await page.getByLabel('Run time').fill('155');
await page.getByLabel('Carbs your gut handles').fill('55');
await settle();
await wordsClean('Step 3 (solo)');
await page.getByRole('button', { name: 'Olympic' }).click();
check(!/\bstandard\b/i.test(await appText()) && (await store()).solo.distance === 'standard', 'Solo step 3 offers Olympic and stores "standard"');
await page.getByRole('button', { name: '70.3', exact: true }).click();
await settle();
await page.getByRole('button', { name: 'Save to a race plan' }).click();
await page.getByRole('heading', { name: 'Choose a race' }).waitFor();
const soloRace = (await store()).race;
check(!('start' in soloRace) && !('transitionOpens' in soloRace) && soloRace.fuel && soloRace.fuel.gut === 55, 'Step 3\'s "Save to a race plan" makes a race with no start or transitionOpens keys');
await page.context().close();

// ---------------------------------------------------------------------------------------------------------------
// Scenario 4: a save from before this change (criterion 31). Isolation: fresh context. The fixture was captured from
// main at 8ba9825. Only race.date is moved to a future day, which feeds no inputKey.
const fixture = JSON.parse(await readFile(join(ROOT, '..', 'scripts', 'fixtures', 'save-before-four-step.json'), 'utf8'));
check(fixture.race.distance === 'standard' && fixture.race.start === '06:40' && fixture.race.transitionOpens === '05:30' && !!fixture.race.pace.inputKey && !!fixture.race.fuel.inputKey, 'The fixture is a Standard save with a start, a transition time, and a pace and nutrition plan, each with its inputKey');
fixture.race.date = inDays(30);
await fresh('old save', { init: { fn: ([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, arg: [KEY, JSON.stringify(fixture)] } });
await page.goto(base + '/index.html#/');
await page.getByRole('heading', { name: /Sprint Cup/ }).waitFor();
let ot = await appText();
check(/All four steps done\./.test(ot) && /Olympic/.test(ot) && !/\bstandard\b/i.test(ot) && (await page.locator('li.step.done').count()) === 4, 'An old save shows S5 with steps 1 to 3 done, and Olympic');
check(!CLOCK.test(ot) && !/Transition/i.test(ot) && !/Out of date/i.test(ot), 'Old save: no time of day, no "Transition", no out-of-date note on home');
await page.goto(base + '/index.html#/card');
ot = await appText();
check(!CLOCK.test(ot) && !/Transition/i.test(ot) && !/changed since/i.test(ot) && /g\/hr/.test(ot) && /Finish \d:\d\d–\d:\d\d/.test(ot) && (await page.locator('.racecard .tl').count()) === 2, 'Old save: the card shows its pacing and nutrition with no time of day, no transition and no out-of-date notice');
await page.emulateMedia({ media: 'print' });
await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
const oldTT = await page.locator('.tt').textContent();
check(!CLOCK.test(oldTT) && !/Transition/i.test(oldTT) && !/out of date/i.test(oldTT) && /nutrition/i.test(oldTT), 'Old save: the print card has no time of day, no transition and no out-of-date line');
await page.emulateMedia({ media: 'screen' });
for (const hash of ['#/setup/1', '#/pacing/3', '#/fuel']) {
  await page.goto(base + '/index.html' + hash);
  await page.reload();
  const t = await appText();
  check(!CLOCK.test(t) && !/Transition|Start time/i.test(t), `Old save: ${hash} shows no race times`);
}
await page.goto(base + '/index.html#/fuel');
await page.reload();
check(/Your gut handles\s*70 g\/hr/.test((await appText()).replace(/\n+/g, ' ')) && !/Out of date|changed since/i.test(await appText()), 'Old save: step 3 shows the saved gut figure as a summary');
await page.context().close();

// ---------------------------------------------------------------------------------------------------------------
// Scenario 5: guide embeds. Isolation: a fresh context for each case, so no race exists when "Save" is pressed.
async function guide(label, path) {
  const g = await fresh(label);
  g.on('dialog', (dl) => dl.accept());
  await g.goto(base + path);
  return g;
}
await guide('bike guide', '/guides/bike-pacing.html');
check((await page.locator('header.top').getByRole('link', { name: 'TRI Momentum' }).isVisible()) && /· TRI Momentum$/.test(await page.title()) && (await page.locator('nav.rail').count()) === 0, 'The bike guide has the wordmark, a TRI Momentum title and no rail');
await page.getByLabel('Your FTP').fill('240');
check(/175–185 W/.test(await page.locator('.result').innerText()), 'Guide gives 175–185 W for FTP 240, rolling');
await page.getByRole('button', { name: 'Hilly' }).click();
check(!/175–185 W/.test(await page.locator('.result').innerText()), 'Guide target changes for a hilly course');
const bikeTool = await page.locator('.tool, .savebox').allInnerTexts();
check(!/\bfuel\b/i.test(bikeTool.join(' ')) && !/\bstandard\b/i.test(bikeTool.join(' ')) && !/Race-day tools/.test(await appText()), 'The bike guide\'s header and tool have no "fuel", "Standard" or "Race-day tools"');
await page.getByRole('button', { name: 'Save to a race plan' }).click();
await page.getByRole('heading', { name: 'Choose a race' }).waitFor();
const bs = await store();
check(bs.fitness.ftp === 240 && bs.race.course === 'hilly' && !('start' in bs.race) && !('transitionOpens' in bs.race), 'Guide carries FTP and course into step 1, with no race-time keys');
await page.context().close();

await guide('nutrition guide', '/guides/race-fuel.html');
check(/Your 70\.3 nutrition/.test(await page.locator('.tool').innerText()) && /g\/hr/.test(await page.locator('.tool').innerText()), 'Nutrition guide shows "Your 70.3 nutrition" and a plan from its defaults');
const guideTool = await page.locator('.tool').innerText();
check(/at \d+:\d\d \(~\d+ km\)/.test(guideTool) && guideTool.includes(kmNote) && !/NaN/.test(guideTool), 'Nutrition guide shows km beside the run gel times, with KM_NOTE');
const nutTool = (await page.locator('.tool, .savebox').allInnerTexts()).join(' ');
check(!/\bfuel\b/i.test(nutTool) && !/\bstandard\b/i.test(nutTool) && (await page.locator('header.top').getByRole('link', { name: 'TRI Momentum' }).isVisible()) && (await page.locator('nav.rail').count()) === 0, 'The nutrition guide\'s header and tool have no "fuel" or "Standard", and it has the wordmark and no rail');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-guide-nutrition.png`, fullPage: true });
await page.getByRole('button', { name: 'Save to a race plan' }).click();
await page.getByRole('heading', { name: 'Choose a race' }).waitFor();
check((await store()).details.gut === null, 'Saving the nutrition guide untouched leaves details.gut null: the page\'s example figure is never carried');
await page.context().close();

await guide('nutrition guide, typed', '/guides/race-fuel.html');
await page.getByLabel('Carbs your gut handles').fill('55');
await page.getByRole('button', { name: 'Save to a race plan' }).click();
await page.getByRole('heading', { name: 'Choose a race' }).waitFor();
const gsv = await store();
check(gsv.details.gut === 55 && !('start' in gsv.race), 'Typing 55 in the nutrition guide carries 55 into details.gut');
await page.context().close();


// ---------------------------------------------------------------------------------------------------------------
// Scenario 6: a save from main whose own sweat rate is blank. Isolation: fresh context. This is the captured fixture
// with ONLY details.sweatTypical set to false and details.sweat left null; nothing else is changed. The plan is not
// called out of date for it (criterion 27); home and the card say plainly what is needed, and step 3 makes no plan.
const SWEAT_NEEDED = 'Add your sweat rate on step 3, or use a typical value.';
const blankSweat = JSON.parse(JSON.stringify(fixture));
blankSweat.details.sweatTypical = false;
blankSweat.details.sweat = null;
await fresh('blank own sweat', { init: { fn: ([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, arg: [KEY, JSON.stringify(blankSweat)] } });
await page.goto(base + '/index.html#/');
await page.getByRole('heading', { name: /Sprint Cup/ }).waitFor();
let bt = await appText();
check(bt.includes(SWEAT_NEEDED) && !/Out of date|changed since/i.test(bt), 'Blank own sweat: home says the sweat rate is needed and shows no out-of-date text');
await page.goto(base + '/index.html#/card');
bt = await appText();
check(bt.includes(SWEAT_NEEDED) && !/changed since|out of date/i.test(bt) && (await page.locator('.racecard .notice a', { hasText: 'step 3' }).getAttribute('href')) === '#/fuel', 'Blank own sweat: the card says it, links to step 3, and shows no out-of-date text');
await page.emulateMedia({ media: 'print' });
await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
check(!/out of date/i.test(await page.locator('.tt').textContent()), 'Blank own sweat: the print card has no out-of-date line');
await page.emulateMedia({ media: 'screen' });
await page.goto(base + '/index.html#/fuel');
await page.reload();
await page.getByRole('heading', { name: 'Review nutrition' }).waitFor();
check(/sweat rate/i.test(await page.locator('.info.warn').first().innerText()) && (await page.locator('.tl').count()) === 0 && (await page.getByRole('button', { name: /Next: get your race card|Update my race card/ }).count()) === 0, 'Blank own sweat: step 3 shows the sweat message and makes no plan and no save');
// Then the gut figure changes (70 to 40) and the person leaves without a valid sweat rate: the plan is out of date AND
// the sweat rate is needed. Both notices show; the sweat line never hides the out-of-date one.
await page.getByLabel('Carbs your gut handles').fill('40');
await settle();
const both = async (where, t) => check(/changed since this plan|Out of date/i.test(t) && t.includes(SWEAT_NEEDED), `Blank own sweat and a changed gut figure: ${where} shows both the out-of-date notice and the sweat line`);
await page.goto(base + '/index.html#/');
await page.reload();
await both('home', await appText());
check((await page.locator('li.step', { hasText: 'Review nutrition' }).locator('.d').innerText()).trim() === 'Out of date: Edit to update it. Add your sweat rate on step 3, or use a typical value.', 'Home\'s step 3 line reads as two sentences when both notices show')
await page.goto(base + '/index.html#/card');
await page.reload();
await both('the card', await appText());
check((await page.locator('.racecard .notice.warn').allInnerTexts()).map((t) => t.trim()).join('|') === 'Your splits, details or products changed since this plan. Open Nutrition to update it.|Add your sweat rate on step 3, or use a typical value.', 'The card shows the two notices as separate sentences')
await page.emulateMedia({ media: 'print' });
await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
check(/out of date/i.test(await page.locator('.tt').textContent()), 'Blank own sweat and a changed gut figure: print says out of date');
await page.emulateMedia({ media: 'screen' });
await page.context().close();

// ---------------------------------------------------------------------------------------------------------------
// Scenario 7: a long multi-word product name in the leg cards. Isolation: fresh context, seeded from the fixture with
// pacing saved and no nutrition plan, and a made-up gel with a long name.
const longName = 'Citrus energy gel with caffeine extra strength';
const longSave = JSON.parse(JSON.stringify(fixture));
longSave.race.fuel = null;
longSave.race.distance = '70.3';
longSave.products = [{ id: 'gel', name: longName, kind: 'gel', carbs: 25, sodium: 50, serveMl: 0 }, { id: 'drink', name: 'Sports drink', kind: 'drink', carbs: 30, sodium: 250, serveMl: 500 }];
await fresh('long product name', { width: 320, init: { fn: ([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, arg: [KEY, JSON.stringify(longSave)] } });
await page.goto(base + '/index.html#/fuel');
await page.getByRole('heading', { name: 'Review nutrition' }).waitFor();
check((await page.locator('.tl').count()) === 2 && (await page.locator('.tl .tlrow').first().innerText()).includes(longName.split(' ')[0]), 'Long name: step 3 makes the plan with the long product name');
const rowsOk = await page.locator('.tl .tlrow').evaluateAll((rows) => rows.map((r) => {
  const [t, name, km] = [...r.children];
  const rb = r.getBoundingClientRect(); const nb = name.getBoundingClientRect();
  const kb = km ? km.getBoundingClientRect() : null;
  return name.scrollWidth <= name.clientWidth + 1 && nb.right <= rb.right + 1 && (!kb || (kb.right <= rb.right + 1 && kb.left >= nb.right - 1 && kb.width > 0)) && t.getBoundingClientRect().right <= nb.left + 1;
}));
check(rowsOk.length > 0 && rowsOk.every(Boolean), 'Long name at 320px: the name wraps, nothing is clipped, and the km stays visible without overlapping');
check((await brokenText()).length === 0, 'Long name at 320px: no word is broken in the middle');
await noHorizontalScroll('Step 3 with a long product name', 320);
await shot('long-name-320');
await page.context().close();

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
