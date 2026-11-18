const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The front page truisms (18 Nov 2026). public/js/truisms.js loads in Node on its own: this file requires it alone.
const PUBLIC = path.join(__dirname, '..', 'public');
const FILE = path.join(PUBLIC, 'js', 'truisms.js');
const T = require('../public/js/truisms.js');
const source = fs.readFileSync(FILE, 'utf8');

// The order is part of the contract: the pick is floor(r * 13) in list order, and the smoke test forces a truism by it.
const IDS = [
  'd01-race-formats-rules-and-logistics',
  'd01-01-race-formats-standard-vs-70-3',
  'd01-02-race-rules-drafting-penalties-equipment',
  'd01-03-race-courses-and-conditions',
  'd01-04-choosing-and-sequencing-races',
  'd01-05-race-logistics-and-travel',
  'd02-swim',
  'd02-01-swim-open-water-skills',
  'd02-02-swim-stroke-efficiency-and-drag',
  'd02-03-swim-threshold-sets-and-pacing',
  'd02-04-swim-wetsuit-swimming',
  'd02-05-swim-weekly-structure-and-fitness',
  'd07-fuelling-and-hydration'
];

// The headline of each image, as the owner's graphic says it. The alt text starts with it.
const HEADLINES = {
  'd01-race-formats-rules-and-logistics': 'Fitness sets the ceiling. Execution decides the race.',
  'd01-01-race-formats-standard-vs-70-3': 'Standard is hard. 70.3 is patient.',
  'd01-02-race-rules-drafting-penalties-equipment': 'The draft zone is a box, not a suggestion.',
  'd01-03-race-courses-and-conditions': 'Pace the profile, not the distance.',
  'd01-04-choosing-and-sequencing-races': 'One season, one peak.',
  'd01-05-race-logistics-and-travel': 'Logistics is the fourth discipline.',
  'd02-swim': 'Arrive fresh, not first.',
  'd02-01-swim-open-water-skills': 'Straight is faster than strong.',
  'd02-02-swim-stroke-efficiency-and-drag': 'Drag costs more than power.',
  'd02-03-swim-threshold-sets-and-pacing': 'The first 200 m always lies.',
  'd02-04-swim-wetsuit-swimming': 'Fit beats brand.',
  'd02-05-swim-weekly-structure-and-fitness': 'Two or three swims beat one long one.'
};

const images = T.LIST.filter((e) => e.kind === 'image');
const live = T.LIST.filter((e) => e.kind === 'live');

// Every string in an entry, however deep.
function strings(v) {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === 'object') return Object.values(v).flatMap(strings);
  return [];
}

test('T-list: 13 entries, 12 images then 1 live, in the agreed order, with unique ids', () => {
  assert.equal(T.LIST.length, 13);
  assert.equal(images.length, 12);
  assert.equal(live.length, 1);
  assert.deepEqual(T.LIST.map((e) => e.id), IDS);
  assert.equal(new Set(T.LIST.map((e) => e.id)).size, 13);
  assert.equal(T.LIST[12].kind, 'live', 'the live truism is last');
  for (const e of images) {
    assert.equal(e.width, 1200, e.id);
    assert.equal(e.height, 630, e.id);
  }
});

test('T-list: no string in the list holds a "<", so none can be read as markup', () => {
  const all = strings(T.LIST).concat(T.TAGLINE);
  assert.ok(all.length > 30, 'looked at the strings');
  for (const s of all) assert.doesNotMatch(s, /</, s.slice(0, 40));
  assert.match('a<b', /</); // the check can see what it is for
});

// WebP: "RIFF", a size, "WEBP", then a VP8, VP8L or VP8X chunk. Returns [width, height].
function webpSize(buf) {
  const chunk = buf.toString('latin1', 12, 16);
  if (chunk === 'VP8X') return [buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1];
  if (chunk === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1]; }
  return [0, 0];
}

test('T-files: every image src is a relative public/img/truisms path to a real WebP of 1200 x 630, and no file is extra', () => {
  for (const e of images) {
    assert.match(e.src, /^img\/truisms\/[a-z0-9-]+\.webp$/, e.id);
    assert.equal(e.src, 'img/truisms/' + e.id + '.webp', 'the file is named for its id');
    const buf = fs.readFileSync(path.join(PUBLIC, e.src));
    assert.equal(buf.toString('latin1', 0, 4), 'RIFF', e.id);
    assert.equal(buf.toString('latin1', 8, 12), 'WEBP', e.id);
    assert.deepEqual(webpSize(buf), [1200, 630], e.id + ' is 1200 x 630 in its own header');
  }
  const onDisk = fs.readdirSync(path.join(PUBLIC, 'img', 'truisms')).sort();
  assert.deepEqual(onDisk, images.map((e) => path.basename(e.src)).sort(), 'the folder holds the listed files and nothing else');
  // The pattern refuses an outside host, a root-absolute path, a data: address and a climb out of the folder.
  for (const bad of ['https://x.test/img/truisms/a.webp', '/img/truisms/a.webp', 'data:image/webp;base64,AAAA', 'img/truisms/../a.webp', '//x.test/img/truisms/a.webp', 'img/truisms/a.png']) {
    assert.doesNotMatch(bad, /^img\/truisms\/[a-z0-9-]+\.webp$/, bad);
  }
});

