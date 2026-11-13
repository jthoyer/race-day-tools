const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../public/js/pace.js');
const F = require('../public/js/fuel.js');
const C = require('../public/js/card.js');
const cases = require('./email-cases.js');

const VENDOR = path.join(__dirname, '..', 'public', 'js', 'vendor');
const CLOCK = /\d{1,2}:\d\d ?(am|pm)/i; // the same pattern the smoke test uses

// Made-up athlete and race. A 70.3, power mode, two bike gels and one run gel.
const RACE = { name: 'Lakeside Sprint Test', distance: '70.3', date: '2026-12-06', course: 'rolling', heat: 'warm' };
const example = { distance: '70.3', mode: 'power', css: 105, ftp: 240, ftpRecent: true, runThreshold: 290, weight: 72, course: 'rolling', heat: 'warm' };
const [GEL, DRINK] = F.DEFAULT_PRODUCTS;
const pace = P.planPace(example);
const fuel = F.planFuel({ distance: '70.3', bikeMin: 110, runMin: 45, heat: 'warm', gut: 70, sweat: null, gel: GEL, drink: DRINK });
const input = (over) => ({ race: { ...RACE, pace, fuel }, pace, fuel, fuelStale: false, ...over });
const texts = (rows) => rows.map((r) => r.text);

test('the fixture is what the tests say it is', () => {
  assert.ok(pace.ok && fuel.ok);
  assert.equal(fuel.bike.gelTimes.length, 2);
  assert.equal(fuel.run.gelTimes.length, 1);
  assert.deepEqual(pace.bike.watts, [175, 185]);
});

test('rows: the pace targets and finish equal what the print card shows (A10a)', () => {
  const rows = C.rows(input());
  assert.deepEqual(rows.slice(0, 7), [
    { kind: 'title', text: 'TRI Momentum race card · 70.3' },
    { kind: 'heading', text: 'Pace' },
    { kind: 'big', text: 'Swim 1:51–1:58 /100m' },
    { kind: 'big', text: 'Bike 175–185 W' },
    { kind: 'big', text: 'Run 5:15–5:30 /km' },
    { kind: 'line', text: 'Finish 5:19–5:33' },
    { kind: 'heading', text: 'Bike nutrition · 63 g/hr' }
  ]);
});

test('rows: heart rate and effort modes give bpm and the effort words', () => {
  const hr = P.planPace({ ...example, mode: 'hr', bikeLthr: 160, runLthr: 170, steadySpeed: 30 });
  assert.ok(hr.ok);
  const effort = P.planPace({ ...example, mode: 'effort', steadySpeed: 30 });
  assert.match(texts(C.rows(input({ pace: hr })))[3], /^Bike \d+–\d+ bpm$/);
  assert.equal(texts(C.rows(input({ pace: effort })))[3], 'Bike 5–6 out of 10');
});

test('rows: nutrition per leg, gel times with their km, and the aid station line (A10b)', () => {
  const t = texts(C.rows(input()));
  assert.equal(t[6], 'Bike nutrition · 63 g/hr');
  assert.equal(t[7], 'Sip ~150 ml every 15 min');
  assert.equal(t[8], 'Gel 0:30 · 1:20');
  assert.equal(t[9], 'at ~25 km · ~65 km');
  assert.equal(t[10], 'Run nutrition · 33 g/hr');
  assert.equal(t[11], 'Gel 0:20');
  assert.equal(t[12], 'at ~9 km');
  assert.equal(t[13], 'Water at each aid station');
});

test('rows: the km come from kmAt, gel time over leg time times the leg distance (no new maths)', () => {
  const t = texts(C.rows(input()));
  const km = (leg, mins) => '~' + P.kmAt('70.3', leg, mins, fuel[leg].minutes) + ' km';
  assert.equal(t[9], 'at ' + km('bike', 30) + ' · ' + km('bike', 80));
  assert.equal(t[12], 'at ' + km('run', 20));
});

