// The anonymous counts: the rules in public/js/stats.js and the function in functions/api/event.js.
// Nothing here reaches the network. The store is a small stand-in for D1, so what the function writes can be read back.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const S = require('../public/js/stats.js');

const EVENT = path.join(__dirname, '..', 'functions', 'api', 'event.js');
const ORIGIN = 'https://tools.example.test';
const T0 = Date.UTC(2026, 10, 18, 3, 0, 0);

let mod;
test.before(async () => { mod = await import(pathToFileURL(EVENT).href); });

// A stand-in for D1: the three statements the function runs, keyed by their text.
function fakeDb() {
  const rows = new Map(); // "day|kind|key" -> n
  const log = [];
  return {
    rows, log,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              log.push(sql);
              if (/^SELECT 1/.test(sql)) return rows.has(args.join('|')) ? { x: 1 } : null;
              if (/^SELECT COUNT/.test(sql)) return { c: [...rows.keys()].filter((k) => k.startsWith(args[0] + '|' + args[1] + '|')).length };
              throw new Error('unexpected query: ' + sql);
            },
            async run() {
              log.push(sql);
              assert.match(sql, /^INSERT INTO counts/);
              const k = args.slice(0, 3).join('|');
              rows.set(k, (rows.get(k) || 0) + 1);
              return {};
            }
          };
        }
      };
    }
  };
}

let n = 0;
const nextIp = () => `198.51.100.${(++n % 250) + 1}`;
let lastLog = [];
function deps(now = T0) { return { now: () => now, log: (status, count) => lastLog.push([status, count]) }; }

