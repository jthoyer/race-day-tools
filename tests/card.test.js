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

const ALLOWED_TEXT = /^[\x20-\x7e–·]*$/; // what built-in Helvetica can draw here
const everyText = (s) => {
  const out = [s.name, s.sub, s.finish, ...C.notes(s).map((n) => n.text)];
  for (const leg of [s.swim, s.bike, s.run]) {
    if (!leg) continue;
    out.push(leg.value, leg.unit, leg.gel, leg.carbs, leg.note);
    for (const g of leg.gels || []) out.push(g.t, g.km);
  }
  return out.filter((x) => typeof x === 'string');
};

test('sheet: the race name, date, finish and the three legs (A10a)', () => {
  const s = C.sheet(input());
  assert.equal(s.name, 'LAKESIDE SPRINT TEST');
  assert.equal(s.sub, 'SUN 6 DEC · 70.3');
  assert.equal(s.finish, '5:19–5:33');
  assert.deepEqual(s.swim, { value: '1:51–1:58', unit: '/100 m', gel: 'About 15 min before the start (optional)' });
  assert.equal(s.bike.value, '175–185');
  assert.equal(s.bike.unit, 'watts');
  assert.equal(s.run.value, '5:15–5:30');
  assert.equal(s.run.unit, 'per km');
});

test('sheet: heart rate and effort modes give bpm and the effort words', () => {
  const hr = P.planPace({ ...example, mode: 'hr', bikeLthr: 160, runLthr: 170, steadySpeed: 30 });
  assert.ok(hr.ok);
  const effort = P.planPace({ ...example, mode: 'effort', steadySpeed: 30 });
  const a = C.sheet(input({ pace: hr })).bike;
  assert.match(a.value, /^\d+–\d+$/);
  assert.equal(a.unit, 'bpm');
  const b = C.sheet(input({ pace: effort })).bike;
  assert.equal(b.value, '5–6 out of 10');
  assert.equal(b.unit, '');
});

test('sheet: nutrition per leg, gel times with their km, and the aid station line (A10b)', () => {
  const s = C.sheet(input());
  assert.equal(s.bike.carbs, '63 g/hr');
  assert.equal(s.bike.note, 'Sip ~150 ml every 15 min');
  assert.deepEqual(s.bike.gels, [{ t: '0:30', km: '~25 km' }, { t: '1:20', km: '~65 km' }]);
  assert.equal(s.run.carbs, '33 g/hr');
  assert.equal(s.run.note, 'Water at each aid station');
  assert.deepEqual(s.run.gels, [{ t: '0:20', km: '~9 km' }]);
  assert.equal(s.kmNote, true);
});

test('sheet: the km come from kmAt, gel time over leg time times the leg distance (no new maths)', () => {
  const s = C.sheet(input());
  const km = (leg, mins) => '~' + P.kmAt('70.3', leg, mins, fuel[leg].minutes) + ' km';
  assert.deepEqual(s.bike.gels.map((g) => g.km), [km('bike', 30), km('bike', 80)]);
  assert.deepEqual(s.run.gels.map((g) => g.km), [km('run', 20)]);
});

test('the swim gel time is the one in fuel.js, never a number of the PDF\'s own', () => {
  assert.equal(fuel.preRaceMin, 15);
  const other = C.sheet(input({ fuel: { ...fuel, preRaceMin: 10 } }));
  assert.equal(other.swim.gel, 'About 10 min before the start (optional)');
  // A plan saved before the field existed (or with a damaged one) takes the number from fuel.js, so an older save still
  // gets the swim gel line on its card. The number is never a copy in card.js.
  const GEL15 = 'About 15 min before the start (optional)';
  for (const bad of [null, undefined, 0, -5, NaN, '15', Infinity]) {
    assert.equal(C.sheet(input({ fuel: { ...fuel, preRaceMin: bad } })).swim.gel, GEL15, String(bad));
  }
  const { preRaceMin, ...older } = fuel;
  assert.equal(preRaceMin, 15);
  assert.equal(C.sheet(input({ fuel: older })).swim.gel, GEL15, 'a saved plan with no preRaceMin at all');
  assert.equal(F.PRE_SWIM_GEL_MIN, 15);
  // No nutrition plan, no gel line: there is nothing to attach it to.
  for (const none of [null, undefined, { ok: false }]) assert.equal(C.sheet(input({ fuel: none })).swim.gel, '', JSON.stringify(none));
});

test('notes: the words under "How to use" (A10c)', () => {
  const n = C.notes(C.sheet(input()));
  assert.deepEqual(n.map((x) => x.text), ['Times are from the start of each leg.', P.KM_NOTE, 'Typical ranges, not medical advice.']);
  assert.equal(P.KM_NOTE, 'Go by the clock. Never take a gel earlier than its time. Km are a guide, from an even pace.');
});

