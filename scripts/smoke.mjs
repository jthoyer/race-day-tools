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
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
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

// RD-039 A24. The one request the app may make besides loading itself is a POST to /api/send, made by its own address.
// Anything else under /api/ is a failure, and so is any request to another host. Kept as a function so it can be tried
// on made-up requests below: a guard that has never been seen to fail is not a guard.
function badRequest(method, url) {
  const u = new URL(url);
  if (/^https?:$/.test(u.protocol) && u.hostname !== 'localhost') return 'outside request';
  if ((u.pathname === '/api' || u.pathname.startsWith('/api/')) && !(method === 'POST' && u.pathname === '/api/send')) return 'unexpected /api/ request';
  return null;
}
// Set while a scenario expects /api/send to fail (a 404, an offline device, a refused call): the browser's own console
// error for that one address is not a problem there. Any other console error still is.
let sendErrorsExpected = false;

// Every scenario below says how it is isolated. A "fresh" one is a new browser context: empty storage, no shared module state.
async function fresh(label, { width = 390, init } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => problems.push(`page error (${label}): ` + e.message));
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (sendErrorsExpected && (m.location().url || '').endsWith('/api/send')) return;
    problems.push(`console (${label}): ` + m.text());
  });
  // Fonts ship with the app, so nothing may be requested from another host, and only POST /api/send may be called.
  p.on('request', (r) => { const bad = badRequest(r.method(), r.url()); if (bad) problems.push(`${bad} (${label}): ${r.method()} ` + r.url()); });
  // A content-policy violation shows as a console error above, and as a securitypolicyviolation event here.
  await p.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error('CSP blocked ' + e.violatedDirective + ' ' + e.blockedURI)));
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
const taperStore = async () => (await store()).race.taperDays;

// RD-039 A12. The PDF rows: the words the emailed card holds. fuelStale is what the app passes when the plan is out of date.
const pdfRows = (fuelStale) => page.evaluate(([k, stale]) => {
  const race = JSON.parse(localStorage.getItem(k)).race;
  return window.RD.card.rows({ race, pace: race.pace, fuel: race.fuel, fuelStale: stale });
}, [KEY, fuelStale]);
const pdfText = async (fuelStale) => (await pdfRows(fuelStale)).map((r) => r.text).join('\n');
async function pdfRowsOk(where, fuelStale) {
  const rows = await pdfRows(fuelStale);
  check(rows.length > 4 && /^TRI Momentum race card · (Olympic|70\.3)$/.test(rows[0].text) && !rows.some((r) => CLOCK.test(r.text) || /Transition|start time/i.test(r.text)), `${where}: the PDF title row has the distance and no race name, and no row has a time of day, a start time or a transition`);
}

// 28 and 29: no whole word "fuel" and no "Standard" in what a person reads.
async function wordsClean(where) {
  const t = await appText();
  check(!/\bfuel\b/i.test(t) && !/\bstandard\b/i.test(t) && !/Race-day tools/.test(t), `${where} has no "fuel", "Standard" or "Race-day tools" in its words`);
}
// 5 and 6. The header, the Race plan button, the status row and the panel (criterion 19).
const STEPS = ['Race', 'Pacing', 'Nutrition', 'Race card'];
const planBtn = () => page.locator('header.top').getByRole('button', { name: 'Race plan', exact: true });
const planPanel = () => page.locator('#race-plan-panel');
const statusRow = () => page.locator('div.here');
async function headerIs(where, { plan = true } = {}) {
  const mark = page.locator('header.top').getByRole('link', { name: 'TRI Momentum' });
  const tall = async (l) => (await l.count()) > 0 && (await l.evaluate((e) => e.getBoundingClientRect().height >= 44 && e.getBoundingClientRect().width >= 44));
  const btn = planBtn();
  const has = (await btn.count()) === 1;
  const wired = has && (await btn.getAttribute('aria-controls')) === 'race-plan-panel' && ['true', 'false'].includes(await btn.getAttribute('aria-expanded'));
  check((await tall(mark)) && /^Momentum$/.test((await mark.innerText()).replace(/\s+/g, ' ').replace(/^T\s*R\s*I\s*/, '').trim()), `${where} header has the wordmark, at least 44 px`);
  check(plan ? has && (await tall(btn)) && wired : (await btn.count()) === 0, `${where} header ${plan ? 'has the Race plan button, at least 44 px, with aria-expanded and aria-controls' : 'has no Race plan button'}`);
}
// The status row: "Step n of 4", the step's name, "Next: ..." (none on the race card), read-only, and no old rail.
async function statusIs(current, where) {
  const row = statusRow();
  const n = STEPS.indexOf(current) + 1;
  const found = (await row.count()) === 1;
  const text = found ? (await row.innerText()).replace(/\s+/g, ' ').trim().toLowerCase() : '';
  const want = (`Step ${n} of 4 ${current}` + (n < 4 ? ` Next: ${STEPS[n]}` : '')).toLowerCase();
  const readOnly = found && (await row.evaluate((e) => !e.querySelector('a,button,input,select,textarea,[tabindex]') && !e.matches('[tabindex]')));
  check(found && text === want && readOnly, `${where} has the status row "${want}", read-only`);
  check((await page.locator('nav.rail').count()) === 0 && (await page.locator('nav.stepbar').count()) === 0, `${where} has no old rail or step bar`);
}
// The status row is absent (S0, S5, My products, the guides, and step 3 with no race), with no panel and no old rail.
async function noStatus(where) {
  check((await statusRow().count()) === 0 && (await planPanel().count()) === 0 && (await page.locator('nav.rail').count()) === 0, `${where} has no status row, no Race plan panel and no rail`);
}
// Open the Race plan panel (if it is closed) and choose a step.
async function viaPlan(name) {
  const btn = planBtn();
  if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
  await planPanel().getByRole('link', { name }).click();
}

// RD-041. The race strip: present exactly where the status row is on a pacing part and on step 3 with a race, and absent elsewhere.
// Present means one strip, the next element after the status row, with no heading in it, and before the part bar or the step title.
async function stripIs(where, present) {
  const n = await page.locator('div.strip').count();
  check(n === (present ? 1 : 0), `${where} ${present ? 'has' : 'has no'} the race strip`);
  if (!present || n !== 1) return;
  const g = await page.evaluate(() => {
    const st = document.querySelector('div.strip');
    const next = st.nextElementSibling;
    const here = document.querySelector('div.here');
    return { afterStatus: !!here && here.nextElementSibling === st, before: !!next && (next.matches('.progress') || !!next.querySelector('h1')), headings: st.querySelectorAll('h1,h2,h3,h4,h5,h6').length, named: !!st.getAttribute('aria-label') };
  });
  check(g.afterStatus && g.before && g.headings === 0 && g.named, `${where}: the strip follows the status row, comes before the part bar or title, is named, and holds no heading`);
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
check(await page.getByText('Free. No account needed. Saved on this device only.', { exact: true }).isVisible(), 'S0 has the free and on-this-device note');
check((await page.locator('.btn').count()) === 1 && (await page.getByRole('link', { name: 'Get started' }).isVisible()), 'S0 has one yellow action, "Get started"');
const s0text = await appText();
check(!/Just plan my|Countdown|Debrief|Coming later/.test(s0text) && (await page.getByRole('link', { name: /account/i }).count()) === 0 && (await page.locator('.gallery,.gcard').count()) === 0, 'S0 has no "Just plan my" link, no account link, no Countdown or Debrief, no gallery');
check((await planBtn().count()) === 0 && (await page.locator('header.top').count()) === 0, 'S0 has no header bar and no Race plan button');
await noStatus('S0');
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
// The "Four steps" label, the "Learn more" link and the About section (owner ask, 17 Nov 2026).
const stepsLabel = page.getByText('Four steps', { exact: true });
check(await stepsLabel.isVisible() && (await topOf(stepsLabel)) < (await topOf(page.locator('ol.steps'))) && (await page.locator('ol.steps').getAttribute('aria-labelledby')) === 'steps-label', 'S0 has a "Four steps" label above the list, naming it');
const more = page.locator('a.more').first();
const moreBox = await more.boundingBox();
check(/^Learn more/.test(await more.evaluate((e) => e.textContent.trim())) && moreBox.height >= 44 && moreBox.width >= 44 && !(await more.evaluate((e) => e.classList.contains('btn'))), 'S0 has a "Learn more" link, at least 44 px, not a button');
check((await topOf(more)) > (await topOf(page.locator('p.lead'))) && (await topOf(more)) < (await topOf(stepsLabel)), 'S0 puts "Learn more" under the subtitle and above the steps');
const hashBefore = await page.evaluate(() => location.hash);
await more.click();
const aboutTop = await page.locator('#about').evaluate((e) => e.getBoundingClientRect().top);
// The section reaches the top of the screen, or the page scrolls as far as it can go (it is short, so the bottom stops it).
const atEnd = await page.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1);
check((await page.evaluate(() => location.hash)) === hashBefore && aboutTop >= -2 && (aboutTop <= 40 || atEnd) && (await page.evaluate(() => document.activeElement.id)) === 'about-h', `"Learn more" scrolls to the section and focuses its heading, with the address unchanged (top ${Math.round(aboutTop)} px)`);
const aboutText = await page.locator('#about').innerText();
check(await page.getByRole('heading', { name: 'What TRI Momentum does', level: 2 }).isVisible() && await page.getByRole('heading', { name: 'What you get', level: 3 }).isVisible() && await page.getByRole('heading', { name: 'How to get it', level: 3 }).isVisible(), 'The About section has its h2 and two h3s');
check(/gut/.test(aboutText) && /sweat/.test(aboutText) && /range/.test(aboutText) && /PDF/.test(aboutText) && /not medical advice/i.test(aboutText) && !/checked|Countdown|Debrief|fuel|standard|Resend|Strava|Garmin/i.test(aboutText), 'The About section says what the plan does and keeps to the spec (no promise of Countdown or Debrief, no brand, nothing called checked)');
check((await topOf(page.getByText('Free. No account needed.'))) < (await topOf(page.locator('#about'))) && (await topOf(page.locator('#about'))) < (await topOf(guides)), 'S0 puts the About section between the note and the guides');
await page.locator('#about a.more').click();
check((await page.evaluate(() => window.scrollY)) === 0 && (await page.evaluate(() => document.activeElement.tagName)) === 'H1', '"Back to the top" returns to the top and focuses the heading');
for (const w of [390, 360, 320]) { await page.setViewportSize({ width: w, height: 844 }); await noHorizontalScroll('S0 with the About section', w); }
await page.setViewportSize({ width: 390, height: 844 });
await wordsClean('S0');
await stripIs('S0', false);
// The probe is expected to be refused; its console errors are dropped at the end by its unique address. It asks for another
// host, which no network request can reach, so it is the policy that refuses it, and the violation event proves that.
const probe = await page.evaluate(() => new Promise((done) => {
  let violated = '';
  document.addEventListener('securitypolicyviolation', (e) => { violated = e.violatedDirective + ' ' + e.blockedURI; }, { once: true });
  fetch('https://outside.example.test/__csp_probe__').then(() => done({ sent: true, violated }), () => setTimeout(() => done({ sent: false, violated }), 100));
}));
check(probe.sent === false && /^connect-src https:\/\/outside\.example\.test\/__csp_probe__$/.test(probe.violated), `Content policy refuses a request to another host (${probe.violated})`);
const own = await page.evaluate(() => fetch('/css/app.css').then((r) => r.status, () => 0));
check(own === 200, "connect-src 'self' lets the page call its own address");
// The two guards, tried on made-up requests: each must say no where it should, and yes where it should.
check(badRequest('GET', 'https://outside.example.test/x') === 'outside request' && badRequest('POST', 'http://localhost:8000/api/send') === null && badRequest('GET', 'http://localhost:8000/js/app.js') === null, 'The outside-host guard refuses another host and lets the app load itself');
check(badRequest('GET', 'http://localhost:8000/api/send') && badRequest('PUT', 'http://localhost:8000/api/send') && badRequest('POST', 'http://localhost:8000/api/other') && badRequest('POST', 'http://localhost:8000/api') && badRequest('POST', 'http://localhost:8000/api/send/x') && badRequest('POST', 'http://localhost:8000/api/send') === null, 'The /api/ guard allows POST /api/send and nothing else under /api/');
const fontsLoaded = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')); });
check(fontsLoaded.includes('DM Sans') && fontsLoaded.includes('Outfit'), 'DM Sans and Outfit load from the app, with no outside request');
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
await statusIs('Race', 'Step 1');
await stripIs('Step 1', false);
await page.locator('header.top').getByRole('link', { name: 'TRI Momentum' }).click();
await page.getByRole('heading', { name: 'Race with a plan.' }).waitFor();
check((await page.getByRole('link', { name: 'Get started' }).isVisible()) && (await statusRow().count()) === 0, 'The wordmark on an empty step 1 goes back to the front page');
const keysNew = await store();
check(!('start' in keysNew.race) && !('transitionOpens' in keysNew.race), 'A new race is made without start or transitionOpens');
await page.getByRole('link', { name: 'Get started' }).click();
await page.getByRole('heading', { name: 'Choose a race' }).waitFor();
check(await page.getByText('Tap the date to choose it.').isVisible(), 'Step 1 says what to do with an empty date');
const s1text = await appText();
check(/Every step works back from race day\./.test(s1text) && !/Start time|Transition opens|Clear start|Clear transition/.test(s1text) && (await page.locator('input[type=time]').count()) === 0, 'Step 1 has its subtitle and no start time, no Transition opens, no Clear buttons');
check(!(await page.getByRole('button', { name: 'Save and back to race card' }).count()), 'A first pass through the steps has no "back to race card" yet');
await page.getByLabel('Race name').fill('Spring 70.3');
// Olympic stores "standard" and shows its legs. (Its 10-day taper guide is checked in the strip, scenario 24b.)
await page.getByLabel('Race date').fill(inDays(20));
await page.getByRole('button', { name: 'Olympic' }).click();
check((await store()).race.distance === 'standard' && (await page.getByText('Swim 1.5 km · Bike 40 km · Run 10 km').isVisible()), 'Choosing Olympic stores "standard" and shows 1.5 / 40 / 10 km');
check(!/\bstandard\b/i.test(await appText()), 'Step 1 never shows "Standard"');
await page.getByRole('button', { name: '70.3', exact: true }).click();
check(await page.getByText('Swim 1.9 km · Bike 90 km · Run 21.1 km').isVisible() && (await store()).race.distance === '70.3', 'Choosing 70.3 shows the 70.3 leg distances');
// The countdown and the taper choices left step 1 (decided 16 Nov 2026). They start at step 2, in the strip (scenario 24).
check((await page.locator('.countdown').count()) === 0 && !/days to go|COUNTDOWN|Taper length|Or pick the day your taper starts|our guide/.test(await appText()) && (await page.getByRole('button', { name: /10 days|14 days|21 days/ }).count()) === 0, 'Step 1 has no countdown and no taper choices');
await wordsClean('Step 1');
for (const w of [390, 360, 320]) { await page.setViewportSize({ width: w, height: 844 }); await noHorizontalScroll('Step 1', w); }
await page.setViewportSize({ width: 390, height: 844 });
await shot('step1');
await page.getByRole('button', { name: 'Next: choose pacing' }).click();