test('rows: the notes, in the print card\'s words (A10c)', () => {
  const t = texts(C.rows(input()));
  assert.equal(t[t.length - 1], 'Times are from the start of each leg. ' + P.KM_NOTE + ' Typical ranges, not medical advice.');
  assert.equal(C.rows(input()).at(-1).kind, 'fine');
  assert.equal(P.KM_NOTE, 'Go by the clock. Never take a gel earlier than its time. Km are a guide, from an even pace.');
});

test('rows: the out-of-date line shows when, and only when, the plan is out of date (A10d)', () => {
  const STALE = 'Nutrition plan out of date. Update it before race day.';
  assert.equal(C.STALE, STALE);
  assert.ok(!texts(C.rows(input({ fuelStale: false }))).includes(STALE));
  assert.ok(!texts(C.rows(input({ fuelStale: undefined }))).includes(STALE));
  assert.ok(!texts(C.rows(input({ fuelStale: 'yes' }))).includes(STALE), 'only a real true counts');
  const rows = C.rows(input({ fuelStale: true }));
  assert.equal(texts(rows).filter((x) => x === STALE).length, 1);
  assert.equal(texts(rows).indexOf(STALE), texts(rows).indexOf('Bike nutrition · 63 g/hr') - 1, 'it sits just above the nutrition, as on the print card');
  // No nutrition shown, so nothing to call out of date.
  assert.ok(!texts(C.rows(input({ fuelStale: true, fuel: null }))).includes(STALE));
});