test('notes: the out-of-date line shows when, and only when, the plan is out of date (A10d)', () => {
  const STALE = 'Nutrition plan out of date. Update it before race day.';
  assert.equal(C.STALE, STALE);
  const has = (o) => C.notes(C.sheet(input(o))).some((x) => x.text === STALE);
  assert.equal(has({ fuelStale: false }), false);
  assert.equal(has({ fuelStale: undefined }), false);
  assert.equal(has({ fuelStale: 'yes' }), false, 'only a real true counts');
  assert.equal(has({ fuelStale: true }), true);
  assert.equal(C.notes(C.sheet(input({ fuelStale: true })))[0].text, STALE, 'it comes first');
  // No nutrition shown, so nothing to call out of date.
  assert.equal(has({ fuelStale: true, fuel: null }), false);
});

test('sheet: the race name is capitals, drawable, short, and never blank (owner decision, 17 Nov 2026)', () => {
  const name = (n) => C.sheet(input({ race: { ...RACE, name: n } })).name;
  assert.equal(name('Spring 70.3'), 'SPRING 70.3');
  assert.equal(name('  Lakeside   Sprint  '), 'LAKESIDE SPRINT');
  assert.equal(name('Café \u{1F6B4} Tri \u0000 Run'), 'CAF TRI RUN', 'a character Helvetica cannot draw is dropped');
  assert.equal(name('x'.repeat(100)).length, C.NAME_MAX);
  for (const blank of ['', '   ', null, undefined, 42, {}, '\u{1F6B4}']) assert.equal(name(blank), 'MY RACE', String(blank));
  assert.equal(C.sheet({}).name, 'MY RACE');
});

test('sheet: the date is the race day as a calendar day, and nothing when it does not read', () => {
  const sub = (d, dist = '70.3') => C.sheet(input({ race: { ...RACE, date: d, distance: dist } })).sub;
  assert.equal(sub('2026-11-16'), 'MON 16 NOV · 70.3');
  assert.equal(sub('2026-12-31', 'standard'), 'THU 31 DEC · OLYMPIC');
  for (const bad of ['', '2026-02-30', '2026-13-01', '16/11/2026', 'soon', null, undefined, 20261116]) assert.equal(sub(bad), '70.3', JSON.stringify(bad));
});