// Step 2, part 1: Your fitness.
await page.getByRole('heading', { name: 'Choose pacing' }).waitFor();
await headerIs('Pacing part 1');
await statusIs('Pacing', 'Pacing part 1');
await stripIs('Pacing part 1', true);
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
check(await page.getByText('Heart rate needs your threshold heart rates and the speed of a hard long ride. The swim always uses your CSS.', { exact: true }).isVisible(), 'Heart rate mode says what it needs');
await page.getByRole('button', { name: 'Effort', exact: true }).click();
check((await page.getByText('Effort needs only the speed of a hard long ride. The swim always uses your CSS.', { exact: true }).isVisible()) && (await page.getByLabel('Speed on a hard long ride').isVisible()) && (await page.getByLabel('FTP', { exact: true }).count()) === 0, 'Effort mode says what it needs and asks only for the long-ride speed');
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
await statusIs('Pacing', 'Pacing part 2');
await stripIs('Pacing part 2', true);
await page.getByRole('button', { name: /Rolling/ }).click();
await page.getByRole('button', { name: /Warm/ }).click();
await wordsClean('Pacing part 2');
await shot('pacing-2');
check((await page.getByRole('link', { name: 'Back: your fitness' }).getAttribute('href')) === '#/pacing/1', 'Part 2 has a quiet Back to part 1');
await page.getByRole('button', { name: 'Next: your targets' }).click();

// Part 3.
await page.getByRole('heading', { name: 'Your pace targets' }).waitFor();
await statusIs('Pacing', 'Pacing part 3');
await stripIs('Pacing part 3', true);
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
await statusIs('Nutrition', 'Step 3');
await headerIs('Step 3', { plan: true });
await stripIs('Step 3', true);
// The bars read saved state: Race and Pacing done (green), Nutrition current (ink), Race card never green (info-bg).
const bars3 = await page.locator('div.here .fours i').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
check(bars3.join('|') === 'rgb(17, 107, 67)|rgb(17, 107, 67)|rgb(24, 37, 66)|rgb(234, 247, 252)', `The status row bars on step 3 are green, green, ink, info-bg (${bars3.join('|')})`);

// S5, after pacing is saved. Isolation: same session, a reload (full page load) to home.
await page.goto(base + '/index.html#/');
await page.reload();
await page.getByRole('heading', { name: 'Spring 70.3' }).waitFor();
const s5a = await appText();
check(!/Countdown|Debrief|Later/.test(s5a), 'S5 hides Countdown and Debrief until they exist');
check(/Two steps done, two to go\./.test(s5a) && /Next: check your gut figure and pick your carbs/.test(s5a), 'S5 after pacing says "Two steps done, two to go." and what step 3 is');
check((await page.getByRole('link', { name: 'Continue: review nutrition' }).isVisible()) && (await page.locator('.btn').count()) === 1, 'S5 after pacing has one yellow action, "Continue: review nutrition"');
check(/Bike 175–185 W · finish \d:\d\d–\d:\d\d/.test(s5a) && /days to go/i.test(s5a) && /Taper starts|In your taper/.test(s5a), 'S5 shows the days to go, the taper line and the pacing summary');
check((await statusRow().count()) === 0 && (await planBtn().count()) === 0 && (await page.locator('nav.rail').count()) === 0 && (await page.locator('header.top').getByRole('link', { name: 'TRI Momentum' }).count()) === 1, 'S5 has the wordmark, no Race plan button, no status row and no rail');
check(!/n of 2 done|Your details|Open race card/.test(s5a) && (await page.getByRole('link', { name: 'Edit' }).count()) === 2 && (await page.getByRole('link', { name: 'Edit' }).evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height >= 44))), 'S5 has two Edit links (steps 1 and 2) at least 44 px high, and none of the old home');
check((await page.locator('section.guides').count()) === 0 && !/Guides/.test(s5a), 'S5 has no guide links (they are on S0 only)');
check((await page.locator('#about').count()) === 0, 'S5 has no About section (it is on S0 only)');
check(/Ready once nutrition is done/.test(s5a) && (await page.locator('li.step.goal').count()) === 1, 'S5 keeps step 4 on the light blue until it is done');
await headerIs('S5', { plan: false });
await stripIs('S5', false);
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
check((await nutCard.count()) === 1 && (await nutCard.locator('select').count()) === 2 && (await nutCard.getByText('Carry list', { exact: true }).count()) === 1 && /generic starter products/.test(await nutCard.innerText()) && !/typical/i.test(await nutCard.innerText()) && (await page.getByText('What you use', { exact: true }).count()) === 0, 'One "Your nutrition" card holds both pickers, the starter note and the carry list, and the old "What you use" card is gone');
const nutTops = [await topOf(nutCard.locator('select').first()), await topOf(nutCard.getByText(/The plan uses /)), await topOf(nutCard.getByText('Carry list', { exact: true }))];
check(nutTops[0] < nutTops[1] && nutTops[1] < nutTops[2], 'In the Your nutrition card the carb choice comes first, then the "plan uses" line, then the carry list');
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
// The header and the status row do not float: not sticky or fixed, no drop shadow, and they scroll away with the page.
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
const statusLook = await statusRow().evaluate((e) => ({ pos: getComputedStyle(e).position, shadow: getComputedStyle(e).boxShadow, top: e.getBoundingClientRect().top }));
const headLook = await page.locator('header.top').evaluate((e) => ({ pos: getComputedStyle(e).position, shadow: getComputedStyle(e).boxShadow, top: e.getBoundingClientRect().top }));
check([statusLook, headLook].every((l) => l.pos !== 'sticky' && l.pos !== 'fixed' && l.shadow === 'none' && l.top < 0), `The header and status row are not sticky, fixed or shadowed, and scroll away (status ${statusLook.pos}/${statusLook.shadow}/${Math.round(statusLook.top)}px, header ${headLook.pos}/${headLook.shadow}/${Math.round(headLook.top)}px)`);
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
await noHorizontalScroll('Step 3 with gel timing');
// Save: with no saved nutrition the yellow action is "Next: get your race card"; there is no Print button.
const nextBtn = page.getByRole('button', { name: 'Next: get your race card' });
check((await page.locator('.actions .btn:not(.ghost)').count()) === 1 && (await page.getByRole('button', { name: 'Print top-tube card' }).count()) === 0, 'Step 3 has one yellow action, and no Print button');
await nextBtn.click();

// Step 4: the race card.
await page.locator('.racecard').waitFor();
await headerIs('The race card');
await statusIs('Race card', 'The race card');
await stripIs('The race card', false);
const card = await page.locator('.racecard').innerText();
check(/Spring 70\.3/.test(card) && /175–185/.test(card) && /g\/hr/.test(card), 'Race card shows pacing and nutrition');
const cardFlat = card.replace(/\s+/g, ' ');
check(/^YOUR RACE Edit race \d+ [A-Z]{3} Spring 70\.3 (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) \d+ \w+ \d+ days to go /.test(cardFlat) && /(Taper starts|In your taper).* Edit taper/.test(cardFlat), 'The card header has the date box, the race, the countdown and the taper, each with its edit button');
check(/Taper starts|In your taper/.test(card) && /\bPacing\b/i.test(card) && /\bNutrition\b/i.test(card), 'The card has Pacing and Nutrition sections and the taper line');
check((await page.locator('.racecard .sechead a', { hasText: 'Step 2' }).getAttribute('href')) === '#/pacing/3' && (await page.locator('.racecard .sechead a', { hasText: 'Step 3' }).getAttribute('href')) === '#/fuel', 'The card links Step 2 to pacing part 3 and Step 3 to step 3');
check(!CLOCK.test(card) && !/Transition|start time/i.test(card), 'The card has no time of day, no transition and no start time');
// The card header edits in place (RD-031): race name and date, then the taper. Each is put back so the rest of the run is unchanged.
const hero = page.locator('.racecard .band');
const editRace = hero.getByRole('button', { name: 'Edit race' });
const editTaper = hero.getByRole('button', { name: 'Edit taper' });
check((await editRace.getAttribute('aria-expanded')) === 'false' && (await editRace.evaluate((e) => e.getBoundingClientRect().height >= 44)) && (await editTaper.evaluate((e) => e.getBoundingClientRect().height >= 44)), 'The card header buttons are closed to start and at least 44 px high');
await editRace.click();
check((await editRace.getAttribute('aria-expanded')) === 'true' && (await page.locator('#f-race-name').evaluate((e) => e === document.activeElement)), 'Edit race opens the panel and moves focus to the race name');
await page.locator('#f-race-name').fill('Autumn 70.3');
await page.getByLabel('Race date').fill(inDays(25));
check((await store()).race.name === 'Autumn 70.3' && (await store()).race.date === inDays(25) && /25 days to go/.test(await hero.innerText()), 'Editing the race name and date saves them and moves the countdown');
await shot('card-edit-race');
await noHorizontalScroll('The race card with Edit race open');
await page.locator('#f-race-name').fill('');
await hero.getByRole('button', { name: 'Done' }).click();
check((await store()).race.name === 'My race' && (await hero.getByRole('heading', { name: 'My race' }).isVisible()) && (await editRace.getAttribute('aria-expanded')) === 'false', 'Done closes the panel, and a blank name becomes "My race"');
await editRace.click();
await page.locator('#f-race-name').fill('Spring 70.3');
await page.getByLabel('Race date').fill(inDays(20));
await hero.getByRole('button', { name: 'Done' }).click();
await editTaper.click();
check((await editTaper.getAttribute('aria-expanded')) === 'true' && (await hero.getByRole('button', { name: /14 days/ }).getAttribute('aria-pressed')) === 'true' && /14 days \(our guide\)/.test(await hero.getByRole('button', { name: /14 days/ }).innerText()), 'Edit taper opens the taper choices and marks our guide');
const taperLine = await hero.locator('.taper .bt').innerText();
await hero.getByRole('button', { name: /21 days/ }).click();
check((await taperStore()) === 21 && (await hero.locator('.taper .bt').innerText()) !== taperLine, 'Picking a 21-day taper on the card saves it and moves the taper line');
await hero.getByLabel('Or pick the day your taper starts').fill(inDays(23)); // race day is inDays(20), so this is 3 days after it
check(/Pick a day 1 to 42 days before race day/.test(await hero.innerText()) && (await taperStore()) === 21, 'A taper day after the race is refused on the card, and not saved');
await shot('card-edit-taper');
for (const w of [390, 360, 320]) { await page.setViewportSize({ width: w, height: 844 }); await noHorizontalScroll('The race card with Edit taper open', w); }
await page.setViewportSize({ width: 390, height: 844 });
await hero.getByRole('button', { name: /14 days/ }).click();
await hero.getByRole('button', { name: 'Done' }).click();
check((await taperStore()) == null && (await hero.locator('#card-panel').count()) === 0 && (await hero.getByRole('button', { name: 'Edit taper' }).evaluate((e) => e === document.activeElement)), 'Back to 14 days uses our guide again; Done closes the panel and returns focus to Edit taper');
check(/Changeovers: T1 0:04–0:05 · T2 0:02–0:04/.test(card) && /Finish \d:\d\d–\d:\d\d/.test(card), 'Race card shows the finish range and the changeovers it includes');
const cardRows = await page.locator('.racecard .tl').first().locator('.tlrow').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
check(cardRows.length === 3 && /^0:30 Gel ~\d+ km$/.test(cardRows[0]), 'The card has the same leg cards, with your own first gel and its km');
check((await page.locator('.racecard p.notice.go').count()) === 1 && (await page.locator('.racecard p.notice.go').innerText()).replace(/\s+/g, ' ').trim() === kmNote && (await page.getByRole('link', { name: 'Change gel times' }).isVisible()), 'The card has the go-by-the-clock note once, and "Change gel times"');
check(await page.getByRole('link', { name: 'Change gel times' }).evaluate((e) => e.getBoundingClientRect().height >= 44), 'The card\'s "Change gel times" link is at least 44 px high');
check(/^Sports drink( and water)?: about \d+ ml every 15 min$/.test((await page.locator('.racecard .tl .tlline').first().innerText()).trim()), 'The card names the drink in the first line of the bike leg card');
check(!/typical/i.test(card) && !/Countdown|Debrief|Coming later/.test(card) && /not medical advice/i.test(await appText()), 'The card has no "(typical)", no Countdown or Debrief, and says not medical advice');
check((await page.locator('.btn:not(.ghost)').count()) === 1 && (await page.locator('.btn:not(.ghost)').innerText()).includes('Email my race card') && (await page.getByRole('button', { name: 'Print top-tube card' }).count()) === 0, 'With pacing and nutrition saved, the email button is the one yellow action, and there is no Print button');
// RD-037, spec criterion 14: no print root and no print stylesheet. The browser prints the screen as it is.
check(await page.evaluate(() => !document.getElementById('print-root') && ![...document.styleSheets].some((sh) => [...sh.cssRules].some((r) => r.constructor.name === 'CSSMediaRule' && /print/.test(r.media.mediaText)))), 'There is no #print-root and no print stylesheet');
await wordsClean('The race card');
for (const w of [390, 360, 320]) {
  await page.setViewportSize({ width: w, height: 844 });
  const broken = await brokenText();
  check(broken.length === 0, `Card leg text is not broken mid-word at ${w}px`);
  await noHorizontalScroll('The race card', w);
  const btnBox = await planBtn().boundingBox();
  check(btnBox.height >= 44 && btnBox.width >= 44, `The Race plan button is at least 44 px at ${w}px (${Math.round(btnBox.width)} x ${Math.round(btnBox.height)})`);
  await planBtn().click();
  const rowBoxes = await planPanel().locator('a').evaluateAll((els) => els.map((e) => [e.getBoundingClientRect().height, e.getBoundingClientRect().width]));
  check(rowBoxes.length === 4 && rowBoxes.every(([hh, ww]) => hh >= 44 && ww >= 44), `The four panel rows are at least 44 px at ${w}px`);
  await noHorizontalScroll('The race card with the panel open', w);
  await planBtn().click();
}
await page.setViewportSize({ width: 390, height: 844 });
await shot('card');