function post(body, { origin = ORIGIN, type = 'application/json', ip = nextIp(), extra = {} } = {}) {
  const headers = { 'CF-Connecting-IP': ip, ...extra };
  if (origin) headers.Origin = origin;
  if (type) headers['Content-Type'] = type;
  return new Request(ORIGIN + '/api/event', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
}
async function run(request, env, now) {
  const res = await mod.handler(request, env, deps(now));
  return { status: res.status, json: await res.json(), res };
}

// ---------- the rules in the page ----------

test('stepOf: every address opens one of the eight screens, old addresses included', () => {
  const cases = {
    '': 'home', '#/': 'home', '#/nonsense': 'home', '#/setup/1': 'race', '#/setup': 'race',
    '#/setup/2': 'pacing1', '#/setup/3': 'pacing1', '#/setup/4': 'pacing2', '#/setup/5': 'pacing3',
    '#/pacing/1': 'pacing1', '#/pacing/2': 'pacing2', '#/pacing/3': 'pacing3', '#/pacing/9': 'pacing1', '#/pacing': 'pacing1',
    '#/fuel': 'nutrition', '#/card': 'card', '#/saved': 'card', '#/products': 'products'
  };
  for (const [hash, step] of Object.entries(cases)) assert.equal(S.stepOf(hash), step, hash);
  for (const step of Object.values(cases)) assert.ok(S.STEPS.includes(step));
});

test('sourceOf: a utm_source, a host name or direct, and never a path, a query or our own host', () => {
  assert.equal(S.sourceOf('', '', 'race.example.test'), 'direct');
  assert.equal(S.sourceOf(undefined, undefined, 'race.example.test'), 'direct');
  assert.equal(S.sourceOf('https://www.Google.com/search?q=sam+lee+race', '', 'race.example.test'), 'google.com');
  assert.equal(S.sourceOf('https://l.facebook.com:443/l.php?u=x', '', 'race.example.test'), 'l.facebook.com');
  assert.equal(S.sourceOf('https://race.example.test/guides/race-fuel.html', '', 'race.example.test'), 'direct', 'our own host is direct');
  assert.equal(S.sourceOf('https://www.race.example.test/', '', 'race.example.test'), 'direct');
  assert.equal(S.sourceOf('https://google.com/search', '?utm_source=Club-Newsletter&x=1', 'race.example.test'), 'club-newsletter', 'utm_source wins');
  assert.equal(S.sourceOf('', '?a=1&utm_source=news_1', 'x'), 'news_1');
  assert.equal(S.sourceOf('', '?utm_source=a%20b', 'x'), 'direct', 'an unclean label is dropped, not cleaned');
  assert.equal(S.sourceOf('', '?utm_source=' + 'a'.repeat(31), 'x'), 'direct');
  assert.equal(S.sourceOf('android-app://com.google.android.gm', '', 'x'), 'direct', 'not an http page');
  assert.equal(S.sourceOf('https://user:pass@evil.example.test/', '', 'x'), 'direct', 'no credentials in a host');
  assert.equal(S.sourceOf('https://localhost/', '', 'x'), 'direct', 'a host with no dot');
  for (const out of [S.sourceOf('https://a.example.test/p?q=1#h', '', 'x'), S.sourceOf('', '?utm_source=ok', 'x')]) assert.match(out, /^[a-z0-9._-]{1,60}$/);
});

test('allowed: off on github.io and an unknown host, and off for Do Not Track and Global Privacy Control', () => {
  assert.equal(S.allowed('race.example.test', {}), true);
  assert.equal(S.allowed('localhost', { doNotTrack: '0' }), true);
  assert.equal(S.allowed('someone.github.io', {}), false);
  assert.equal(S.allowed('', {}), false);
  assert.equal(S.allowed(undefined, {}), false);
  assert.equal(S.allowed('race.example.test', { doNotTrack: '1' }), false);
  assert.equal(S.allowed('race.example.test', { globalPrivacyControl: true }), false);
});

test('eventBody: only the four kinds with their own keys, and never anything else', () => {
  assert.deepEqual(S.eventBody('visit', 'direct'), { kind: 'visit', key: 'direct' });
  assert.deepEqual(S.eventBody('step', 'pacing2'), { kind: 'step', key: 'pacing2' });
  assert.deepEqual(S.eventBody('card', '70.3'), { kind: 'card', key: '70.3' });
  assert.deepEqual(S.eventBody('emailed', 'ironman'), { kind: 'emailed', key: 'ironman' });
  for (const [k, v] of [['visit', 'Has Space'], ['visit', ''], ['step', 'fuel'], ['step', 'Sam Lee'], ['card', 'olympic'], ['card', undefined], ['card', null], ['emailed', 'marathon'], ['other', 'x']]) {
    assert.equal(S.eventBody(k, v), null, `${k} ${v}`);
  }
});

test('createCounter: each thing is sent once a page load', () => {
  const sent = [];
  const c = S.createCounter((b) => sent.push(b));
  assert.equal(c.count('step', 'race'), true);
  assert.equal(c.count('step', 'race'), false);
  assert.equal(c.count('step', 'pacing1'), true);
  assert.equal(c.count('card', 'standard'), true);
  assert.equal(c.count('card', 'standard'), false);
  assert.equal(c.count('card', 'sprint'), true);
  assert.equal(c.count('card', 'bogus'), false);
  assert.equal(c.count('card', undefined), false);
  assert.deepEqual(sent.map((b) => b.kind + ':' + b.key), ['step:race', 'step:pacing1', 'card:standard', 'card:sprint']);
  for (const b of sent) assert.deepEqual(Object.keys(b).sort(), ['key', 'kind'], 'a count carries two fields and nothing else');
});

// ---------- the function ----------

test('a good count is added to today\'s row, and the reply is counted', async () => {
  const db = fakeDb();
  const out = await run(post({ kind: 'card', key: '70.3' }), { STATS: db });
  assert.equal(out.status, 200);
  assert.deepEqual(out.json, { result: 'counted' });
  assert.equal(out.res.headers.get('Cache-Control'), 'no-store');
  assert.equal(db.rows.get('2026-11-18|card|70.3'), 1);
  await run(post({ kind: 'card', key: '70.3' }), { STATS: db });
  assert.equal(db.rows.get('2026-11-18|card|70.3'), 2);
  await run(post({ kind: 'card', key: 'sprint' }), { STATS: db });
  assert.equal(db.rows.get('2026-11-18|card|sprint'), 1);
});

test('the row is the UTC day, nothing finer', async () => {
  const db = fakeDb();
  await run(post({ kind: 'step', key: 'home' }), { STATS: db }, Date.UTC(2026, 10, 18, 23, 59, 59));
  await run(post({ kind: 'step', key: 'home' }), { STATS: db }, Date.UTC(2026, 10, 19, 0, 0, 1));
  assert.deepEqual([...db.rows.keys()].sort(), ['2026-11-18|step|home', '2026-11-19|step|home']);
});

test('what is stored is the day, the kind, the key and a number: no address, no hash, no agent', async () => {
  const db = fakeDb();
  const ip = '203.0.113.77';
  await run(post({ kind: 'visit', key: 'google.com' }, { ip, extra: { 'User-Agent': 'Mozilla/5.0 zq-agent', Referer: ORIGIN + '/#/setup/1' } }), { STATS: db });
  const stored = JSON.stringify([...db.rows.entries()]);
  assert.equal(stored, '[["2026-11-18|visit|google.com",1]]');
  assert.ok(!stored.includes(ip) && !stored.includes('zq-agent'));
  assert.ok(db.log.every((q) => !/ip|agent|user/i.test(q)), 'no query names an address or an agent');
});

test('refused: a wrong method, origin, type, size, shape, key or value changes nothing', async () => {
  const db = fakeDb();
  const env = { STATS: db };
  const good = { kind: 'step', key: 'race' };
  const cases = [
    ['a GET', new Request(ORIGIN + '/api/event', { method: 'GET' }), 405],
    ['no Origin', post(good, { origin: null }), 403],
    ['another origin', post(good, { origin: 'https://other.example.test' }), 403],
    ['not JSON type', post(good, { type: 'text/plain' }), 415],
    ['no type', post(good, { type: null }), 415],
    ['not JSON', post('{nope'), 400],
    ['a list', post([good]), 400],
    ['null', post('null'), 400],
    ['an extra key', post({ ...good, page: '#/' }), 400],
    ['a missing key', post({ kind: 'step' }), 400],
    ['a number key', post({ kind: 'step', key: 5 }), 400],
    ['an unknown kind', post({ kind: 'page', key: 'race' }), 400],
    ['an unknown step', post({ kind: 'step', key: 'fuel' }), 400],
    ['free text as a step', post({ kind: 'step', key: 'Sam Lee, sam@example.test' }), 400],
    ['an unknown distance', post({ kind: 'card', key: 'olympic' }), 400],
    ['an upper-case source', post({ kind: 'visit', key: 'Google.com' }), 400],
    ['a source with a space', post({ kind: 'visit', key: 'a b' }), 400],
    ['a source of 61', post({ kind: 'visit', key: 'a'.repeat(61) }), 400],
    ['a source with a slash', post({ kind: 'visit', key: 'a.com/path' }), 400],
    ['over 512 bytes', post({ kind: 'visit', key: 'a', pad: 'x'.repeat(600) }), 413]
  ];
  for (const [name, request, status] of cases) {
    const out = await run(request, env);
    assert.equal(out.status, status, name);
    assert.ok(['refused'].includes(out.json.result), name);
  }
  assert.equal(db.rows.size, 0, 'nothing was stored');
});

test('a body over the cap with no Content-Length is stopped while reading', async () => {
  const db = fakeDb();
  const big = new Request(ORIGIN + '/api/event', {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"kind":"visit","key":"' + 'a'.repeat(700) + '"}')); c.close(); } }), duplex: 'half'
  });
  const out = await run(big, { STATS: db });
  assert.equal(out.status, 413);
  assert.equal(db.rows.size, 0);
});