test('sheet: no start time, transition, time of day or junk (A10e)', () => {
  for (const mode of ['power', 'hr', 'effort']) {
    const pc = P.planPace({ ...example, mode, bikeLthr: 160, runLthr: 170, steadySpeed: 30 });
    for (const fuelStale of [false, true]) {
      const t = everyText(C.sheet(input({ pace: pc, fuelStale }))).join('\n');
      assert.doesNotMatch(t, /Transition|T1|T2|start time|Changeover/i);
      assert.doesNotMatch(t, CLOCK);
      assert.doesNotMatch(t, /NaN|undefined|null|Infinity/);
      assert.doesNotMatch(t, /Sports drink|Gel \(/, 'no product names');
    }
  }
});

test('sheet: a leg time that is blank or zero gives the gel time with no km (A10f, criterion 18)', () => {
  for (const minutes of [null, 0, undefined, NaN, -5, '']) {
    const f = { ...fuel, bike: { ...fuel.bike, minutes }, run: { ...fuel.run, minutes } };
    const s = C.sheet(input({ fuel: f }));
    assert.deepEqual(s.bike.gels, [{ t: '0:30', km: '' }, { t: '1:20', km: '' }], String(minutes));
    assert.deepEqual(s.run.gels, [{ t: '0:20', km: '' }], String(minutes));
    assert.equal(s.kmNote, false);
    assert.ok(!C.notes(s).some((x) => x.text === P.KM_NOTE), 'no km, so no go-by-the-clock note');
    assert.doesNotMatch(everyText(s).join('\n'), /NaN|undefined|null/);
  }
});

test('sheet: a failed or missing nutrition plan gives pace only, and no pace gives nutrition only (A10g)', () => {
  for (const f of [{ ok: false, errors: [{ field: 'gut', message: 'x' }] }, null, undefined]) {
    const s = C.sheet(input({ fuel: f, fuelStale: true }));
    assert.equal(s.swim.gel, '');
    assert.deepEqual([s.bike.carbs, s.bike.note, s.bike.gels, s.run.carbs, s.run.note, s.run.gels], ['', '', [], '', '', []], JSON.stringify(f));
    assert.equal(s.stale, false);
    assert.equal(s.kmNote, false);
    assert.ok(s.finish && s.bike.value && s.run.value);
  }
  for (const p of [null, undefined]) {
    const s = C.sheet(input({ pace: p }));
    assert.equal(s.finish, '');
    assert.equal(s.swim.value, '');
    assert.equal(s.bike.value, '');
    assert.equal(s.bike.carbs, '63 g/hr');
    assert.equal(s.run.note, 'Water at each aid station');
  }
  const none = C.sheet({ race: RACE, pace: null, fuel: null, fuelStale: false });
  assert.deepEqual([none.swim, none.bike, none.run, none.finish], [null, null, null, '']);
  assert.equal(none.name, 'LAKESIDE SPRINT TEST');
});

test('sheet: a blank is never read as zero, and nothing prints NaN (risk 8)', () => {
  const f = { ...fuel, bike: { ...fuel.bike, sipMl: null, carbsPerHour: undefined, gelTimes: [30, NaN, null, '50', 80, -5, Infinity] }, run: { ...fuel.run, carbsPerHour: null, gels: 0, gelTimes: [] } };
  const s = C.sheet(input({ fuel: f }));
  assert.equal(s.bike.note, '', 'no sip line without a sip figure');
  assert.equal(s.bike.carbs, '', 'no g/hr, not "0 g/hr"');
  assert.equal(s.run.carbs, '');
  assert.deepEqual(s.bike.gels.map((g) => g.t), ['0:30', '1:20'], 'only real times');
  assert.deepEqual(s.run.gels, []);
  assert.doesNotMatch(everyText(s).join('\n'), /NaN|undefined|null| 0 g\/hr|0:00/);
  const bad = { ...pace, swim: { pace: [NaN, 3] }, run: {}, bike: { watts: null, hr: null, effort: null }, finish: null };
  const p2 = C.sheet(input({ pace: bad }));
  assert.deepEqual([p2.finish, p2.swim.value, p2.bike.value, p2.run.value], ['', '', '', ''], 'no pace figure when none can be read');
  assert.doesNotMatch(everyText(p2).join('\n'), /NaN|undefined|null/);
  assert.doesNotThrow(() => C.sheet(undefined));
  assert.doesNotThrow(() => C.sheet({}));
  assert.doesNotThrow(() => C.sheet({ race: 'x', pace: 4, fuel: [] }));
});

test('sheet: every character can be drawn in built-in Helvetica (A10h)', () => {
  const pcs = ['power', 'hr', 'effort'].map((mode) => P.planPace({ ...example, mode, bikeLthr: 160, runLthr: 170, steadySpeed: 30 }));
  for (const pc of pcs) {
    for (const d of ['standard', '70.3']) {
      for (const text of everyText(C.sheet(input({ pace: pc, race: { ...RACE, distance: d }, fuelStale: true })))) assert.match(text, ALLOWED_TEXT, text);
    }
  }
  // A damaged save with a character the font cannot draw loses the character, not the card.
  const odd = { ...pace, bike: { watts: null, hr: null, effort: '5–6 out of 10 \u{1F6B4} \u0000 café: x' } };
  const v = C.sheet(input({ pace: odd })).bike.value;
  assert.match(v, ALLOWED_TEXT);
  assert.equal(v, '5–6 out of 10 caf');
});

test('sheet: the distance is Olympic or 70.3 beside the date, from the race, the pace or the nutrition', () => {
  assert.equal(C.sheet(input({ race: { ...RACE, date: '', distance: 'standard' } })).sub, 'OLYMPIC');
  assert.equal(C.sheet(input({ race: { date: '' }, pace: { ...pace, distance: '70.3' }, fuel: null })).sub, '70.3');
  assert.equal(C.sheet(input({ race: { name: 'x' }, pace: null, fuel: null })).sub, '');
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
  const bytes = C.drawPdf(jsPDF, C.sheet(input({ fuelStale: true })));
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
  assert.match(s, /\(Nutrition plan out of date\. Update it\)[\s\S]*\(before race day\.\)/, 'the out-of-date line, wrapped in its column');
  assert.match(s, /\(LAKESIDE SPRINT TEST\)/, 'the race name, in capitals');
  assert.match(s, /\(SUN 6 DEC · 70\.3\)|\(SUN 6 DEC \\267 70\.3\)/, 'the race day and distance');
  assert.match(s, /How to use/);
  assert.match(s, /Print at 100%/);
  assert.doesNotMatch(s, /Lakeside/, 'only the capitals reach the PDF');
  assert.doesNotMatch(s, CLOCK);
  assert.ok(bytes.length < 100000 / 3, 'the real card is under a third of the 100,000 byte cap: ' + bytes.length);
});

test('a card with many gels and every note still fits on one page', () => {
  const { jsPDF } = require(path.join(VENDOR, 'jspdf.umd.min.js'));
  const times = Array.from({ length: 40 }, (_, i) => 10 + i * 5);
  const f = { ...fuel, bike: { ...fuel.bike, gels: 40, gelTimes: times, minutes: 300 }, run: { ...fuel.run, gels: 40, gelTimes: times, minutes: 300 } };
  const s = Buffer.from(C.drawPdf(jsPDF, C.sheet(input({ fuel: f, fuelStale: true })))).toString('latin1');
  assert.equal((s.match(/\/Type \/Page\b(?!s)/g) || []).length, 1);
});

test('the PDF carries a fixed creation date and nothing from today (RD-039 A11, spec 29)', () => {
  const { jsPDF } = require(path.join(VENDOR, 'jspdf.umd.min.js'));
  assert.equal(C.CREATION_DATE, "D:20260101000000+00'00'");
  const s = Buffer.from(C.drawPdf(jsPDF, C.sheet(input()))).toString('latin1');
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