// The PDF rows: what the emailed card holds
const tt = await pdfText(false);
check(/Bike nutrition/.test(tt) && /Run nutrition/.test(tt) && !/\bfuel\b/i.test(tt) && /175–185 W/.test(tt), 'The PDF has pace and nutrition, with Nutrition headings');
check(/Gel 0:30 · 1:30 · 2:30/.test(tt) && /at ~\d+ km/.test(tt) && tt.includes(kmNote) && /not medical advice/i.test(tt), 'The PDF has your gel times, their km, the KM_NOTE and not medical advice');
check(!CLOCK.test(tt) && !/Transition|start time/i.test(tt), 'The PDF has no start time, no transition and no time of day');
await pdfRowsOk('The PDF', false);
const drawn = await page.evaluate((k) => {
  const race = JSON.parse(localStorage.getItem(k)).race;
  const bytes = window.RD.card.drawPdf(window.jspdf.jsPDF, window.RD.card.rows({ race, pace: race.pace, fuel: race.fuel, fuelStale: false }));
  return { head: String.fromCharCode(...bytes.subarray(0, 5)), size: bytes.length };
}, KEY);
check(drawn.head === '%PDF-' && drawn.size > 500 && drawn.size < 33000, `The vendored library draws the card in the browser under the content policy (${drawn.size} bytes)`);

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
check(/All four steps done\./.test(s5b) && (await page.getByRole('link', { name: 'Open my race card' }).isVisible()) && /Bike \d+ g\/hr · run \d+ g\/hr/.test(s5b) && /Ready to email/.test(s5b), 'S5 after nutrition says "All four steps done." with "Open my race card"');
check((await page.locator('li.step.goal').count()) === 0 && (await page.getByRole('link', { name: 'Edit' }).count()) === 3 && (await page.getByRole('link', { name: 'Open', exact: true }).count()) === 1, 'S5 shows step 4 done (no light blue) with Edit on steps 1 to 3 and Open on step 4');
await shot('s5-all-done');

// Stale targets (15 and 4). Change FTP on part 1, leave by the panel's Race card without saving.
await page.goto(base + '/index.html#/pacing/1');
await page.getByLabel('FTP', { exact: true }).fill('260');
await viaPlan(/Race card/);
await page.locator('.racecard').waitFor();
check(/Your numbers changed since these targets/.test(await page.locator('.racecard').innerText()), 'Leaving part 1 by the Race plan panel after a change flags the targets as out of date');
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
await viaPlan(/^Race(?! card)/);
await page.getByRole('heading', { name: 'Choose a race' }).waitFor();
check(await page.getByRole('button', { name: 'Save and back to race card' }).isVisible(), 'Step 1 has "Save and back to race card" once the card has a plan');
await page.goto(base + '/index.html#/pacing/2');
check(await page.getByRole('button', { name: 'Save and back to race card' }).isVisible(), 'Part 2 has "Save and back to race card" once the card has a plan');
await viaPlan(/Pacing/);
await page.getByRole('heading', { name: 'Your pace targets' }).waitFor();
check(true, 'Pacing in the Race plan panel opens part 3 once pace is saved');
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
check((await pdfRows(true)).some((r) => r.text === 'Nutrition plan out of date. Update it before race day.'), 'The PDF says "Nutrition plan out of date. Update it before race day." when the plan is out of date');
await pdfRowsOk('Out-of-date PDF', true);
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
  await stripIs(`Old address ${hash}`, true);
}
await page.goto(base + '/index.html#/saved');
await page.reload();
check(await page.locator('.racecard').isVisible(), 'Old address #/saved opens the race card');
await stripIs('Old address #/saved', false);
await headerIs('Old address #/saved', { plan: true });

// Products: add one, it appears in step 3.
await page.goto(base + '/index.html#/products');
await page.getByRole('button', { name: 'Add a product' }).click();
await headerIs('My products', { plan: false });
await stripIs('My products', false);
check(await page.getByRole('link', { name: 'Nutrition' }).first().isVisible(), 'My products keeps a back link named Nutrition');
await noStatus('My products');
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
check((await page.getByLabel('Exact figure (g)').count()) === (await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).products.filter((p) => ![20, 25, 30, 35, 40, 45, 50].includes(p.carbs)).length, KEY)), 'Picking a step from Other hides the typed box again');
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
// Step 3 with no race: still works, has neither the Race plan button nor a status row (the wordmark goes home), and "Save to a race plan" makes a race with no times.
await fresh('solo nutrition');
await page.goto(base + '/index.html#/fuel');
await page.getByRole('heading', { name: 'Review nutrition' }).waitFor();
await headerIs('Step 3 with no race (solo)', { plan: false });
await noStatus('Step 3 with no race (solo)');
await stripIs('Step 3 with no race (solo)', false);
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
const oldTT = await pdfText(false);
check(!CLOCK.test(oldTT) && !/Transition/i.test(oldTT) && !/out of date/i.test(oldTT) && /nutrition/i.test(oldTT), 'Old save: the PDF has no time of day, no transition and no out-of-date line');
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
await stripIs('The bike guide', false);
check((await page.locator('header.top').getByRole('link', { name: 'TRI Momentum' }).isVisible()) && /· TRI Momentum$/.test(await page.title()), 'The bike guide has the wordmark and a TRI Momentum title');
await headerIs('The bike guide', { plan: false });
await noStatus('The bike guide');
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
await stripIs('The nutrition guide', false);
check(/Your 70\.3 nutrition/.test(await page.locator('.tool').innerText()) && /g\/hr/.test(await page.locator('.tool').innerText()), 'Nutrition guide shows "Your 70.3 nutrition" and a plan from its defaults');
const guideTool = await page.locator('.tool').innerText();
check(/at \d+:\d\d \(~\d+ km\)/.test(guideTool) && guideTool.includes(kmNote) && !/NaN/.test(guideTool), 'Nutrition guide shows km beside the run gel times, with KM_NOTE');
const nutTool = (await page.locator('.tool, .savebox').allInnerTexts()).join(' ');
check(!/\bfuel\b/i.test(nutTool) && !/\bstandard\b/i.test(nutTool) && (await page.locator('header.top').getByRole('link', { name: 'TRI Momentum' }).isVisible()), 'The nutrition guide\'s header and tool have no "fuel" or "Standard", and it has the wordmark');
await headerIs('The nutrition guide', { plan: false });
await noStatus('The nutrition guide');
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

