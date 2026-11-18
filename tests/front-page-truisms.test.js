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

const LIVE = T.LIST;
const CARD_DIR = path.join(PUBLIC, 'truisms');
const unescape = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// The words of a card page in public/truisms/: headline, subtext and, for each stat card, label, detail and value.
function cardWords(id) {
  const src = fs.readFileSync(path.join(CARD_DIR, id + '.html'), 'utf8');
  const one = (re) => unescape(re.exec(src)[1]);
  const tiles = [...src.matchAll(/<div class="pill-card pill-(lime|lavender)">([\s\S]*?)<div class="pill-value">([^<]*)<\/div>\s*<\/div>/g)].map((m) => ({
    label: unescape(/class="pill-label">([^<]*)</.exec(m[2])[1]),
    detail: /class="pill-detail">([^<]*)</.test(m[2]) ? unescape(/class="pill-detail">([^<]*)</.exec(m[2])[1]) : '',
    value: unescape(m[3]), tone: m[1]
  }));
  return { headline: one(/class="headline">([^<]*)</), body: one(/class="subtext">([^<]*)</), cards: tiles };
}

// Every string in an entry, however deep.
function strings(v) {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === 'object') return Object.values(v).flatMap(strings);
  return [];
}

test('T-list: 13 entries, all live text, in the agreed order, with unique ids and no picture', () => {
  assert.equal(T.LIST.length, 13);
  assert.deepEqual(T.LIST.map((e) => e.id), IDS);
  assert.equal(new Set(T.LIST.map((e) => e.id)).size, 13);
  for (const e of T.LIST) {
    assert.equal(e.kind, 'live', e.id);
    assert.equal(e.src, undefined, `${e.id}: no image`);
    assert.equal(e.alt, undefined, `${e.id}: no alt text, because the words are real text`);
  }
});

test('T-list: no string in the list holds a "<", so none can be read as markup', () => {
  const markup = (list) => strings(list).filter((s) => /</.test(s));
  assert.ok(strings(T.LIST).concat(T.TAGLINE).length > 30, 'looked at the strings');
  assert.deepEqual(markup([T.LIST, T.TAGLINE]), []);
  // The checker finds a "<" in a deliberately bad entry, nested as deep as the real ones.
  assert.deepEqual(markup([{ id: 'x', cards: [{ detail: 'a<b' }] }]), ['a<b']);
});

test('T-files: the landscape pictures are gone, and each entry is the same words as its card page', () => {
  assert.equal(fs.existsSync(path.join(PUBLIC, 'img', 'truisms')), false, 'public/img/truisms/ is gone');
  for (const e of LIVE) {
    assert.ok(fs.existsSync(path.join(CARD_DIR, e.id + '.html')), `${e.id} has a card page`);
    assert.ok(e.cards.length >= 2 && e.cards.length <= 5, `${e.id}: two to five cards`);
    assert.deepEqual({ headline: e.headline, body: e.body, cards: e.cards }, cardWords(e.id), `${e.id}: the front page says what its card page says`);
    for (const c of e.cards) {
      assert.ok(c.label && c.value, `${e.id}: a card has its label and its figure`);
      assert.ok(c.tone === 'lime' || c.tone === 'lavender', `${e.id}: tone ${c.tone}`);
    }
  }
});

test('T-live: the fuelling truism holds the owner\'s strings exactly, as two toned cards', () => {
  const e = LIVE[12];
  assert.equal(e.id, 'd07-fuelling-and-hydration');
  assert.equal(e.headline, 'Fuelling is a trained skill. 70.3 is an eating contest.');
  assert.equal(e.body, 'What, when, and how much you consume is calculated and rehearsed in training. Standard forgives minor fuelling errors; 70.3 will completely sink under-fuelled athletes.');
  assert.deepEqual(e.cards, [
    { label: 'STANDARD FUEL', detail: '~60 g/hr carbs · Electrolyte sip · Fast burn', value: '60 g / HR', tone: 'lime' },
    { label: '70.3 FUEL', detail: '60–90 g/hr carbs · 500–1000 mg sodium · Gut lock', value: '60–90 g / HR', tone: 'lavender' }
  ]);
  assert.equal(T.TAGLINE, 'Helping Triathletes shift gear');
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
  const WORDS = ['RD.pace', 'RD.fuel', 'require(', 'pace.js', 'fuel.js', 'CARB_CEILING', 'SODIUM_RANGE', 'BIKE_IF'];
  const mentioned = (text) => WORDS.filter((w) => text.includes(w));
  assert.deepEqual(mentioned(source), [], 'truisms.js mentions the pacing or nutrition code');
  assert.ok(source.includes('UNCHECKED'), 'the file says its figures are unchecked');
  // The scan finds each word in a deliberately bad source.
  assert.deepEqual(mentioned("x = RD.pace.LEGS; y = RD.fuel; require('./pace.js'); BIKE_IF; SODIUM_RANGE; CARB_CEILING; 'fuel.js'"), WORDS);
});

test('T-persist: truisms.js names no place a pick could be saved', () => {
  const PLACES = ['localStorage', 'sessionStorage', 'cookie', 'history', 'window.name', 'location', 'indexedDB', 'caches'];
  const named = (text) => PLACES.filter((w) => text.toLowerCase().includes(w.toLowerCase()));
  assert.deepEqual(named(source), [], 'truisms.js names a place a pick could be saved');
  // The scan finds each place in a deliberately bad source, whatever its case.
  assert.deepEqual(named('LOCALSTORAGE sessionStorage document.COOKIE history.replaceState window.name location.hash indexedDB caches.open'), PLACES);
});