test('T-alt: every image has real alt text that starts with its headline and leaves out the logo', () => {
  assert.deepEqual(Object.keys(HEADLINES), images.map((e) => e.id));
  for (const e of images) {
    assert.equal(typeof e.alt, 'string', e.id);
    assert.ok(e.alt.length >= 60, `${e.id}: alt is ${e.alt.length} characters`);
    assert.ok(e.alt.startsWith(HEADLINES[e.id]), `${e.id}: alt starts with its headline`);
    assert.doesNotMatch(e.alt, /TRI Momentum/i, `${e.id}: the logo is not read out`);
    assert.doesNotMatch(e.alt, /shift gear/i, `${e.id}: the tagline is not read out`);
  }
  assert.equal(live[0].alt, undefined, 'the live truism has no alt text: its words are real text');
});

test('T-live: the live truism holds the owner\'s strings exactly, as two toned cards', () => {
  const e = live[0];
  assert.equal(e.id, 'd07-fuelling-and-hydration');
  assert.equal(e.headline, 'Fuelling is a trained skill. 70.3 is an eating contest.');
  assert.equal(e.body, 'What, when, and how much you consume is calculated and rehearsed in training. Standard forgives minor fuelling errors; 70.3 will completely sink under-fuelled athletes.');
  assert.deepEqual(e.cards, [
    { label: 'STANDARD FUEL', detail: '~60 g/hr carbs · Electrolyte sip · Fast burn', value: '60 g / HR', tone: 'lime' },
    { label: '70.3 FUEL', detail: '60–90 g/hr carbs · 500–1000 mg sodium · Gut lock', value: '60–90 g / HR', tone: 'lavender' }
  ]);
  assert.equal(T.TAGLINE, 'Helping Triathletes shift gear');
  assert.equal(e.src, undefined);
});

test('T-pick: every value of r gives a valid index, and floor(r * 13) inside [0, 1)', () => {
  for (const r of [0, 0.5, 12.5 / 13, 0.9999999, 1, -0.1, NaN, Infinity, -Infinity, 2, '0.5', null, undefined]) {
    const i = T.pick(r);
    assert.ok(Number.isInteger(i) && i >= 0 && i <= 12, `pick(${String(r)}) = ${i}`);
  }
  assert.equal(T.pick(0), 0);
  assert.equal(T.pick(0.5), 6);
  assert.equal(T.pick(12.5 / 13), 12);
  assert.equal(T.pick(0.9999999), 12);
  assert.equal(T.pick(1), 12, 'one is clamped to the last entry, not past the end');
  assert.equal(T.pick(-0.1), 0);
  // The smoke test forces a truism with (i + 0.5) / 13: that must give back i.
  for (let i = 0; i < 13; i++) assert.equal(T.pick((i + 0.5) / 13), i);
  for (let k = 0; k < 1000; k++) { const r = k / 1000; assert.equal(T.pick(r), Math.floor(r * 13), String(r)); }
});

test('T-figures: truisms.js reads nothing from the pacing or nutrition code and loads alone', () => {
  for (const word of ['RD.pace', 'RD.fuel', 'require(', 'pace.js', 'fuel.js', 'CARB_CEILING', 'SODIUM_RANGE', 'BIKE_IF']) {
    assert.ok(!source.includes(word), `truisms.js mentions ${word}`);
  }
  assert.ok(source.includes('UNCHECKED'), 'the file says its figures are unchecked');
  // The scan can see what it is for.
  assert.ok('x = RD.pace.LEGS'.includes('RD.pace'));
  assert.ok("require('./pace.js')".includes('require('));
});

test('T-persist: truisms.js names no place a pick could be saved', () => {
  for (const word of ['localStorage', 'sessionStorage', 'cookie', 'history', 'window.name', 'location', 'indexedDB', 'caches']) {
    assert.ok(!source.toLowerCase().includes(word.toLowerCase()), `truisms.js names ${word}`);
  }
  assert.ok('document.cookie'.toLowerCase().includes('cookie'));
});