// ---------------------------------------------------------------------------------------------------------------
// Scenarios 8 to 18: email the race card (RD-039, criterion 29). Each one is a fresh browser context, seeded from the same
// made-up save as scenario 4 (an Olympic plan for Sam Lee with pace and nutrition saved), so none inherits another's state.
// /api/send is stubbed with page.route in each, and no scenario touches a real network or a real mail service. The
// function itself runs only on Cloudflare, and is tested in tests/send.test.js.
const ADDRESS = 'sam@example.test';
const MAIL_SENT = 'Sent. It should arrive in a few minutes. Check your junk folder if not.';
const MAIL_REFUSED = "That address didn't work. Check it and try again.";
const MAIL_LATER = "Email isn't working right now. Your plan is saved on this device.";
const MAIL_BAD = 'Type one email address, such as sam@example.test.';
const MAIL_STALE = 'Your nutrition plan is out of date. The emailed card will say so. Update it on step 3 first.';
const STALE_PDF = 'Nutrition plan out of date. Update it before race day.';
const YELLOW = 'rgb(248, 196, 79)';
const mailSave = () => { const v = JSON.parse(JSON.stringify(fixture)); v.race.date = inDays(30); return v; };
const seedWith = (save) => ({ fn: ([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, arg: [KEY, JSON.stringify(save)] });
const sendBtn = () => page.getByRole('button', { name: 'Email my race card', exact: true });
const mailStatus = () => page.locator('.mail .mailnote');
const json = (status, result, extra = {}) => ({ status, contentType: 'application/json', body: JSON.stringify({ result }), ...extra });
// Opens the race card with /api/send stubbed. handler is (route) => ..., or null for no stub at all: the smoke server
// then answers 404, which is what GitHub Pages does for an address it does not have. Returns the requests the stub saw.
async function mailPage(label, save, handler, { errorsExpected = false } = {}) {
  sendErrorsExpected = errorsExpected;
  await fresh(label, { init: seedWith(save) });
  const seen = [];
  if (handler) await page.route('**/api/send', async (route) => { seen.push(route.request()); await handler(route); });
  await page.goto(base + '/index.html#/card');
  await page.locator('.racecard').waitFor();
  return seen;
}
// What a person should be left with after any result: the card and the saved plan, both as they were.
async function stillWorks(where, before) {
  check((await page.evaluate((k) => localStorage.getItem(k), KEY)) === before, `${where}: the saved plan is exactly as it was`);
  check(await page.locator('.racecard').isVisible(), `${where}: the card is still there`);
  check((await sendBtn().isEnabled()) && (await sendBtn().innerText()) === 'Email my race card', `${where}: the button is back to "Email my race card"`);
}
const storeText = () => page.evaluate((k) => localStorage.getItem(k), KEY);
const said = () => page.evaluate(() => window.__said);
async function watchStatus() {
  await page.evaluate(() => {
    window.__said = [];
    const el = document.querySelector('.mail .mailnote');
    new MutationObserver((records) => records.forEach(() => window.__said.push(el.textContent))).observe(el, { childList: true, characterData: true, subtree: true });
  });
}
async function typeAndSend(address) {
  await page.locator('#f-mail').fill(address);
  await sendBtn().click();
}

// 8. The block: where it is, what it says, how big it is. Isolation: fresh context, seeded save. Nothing is sent.
{
  const seen = await mailPage('email block', mailSave(), (route) => route.fulfill(json(200, 'sent')));
  const m = page.locator('section.mail');
  check((await m.count()) === 1, 'The email block is on the race card');
  check((await page.getByLabel('Email me this race card', { exact: true }).count()) === 1, 'The email field is labelled "Email me this race card"');
  const f = page.locator('#f-mail');
  check((await f.getAttribute('type')) === 'email' && (await f.getAttribute('inputmode')) === 'email' && (await f.getAttribute('autocomplete')) === 'email' && (await f.inputValue()) === '', 'The field is type email, inputmode email, autocomplete email, and starts empty');
  check((await m.getByText("We use this address once, to send this card. We don't keep it.", { exact: true }).count()) === 1 && (await f.getAttribute('aria-describedby')) === 'mail-hint', 'The block says the address is used once and not kept, and the field points at that line');
  check((await sendBtn().count()) === 1 && (await m.locator('[role=status]').count()) === 1, 'There is one button, "Email my race card", and one result line with role=status');
  const geo = await page.evaluate(() => {
    const top = (e) => e.getBoundingClientRect().top; const bottom = (e) => e.getBoundingClientRect().bottom;
    return { card: bottom(document.querySelector('.racecard')), mailTop: top(document.querySelector('section.mail')) };
  });
  check(geo.card <= geo.mailTop, `The block sits below the card (${Math.round(geo.card)} <= ${Math.round(geo.mailTop)})`);
  const bg = await sendBtn().evaluate((e) => getComputedStyle(e).backgroundColor);
  await sendBtn().hover();
  const bgHover = await sendBtn().evaluate((e) => getComputedStyle(e).backgroundColor);
  check(bg === YELLOW && !/ghost/.test(await sendBtn().getAttribute('class')) && (await page.locator('.btn:not(.ghost)').count()) === 1 && (await page.locator('.btn:not(.ghost)').innerText()).includes('Email my race card') && (await page.getByRole('button', { name: 'Print top-tube card' }).count()) === 0, `The email button is the one yellow button (${bg}, on hover ${bgHover}), and there is no Print button`);
  const sizes = await page.evaluate(() => ['#f-mail', 'section.mail .btn'].map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  check(sizes.every(([w, hh]) => w >= 44 && hh >= 44), `The field and the button are at least 44 px (${JSON.stringify(sizes)})`);
  await shot('email-block');
  for (const w of [390, 360, 320]) { await page.setViewportSize({ width: w, height: 844 }); await noHorizontalScroll('The race card with the email block', w); }
  await page.setViewportSize({ width: 1200, height: 900 });
  await noHorizontalScroll('The race card with the email block', 1200);
  await shot('email-block-1200');
  await page.setViewportSize({ width: 390, height: 844 });
  // The card redraws when its header opens for editing; what was typed in the email field stays.
  await page.locator('#f-mail').fill(ADDRESS);
  await page.locator('.racecard .band').getByRole('button', { name: 'Edit race' }).click();
  await page.locator('#f-race-name').waitFor();
  check((await page.locator('#f-mail').inputValue()) === ADDRESS && (await page.locator('.mail').count()) === 1, 'Opening "Edit race" redraws the card and keeps the typed address');
  check(seen.length === 0, 'Looking at the block sends nothing');
  await page.context().close();
}

// 9. A blank or bad address makes no request. Isolation: fresh context, seeded save, a stub that counts.
{
  const seen = await mailPage('email validation', mailSave(), (route) => route.fulfill(json(200, 'sent')));
  const before = await storeText();
  const err = page.locator('#mail-err');
  const bad = [['blank', ''], ['two addresses with a comma', 'sam@example.test, lee@example.test'], ['two addresses, a line break between', 'sam@example.test\nlee@example.test'], ['no dot in the domain', 'sam@example'], ['no @', 'sam.example.test'], ['a semicolon', 'sam@example.test;lee@example.test']];
  for (const [what, value] of bad) {
    await page.locator('#f-mail').fill(value);
    await sendBtn().click();
    check((await err.isVisible()) && (await err.innerText()) === MAIL_BAD && (await page.locator('#f-mail').getAttribute('aria-invalid')) === 'true' && /mail-err/.test(await page.locator('#f-mail').getAttribute('aria-describedby')), `${what}: the message shows by the field`);
    check((await page.locator('#f-mail').evaluate((e) => e === document.activeElement)), `${what}: focus goes back to the field`);
  }
  await page.waitForTimeout(150);
  check(seen.length === 0, 'A blank or bad address made no request (route counter stays 0)');
  await page.locator('#f-mail').fill('sam@example.test');
  check(!(await err.isVisible()) && !(await page.locator('#f-mail').getAttribute('aria-invalid')), 'Typing again clears the message');
  check((await storeText()) === before, 'Validation changed nothing saved');
  await page.context().close();
}

// 10. Sent. Isolation: fresh context, seeded save. The stub holds its reply for 300 ms, so a double tap lands while sending.
{
  const save = mailSave();
  const seen = await mailPage('email sent', save, async (route) => { await page.waitForTimeout(300); await route.fulfill(json(200, 'sent')); });
  const before = await storeText();
  await watchStatus();
  await page.locator('#f-mail').fill(`  ${ADDRESS}  `);
  await sendBtn().dblclick();
  const busyBtn = page.locator('section.mail .btn');
  check((await busyBtn.isDisabled()) && (await busyBtn.innerText()) === 'Sending...', 'While sending the button is disabled and says "Sending..."');
  await page.waitForFunction((t) => document.querySelector('.mail .mailnote').textContent === t, MAIL_SENT);
  await page.waitForTimeout(400);
  check(seen.length === 1, `A double tap sent once (${seen.length} request)`);
  const req = seen[0];
  const body = req.postDataJSON();
  check(req.method() === 'POST' && new URL(req.url()).pathname === '/api/send' && (await req.headerValue('content-type')) === 'application/json', 'The request is a POST of JSON to /api/send');
  check((await req.headerValue('origin')) === base, `The request's Origin header is the page's own origin, never "null" (${await req.headerValue('origin')})`);
  check(Object.keys(body).sort().join(',') === 'email,pdf' && body.email === ADDRESS, 'The body holds only email and pdf, and the address is trimmed');
  const pdfBytes = Buffer.from(body.pdf, 'base64');
  const pdf = pdfBytes.toString('latin1');
  check(pdf.startsWith('%PDF-') && pdfBytes.length > 500 && pdfBytes.length * 3 < 100000, `The PDF starts %PDF- and is ${pdfBytes.length} bytes, under a third of the 100,000 byte cap`);
  check(/not medical advice/.test(pdf) && /TRI Momentum race card/.test(pdf) && /Olympic/.test(pdf) && /Water at each aid station/.test(pdf), 'The PDF holds the card words, the distance and "not medical advice"');
  check(!pdf.includes(save.race.name) && !/Sprint Cup|Sam Lee/.test(pdf) && !CLOCK.test(pdf) && !/Transition|start time/i.test(pdf) && !/NaN|undefined/.test(pdf), 'The PDF has no race name, no time of day, no transition and no junk');
  check(!pdf.includes(STALE_PDF) && !/\/Filter|\/JavaScript|\/JS\b|\/URI|\/EmbeddedFile|\/Launch/.test(pdf) && (pdf.match(/\/Type \/Page\b(?!s)/g) || []).length === 1, 'A current plan has no out-of-date line; the PDF is one page, uncompressed, with no script or link');
  check((await mailStatus().innerText()) === MAIL_SENT && !/delivered/i.test(await mailStatus().innerText()), 'The result says "Sent. It should arrive in a few minutes. Check your junk folder if not." and never "delivered"');
  const history = await said();
  check(history.length === 1 && history[0] === MAIL_SENT, `The result line was written once (${JSON.stringify(history)})`);
  check((await mailStatus().getAttribute('role')) === 'status', 'The result is in a role=status line');
  await stillWorks('After sent', before);
  // The address is held in the page for this visit only: leaving the card and coming back starts blank.
  await page.locator('#f-mail').fill(ADDRESS);
  await page.goto(base + '/index.html#/');
  await page.getByRole('heading', { name: /Sprint Cup/ }).waitFor();
  await page.goto(base + '/index.html#/card');
  await page.locator('.racecard').waitFor();
  check((await page.locator('#f-mail').inputValue()) === '' && (await mailStatus().innerText()) === '', 'Leaving the card and coming back shows an empty field and a blank result line');
  // The address is held in the page for this visit only.
  check(!(await storeText()).includes(ADDRESS) && !(await page.evaluate(() => location.href)).includes('sam') && !(await page.evaluate(() => document.cookie)).includes('sam') && !(await page.evaluate(() => JSON.stringify(sessionStorage) + JSON.stringify(localStorage))).includes(ADDRESS), 'After sending, the address is not in storage, the page address or a cookie');
  await page.reload();
  await page.locator('.racecard').waitFor();
  check((await page.locator('#f-mail').inputValue()) === '' && (await mailStatus().innerText()) === '', 'After a reload the field is empty and the result line is blank');
  await page.context().close();
}

// 11. Refused (a 400 from the function). Isolation: fresh context, seeded save.
{
  const seen = await mailPage('email refused', mailSave(), (route) => route.fulfill(json(400, 'refused')), { errorsExpected: true });
  const before = await storeText();
  await typeAndSend(ADDRESS);
  await page.waitForFunction((t) => document.querySelector('.mail .mailnote').textContent === t, MAIL_REFUSED);
  check(seen.length === 1 && (await mailStatus().innerText()) === MAIL_REFUSED && (await mailStatus().isVisible()), 'A refused reply says "That address didn\'t work. Check it and try again."');
  await stillWorks('After refused', before);
  await typeAndSend(ADDRESS);
  await page.waitForFunction(() => document.querySelector('section.mail .btn').textContent === 'Email my race card');
  check(seen.length === 2, 'The person can try again after a refusal');
  await page.context().close();
}

// 12. The function asks to try later (503) and a 429. Isolation: fresh context per status.
for (const status of [503, 429]) {
  sendErrorsExpected = true;
  const seen = await mailPage(`email later ${status}`, mailSave(), (route) => route.fulfill(json(status, 'later')), { errorsExpected: true });
  const before = await storeText();
  await typeAndSend(ADDRESS);
  await page.waitForFunction((t) => document.querySelector('.mail .mailnote').textContent === t, MAIL_LATER);
  check(seen.length === 1 && (await mailStatus().innerText()) === MAIL_LATER && (await mailStatus().isVisible()), `A ${status} "later" reply says email is not working right now, and the plan is saved`);
  await stillWorks(`After ${status}`, before);
  await page.context().close();
}

// 13. Offline. Isolation: fresh context, then the context goes offline before the tap.
{
  const seen = await mailPage('email offline', mailSave(), (route) => route.fulfill(json(200, 'sent')), { errorsExpected: true });
  const before = await storeText();
  await page.context().setOffline(true);
  await typeAndSend(ADDRESS);
  await page.waitForFunction((t) => document.querySelector('.mail .mailnote').textContent === t, MAIL_LATER);
  check(seen.length === 0 && (await mailStatus().innerText()) === MAIL_LATER, 'Offline: the message says email is not working, and no request goes out');
  await stillWorks('After offline', before);
  await page.context().close();
}

// 14. The network fails after the tap (the device thinks it is online). Isolation: fresh context.
{
  const seen = await mailPage('email network failure', mailSave(), (route) => route.abort('connectionreset'), { errorsExpected: true });
  const before = await storeText();
  await typeAndSend(ADDRESS);
  await page.waitForFunction((t) => document.querySelector('.mail .mailnote').textContent === t, MAIL_LATER);
  check(seen.length === 1 && (await mailStatus().innerText()) === MAIL_LATER, 'A failed request says email is not working');
  await stillWorks('After a network failure', before);
  await page.context().close();
}

// 15. No /api/send at all: the smoke server's 404, which is what GitHub Pages gives. Isolation: fresh context, no stub.
{
  const seen = await mailPage('email no function', mailSave(), null, { errorsExpected: true });
  const before = await storeText();
  let hit = null;
  page.on('response', (r) => { if (new URL(r.url()).pathname === '/api/send') hit = [r.request().method(), r.status()]; });
  await typeAndSend(ADDRESS);
  await page.waitForFunction((t) => document.querySelector('.mail .mailnote').textContent === t, MAIL_LATER);
  check(JSON.stringify(hit) === '["POST",404]' && seen.length === 0, `With no function behind /api/send (a static host's 404) the message says email is not working (${JSON.stringify(hit)})`);
  await stillWorks('After a 404', before);
  await page.context().close();
}

// 16. A 200 that is not the function's JSON (a static host that answers every address with a page), and a 405. Isolation: fresh context each.
for (const [what, reply] of [['a page, not JSON', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>x</title>' })], ['JSON with no result', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })], ['a 405', (route) => route.fulfill(json(405, 'refused'))]]) {
  const seen = await mailPage('email odd reply', mailSave(), reply, { errorsExpected: true });
  const before = await storeText();
  await typeAndSend(ADDRESS);
  await page.waitForFunction((t) => document.querySelector('.mail .mailnote').textContent === t, MAIL_LATER);
  check(seen.length === 1 && (await mailStatus().innerText()) === MAIL_LATER, `A reply that is ${what} says email is not working, never "sent"`);
  await stillWorks(`After ${what}`, before);
  await page.context().close();
}

// 17. A reply that never comes. Isolation: fresh context. The page's clock is faked so the 15 second wait takes no real time.
{
  const seen = await mailPage('email timeout', mailSave(), async () => { /* never answers */ }, { errorsExpected: true });
  const before = await storeText();
  await page.clock.install();
  await typeAndSend(ADDRESS);
  await page.waitForFunction(() => document.querySelector('section.mail .btn').textContent === 'Sending...');
  await page.clock.fastForward(14000);
  check((await sendBtn().count()) === 0 && (await mailStatus().innerText()) === '', 'After 14 seconds it is still sending');
  await page.clock.fastForward(2000);
  await page.waitForFunction((t) => document.querySelector('.mail .mailnote').textContent === t, MAIL_LATER);
  check(seen.length === 1 && (await mailStatus().innerText()) === MAIL_LATER, 'After about 15 seconds with no reply the message says email is not working');
  await stillWorks('After a timeout', before);
  await page.context().close();
}

// 18. An out-of-date plan. Isolation: fresh context, the seeded save with the gut figure changed after the plan was made.
{
  const save = mailSave();
  save.details.gut = 50;
  const seen = await mailPage('email stale', save, (route) => route.fulfill(json(200, 'sent')));
  const notice = page.locator('section.mail p.notice.warn');
  check((await notice.count()) === 1 && (await notice.innerText()) === MAIL_STALE, 'An out-of-date plan shows "Your nutrition plan is out of date. The emailed card will say so. Update it on step 3 first."');
  const order = await page.evaluate(() => { const q = (s) => document.querySelector(s).getBoundingClientRect().top; return q('section.mail p.notice.warn') < q('section.mail .btn') && q('#f-mail') < q('section.mail p.notice.warn'); });
  check(order, 'The notice sits above the button');
  await shot('email-block-stale');
  await noHorizontalScroll('The race card with the email block and its out-of-date notice', 390);
  await typeAndSend(ADDRESS);
  await page.waitForFunction((t) => document.querySelector('.mail .mailnote').textContent === t, MAIL_SENT);
  const pdf = Buffer.from(seen[0].postDataJSON().pdf, 'base64').toString('latin1');
  check(seen.length === 1 && pdf.includes(STALE_PDF), 'Sending was still allowed, and the PDF says "Nutrition plan out of date. Update it before race day."');
  await page.context().close();
}

// 19. No block without a finished plan. Isolation: fresh context each, the seeded save with one half taken away.
for (const [what, edit] of [['no nutrition plan', (v) => { v.race.fuel = null; }], ['no pace plan', (v) => { v.race.pace = null; }]]) {
  const save = mailSave();
  edit(save);
  const seen = await mailPage(`email ${what}`, save, (route) => route.fulfill(json(200, 'sent')));
  check((await page.locator('section.mail, #f-mail').count()) === 0 && seen.length === 0, `The race card with ${what} has no email block`);
  await page.context().close();
}
sendErrorsExpected = false;

// ---------------------------------------------------------------------------------------------------------------
// Scenarios 20 to 35: the race strip (RD-041, criterion 30). Each one is a fresh browser context (empty storage, no shared
// module state) seeded from the made-up save of scenario 4 (Sam Lee), with the race name, distance and date set as each says.
// Inside one scenario the steps share the session on purpose where a later step reads what an earlier one did; the scenario
// says so. Nothing here sends a request, and the outside-host and /api/ guards of fresh() stay on throughout.
const stripSeed = (over = {}, fit = {}) => {
  const v = JSON.parse(JSON.stringify(fixture));
  Object.assign(v.race, { name: 'Spring 70.3', distance: '70.3', date: inDays(20) }, over);
  Object.assign(v.fitness, fit);
  return v;
};
const strip = () => page.locator('div.strip');
const stripBtn = (which) => page.locator('#strip-edit-' + which);
const expandedOf = (which) => stripBtn(which).getAttribute('aria-expanded');
const activeId = () => page.evaluate(() => document.activeElement && document.activeElement.id);
const flatText = (loc) => loc.evaluate((e) => e.innerText.replace(/\s+/g, ' ').trim()); // as shown, so separate blocks read as separate words
const dayBefore = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return isoLocal(new Date(y, m - 1, d - n)); };
const TAPER_REFUSED = 'Pick a day 1 to 42 days before race day.';
async function stripPage(label, save, hash, { width = 390 } = {}) {
  await fresh(label, { width, init: seedWith(save) });
  await page.goto(base + '/index.html' + hash);
  await page.locator('#view h1').first().waitFor();
}
// Counts every time the page's own h1 takes focus from here on: a strip tap must never do that.
const watchH1 = () => page.evaluate(() => { window.__h1 = 0; document.addEventListener('focusin', (e) => { if (e.target.tagName === 'H1') window.__h1++; }); });
const h1Focused = () => page.evaluate(() => window.__h1);

// 20. Where it shows (A1, A2, A3). Isolation: a fresh context per address, so no earlier visit can leave a strip behind.
for (const [hash, h1] of [['#/pacing/1', 'Choose pacing'], ['#/pacing/2', 'Course and heat'], ['#/pacing/3', 'Your pace targets'], ['#/fuel', 'Review nutrition'], ['#/setup/2', 'Choose pacing'], ['#/setup/3', 'Choose pacing'], ['#/setup/4', 'Course and heat'], ['#/setup/5', 'Your pace targets']]) {
  await stripPage(`strip shows ${hash}`, stripSeed(), hash);
  await stripIs(hash, true);
  const active = await page.evaluate(() => [document.activeElement.tagName, document.activeElement.textContent]);
  check(active[0] === 'H1' && active[1] === h1, `${hash}: on arrival focus is on the page's own h1, "${h1}" (${active})`);
  await page.context().close();
}
await stripPage('strip shows, a number is missing', stripSeed({}, { ftp: null }), '#/pacing/3');
await stripIs('Pacing part 3, "A number is missing"', true);
check(await page.getByRole('heading', { name: 'A number is missing' }).isVisible(), 'That view of part 3 is the "A number is missing" one');
await page.context().close();
for (const [hash, what] of [['#/', 'Home (S5)'], ['#/setup/1', 'Step 1'], ['#/card', 'The race card'], ['#/saved', 'The old #/saved address'], ['#/products', 'My products']]) {
  await stripPage(`strip absent ${hash}`, stripSeed(), hash);
  check((await page.locator('#view').innerText()).length > 20, `${what} drew a screen`);
  await stripIs(what, false);
  await page.context().close();
}
// 21. What it says (A4, A5, A6). Isolation: a fresh context per row.
const STRIP_DATE = /^Spring 70\.3\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun),? \d{1,2} [A-Z][a-z]{2}/;
const STRIP_LINE2 = /Taper starts (Mon|Tue|Wed|Thu|Fri|Sat|Sun),? \d{1,2} [A-Z][a-z]{2}/;
const STRIP_NO_LINE2 = /days to go|Tomorrow|Race day|Race done|Taper|NaN|null|undefined|\b0\b/;
for (const [what, date, want] of [['20 days out, our guide taper', inDays(20), (t) => /\b20 days to go\b/.test(t) && STRIP_LINE2.test(t)],
  ['1 day out', inDays(1), (t) => /Tomorrow/.test(t) && /In your taper/.test(t)],
  ['race day', inDays(0), (t) => /Race day/.test(t) && /In your taper/.test(t)]]) {
  await stripPage(`strip row ${what}`, stripSeed({ date }), '#/pacing/1');
  const t = await flatText(strip());
  check(want(t) && (await stripBtn('taper').count()) === 1 && (await strip().locator('.count').count()) === 1, `Strip, ${what}: line 2 says it, with Edit taper (${t})`);
  check(STRIP_DATE.test(await strip().innerText()) && (await strip().getByRole('button', { name: 'Edit race', exact: true }).count()) === 1, `Strip, ${what}: line 1 is the title, the short date and "Edit race"`);
  await page.context().close();
}
await stripPage('strip row race done', stripSeed({ date: inDays(-3) }), '#/pacing/1');
{
  const t = await flatText(strip());
  check(/Race done/.test(t) && !/Taper/.test(t) && (await stripBtn('taper').count()) === 0 && (await strip().getByRole('button', { name: /taper/i }).count()) === 0, `Strip, 3 days ago: "Race done", no taper text and no Edit taper (${t})`);
  await page.context().close();
}
for (const [what, edit] of [['an empty string', (r) => { r.date = ''; }], ['null', (r) => { r.date = null; }], ['a key that is missing', (r) => { delete r.date; }], ['"not-a-date"', (r) => { r.date = 'not-a-date'; }]]) {
  const save = stripSeed();
  edit(save.race);
  await stripPage(`strip row no date ${what}`, save, '#/pacing/1');
  const t = await flatText(strip());
  check(/No date yet/.test(t) && (await strip().locator('.count, .rule').count()) === 0 && (await stripBtn('taper').count()) === 0 && (await stripBtn('race').count()) === 1, `Strip, date is ${what}: "No date yet", no line 2, no Edit taper (${t})`);
  check(!STRIP_NO_LINE2.test(t), `Strip, date is ${what}: none of "days to go", Tomorrow, Race day, Race done, Taper, NaN, null, undefined or a bare 0 (${t})`);
  if (what === 'an empty string') {
    await stripBtn('race').click();
    check(await strip().getByText('Tap the date to choose it.', { exact: true }).isVisible(), 'Edit race with no date says "Tap the date to choose it."');
  }
  await page.context().close();
}
await stripPage('strip blank name', stripSeed({ name: '' }), '#/pacing/1');
check(/^My race\b/.test(await flatText(strip())), 'Strip, blank name: line 1 says "My race"');
await page.context().close();

// 22. The buttons and the Edit race panel (A8, A9, A12). Isolation: fresh context; the steps share the session on purpose.
await stripPage('strip buttons', stripSeed(), '#/fuel');
await watchH1();
for (const w of [390, 320]) {
  await page.setViewportSize({ width: w, height: 844 });
  const bs = await strip().locator('button').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [e.textContent.trim(), e.type, e.getAttribute('aria-expanded'), r.width, r.height]; }));
  check(bs.map((b) => b[0]).join('|') === 'Edit race|Edit taper' && bs.every((b) => b[1] === 'button' && b[2] === 'false' && b[3] >= 44 && b[4] >= 44), `Strip buttons are type=button, closed, and at least 44 x 44 at ${w}px (${bs.map((b) => Math.round(b[3]) + 'x' + Math.round(b[4]))})`);
}
await page.setViewportSize({ width: 390, height: 844 });
check((await strip().getByRole('button', { name: 'Edit race', exact: true }).count()) === 1 && (await strip().getByRole('button', { name: 'Edit taper', exact: true }).count()) === 1 && (await strip().locator('button svg[aria-hidden="true"]').count()) === 2, 'The buttons are named exactly "Edit race" and "Edit taper"; the chevron is aria-hidden');
check((await stripBtn('race').locator('svg path').getAttribute('d')) === 'M6 9l6 6 6-6', 'A closed button shows the chevron pointing down');
await stripBtn('race').click();
check((await expandedOf('race')) === 'true' && (await activeId()) === 'f-race-name' && (await stripBtn('race').locator('svg path').getAttribute('d')) === 'M6 15l6-6 6 6', 'Edit race opens its panel, aria-expanded is true, the chevron flips up, and focus is in the race name');
const racePanel = strip().locator('#strip-panel');
check((await racePanel.getAttribute('aria-label')) === 'Edit race' && (await strip().getByLabel('Race name').getAttribute('type')) === 'text' && (await strip().getByLabel('Race name').getAttribute('name')) === 'race-name' && (await strip().getByLabel('Race date').getAttribute('type')) === 'date' && (await strip().getByLabel('Race date').getAttribute('name')) === 'race-date', 'The Edit race panel has the race name (text) and the race date (date), with the same names as step 1');
check((await racePanel.getByRole('button').allInnerTexts()).join('|') === 'Done' && (await strip().getByRole('button', { name: /save|cancel/i }).count()) === 0 && (await strip().getByRole('link', { name: /save|cancel/i }).count()) === 0, 'The panel has one button, Done, and the strip has no Save or Cancel');
await stripBtn('taper').click();
check((await expandedOf('race')) === 'false' && (await expandedOf('taper')) === 'true' && (await strip().locator('.panel').count()) === 1 && (await strip().locator('.panel').getAttribute('aria-label')) === 'Edit taper', 'Opening Edit taper closes Edit race: one panel, the other button aria-expanded false');
await stripBtn('race').click();
check((await expandedOf('taper')) === 'false' && (await expandedOf('race')) === 'true' && (await strip().locator('.panel').count()) === 1 && (await strip().locator('.panel').getAttribute('aria-label')) === 'Edit race', 'Opening Edit race closes Edit taper');
check((await h1Focused()) === 0, 'No strip tap moved focus to the page h1');
await page.context().close();