test('Do Not Track and Global Privacy Control: answered counted, kept as nothing', async () => {
  const db = fakeDb();
  for (const extra of [{ DNT: '1' }, { 'Sec-GPC': '1' }]) {
    const out = await run(post({ kind: 'step', key: 'race' }, { extra }), { STATS: db });
    assert.equal(out.status, 200);
  }
  assert.equal(db.rows.size, 0);
  await run(post({ kind: 'step', key: 'race' }, { extra: { DNT: '0' } }), { STATS: db });
  assert.equal(db.rows.size, 1);
});

test('no database bound: later, and nothing thrown', async () => {
  for (const env of [{}, undefined, { STATS: {} }, { STATS: 'x' }]) {
    const out = await run(post({ kind: 'step', key: 'race' }), env);
    assert.equal(out.status, 503);
    assert.deepEqual(out.json, { result: 'later' });
  }
});

test('a store that fails is later, and the error is not logged', async () => {
  lastLog = [];
  const broken = { prepare() { throw new Error('secret detail zq-leak'); } };
  const out = await run(post({ kind: 'step', key: 'race' }), { STATS: broken });
  assert.equal(out.status, 503);
  assert.ok(!JSON.stringify(lastLog).includes('zq-leak'));
});

test('a new visit label past the day\'s cap is counted as "other"; a known one still counts as itself', async () => {
  const db = fakeDb();
  const env = { STATS: db };
  for (let i = 0; i < mod.VISIT_KEYS_MAX; i++) await run(post({ kind: 'visit', key: 'site' + i + '.example.test' }), env);
  await run(post({ kind: 'visit', key: 'brand-new.example.test' }), env);
  await run(post({ kind: 'visit', key: 'site0.example.test' }), env);
  assert.equal(db.rows.get('2026-11-18|visit|other'), 1);
  assert.equal(db.rows.has('2026-11-18|visit|brand-new.example.test'), false);
  assert.equal(db.rows.get('2026-11-18|visit|site0.example.test'), 2);
  await run(post({ kind: 'step', key: 'race' }), env);
  assert.equal(db.rows.get('2026-11-18|step|race'), 1, 'the cap is for visit labels only');
});