test('rows: no race name, date, start time, transition, time of day or junk (A10e)', () => {
  for (const mode of ['power', 'hr', 'effort']) {
    const pc = P.planPace({ ...example, mode, bikeLthr: 160, runLthr: 170, steadySpeed: 30 });
    for (const fuelStale of [false, true]) {
      const t = texts(C.rows(input({ pace: pc, fuelStale }))).join('\n');
      assert.doesNotMatch(t, /Lakeside|Sprint|2026|Sunday|Monday|December/i);
      assert.doesNotMatch(t, /Transition|T1|T2|start time|Changeover/i);
      assert.doesNotMatch(t, CLOCK);
      assert.doesNotMatch(t, /NaN|undefined|null|Infinity/);
      assert.doesNotMatch(t, /Sports drink|Gel \(/, 'no product names');
    }
  }
});

test('rows: a leg time that is blank or zero gives the gel time with no km (A10f, criterion 18)', () => {
  for (const minutes of [null, 0, undefined, NaN, -5, '']) {
    const f = { ...fuel, bike: { ...fuel.bike, minutes }, run: { ...fuel.run, minutes } };
    const t = texts(C.rows(input({ fuel: f })));
    assert.ok(t.includes('Gel 0:30 · 1:20'), String(minutes));
    assert.ok(t.includes('Gel 0:20'), String(minutes));
    assert.ok(!t.some((x) => /^at |~\d+ km/.test(x)), 'no km for ' + String(minutes));
    assert.ok(!t.join(' ').includes(P.KM_NOTE), 'no km, so no go-by-the-clock note');
    assert.doesNotMatch(t.join('\n'), /NaN|undefined|null/);
  }
});

test('rows: a failed or missing nutrition plan gives pace only, and no pace gives nutrition only (A10g)', () => {
  const kinds = (rows) => rows.map((r) => r.text);
  for (const f of [{ ok: false, errors: [{ field: 'gut', message: 'x' }] }, null, undefined]) {
    const t = kinds(C.rows(input({ fuel: f, fuelStale: true })));
    assert.ok(t.includes('Pace') && !t.some((x) => /nutrition|Gel|Sip|Water/i.test(x.replace(/not medical advice/, ''))), JSON.stringify(f));
    assert.doesNotMatch(t.join(' '), /Go by the clock/);
  }
  for (const p of [null, undefined]) {
    const t = kinds(C.rows(input({ pace: p })));
    assert.ok(!t.includes('Pace') && !t.some((x) => /^(Swim|Bike \d|Run \d|Finish)/.test(x)));
    assert.ok(t.includes('Bike nutrition · 63 g/hr') && t.includes('Water at each aid station'));
  }
  const none = C.rows({ race: RACE, pace: null, fuel: null, fuelStale: false });
  assert.deepEqual(texts(none), ['TRI Momentum race card · 70.3', 'Times are from the start of each leg. Typical ranges, not medical advice.']);
});

test('rows: a blank is never read as zero, and nothing prints NaN (risk 8)', () => {
  const f = { ...fuel, bike: { ...fuel.bike, sipMl: null, carbsPerHour: undefined, gelTimes: [30, NaN, null, '50', 80, -5, Infinity] }, run: { ...fuel.run, carbsPerHour: null, gels: 0, gelTimes: [] } };
  const t = texts(C.rows(input({ fuel: f })));
  assert.ok(!t.some((x) => /^Sip/.test(x)), 'no sip row without a sip figure');
  assert.ok(t.includes('Bike nutrition') && t.includes('Run nutrition'), 'a heading with no g/hr, not "0 g/hr"');
  assert.ok(t.includes('Gel 0:30 · 1:20'), 'only real times');
  assert.ok(!t.some((x) => /^Gel/.test(x) && x.includes('Gel 0:00')));
  assert.doesNotMatch(t.join('\n'), /NaN|undefined|null| 0 g\/hr/);
  const bad = { ...pace, swim: { pace: [NaN, 3] }, run: {}, bike: { watts: null, hr: null, effort: null }, finish: null };
  const p2 = texts(C.rows(input({ pace: bad })));
  assert.deepEqual(p2.slice(0, 2), ['TRI Momentum race card · 70.3', 'Bike nutrition · 63 g/hr'], 'no pace rows and no Pace heading when none can be read');
  assert.doesNotMatch(p2.join('\n'), /NaN|undefined|null/);
  assert.doesNotThrow(() => C.rows(undefined));
  assert.doesNotThrow(() => C.rows({}));
  assert.doesNotThrow(() => C.rows({ race: 'x', pace: 4, fuel: [] }));
});

test('rows: every character can be drawn in built-in Helvetica (A10h)', () => {
  const allowed = /^[\x20-\x7e–·]*$/;
  const pcs = ['power', 'hr', 'effort'].map((mode) => P.planPace({ ...example, mode, bikeLthr: 160, runLthr: 170, steadySpeed: 30 }));
  for (const pc of pcs) {
    for (const d of ['standard', '70.3']) {
      const rows = C.rows(input({ pace: pc, race: { ...RACE, distance: d }, fuelStale: true }));
      for (const r of rows) assert.match(r.text, allowed, r.text);
      assert.ok(rows.every((r) => ['title', 'heading', 'line', 'big', 'fine'].includes(r.kind)));
    }
  }
  // A damaged save with a character the font cannot draw loses the character, not the card.
  const odd = { ...pace, bike: { watts: null, hr: null, effort: '5\u20136 out of 10 \u{1F6B4} \u0000 caf\u00e9: x' } };
  const t = texts(C.rows(input({ pace: odd })))[3];
  assert.match(t, allowed);
  assert.equal(t, 'Bike 5–6 out of 10 caf');
});

test('rows: the title carries the distance label, Olympic or 70.3, and never the race name', () => {
  assert.equal(C.rows(input({ race: { ...RACE, distance: 'standard' } }))[0].text, 'TRI Momentum race card · Olympic');
  assert.equal(C.rows(input({ race: {} , pace: { ...pace, distance: '70.3' }, fuel: null }))[0].text, 'TRI Momentum race card · 70.3');
  assert.equal(C.rows(input({ race: { name: 'x' }, pace: null, fuel: null }))[0].text, 'TRI Momentum race card');
  assert.equal(C.TITLE, 'TRI Momentum race card');
  assert.equal(C.FILE_NAME, 'race-card.pdf');
});

test('the address check accepts one plain address and refuses the rest (A26)', () => {
  for (const g of cases.good) assert.equal(C.normaliseEmail(g), g.trim(), JSON.stringify(g));
  for (const b of cases.bad) assert.equal(C.normaliseEmail(b), null, JSON.stringify(b));
});

// ---- the real library, in Node ----

test('the vendored library draws one uncompressed Helvetica page with no image and no embedded font', () => {
  const { jsPDF } = require(path.join(VENDOR, 'jspdf.umd.min.js'));
  const bytes = C.drawPdf(jsPDF, C.rows(input({ fuelStale: true })));
  const s = Buffer.from(bytes).toString('latin1');
  assert.ok(s.startsWith('%PDF-'));
  assert.equal((s.match(/\/Type \/Page\b(?!s)/g) || []).length, 1, 'one page');
  assert.match(s, /\/MediaBox \[0 0 595\.2/, 'A4');
  assert.doesNotMatch(s, /\/Filter/, 'not compressed');
  assert.doesNotMatch(s, /\/Subtype \/(Image|TrueType|Type0|CIDFontType2)|\/FontFile/, 'no image, no embedded font');
  const fonts = [...s.matchAll(/\/BaseFont \/([A-Za-z-]+)/g)].map((m) => m[1]);
  assert.ok(fonts.length > 0 && fonts.every((f) => /^Helvetica/.test(f)), 'Helvetica only, got ' + fonts);
  assert.match(s, /\/Title \(TRI Momentum race card\)/);
  assert.match(s, /not medical advice/);
  assert.match(s, /Nutrition plan out of date\. Update it before race day\./);
  assert.doesNotMatch(s, /Lakeside/);
  assert.doesNotMatch(s, CLOCK);
  assert.ok(bytes.length < 100000 / 3, 'the real card is under a third of the 100,000 byte cap: ' + bytes.length);
});

test('a card with many gels and every note still fits on one page', () => {
  const { jsPDF } = require(path.join(VENDOR, 'jspdf.umd.min.js'));
  const times = Array.from({ length: 40 }, (_, i) => 10 + i * 5);
  const f = { ...fuel, bike: { ...fuel.bike, gels: 40, gelTimes: times, minutes: 300 }, run: { ...fuel.run, gels: 40, gelTimes: times, minutes: 300 } };
  const s = Buffer.from(C.drawPdf(jsPDF, C.rows(input({ fuel: f, fuelStale: true })))).toString('latin1');
  assert.equal((s.match(/\/Type \/Page\b(?!s)/g) || []).length, 1);
});

test('the PDF carries a fixed creation date and nothing from today (RD-039 A11, spec 29)', () => {
  const { jsPDF } = require(path.join(VENDOR, 'jspdf.umd.min.js'));
  assert.equal(C.CREATION_DATE, "D:20260101000000+00'00'");
  const s = Buffer.from(C.drawPdf(jsPDF, C.rows(input()))).toString('latin1');
  assert.equal(/\/CreationDate \(([^)]*)\)/.exec(s)[1], C.CREATION_DATE);
  // Compared with the clock at run time, in local and UTC terms: the PDF must not hold today's date. (Only a run on
  // 1 Jan 2026 itself could trip this, and that day has passed.)
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const days = ['' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()), '' + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate())];
  for (const day of days) assert.ok(!s.includes('D:' + day), 'no date from today: ' + day);
  assert.doesNotMatch(s, /\/(Creation|Mod)Date \(D:\d{8}(?!000000\+)/, 'no time of day');
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'race-card.pdf'), 'latin1');
  assert.match(fixture, /\/CreationDate \(D:20260101000000\+00'00'\)/, 'the committed fixture was drawn with the fixed date');
});

test('the email block shows only where the send function can be (canEmailHere)', () => {
  for (const ok of ['localhost', '127.0.0.1', 'tools.example.test', 'racecard.example.com.au', 'github.io.example.test', 'notgithub.io', 'LOCALHOST']) assert.equal(C.canEmailHere(ok), true, ok);
  for (const no of ['github.io', 'jthoyer.github.io', 'JThoyer.GitHub.io', 'a.b.github.io', 'jthoyer.github.io.']) assert.equal(C.canEmailHere(no), false, no);
  // Unknown is the safe side: nothing is posted when the host cannot be told.
  for (const unknown of ['', '  ', undefined, null, 42, {}]) assert.equal(C.canEmailHere(unknown), false, String(unknown));
});