// 23. Changes save as they are typed (A10). Isolation: fresh context.
await stripPage('strip typing', stripSeed(), '#/fuel');
await stripBtn('race').click();
await strip().getByLabel('Race date').fill(inDays(25));
check((await store()).race.date === inDays(25) && /\b25 days to go\b/.test(await flatText(strip())) && (await strip().locator('#strip-panel').count()) === 1 && (await activeId()) === 'f-race-date', 'Filling the date stores it, and the strip says "25 days to go" with the panel still open and focus in the field');
await strip().getByLabel('Race name').fill('');
await strip().getByLabel('Race name').pressSequentially('Lake Run');
const caret = await page.evaluate(() => { const e = document.activeElement; return [e.id, e.value, e.selectionStart, e.selectionEnd]; });
check((await store()).race.name === 'Lake Run' && /^Lake Run · 70\.3/.test(await flatText(strip())) && caret.join() === 'f-race-name,Lake Run,8,8', `Typing the name one key at a time saves it, line 1 follows, and focus and caret stay in the field (${caret})`);
await page.context().close();

// 24. Edit taper (A11), on step 3 and on one pacing part. Isolation: fresh context per address.
for (const hash of ['#/fuel', '#/pacing/2']) {
  const date = inDays(20);
  await stripPage(`strip taper ${hash}`, stripSeed({ date }), hash);
  await stripBtn('taper').click();
  const panel = strip().locator('#strip-panel');
  const pill = (re) => panel.getByRole('button', { name: re });
  check((await expandedOf('taper')) === 'true' && (await activeId()) === 'strip-panel' && (await panel.getAttribute('aria-label')) === 'Edit taper', `${hash}: Edit taper opens the panel and focus moves to it`);
  check((await panel.locator('.pills button').allInnerTexts()).join('|') === '10 days|14 days (our guide)|21 days' && (await pill(/14 days/).getAttribute('aria-pressed')) === 'true' && (await panel.getByLabel('Or pick the day your taper starts').count()) === 1, `${hash}: the taper controls are the same as the card header's, with our guide (14 days for a 70.3) marked pressed`);
  const line = await strip().locator('.taper .bt').innerText();
  await pill(/21 days/).click();
  check((await store()).race.taperDays === 21 && (await strip().locator('.taper .bt').innerText()) !== line && (await strip().locator('#strip-panel').count()) === 1, `${hash}: picking 21 saves 21 and moves the taper line`);
  const day = strip().locator('#strip-panel').getByLabel('Or pick the day your taper starts');
  for (const [what, iso] of [['43 days before race day', dayBefore(date, 43)], ['race day itself', dayBefore(date, 0)], ['3 days after race day', dayBefore(date, -3)]]) {
    await day.fill(iso);
    check(await strip().getByText(TAPER_REFUSED, { exact: true }).isVisible() && (await store()).race.taperDays === 21 && (await day.inputValue()) === iso, `${hash}: ${what} is refused with its message, not saved, and the refused day stays`);
  }
  for (const [what, n] of [['42 days before race day', 42], ['1 day before race day', 1]]) {
    await day.fill(dayBefore(date, n));
    check((await store()).race.taperDays === n && (await strip().getByText(TAPER_REFUSED).count()) === 0, `${hash}: ${what} is accepted and saved as ${n}`);
  }
  await pill(/14 days/).click();
  check(typeof (await store()).race.taperDays !== 'number' && (await pill(/14 days/).getAttribute('aria-pressed')) === 'true', `${hash}: picking our guide saves blank, never a number`);
  await page.context().close();
}