test('the limiter: one visitor is slowed after 120 counts in ten minutes; another is not', async () => {
  const db = fakeDb();
  const env = { STATS: db };
  const ip = '192.0.2.99';
  let last;
  for (let i = 0; i < 121; i++) last = await run(post({ kind: 'step', key: 'home' }, { ip }), env, T0 + i);
  assert.equal(last.status, 429);
  assert.equal(db.rows.get('2026-11-18|step|home'), 120);
  assert.equal((await run(post({ kind: 'step', key: 'home' }, { ip: '192.0.2.100' }), env, T0 + 200)).status, 200);
  assert.equal((await run(post({ kind: 'step', key: 'home' }, { ip }), env, T0 + 11 * 60 * 1000)).status, 200, 'the window passes');
  const lim = mod.createLimiter({ perVisitor: 2, windowMs: 1000, maxEntries: 3 });
  for (let i = 0; i < 10; i++) lim.take('v' + i, T0);
  assert.ok(lim.size().visitors <= 3, 'the limiter is bounded');
});

test('the log holds a status code and a count, and nothing a person sent', async () => {
  lastLog = [];
  const db = fakeDb();
  await run(post({ kind: 'visit', key: 'zq-marker.example.test' }, { ip: '203.0.113.5' }), { STATS: db });
  assert.ok(lastLog.length > 0);
  for (const entry of lastLog) assert.ok(entry.every((v) => typeof v === 'number'), 'numbers only');
});

test('the Pages entry points are exported and the schema holds only the four columns', () => {
  assert.equal(typeof mod.onRequestPost, 'function');
  assert.equal(mod.onRequest, mod.onRequestPost);
  assert.match(mod.SCHEMA, /\(day TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY \(day, kind, key\)\)/);
  assert.deepEqual(mod.STEPS, S.STEPS, 'the function and the page agree on the screens');
  assert.deepEqual(mod.DISTANCES, S.DISTANCES, 'and on the distances');
});

test('the page and the function agree on what a count is', () => {
  const src = fs.readFileSync(EVENT, 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'stats.js'), 'utf8');
  assert.equal(/SOURCE_SHAPE = (\/.*\/);/.exec(src)[1], /SOURCE_SHAPE = (\/.*\/);/.exec(page)[1], 'the same source shape');
  assert.ok(!/localStorage|sessionStorage|document\.cookie|indexedDB/.test(page.replace(/\/\*[\s\S]*?\*\//g, '')), 'the page keeps no count in storage');
});