// 24b. An Olympic race marks 10 days, not 14, as our guide (spec criterion 20). Isolation: fresh context.
await stripPage('strip taper olympic', stripSeed({ distance: 'standard' }), '#/fuel');
await stripBtn('taper').click();
{
  const pills = strip().locator('#strip-panel .pills button');
  check((await pills.allInnerTexts()).join('|') === '10 days (our guide)|14 days|21 days' && (await pills.first().getAttribute('aria-pressed')) === 'true', 'For an Olympic race the strip marks 10 days as our guide, and it is pressed');
}
await page.context().close();

// 25. Done and tapping a button again (A13). Isolation: fresh context.
await stripPage('strip done', stripSeed(), '#/fuel');
await stripBtn('race').click();
await strip().getByLabel('Race name').fill('');
await strip().getByRole('button', { name: 'Done' }).click();
check((await store()).race.name === 'My race' && (await strip().locator('.panel').count()) === 0 && (await expandedOf('race')) === 'false' && (await activeId()) === 'strip-edit-race', 'Done after a cleared name stores "My race", closes the panel, and puts focus back on Edit race');
await stripBtn('taper').click();
await strip().locator('#strip-panel').getByLabel('Or pick the day your taper starts').fill(dayBefore((await store()).race.date, -3));
check(await strip().getByText(TAPER_REFUSED, { exact: true }).isVisible(), 'A refused taper day shows its message');
await strip().getByRole('button', { name: 'Done' }).click();
check((await strip().locator('.panel').count()) === 0 && (await strip().getByText(TAPER_REFUSED).count()) === 0 && (await activeId()) === 'strip-edit-taper', 'Done after a refused taper day closes the panel, clears the message, and puts focus back on Edit taper');
await stripBtn('taper').click();
check((await strip().getByText(TAPER_REFUSED).count()) === 0 && (await strip().locator('#strip-panel').getByLabel('Or pick the day your taper starts').inputValue()) === (await page.evaluate(() => document.querySelector('#strip-panel input[type=date]').value)) && (await strip().locator('#strip-panel [aria-invalid="true"]').count()) === 0, 'Reopening Edit taper shows no refused day and no message');
await stripBtn('taper').click();
check((await expandedOf('taper')) === 'false' && (await strip().locator('.panel').count()) === 0, 'Tapping the open panel\'s own button again closes it (Edit taper)');
await stripBtn('race').click();
await stripBtn('race').click();
check((await expandedOf('race')) === 'false' && (await strip().locator('.panel').count()) === 0, 'Tapping the open panel\'s own button again closes it (Edit race)');
await page.context().close();

// 26. Edit taper follows the date (A14). Isolation: fresh context.
await stripPage('strip date follows', stripSeed(), '#/fuel');
await stripBtn('race').click();
await strip().getByLabel('Race date').fill(inDays(-3));
check(/Race done/.test(await flatText(strip())) && (await stripBtn('taper').count()) === 0 && !/Taper/.test(await flatText(strip())), 'Changing the date to a past day makes line 2 "Race done" and removes Edit taper');
await strip().getByLabel('Race date').fill('');
check((await strip().locator('.count, .rule').count()) === 0 && !/Race done|days to go/.test(await flatText(strip())) && (await stripBtn('taper').count()) === 0 && /No date yet/.test(await flatText(strip())), 'Clearing the date removes line 2');
await strip().getByLabel('Race date').fill(inDays(10));
check((await stripBtn('taper').count()) === 1 && /\b10 days to go\b/.test(await flatText(strip())), 'A date in the future brings line 2 and Edit taper back');
await page.context().close();

// 27. The countdown stays in view (A15). Isolation: fresh context per screen.
for (const hash of ['#/fuel', '#/pacing/1']) {
  await stripPage(`strip in view ${hash}`, stripSeed(), hash);
  for (const which of ['race', 'taper']) {
    await stripBtn(which).click();
    const g = await page.evaluate(() => { const q = (s) => document.querySelector(s).getBoundingClientRect(); return { l1: q('.strip .toprow'), l2: q('.strip .count'), p: q('#strip-panel'), vh: window.innerHeight }; });
    check(g.l1.top >= 0 && g.l1.bottom <= g.vh && g.l2.top >= 0 && g.l2.bottom <= g.vh && g.l2.top < g.p.top && g.p.top < g.vh, `${hash}: with Edit ${which} open, lines 1 and 2 sit above the panel, all in view at 390 x 844 (line 2 top ${Math.round(g.l2.top)}, panel top ${Math.round(g.p.top)})`);
  }
  await page.context().close();
}

// 28. Panels open closed on every visit (A16). Isolation: fresh context per case.
const stripClosed = async () => (await expandedOf('race')) === 'false' && (await expandedOf('taper')) === 'false' && (await strip().locator('.panel').count()) === 0;
await stripPage('strip closed after Next', stripSeed(), '#/pacing/1');
await stripBtn('taper').click();
await page.getByRole('button', { name: 'Next: course and heat' }).click();
await page.getByRole('heading', { name: 'Course and heat' }).waitFor();
check(await stripClosed(), 'Open Edit taper on part 1, press Next: part 2\'s strip is closed');
await stripBtn('race').click();
await page.getByRole('link', { name: 'Back: your fitness' }).click();
await page.getByRole('heading', { name: 'Choose pacing' }).waitFor();
check(await stripClosed(), 'Open Edit race on part 2, press Back: part 1\'s strip is closed');
await page.context().close();
await stripPage('strip closed after the Race plan panel', stripSeed(), '#/fuel');
await stripBtn('race').click();
await viaPlan(/Race card/);
await page.locator('.racecard').waitFor();
await viaPlan(/Nutrition/);
await page.getByRole('heading', { name: 'Review nutrition' }).waitFor();
check(await stripClosed(), 'Open Edit race on step 3, tap the Race plan panel to the race card and back: the strip is closed');
await page.context().close();
await stripPage('strip closed after a typed address', stripSeed(), '#/pacing/1');
await stripBtn('taper').click();
await page.goto(base + '/index.html#/pacing/2');
await page.getByRole('heading', { name: 'Course and heat' }).waitFor();
check(await stripClosed(), 'Open Edit taper, then type another address: the strip is closed');
await page.context().close();
await stripPage('strip closed after a reload', stripSeed(), '#/pacing/1');
await stripBtn('taper').click();
await page.reload();
await statusRow().waitFor();
check(await stripClosed(), 'Open Edit taper, then reload: the strip is closed');
await page.context().close();

// 29. One edit state, shared with the card (A17). Isolation: fresh context per direction.
await stripPage('strip then card', stripSeed(), '#/fuel');
await stripBtn('race').click();
await viaPlan(/Race card/);
await page.locator('.racecard').waitFor();
const band = page.locator('.racecard .band');
check((await band.locator('#card-edit-race').getAttribute('aria-expanded')) === 'false' && (await band.locator('#card-edit-taper').getAttribute('aria-expanded')) === 'false' && (await band.locator('.panel').count()) === 0 && (await strip().count()) === 0, 'Open Edit race on step 3, tap Race card in the Race plan panel: the card band has both buttons aria-expanded false, no panel, and no strip');
await page.context().close();
await stripPage('card then strip', stripSeed(), '#/card');
await page.locator('#card-edit-taper').click();
check((await page.locator('#card-edit-taper').getAttribute('aria-expanded')) === 'true', 'The card band opens its taper panel');
await viaPlan(/Nutrition/);
await page.getByRole('heading', { name: 'Review nutrition' }).waitFor();
check(await stripClosed(), 'Open the card\'s Edit taper, tap Nutrition in the Race plan panel: step 3\'s strip is closed');
await page.context().close();

// 30. No lost typing, no harmful redraw (A19). Isolation: fresh context per property.
// (a) Part 1: a readable FTP and an unreadable CSS survive the strip's redraws.
await stripPage('strip no lost typing a', stripSeed(), '#/pacing/1');
await watchH1();
await page.getByLabel('FTP', { exact: true }).fill('260');
await page.getByLabel('CSS, your critical swim speed').fill('45');
await stripBtn('race').click();
await strip().getByLabel('Race name').fill('Lake Run');
await strip().getByRole('button', { name: 'Done' }).click();
await stripBtn('taper').click();
await stripBtn('taper').click();
{
  const s = await store();
  check((await page.getByLabel('FTP', { exact: true }).inputValue()) === '260' && (await page.getByLabel('CSS, your critical swim speed').inputValue()) === '45' && s.fitness.ftp === 260 && s.race.name === 'Lake Run' && (await h1Focused()) === 0, 'Part 1: a typed FTP (260) and an unreadable CSS ("45") both still show after Edit race, Done and Edit taper, and the FTP is stored');
}
await page.context().close();
// (b) Step 3: the gut and sweat questions stay open, with what was typed.
await stripPage('strip no lost typing b', stripSeed(), '#/fuel');
await page.getByRole('link', { name: 'Change', exact: true }).click();
await page.getByLabel('Carbs your gut handles').fill('65');
await watchH1();
await stripBtn('race').click();
await strip().getByLabel('Race name').fill('Lake Run');
await settle();
check((await page.getByLabel('Carbs your gut handles').isVisible()) && (await page.getByLabel('Carbs your gut handles').inputValue()) === '65' && (await h1Focused()) === 0, 'Step 3: with the gut and sweat questions open and 65 typed, Edit race and a new name leave them open and the gut field at 65');
await page.context().close();
// (c) The first arrival at step 3: the "targets saved" line stays through strip taps.
{
  const save = stripSeed();
  save.race.pace = null; save.race.fuel = null; save.race.splits = null; save.race.splitsByHand = null;
  await stripPage('strip no lost typing c', save, '#/pacing/3');
  await page.getByRole('button', { name: 'Save to my race card' }).click();
  await page.getByRole('heading', { name: 'Review nutrition' }).waitFor();
  const saved = page.getByRole('status').filter({ hasText: 'Pace targets saved to your race card' });
  check((await saved.count()) === 1, 'The first save opens step 3 with "Pace targets saved to your race card"');
  await watchH1();
  await stripBtn('race').click();
  await strip().getByRole('button', { name: 'Done' }).click();
  await stripBtn('taper').click();
  await stripBtn('taper').click();
  check((await saved.count()) === 1 && (await saved.isVisible()) && (await h1Focused()) === 0, 'The "targets saved" line is still shown once after opening and closing both strip panels');
  await page.context().close();
}
// (d) The page does not jump.
await stripPage('strip no lost typing d', stripSeed(), '#/pacing/1');
await page.evaluate(() => window.scrollTo(0, 60));
{
  const ys = [await page.evaluate(() => window.scrollY)];
  await stripBtn('race').click(); ys.push(await page.evaluate(() => window.scrollY));
  await strip().getByRole('button', { name: 'Done' }).click(); ys.push(await page.evaluate(() => window.scrollY));
  await stripBtn('taper').click(); ys.push(await page.evaluate(() => window.scrollY));
  await stripBtn('taper').click(); ys.push(await page.evaluate(() => window.scrollY));
  check(ys[0] >= 58 && ys.every((y) => Math.abs(y - ys[0]) <= 2), `The window's scrollY does not change by more than 2 px across the strip's open, Done and close (${ys})`);
}
await page.context().close();

// 31. A failing Next with the taper panel open (A20). Isolation: fresh context. The steps share the session on purpose.
await stripPage('strip failing next', stripSeed(), '#/pacing/1');
{
  const date = (await store()).race.date;
  const refused = dayBefore(date, -3);
  await stripBtn('taper').click();
  await strip().locator('#strip-panel').getByLabel('Or pick the day your taper starts').fill(refused);
  await page.getByLabel('FTP', { exact: true }).fill('');
  await page.getByLabel('CSS, your critical swim speed').fill('');
  await page.getByRole('button', { name: 'Next: course and heat' }).click();
  const after = await page.evaluate(() => {
    const first = [...document.querySelectorAll('[aria-invalid="true"]')].find((e) => !e.closest('.strip'));
    return { active: document.activeElement.id, first: first && first.id, taper: document.querySelector('#f-race-taperDate') && document.querySelector('#f-race-taperDate').value };
  });
  check((await page.getByRole('heading', { name: 'Choose pacing' }).isVisible()) && (await strip().getByText(TAPER_REFUSED, { exact: true }).isVisible()) && after.taper === refused, 'A failing Next keeps the strip\'s refused day and its message on screen');
  check(after.active === 'f-fitness-css' && after.first === 'f-fitness-css', `Focus goes to the first invalid field of the step, never the taper input (${after.active})`);
  await page.getByLabel('FTP', { exact: true }).fill('240');
  await page.getByLabel('CSS, your critical swim speed').fill('1:45');
  await page.getByRole('button', { name: 'Next: course and heat' }).click();
  await page.getByRole('heading', { name: 'Course and heat' }).waitFor();
  check(await stripClosed(), 'A passing Next, with the refused day showing, moves on and the next strip is closed');
}
await page.context().close();

// 31b. The mode pill keeps a refused taper day (A11, A20). Isolation: fresh context.
await stripPage('strip mode pill', stripSeed(), '#/pacing/1');
{
  const date = (await store()).race.date;
  const refused = dayBefore(date, -3);
  await stripBtn('taper').click();
  await strip().locator('#strip-panel').getByLabel('Or pick the day your taper starts').fill(refused);
  await page.getByRole('button', { name: 'Heart rate', exact: true }).click();
  const after = await page.evaluate(() => { const i = document.querySelector('#f-race-taperDate'); return i && i.value; });
  check((await strip().getByText(TAPER_REFUSED, { exact: true }).isVisible()) && after === refused, 'Changing the pacing mode keeps the strip\'s refused taper day and its message');
}
await page.context().close();

// 32. Strip edits never make a plan out of date (A21). Isolation: fresh context, the unchanged save of scenario 4.
{
  await fresh('strip stale', { init: seedWith(mailSave()) });
  await page.goto(base + '/index.html#/card');
  await page.locator('.racecard').waitFor();
  const stale = async () => /changed since/i.test(await page.locator('.racecard').innerText());
  const keys0 = await page.evaluate((k) => { const r = JSON.parse(localStorage.getItem(k)).race; return [r.pace.inputKey, r.fuel.inputKey]; }, KEY);
  check(!(await stale()), 'Before any strip edit the card shows neither out-of-date notice');
  await page.goto(base + '/index.html#/fuel');
  await page.getByRole('heading', { name: 'Review nutrition' }).waitFor();
  await stripBtn('race').click();
  await strip().getByLabel('Race name').fill('Renamed Cup');
  await strip().getByLabel('Race date').fill(inDays(35));
  await strip().getByRole('button', { name: 'Done' }).click();
  await stripBtn('taper').click();
  await strip().getByRole('button', { name: /21 days/ }).click();
  await strip().getByRole('button', { name: 'Done' }).click();
  await viaPlan(/Race card/);
  await page.locator('.racecard').waitFor();
  const s = await store();
  const keys1 = [s.race.pace.inputKey, s.race.fuel.inputKey];
  check(s.race.name === 'Renamed Cup' && s.race.date === inDays(35) && s.race.taperDays === 21, 'The name, date and taper were changed through the strip');
  check(!(await stale()) && keys1.join('|') === keys0.join('|'), 'After name, date and taper edits on the strip the card shows neither notice, and the saved input keys are unchanged');
  await page.goto(base + '/index.html#/');
  await page.reload();
  check(!/Out of date/.test(await appText()), 'Home does not call pacing or nutrition out of date after strip edits');
  // The detector is live in this session: a real change to a number the plan reads does show the notice.
  await page.goto(base + '/index.html#/pacing/1');
  await page.getByLabel('FTP', { exact: true }).fill('260');
  await viaPlan(/Race card/);
  await page.locator('.racecard').waitFor();
  check(/Your numbers changed since these targets/.test(await page.locator('.racecard').innerText()), 'Control: changing FTP does flag the targets as out of date in the same session');
  await page.context().close();
}

// 33. No sideways scroll, and a long name (A23). Isolation: a fresh context per state; each is checked at three widths by resizing.
const STRIP_LONG = 'Lakeside Autumn Classic Half Distance Triathlon';
for (const [what, save, hash, act] of [
  ['closed', stripSeed(), '#/pacing/1', async () => {}],
  ['Edit race open', stripSeed(), '#/pacing/1', async () => { await stripBtn('race').click(); }],
  ['Edit taper open with the refusal', stripSeed(), '#/fuel', async () => { await stripBtn('taper').click(); await strip().locator('#strip-panel').getByLabel('Or pick the day your taper starts').fill(dayBefore(inDays(20), -3)); }],
  ['a long name and a date', stripSeed({ name: STRIP_LONG }), '#/pacing/1', async () => {}],
  ['a long name with Edit race open', stripSeed({ name: STRIP_LONG }), '#/fuel', async () => { await stripBtn('race').click(); }]]) {
  await stripPage(`strip width ${what}`, save, hash);
  await act();
  for (const w of [390, 360, 320]) {
    await page.setViewportSize({ width: w, height: 844 });
    await noHorizontalScroll(`The strip, ${what},`, w);
    const m = await page.evaluate(() => {
      const ctx = document.createElement('canvas').getContext('2d');
      const name = document.querySelector('.strip .rname');
      const cs = getComputedStyle(name);
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const longest = Math.max(...name.textContent.split(/\s+/).filter(Boolean).map((x) => ctx.measureText(x).width));
      const b = document.getElementById('strip-edit-race').getBoundingClientRect();
      return { fit: longest <= name.parentElement.clientWidth + 0.5, uncut: name.parentElement.scrollWidth <= name.parentElement.clientWidth + 1, lines: name.getClientRects().length, left: b.left, right: b.right, w: b.width, h: b.height, vw: window.innerWidth };
    });
    check(m.fit && m.uncut && m.left >= 0 && m.right <= m.vw && m.w >= 44 && m.h >= 44, `The strip, ${what}, at ${w}px: the name is not cut off or broken mid-word, and Edit race is inside the screen at ${Math.round(m.w)} x ${Math.round(m.h)}`);
    if (what.startsWith('a long name') && w === 320) check(m.lines >= 2, `The long name wraps onto ${m.lines} lines at 320px`);
  }
  if (what === 'a long name and a date') await shot('strip-long-name');
  await page.context().close();
}

// 34. The header, the status row and the strip all scroll with the page (A13). Isolation: fresh context.
await stripPage('strip scroll', stripSeed(), '#/pacing/1');
{
  const pos = await strip().evaluate((e) => getComputedStyle(e).position);
  const statusPos = await statusRow().evaluate((e) => getComputedStyle(e).position);
  const headPos = await page.locator('header.top').evaluate((e) => getComputedStyle(e).position);
  await page.evaluate(() => window.scrollTo(0, 600));
  const g = await page.evaluate(() => ({
    y: window.scrollY,
    headBottom: document.querySelector('header.top').getBoundingClientRect().bottom,
    statusBottom: document.querySelector('div.here').getBoundingClientRect().bottom,
    stripBottom: document.querySelector('.strip').getBoundingClientRect().bottom,
  }));
  check(pos !== 'sticky' && pos !== 'fixed', `The strip is not sticky or fixed (position ${pos})`);
  check([statusPos, headPos].every((v) => v !== 'sticky' && v !== 'fixed'), `The status row and the header are not sticky or fixed (positions ${statusPos}, ${headPos})`);
  check(g.y >= 590 && g.headBottom < 0 && g.statusBottom < 0 && g.stripBottom < 0, `After scrolling 600 px the header (bottom ${Math.round(g.headBottom)}), the status row (bottom ${Math.round(g.statusBottom)}) and the strip (bottom ${Math.round(g.stripBottom)}) have all scrolled away`);
}
await page.context().close();

// 35. Typed text stays text (A27). Isolation: fresh context per screen.
const HOSTILE = '<img src=x onerror="window.__x=1">Lake';
for (const hash of ['#/pacing/1', '#/fuel']) {
  await stripPage(`strip hostile name ${hash}`, stripSeed({ name: HOSTILE }), hash);
  const probe = async () => page.evaluate(() => ({ img: document.querySelectorAll('#view img').length, onerror: document.querySelectorAll('[onerror]').length, x: typeof window.__x }));
  let p = await probe();
  check(p.img === 0 && p.onerror === 0 && p.x === 'undefined' && (await strip().evaluate((e) => e.textContent)).includes(HOSTILE), `${hash}: a name holding an img tag shows as text in the strip, with no element made and nothing run`);
  await stripBtn('race').click();
  p = await probe();
  check(p.img === 0 && p.onerror === 0 && p.x === 'undefined' && (await strip().getByLabel('Race name').inputValue()) === HOSTILE, `${hash}: and the same with Edit race open (the field holds the literal text)`);
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------------------
// 36. The Race plan button, status row and panel (criterion 19). Every case is a fresh context with its own seed
// (full reload, empty storage, then the seed), so no case inherits a panel left open by another.
const DATE_ONLY = { pace: null, fuel: null, splits: null };
const panelLinks = () => planPanel().locator('a');
const expandedPlan = () => planBtn().getAttribute('aria-expanded');
const activeIdOrTag = () => page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
const lc = (t) => t.replace(/\s+/g, ' ').trim().toLowerCase();
const ROUTES = [['#/setup/1', 'Race'], ['#/pacing/1', 'Pacing'], ['#/pacing/2', 'Pacing'], ['#/pacing/3', 'Pacing'], ['#/setup/4', 'Pacing'], ['#/fuel', 'Nutrition'], ['#/card', 'Race card'], ['#/saved', 'Race card']];

// 36a. "You are here" follows the screen, not the saved state: eight routes, two seeds (A17). Isolation: fresh per case.
for (const [seedName, over] of [['a race with only a date', DATE_ONLY], ['a full plan', {}]]) {
  for (const [hash, step] of ROUTES) {
    await stripPage(`you are here ${seedName} ${hash}`, stripSeed(over), hash);
    check((await page.locator('[aria-current]').count()) === 0 && (await expandedPlan()) === 'false' && (await planPanel().isHidden()), `${hash} (${seedName}): closed panel, nothing on the page has aria-current`);
    await planBtn().click();
    const cur = planPanel().locator('a[aria-current="step"]');
    const rowsText = (await panelLinks().allInnerTexts()).map(lc);
    const here = rowsText.map((t) => t.includes('you are here'));
    const idx = STEPS.indexOf(step);
    check((await page.locator('[aria-current="step"]').count()) === 1 && (await cur.count()) === 1 && lc(await cur.innerText()).replace(/^\d /, '').startsWith(step.toLowerCase()) && here.filter(Boolean).length === 1 && here[idx] && lc(await statusRow().innerText()).startsWith(`step ${idx + 1} of 4 ${step.toLowerCase()}`), `${hash} (${seedName}): open panel has one aria-current row, ${step}, the only "You are here", and the status row names ${step}`);
    check((await page.locator('[inert], [aria-modal]').count()) === 0, `${hash} (${seedName}): the open panel makes nothing inert and no element is aria-modal`);
    await page.context().close();
  }
}

// 36b. Row states and targets, and the bars, on #/pacing/2 with Race and Nutrition done (A11, A16, A17). Fresh context.
await stripPage('panel states full plan', stripSeed(), '#/pacing/2');
await planBtn().click();
const rowInfo = await panelLinks().evaluateAll((els) => els.map((e) => ({ href: e.getAttribute('href'), tick: !!e.querySelector('.c svg'), cls: e.className, text: e.innerText.replace(/\s+/g, ' ').trim(), bg: getComputedStyle(e.querySelector('.c')).backgroundColor, circle: getComputedStyle(e.querySelector('.c')).borderTopColor, rowBg: getComputedStyle(e).backgroundColor, ring: getComputedStyle(e).boxShadow })));
check(rowInfo.map((r) => r.href).join(',') === '#/setup/1,#/pacing/3,#/fuel,#/card', `With pace saved the panel targets are #/setup/1, #/pacing/3, #/fuel, #/card (${rowInfo.map((r) => r.href)})`);
check(rowInfo[0].tick && /Done$/.test(rowInfo[0].text) && rowInfo[0].bg === 'rgb(17, 107, 67)' && !rowInfo[1].tick && /You are here$/.test(rowInfo[1].text) && rowInfo[1].bg === 'rgb(24, 37, 66)' && /^2 ?/.test(await panelLinks().nth(1).innerText()) && rowInfo[2].tick && /Done$/.test(rowInfo[2].text), 'Panel on part 2: Race done (green tick), Pacing current (ink, number, no tick, even though done), Nutrition done');
check(!rowInfo[3].tick && /Last step$/.test(rowInfo[3].text) && !/Done/.test(rowInfo[3].text) && rowInfo[3].rowBg === 'rgb(234, 247, 252)' && rowInfo[3].ring === 'none' && rowInfo[3].circle === 'rgb(0, 112, 168)', `Race card row is on info-bg, with no tick and no "Done", before it is current (${rowInfo[3].rowBg}, ${rowInfo[3].ring})`);
const bars = await statusRow().locator('.fours i').evaluateAll((els) => els.map((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).boxShadow !== 'none']));
check(bars.map((b) => b[0]).join('|') === 'rgb(17, 107, 67)|rgb(24, 37, 66)|rgb(17, 107, 67)|rgb(234, 247, 252)' && bars[3][1] && !bars[0][1] && (await statusRow().locator('.fours').getAttribute('aria-hidden')) === 'true', `Part 2 with Race and Nutrition done: bars green, ink, green, info-bg with a ring, hidden from a screen reader (${bars.map((b) => b[0])})`);
await page.context().close();
await stripPage('panel states date only', stripSeed(DATE_ONLY), '#/pacing/1');
await planBtn().click();
const rowInfo2 = await panelLinks().evaluateAll((els) => els.map((e) => ({ href: e.getAttribute('href'), tick: !!e.querySelector('.c svg') })));
check(rowInfo2.map((r) => r.href).join(',') === '#/setup/1,#/pacing/1,#/fuel,#/card' && rowInfo2[0].tick && !rowInfo2[1].tick && !rowInfo2[2].tick && !rowInfo2[3].tick, `With no pace saved, Pacing targets part 1, and only Race is done (${rowInfo2.map((r) => r.href)})`);
await page.context().close();

// 36c. The locked row (A18). Fresh context.
await stripPage('panel locked row', stripSeed(), '#/fuel');
await planBtn().click();
const locked = await planPanel().evaluate((nav) => {
  const row = [...nav.querySelectorAll('div')].find((d) => /Review your race/.test(d.textContent));
  const sep = [...nav.querySelectorAll('p')].find((x) => /After the race/.test(x.textContent));
  return { found: !!row, text: row && row.innerText.replace(/\s+/g, ' ').trim(), inert: row && (row.matches('a,button,input,select,textarea,[tabindex],[href],[onclick],[aria-current],[role=link],[role=button]') || !!row.querySelector('a,button,input,[tabindex]')), icon: row && row.querySelector('svg').getAttribute('aria-hidden'), sep: !!sep };
});
check(locked.found && locked.sep && locked.text === 'Review your race Opens after race day' && !locked.inert && locked.icon === 'true', 'The locked row sits under an "After the race" divider, says "Opens after race day", is not a link or control, and its lock icon is hidden from a screen reader');
check((await page.getByRole('link', { name: /Review/ }).count()) === 0 && (await page.getByRole('button', { name: /Review/ }).count()) === 0, 'No link or button on the page is named Review');
// Tab order: the button, then the four links, then something outside the panel and the status row. The locked row never takes focus.
await planBtn().focus();
const order = [];
for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => { const a = document.activeElement; return a.id || (a.closest('#race-plan-panel') ? 'in-panel' : a.closest('div.here') ? 'in-status' : a.tagName + ':' + (a.textContent || '').trim().slice(0, 20)); })); }
check(order.slice(0, 4).join(',') === 'plan-step-1,plan-step-2,plan-step-3,plan-step-4' && !/^plan-step|in-panel|in-status/.test(order[4]), `Tab from the button goes Race, Pacing, Nutrition, Race card, then out of the panel (${order})`);
// A strip button still works with the panel open, and nothing traps focus (A8).
await stripBtn('race').click();
check((await expandedPlan()) === 'true' && (await stripBtn('race').getAttribute('aria-expanded')) === 'true' && (await strip().getByLabel('Race name').isVisible()), 'With the panel open, Edit race still opens: the page behind is usable and the two panels are independent');
await page.context().close();

// 36d. Closed panel: links take no focus and are not visible (A15). Fresh context.
await stripPage('panel closed focus', stripSeed(), '#/pacing/1');
await planBtn().focus();
await page.keyboard.press('Tab');
check((await activeIdOrTag()) !== 'plan-step-1' && (await page.locator('#race-plan-panel a').count()) === 0 && (await page.locator('#race-plan-panel').isHidden()), 'Closed panel: Tab from the button does not land in it, and it holds no links');
check(await page.evaluate(() => { const b = document.getElementById('race-plan-btn'); const p = document.getElementById('race-plan-panel'); const h = document.querySelector('header.top'); return h.nextElementSibling === p && p.nextElementSibling === document.querySelector('div.here') && b.closest('header') === h; }), 'The panel sits directly after the header and before the status row');
await page.context().close();

// 36e. Escape, a quiet redraw with the panel open, and one listener (A5, A6). Fresh context.
await stripPage('panel escape', stripSeed(), '#/fuel');
await page.evaluate(() => { window.__exp = []; new MutationObserver((ms) => ms.forEach((m) => { if (m.target.id === 'race-plan-btn') window.__exp.push(m.target.getAttribute('aria-expanded')); })).observe(document.getElementById('view'), { subtree: true, attributes: true, attributeFilter: ['aria-expanded'] }); });
await planBtn().click();
await stripBtn('race').click(); // a quiet redraw with the panel open
await strip().getByLabel('Race name').fill('Typed while open');
await page.waitForTimeout(100);
check((await expandedPlan()) === 'true' && (await planPanel().isVisible()) && (await strip().getByLabel('Race name').inputValue()) === 'Typed while open' && (await store()).race.name === 'Typed while open', 'A strip edit with the panel open redraws in place: the panel stays open (aria-expanded true) and the typed name is kept and saved');
// Escape with focus somewhere else does nothing to the panel.
await strip().getByLabel('Race name').focus();
await page.keyboard.press('Escape');
check((await expandedPlan()) === 'true' && (await planPanel().isVisible()), 'Escape with focus in the page (not the button or panel) leaves the panel open');
await page.evaluate(() => { window.__exp.length = 0; });
await planBtn().focus();
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
check((await activeIdOrTag()) === 'plan-step-2', 'Tab twice from the button reaches the second link');
await page.keyboard.press('Escape');
const exp = await page.evaluate(() => window.__exp.slice());
check((await expandedPlan()) === 'false' && (await planPanel().isHidden()) && (await activeIdOrTag()) === 'race-plan-btn' && exp.length === 1 && exp[0] === 'false' && (await page.locator('[aria-current]').count()) === 0, `Escape on the second link, after a redraw, closes the panel once (aria-expanded changed ${exp.length} time: ${exp}) and puts focus on the button`);
// Escape on the button itself closes it too.
await planBtn().click();
await page.keyboard.press('Escape');
check((await expandedPlan()) === 'false' && (await activeIdOrTag()) === 'race-plan-btn', 'Escape with focus on the button closes the panel and keeps focus on the button');
await page.context().close();

// 36f. Choosing a step (A7). Fresh context per case.
await stripPage('panel choose other', stripSeed(), '#/fuel');
await planBtn().click();
await planPanel().getByRole('link', { name: /Race card/ }).click();
await page.locator('.racecard').waitFor();
check((await expandedPlan()) === 'false' && (await planPanel().isHidden()) && (await page.evaluate(() => document.activeElement.tagName)) === 'H1' && page.url().endsWith('#/card'), 'On step 3, choosing Race card closes the panel, opens the card and puts focus on its h1');
await page.context().close();
await stripPage('panel choose same', stripSeed(), '#/fuel');
await watchH1();
await stripBtn('race').click();
await strip().getByLabel('Race name').fill('Typed before choosing');
await planBtn().click();
await planPanel().getByRole('link', { name: /Nutrition/ }).click();
await page.waitForTimeout(500);
check((await expandedPlan()) === 'false' && (await planPanel().isHidden()) && (await activeId()) === 'race-plan-btn' && page.url().endsWith('#/fuel') && (await h1Focused()) === 0 && (await strip().getByLabel('Race name').inputValue()) === 'Typed before choosing', 'On step 3, choosing Nutrition closes the panel, leaves the address as it was, puts focus on the button, does not redraw and keeps the typed race name');
await page.context().close();
await stripPage('panel pacing 3 same', stripSeed(), '#/pacing/3');
await planBtn().click();
await planPanel().getByRole('link', { name: /Pacing/ }).click();
check((await expandedPlan()) === 'false' && (await activeId()) === 'race-plan-btn' && page.url().endsWith('#/pacing/3'), 'On part 3 with pace saved, choosing Pacing (the same address) closes the panel and focuses the button');
await page.context().close();

// 36g. Closed on every kind of new visit (A4). Fresh context per case.
await stripPage('panel closed after Next', stripSeed(), '#/pacing/1');
await planBtn().click();
await page.getByRole('button', { name: 'Next: course and heat' }).click();
await page.getByRole('heading', { name: 'Course and heat' }).waitFor();
check((await expandedPlan()) === 'false' && (await planPanel().isHidden()), 'Open the panel, press Next: the next screen opens with the panel closed');
await planBtn().click();
await page.getByRole('link', { name: 'Back: your fitness' }).click();
await page.getByRole('heading', { name: 'Choose pacing' }).waitFor();
check((await expandedPlan()) === 'false' && (await planPanel().isHidden()), 'Open the panel, press Back: the earlier screen opens with the panel closed');
await page.context().close();
await stripPage('panel closed after typed address', stripSeed(), '#/pacing/1');
await planBtn().click();
await page.goto(base + '/index.html#/pacing/2');
await page.getByRole('heading', { name: 'Course and heat' }).waitFor();
check((await expandedPlan()) === 'false' && (await planPanel().isHidden()), 'Open the panel, type another address: the panel is closed');
await page.context().close();
await stripPage('panel closed after reload', stripSeed(), '#/pacing/1');
await planBtn().click();
await page.reload();
await statusRow().waitFor();
check((await expandedPlan()) === 'false' && (await planPanel().isHidden()), 'Open the panel, reload: the panel is closed');
check(!JSON.stringify(await store()).includes('plan-open') && !(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).includes('race-plan'), 'The panel\'s open state is not stored');
await page.context().close();

// 36h. After race day (A19, A20, A21). Fresh context per screen, seeded 3 days past.
for (const [hash, step] of [['#/setup/1', 'Race'], ['#/pacing/3', 'Pacing'], ['#/fuel', 'Nutrition'], ['#/card', 'Race card']]) {
  await stripPage(`after race day ${hash}`, stripSeed({ date: inDays(-3) }), hash);
  const row = lc(await statusRow().innerText());
  const complete = await statusRow().locator('.complete i').evaluateAll((els) => els.map((e) => [getComputedStyle(e).backgroundColor, e.getBoundingClientRect().width]));
  check(row === `race done ${step.toLowerCase()} plan complete` && !/step|next/.test(row) && (await statusRow().locator('i').count()) === 1 && complete.length === 1 && complete[0][0] === 'rgb(17, 107, 67)' && complete[0][1] > 100 && (await statusRow().locator('.fours').count()) === 0, `${hash} after race day: the status row says "Race done", ${step} and "Plan complete" with one green bar, no "Step n of 4" and no "Next" (${row})`);
  await planBtn().click();
  const panelText = lc(await planPanel().innerText());
  check((await planPanel().locator('div.locked').count()) === 1 && /after the race review your race opens after race day$/.test(panelText) && (await page.getByRole('link', { name: /Review/ }).count()) === 0 && (await page.getByRole('button', { name: /Review/ }).count()) === 0 && (await panelLinks().count()) === 4 && (await page.locator('[aria-current="step"]').count()) === 1, `${hash} after race day: the panel keeps four rows and the locked Review row, with no Review link or button`);
  const yellow = await page.locator('.btn').evaluateAll((els) => els.filter((e) => getComputedStyle(e).backgroundColor === 'rgb(248, 196, 79)').length);
  check(yellow <= 1 && !(await page.locator('.btn').filter({ hasText: /Review/ }).count()), `${hash} after race day: at most one yellow action and none says Review (${yellow})`);
  const header = hash === '#/card' ? await flatText(page.locator('.racecard .band')) : hash.includes('setup') ? 'Race done' : await flatText(strip());
  check(/Race done/.test(header) && !/Taper|Edit taper/.test(header), `${hash} after race day: the strip or card header still says "Race done" with no taper line`);
  await page.context().close();
}

// 36i. A blank, unreadable or same-day date is never "Race done" (A22). Fresh context per seed.
for (const [what, date] of [['a blank date', ''], ['2025-13-45', '2025-13-45'], ['"soon"', 'soon'], ['race day itself', inDays(0)]]) {
  await stripPage(`not after race day ${what}`, stripSeed({ date }), '#/pacing/1');
  const row = lc(await statusRow().innerText());
  check(row.startsWith('step 2 of 4 pacing') && !/race done|plan complete/.test(row) && (await statusRow().locator('.fours i').count()) === 4, `${what}: the status row is the before-race-day one ("${row}"), never "Race done"`);
  await page.context().close();
}

// 36j. S5 after race day keeps its header and list, with no Review row or action (A23). Fresh context.
await fresh('s5 after race day', { init: seedWith(stripSeed({ date: inDays(-3) })) });
await page.goto(base + '/index.html#/');
await page.getByRole('heading', { name: 'Spring 70.3' }).waitFor();
await headerIs('S5 after race day', { plan: false });
await noStatus('S5 after race day');
check((await page.locator('ol.steps li').count()) === 4 && (await page.locator('.btn').count()) === 1 && !/Review your race/.test(await appText()), 'S5 after race day keeps its four steps and one yellow action, with no Review row or action');
await page.context().close();

// 36k. No sideways scroll with the panel open or closed, before and after race day, at three widths (A24). Fresh per case.
for (const [what, over] of [['before race day', {}], ['after race day', { date: inDays(-3) }]]) {
  for (const hash of ['#/pacing/2', '#/fuel']) {
    for (const w of [390, 360, 320]) {
      await stripPage(`no scroll ${what} ${hash} ${w}`, stripSeed(over), hash, { width: w });
      await noHorizontalScroll(`${hash} ${what}, panel closed`, w);
      const b = await planBtn().boundingBox();
      check(b.width >= 44 && b.height >= 44, `${hash} ${what}: the Race plan button is ${Math.round(b.width)} x ${Math.round(b.height)} at ${w}px`);
      await planBtn().click();
      await noHorizontalScroll(`${hash} ${what}, panel open`, w);
      const rows = await panelLinks().evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      check(rows.length === 4 && rows.every((v) => v >= 44), `${hash} ${what}: the four panel rows are at least 44 px high at ${w}px (${rows.map(Math.round)})`);
      if (w === 390 && hash === '#/pacing/2') await shot(`panel-open-${what.replace(/ /g, '-')}`);
      await page.context().close();
    }
  }
}

// 36k2. The button is at least 44 x 44 on every route at three widths (A2). Fresh context per case.
for (const [hash] of ROUTES) {
  for (const w of [390, 360, 320]) {
    await stripPage(`button size ${hash} ${w}`, stripSeed(), hash, { width: w });
    const b = await planBtn().boundingBox();
    check(b.width >= 44 && b.height >= 44, `${hash}: the Race plan button is ${Math.round(b.width)} x ${Math.round(b.height)} at ${w}px`);
    await page.context().close();
  }
}

// 36l. The old header name is rendered nowhere, in text, aria-label or title (A26). Fresh context per screen, panel open.
// The pattern is built from two pieces so this file does not match its own search.
const OLD_NAME = 'my' + ' plan';
for (const hash of ['#/setup/1', '#/pacing/2', '#/fuel', '#/card', '#/']) {
  await stripPage(`no old name ${hash}`, stripSeed(), hash);
  if (await planBtn().count()) await planBtn().click();
  const found = await page.evaluate((word) => { const re = new RegExp(word, 'i'); return [...document.querySelectorAll('*')].filter((e) => re.test(e.getAttribute('aria-label') || '') || re.test(e.getAttribute('title') || '')).length + (re.test(document.body.innerText) ? 1 : 0); }, OLD_NAME);
  check(found === 0, `${hash}: no rendered text, aria-label or title says the old header name`);
  await page.context().close();
}
// Step 3 with no race has no button and no panel (above), and step 3 with a race has them: the positive case, so a wrong selector cannot pass.
await stripPage('step 3 with a race has the button', stripSeed(), '#/fuel');
await headerIs('Step 3 with a race', { plan: true });
check((await planPanel().count()) === 1 && (await statusRow().count()) === 1, 'Step 3 with a race has the panel element and the status row');
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
