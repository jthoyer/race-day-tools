// The feedback function (functions/api/feedback.js), tested with a real Request, a stub env and a stub fetch.
// Nothing here reaches the network, and no real address or key is used: the recipient is owner@example.test.
//
// The function is an ES module and these tests are CommonJS, so it is loaded with import().
// The limiter lives in the module. Each case uses its own visitor (nextIp) and its own UTC day (nextDeps), so no case
// inherits another's count; the cases about the limiter set their own clock.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const cases = require('./feedback-cases.js');
const FBPAGE = require('../public/js/feedback.js');
const emails = require('./email-cases.js');

const FEEDBACK = path.join(__dirname, '..', 'functions', 'api', 'feedback.js');
const SEND = path.join(__dirname, '..', 'functions', 'api', 'send.js');
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'race-card.pdf'));
const ORIGIN = 'https://tools.example.test';
const KEY = 'test-key-not-real';
const FROM = 'Feedback <feedback@example.test>';
const OWNER = 'owner@example.test';
const ENV = { RESEND_API_KEY: KEY, MAIL_FROM: FROM, FEEDBACK_TO: OWNER };
const DAY = 86400000;
const T0 = Date.UTC(2026, 10, 13, 3, 0, 0);
const MARK = 'zq-marker-message'; // in every message this file sends, so the last test can look for it in the logs

let mod;
let sendMod;
let n = 0;
let day = 1;
const nextIp = () => `198.51.${Math.floor(++n / 250)}.${n % 250}`; // documentation range, never a real visitor

// Everything the function and the console say during this whole file. The last test reads it.
const said = [];
const realConsole = {};
const logged = [];
for (const m of ['log', 'info', 'warn', 'error', 'debug']) {
  realConsole[m] = console[m];
  console[m] = (...args) => said.push(args.map(String).join(' '));
}
const realFetch = globalThis.fetch;
const globalFetchCalls = [];
globalThis.fetch = (...args) => { globalFetchCalls.push(args); throw new Error('the handler must not touch the global fetch'); };

test.before(async () => {
  mod = await import(pathToFileURL(FEEDBACK).href);
  sendMod = await import(pathToFileURL(SEND).href);
});
test.after(() => {
  for (const m of Object.keys(realConsole)) console[m] = realConsole[m];
  globalThis.fetch = realFetch;
});

// A stub provider. reply: a status number, or a function (url, init) => Response | Promise | throws.
function provider(reply = 200) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (typeof reply === 'function') return reply(url, init);
    return new Response('{}', { status: reply });
  };
  fn.calls = calls;
  return fn;
}
// Each call gets a UTC day of its own, so the 30-a-day cap is never shared between cases.
function deps(over = {}) {
  const t = T0 + day++ * DAY;
  return { fetch: provider(), log: (...a) => logged.push(a), now: () => t, ...over };
}
function request({ method = 'POST', origin = ORIGIN, type = 'application/json', ip = nextIp(), body, headers = {}, url = ORIGIN + '/api/feedback' } = {}) {
  const h = new Headers(headers);
  if (origin) h.set('Origin', origin);
  if (type) h.set('Content-Type', type);
  if (ip) h.set('CF-Connecting-IP', ip);
  return new Request(url, { method, headers: h, body: method === 'GET' || method === 'HEAD' ? undefined : body });
}
const good = (over = {}) => ({ message: MARK + ' the start button is hard to find', email: '', page: '#/card', website: '', ...over });
async function send(payload, { d = deps(), env = ENV, ...req } = {}) {
  const body = typeof payload === 'string' || payload instanceof Uint8Array ? payload : JSON.stringify(payload);
  const res = await mod.handler(request({ body, ...req }), env, d);
  return { res, json: JSON.parse(await res.text()), d };
}
const mailOf = (r) => JSON.parse(r.d.fetch.calls[0].init.body);
const sentOne = (r, what) => {
  assert.equal(r.res.status, 200, what);
  assert.deepEqual(r.json, { result: 'sent' }, what);
  assert.equal(r.d.fetch.calls.length, 1, what);
};
const refusedNone = (r, what, status = 400) => {
  assert.equal(r.res.status, status, what);
  assert.equal(r.json.result, 'refused', what);
  assert.equal(r.d.fetch.calls.length, 0, 'the mail service was called for ' + what);
};

// ---------------------------------------------------------------------------------------------------------------

test('AC1: the module exports the handler and both Pages entries; GET and PUT are 405 with Allow: POST', async () => {
  assert.equal(typeof mod.handler, 'function');
  assert.equal(typeof mod.onRequestPost, 'function');
  assert.equal(typeof mod.onRequest, 'function');
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    const r = await send(good(), { method });
    assert.equal(r.res.status, 405, method);
    assert.equal(r.res.headers.get('Allow'), 'POST', method);
    assert.equal(r.d.fetch.calls.length, 0);
  }
  const viaEntry = await mod.onRequest({ request: request({ method: 'GET' }), env: ENV });
  assert.equal(viaEntry.status, 405);
  // onRequestPost builds its own deps: with the recipient missing it must answer 503 and call no fetch.
  const later = await mod.onRequestPost({ request: request({ body: JSON.stringify(good()) }), env: { RESEND_API_KEY: KEY, MAIL_FROM: FROM } });
  assert.equal(later.status, 503);
  // The handler uses the deps it is given, and never the global fetch.
  const r = await send(good());
  sentOne(r, 'good');
  assert.equal(globalFetchCalls.length, 0, 'the global fetch was not used');
  assert.ok(logged.length > 0, 'the deps log was used');
});

test('AC2: a good request is one provider call to the env recipient, from the env sender, fixed subject, text only', async () => {
  const r = await send(good());
  sentOne(r, 'good');
  const { url, init } = r.d.fetch.calls[0];
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer ' + KEY);
  assert.ok(init.signal instanceof AbortSignal, 'a timeout signal is passed');
  const mail = JSON.parse(init.body);
  assert.deepEqual(Object.keys(mail).sort(), ['from', 'subject', 'text', 'to']);
  assert.equal(mail.to, OWNER);
  assert.equal(typeof mail.to, 'string');
  assert.equal(mail.from, FROM);
  assert.equal(mail.subject, 'TRI Momentum feedback');
  assert.equal(typeof mail.text, 'string');
  for (const banned of ['html', 'attachments', 'reply_to', 'cc', 'bcc', 'headers']) assert.ok(!(banned in mail), banned + ' is in the mail');
  const lines = mail.text.split('\n');
  assert.equal(lines[0], 'New feedback from the TRI Momentum app.');
  assert.equal(lines[1], 'Page: #/card');
  assert.equal(lines[2], 'Reply to: not given');
  assert.equal(lines[3], '-'.repeat(40));
  assert.equal(lines.slice(4).join('\n'), good().message);
});

test('AC3: a valid reply address is Reply-To and in the body, trimmed; blank or spaces send with neither', async () => {
  const withAddr = await send(good({ email: '  sam@example.test  ' }));
  sentOne(withAddr, 'address');
  assert.equal(mailOf(withAddr).reply_to, 'sam@example.test');
  assert.equal(mailOf(withAddr).text.split('\n')[2], 'Reply to: sam@example.test');
  for (const blank of cases.blankAddress) {
    const r = await send(good({ email: blank }));
    sentOne(r, JSON.stringify(blank));
    assert.ok(!('reply_to' in mailOf(r)), 'no Reply-To for ' + JSON.stringify(blank));
    assert.equal(mailOf(r).text.split('\n')[2], 'Reply to: not given');
  }
  // The page value shows as "home" when blank.
  assert.equal(mailOf(await send(good({ page: '' }))).text.split('\n')[1], 'Page: home');
});

test('AC4: no field of the request can change the recipient, the sender or the subject', async () => {
  const attacks = ['owner2@example.test', 'Bcc: owner2@example.test', 'To: owner2@example.test', 'x\r\nBcc: owner2@example.test', 'x\nTo: owner2@example.test', 'a,owner2@example.test', 'a;owner2@example.test', 'Subject: hacked'];
  let accepted = 0;
  const check = (r, what) => {
    if (r.res.status !== 200) { refusedNone(r, what); return; }
    accepted += 1;
    const mail = mailOf(r);
    assert.equal(mail.to, OWNER, what);
    assert.equal(mail.from, FROM, what);
    assert.equal(mail.subject, 'TRI Momentum feedback', what);
    assert.deepEqual(Object.keys(mail).sort().filter((k) => k !== 'reply_to'), ['from', 'subject', 'text', 'to'], what);
    assert.ok(!('bcc' in mail) && !('cc' in mail), what);
  };
  for (const a of attacks) {
    check(await send(good({ message: 'hello ' + a + ' there' })), 'message ' + JSON.stringify(a));
    check(await send(good({ email: a })), 'email ' + JSON.stringify(a));
    check(await send(good({ page: a })), 'page ' + JSON.stringify(a));
  }
  // owner2@example.test in the message and as the reply address is accepted, and still goes to the env recipient only.
  const asReply = await send(good({ email: 'owner2@example.test' }));
  sentOne(asReply, 'reply address');
  assert.equal(mailOf(asReply).to, OWNER);
  assert.equal(mailOf(asReply).reply_to, 'owner2@example.test');
  assert.ok(accepted >= 9, 'the loop reached accepted cases too: ' + accepted);
  // An extra key, named for a header, is 400 and sends nothing.
  for (const extra of ['to', 'bcc', 'cc', 'from', 'subject', 'reply_to']) {
    refusedNone(await send({ ...good(), [extra]: 'owner2@example.test' }), 'extra key ' + extra);
  }
  // The reply address must not be able to carry a header into the JSON the provider reads: nothing but the one address.
  const body = JSON.parse((await (async () => { const r = await send(good({ email: 'a@example.test' })); return r.d.fetch.calls[0].init.body; })()));
  assert.equal(body.reply_to, 'a@example.test');
});

test('AC5: exactly four string keys: a missing key, a fifth key, a non-string, an array or a non-object is 400', async () => {
  for (const k of ['message', 'email', 'page', 'website']) {
    const p = good();
    delete p[k];
    refusedNone(await send(p), 'missing ' + k);
    for (const value of [null, 1, true, ['x'], { a: 1 }]) refusedNone(await send({ ...good(), [k]: value }), k + ' as ' + JSON.stringify(value));
  }
  refusedNone(await send({ ...good(), extra: '' }), 'a fifth key');
  refusedNone(await send({ ...good(), __proto__x: '' }), 'a fifth key, odd name');
  for (const body of ['[]', '["a"]', 'null', '"text"', '42', 'true', JSON.stringify([good()])]) refusedNone(await send(body), body.slice(0, 20));
  refusedNone(await send('{}'), 'empty object');
});

test('AC6: message: the shared table, through the real handler, and the control characters', async () => {
  for (const [what, value] of cases.message.good) {
    const r = await send(good({ message: value }));
    sentOne(r, what);
    assert.equal(mailOf(r).text.split('\n').slice(4).join('\n'), value.trim(), what + ': the message is sent trimmed');
  }
  for (const [what, value] of cases.message.bad) refusedNone(await send(JSON.stringify({ ...good(), message: value })), what);
  for (const [what, value] of cases.message.controls) refusedNone(await send(good({ message: value })), what);
  // What the page sends after cleaning each of them is accepted, so the page and the function agree.
  for (const [what, typed] of cases.message.cleaned) {
    const r = await send(good({ message: FBPAGE.cleanMessage(typed) }));
    sentOne(r, what + ': as the page cleans it');
  }
  // The unit is JavaScript string length: 2,000 pairs is 4,000 units, and is refused.
  refusedNone(await send(good({ message: '\u{1F600}'.repeat(2000) })), '2,000 emoji is 4,000 code units');
});

test('AC6/AC10: the largest valid request fits under the 16,384-byte cap', async () => {
  // 2,000 lone surrogates: each is a 6-byte JSON escape, the worst case for the message. Plus the longest address and page.
  const message = '\ud83d'.repeat(2000);
  const email = 'x'.repeat(247) + '@a.test'; // 254 characters
  const body = JSON.stringify(good({ message, email, page: '#/' + 'a'.repeat(40) }));
  assert.ok(Buffer.byteLength(body) > 12000 && Buffer.byteLength(body) < 16384, 'the worst case is ' + Buffer.byteLength(body) + ' bytes');
  sentOne(await send(body), 'the largest valid body');
});

test('AC7: addresses: every good one is Reply-To (trimmed), every bad one is 400, blanks send with none', async () => {
  for (const g of emails.good) {
    const r = await send(good({ email: g }));
    sentOne(r, JSON.stringify(g));
    assert.equal(mailOf(r).reply_to, g.trim());
  }
  const blank = new Set(cases.blankAddress);
  assert.ok(cases.blankAddress.every((b) => emails.bad.includes(b) || b.trim() === ''), 'the blank cases are the ones the card refuses');
  let refusedCount = 0;
  for (const b of emails.bad) {
    if (typeof b === 'string' && b.trim() === '') continue; // blank: feedback allows it, and the next loop proves it
    refusedNone(await send(JSON.stringify({ ...good(), email: b })), JSON.stringify(b));
    refusedCount += 1;
  }
  assert.ok(refusedCount > 30, 'the table was read: ' + refusedCount);
  for (const b of [...blank, '', '   ']) {
    const r = await send(good({ email: b }));
    sentOne(r, JSON.stringify(b));
    assert.ok(!('reply_to' in mailOf(r)));
  }
});

test('AC8: page: the shared table, through the real handler', async () => {
  for (const g of cases.page.good) {
    const r = await send(good({ page: g }));
    sentOne(r, JSON.stringify(g));
    assert.equal(mailOf(r).text.split('\n')[1], 'Page: ' + (g || 'home'));
  }
  for (const b of cases.page.bad) refusedNone(await send(JSON.stringify({ ...good(), page: b })), JSON.stringify(b));
});

test('AC9: a filled trap field is 200 sent, sends nothing, and does not raise the logged count', async () => {
  const last = () => logged[logged.length - 1];
  await send(good());
  const before = last()[1];
  for (const website of ['x', 'http://spam.example.test', ' ', '0']) {
    const r = await send(good({ website }));
    assert.equal(r.res.status, 200, JSON.stringify(website));
    assert.deepEqual(r.json, { result: 'sent' });
    assert.equal(r.d.fetch.calls.length, 0, 'nothing was mailed');
    assert.deepEqual(last(), [200, before], 'the count did not rise');
  }
  // A trap filled by a script that also sends a rubbish message still sees "sent" and nothing else.
  assert.equal((await send({ message: '', email: 'nope', page: 'nope', website: 'x' })).res.status, 200);
  // Traps never use the limiter: 40 of them from one visitor, then a real send from that visitor still goes.
  const ip = nextIp();
  const d = deps();
  for (let i = 0; i < 40; i++) assert.equal((await send(good({ website: 'x' }), { ip, d })).res.status, 200);
  sentOne(await send(good(), { ip, d }), 'a real send after 40 traps');
  // A trap with the wrong shape is still refused: the four keys are checked first.
  refusedNone(await send({ message: 'hello there', email: '', page: '', website: 1 }), 'a non-string trap');
});

test('AC10: origin, content type, body size, and not-JSON or not-UTF-8', async () => {
  refusedNone(await send(good(), { origin: null }), 'no origin', 403);
  refusedNone(await send(good(), { origin: 'https://evil.example.test' }), 'another origin', 403);
  refusedNone(await send(good(), { origin: 'null' }), 'the string null', 403);
  for (const type of [null, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonp']) refusedNone(await send(good(), { type }), String(type), 415);
  assert.equal((await send(good(), { type: 'Application/JSON; charset=utf-8' })).res.status, 200, 'type is not case sensitive and may carry a charset');

  const base = JSON.stringify(good());
  const exact = base + ' '.repeat(16384 - Buffer.byteLength(base));
  assert.equal(Buffer.byteLength(exact), 16384);
  sentOne(await send(exact), 'exactly 16,384 bytes is not refused for size');
  const over = await send(exact + ' ');
  refusedNone(over, '16,385 bytes by the bytes read', 413);
  // An honest header over the cap, a header that lies low, none at all, and one that is not a number: the bytes decide.
  const big = base + ' '.repeat(20000);
  refusedNone(await send(big, { headers: { 'Content-Length': String(Buffer.byteLength(big)) } }), 'honest header', 413);
  refusedNone(await send(big, { headers: { 'Content-Length': '10' } }), 'lying header', 413);
  refusedNone(await send(big, { headers: { 'Content-Length': 'abc' } }), 'header that is not a number', 413);
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
  const noHeader = await mod.handler(new Request(ORIGIN + '/api/feedback', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': nextIp() }, body: stream, duplex: 'half' }), ENV, deps());
  assert.equal(noHeader.status, 413);
  let reads = 0;
  const unread = new ReadableStream({ pull() { reads += 1; throw new Error('the body was read'); } }, { highWaterMark: 0 });
  const early = await mod.handler(new Request(ORIGIN + '/api/feedback', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'Content-Length': '16385', 'CF-Connecting-IP': nextIp() }, body: unread, duplex: 'half' }), ENV, deps());
  assert.equal(early.status, 413);
  assert.equal(reads, 0, 'an over-cap Content-Length is refused without reading the body');

  for (const bad of ['not json', '{"message":', '', '{message: "x"}', "{'message':'x'}"]) refusedNone(await send(bad), JSON.stringify(bad));
  refusedNone(await send(new Uint8Array([0x7b, 0x22, 0x6d, 0xff, 0xfe, 0x22, 0x7d])), 'bytes that are not UTF-8');
  const latin1 = Buffer.from(JSON.stringify(good({ message: 'café is great' })), 'latin1');
  refusedNone(await send(new Uint8Array(latin1)), 'latin-1 bytes');
});

test('AC11: a missing key, sender or recipient, or a recipient that is not one address, is 503 later with no fetch', async () => {
  const envs = [{}, null, { MAIL_FROM: FROM, FEEDBACK_TO: OWNER }, { RESEND_API_KEY: KEY, FEEDBACK_TO: OWNER }, { RESEND_API_KEY: KEY, MAIL_FROM: FROM },
    { ...ENV, RESEND_API_KEY: '' }, { ...ENV, MAIL_FROM: '' }, { ...ENV, FEEDBACK_TO: '' }, { ...ENV, FEEDBACK_TO: '   ' },
    { ...ENV, FEEDBACK_TO: 'a@example.test, b@example.test' }, { ...ENV, FEEDBACK_TO: 'a@example.test;b@example.test' }, { ...ENV, FEEDBACK_TO: 'a@example.test b@example.test' },
    { ...ENV, FEEDBACK_TO: 'Owner <owner@example.test>' }, { ...ENV, FEEDBACK_TO: 'not an address' }, { ...ENV, FEEDBACK_TO: 42 }];
  for (const env of envs) {
    const r = await send(good(), { env });
    assert.equal(r.res.status, 503, JSON.stringify(env));
    assert.equal(r.json.result, 'later');
    assert.equal(r.d.fetch.calls.length, 0, 'fetch was called for ' + JSON.stringify(env));
  }
  // A recipient with padding is trimmed, and is the one address.
  assert.equal(mailOf(await send(good(), { env: { ...ENV, FEEDBACK_TO: '  ' + OWNER + '  ' } })).to, OWNER);
});

test('AC12: the provider: 2xx sent; 429, 5xx, a timeout or a thrown fetch is 503 later; 401 and 403 are 503 and 502 in the log; other 4xx is 400', async () => {
  for (const reply of [200, 201, 202]) sentOne(await send(good(), { d: deps({ fetch: provider(reply) }) }), 'provider ' + reply);
  for (const reply of [429, 500, 502, 503, 504]) {
    const r = await send(good(), { d: deps({ fetch: provider(reply) }) });
    assert.equal(r.res.status, 503, 'provider ' + reply);
    assert.equal(r.json.result, 'later');
  }
  for (const reply of [401, 403]) {
    const before = logged.length;
    const r = await send(good(), { d: deps({ fetch: provider(reply) }) });
    assert.equal(r.res.status, 503, 'provider ' + reply);
    assert.equal(r.json.result, 'later');
    assert.equal(logged[before][0], 502, 'the owner sees 502 in the log');
  }
  for (const reply of [400, 404, 422]) {
    const r = await send(good(), { d: deps({ fetch: provider(reply) }) });
    assert.equal(r.res.status, 400, 'provider ' + reply);
    assert.equal(r.json.result, 'refused');
  }
  const thrown = await send(good(), { d: deps({ fetch: provider(() => { throw new Error('boom ' + MARK); }) }) });
  assert.equal(thrown.res.status, 503);
  let signal;
  const hung = provider((url, init) => {
    signal = init.signal;
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  });
  const started = Date.now();
  const r = await send(good(), { d: deps({ fetch: hung, timeoutMs: 30 }) });
  assert.equal(r.res.status, 503);
  assert.equal(r.json.result, 'later');
  assert.ok(signal.aborted, 'the call was aborted');
  assert.ok(Date.now() - started < 2000);
  assert.match(fs.readFileSync(FEEDBACK, 'utf8'), /PROVIDER_TIMEOUT_MS = 10000/, 'about 10 s in real use');
});

test('AC13: the 4th send in 10 minutes from one visitor is 429 later, with no provider call, and passes again after the window', async () => {
  let t = T0 + 200 * DAY;
  const d = deps({ now: () => t });
  const ip = nextIp();
  for (let i = 0; i < 3; i++) assert.equal((await send(good(), { ip, d })).res.status, 200, 'send ' + (i + 1));
  const fourth = await send(good(), { ip, d });
  assert.equal(fourth.res.status, 429);
  assert.equal(fourth.json.result, 'later');
  assert.equal(fourth.d.fetch.calls.length, 3, 'the refused send never reached the mail service');
  t += 9 * 60 * 1000;
  assert.equal((await send(good(), { ip, d })).res.status, 429, 'still inside 10 minutes, and the refused try did not extend it');
  t += 2 * 60 * 1000;
  assert.equal((await send(good(), { ip, d })).res.status, 200, '11 minutes later');
  assert.equal((await send(good(), { ip: nextIp(), d })).res.status, 200, 'another visitor was never blocked');
});

test('AC13: IPv6 visitors share a count per /64, IPv4 per address', async () => {
  const k = mod.visitorKey;
  assert.equal(k('2001:db8:1:2:3:4:5:6'), k('2001:DB8:1:2:ffff:ffff:ffff:ffff'));
  assert.equal(k('2001:db8:1:2::9'), k('2001:db8:1:2:aaaa::1'));
  assert.notEqual(k('2001:db8:1:2::1'), k('2001:db8:1:3::1'));
  assert.notEqual(k('203.0.113.5'), k('203.0.113.6'));
  assert.equal(k('203.0.113.5'), '203.0.113.5');
  assert.equal(k(null), 'unknown');
  const d = deps({ now: () => T0 + 300 * DAY });
  const prefix = '2001:db8:' + (++n).toString(16) + ':1';
  for (let i = 1; i <= 3; i++) assert.equal((await send(good(), { ip: prefix + '::' + i, d })).res.status, 200);
  assert.equal((await send(good(), { ip: prefix + ':9:8:7:6', d })).res.status, 429);
  assert.equal((await send(good(), { ip: '2001:db8:' + (++n).toString(16) + ':2::1', d })).res.status, 200, 'another /64 is another visitor');
});

test('AC13: the day cap is 30 sends a UTC day for the isolate, and a new UTC day starts again', async () => {
  const dayStart = Date.UTC(2027, 0, 5);
  let t = dayStart + 60000;
  const d = deps({ now: () => t });
  let ok = 0;
  for (let i = 0; i < 30; i++) if ((await send(good(), { ip: nextIp(), d })).res.status === 200) ok++;
  assert.equal(ok, 30);
  const over = await send(good(), { ip: nextIp(), d });
  assert.equal(over.res.status, 429);
  assert.equal(over.json.result, 'later');
  assert.equal(over.d.fetch.calls.length, 30, 'the 31st never reached the mail service');
  t = dayStart + DAY - 1000;
  assert.equal((await send(good(), { ip: nextIp(), d })).res.status, 429, 'the last second of the same UTC day');
  t = dayStart + DAY + 1000;
  assert.equal((await send(good(), { ip: nextIp(), d })).res.status, 200, 'the next UTC day');
});

test('AC13: the limiter map stays bounded and expires, and holds only hashes', async () => {
  const lim = mod.createLimiter({ perDay: 1e9 });
  const t = Date.UTC(2027, 5, 1);
  for (let i = 0; i < 2000; i++) lim.take('v' + i, t + i);
  assert.deepEqual(lim.size(), { visitors: 1000 });
  for (let i = 0; i < 3; i++) assert.equal(lim.take('v0', t + 3000 + i), true, 'the oldest was evicted, so visitor 0 is a stranger again');
  assert.equal(lim.take('v1999', t + 4000), true);
  assert.equal(lim.take('v1999', t + 4001), true);
  assert.equal(lim.take('v1999', t + 4002), false, 'the newest visitor is still remembered: three sends, then the limit');
  const q = mod.createLimiter({ perDay: 1e9 });
  for (let i = 0; i < 50; i++) q.take('v' + i, t + i);
  assert.deepEqual(q.size(), { visitors: 50 });
  q.take('late', t + 11 * 60 * 1000);
  assert.deepEqual(q.size(), { visitors: 1 }, 'entries expire after 10 minutes');
  const src = fs.readFileSync(FEEDBACK, 'utf8');
  assert.match(src, /digest\(visitorKey\(request\.headers\.get\('CF-Connecting-IP'\)\)\)/, 'the visitor is hashed before it reaches the limiter');
  assert.match(src, /limiter\.take\(visitor, /);
});

test('AC14: the feedback limit and the race-card limit are separate, in both directions', async () => {
  const sendPdf = Buffer.from(FIXTURE).toString('base64');
  const sendReq = (ip, email) => new Request(ORIGIN + '/api/send', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify({ email, pdf: sendPdf }) });
  const sendEnv = { RESEND_API_KEY: KEY, MAIL_FROM: FROM };
  const t = T0 + 400 * DAY;
  const dSend = { fetch: provider(), log: () => {}, now: () => t };
  const dFeed = { fetch: provider(), log: () => {}, now: () => t };

  // 1. Use up the feedback limit for a visitor; a race-card send from the same visitor still goes.
  const ip = nextIp();
  for (let i = 0; i < 3; i++) assert.equal((await send(good(), { ip, d: dFeed })).res.status, 200);
  assert.equal((await send(good(), { ip, d: dFeed })).res.status, 429, 'the feedback limit is used up');
  const card = await sendMod.handler(sendReq(ip, 'sam1@example.test'), sendEnv, dSend);
  assert.equal(card.status, 200, 'a race-card send from that visitor is not used up');

  // 2. Use up the race-card limit for another visitor; a feedback send from that visitor still goes.
  const ip2 = nextIp();
  for (let i = 0; i < 3; i++) assert.equal((await sendMod.handler(sendReq(ip2, `sam${i + 2}@example.test`), sendEnv, dSend)).status, 200);
  assert.equal((await sendMod.handler(sendReq(ip2, 'sam9@example.test'), sendEnv, dSend)).status, 429, 'the race-card limit is used up');
  assert.equal((await send(good(), { ip: ip2, d: dFeed })).res.status, 200, 'a feedback send from that visitor is not used up');
});

test('AC15: replies are JSON, no-store, nosniff, with no CORS header, and never say "delivered"', async () => {
  const replies = [
    await send(good()), await send(good({ message: 'no' })), await send(good(), { origin: null }), await send(good(), { type: 'text/plain' }),
    await send(good(), { method: 'GET' }), await send(good(), { env: {} }), await send(good({ website: 'x' })),
    await send(good(), { d: deps({ fetch: provider(500) }) }), await send('{'), await send(' '.repeat(16385))
  ];
  assert.deepEqual([...new Set(replies.map((r) => r.res.status))].sort((a, b) => a - b), [200, 400, 403, 405, 413, 415, 503]);
  for (const r of replies) {
    assert.match(r.res.headers.get('Content-Type'), /^application\/json/);
    assert.equal(r.res.headers.get('Cache-Control'), 'no-store');
    assert.equal(r.res.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.deepEqual([...r.res.headers.keys()].filter((h) => /^access-control-/i.test(h)), []);
    assert.deepEqual(Object.keys(r.json), ['result']);
    assert.ok(['sent', 'refused', 'later'].includes(r.json.result));
    assert.doesNotMatch(JSON.stringify(r.json), /delivered/i);
  }
});

test('AC16: every log call is two integers; nothing logged or written to the console holds an address, message, page or key', async () => {
  // Cases built to tempt a leak: an error whose message holds the message, and a provider that echoes the request.
  const ip = '198.51.100.77';
  const echo = provider((url, init) => { throw new Error('boom ' + init.body); });
  await send(good({ email: 'leak.check@example.test' }), { ip, d: deps({ fetch: echo }) });
  await send(good({ email: 'leak.check@example.test' }), { ip, d: deps({ fetch: provider(() => new Response('x', { status: 500 })) }) });
  await send('{"message":"' + MARK + '", broken', { ip });
  await send(good({ email: 'leak.check@example.test,x@example.test' }), { ip });
  await mod.handler(request({ ip, body: JSON.stringify(good({ email: 'leak.check@example.test' })) }), ENV, { fetch: () => { throw new Error('direct ' + MARK); }, log: (...a) => logged.push(a), now: () => T0 + 500 * DAY });
  // The Pages entry logs through the console: stub the platform fetch for it and read what it says.
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  const viaEntry = await mod.onRequestPost({ request: request({ ip, body: JSON.stringify(good({ email: 'leak.check@example.test' })) }), env: ENV });
  globalThis.fetch = (...args) => { globalFetchCalls.push(args); throw new Error('the handler must not touch the global fetch'); };
  assert.equal(viaEntry.status, 200);
  assert.ok(said.some((s) => /^feedback status=\d+ count=\d+$/.test(s)), 'the Pages entry logs one line: status and count');
  assert.ok(logged.length > 10);
  for (const args of logged) {
    assert.equal(args.length, 2, JSON.stringify(args));
    assert.ok(args.every((a) => Number.isInteger(a)), 'numbers only: ' + JSON.stringify(args));
    assert.ok(args[0] >= 200 && args[0] < 600);
  }
});

test('AC17: nothing is stored: three env names, no store or file, no import and no require', () => {
  const src = fs.readFileSync(FEEDBACK, 'utf8');
  const names = new Set([...src.matchAll(/\benv\.([A-Za-z_]+)/g)].map((m) => m[1]));
  assert.deepEqual([...names].sort(), ['FEEDBACK_TO', 'MAIL_FROM', 'RESEND_API_KEY']);
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\b(KV|D1|R2|caches|localStorage|sessionStorage|indexedDB|writeFile|appendFile|env\.[A-Z_]+_(KV|DB))\b|\bimport\b|\brequire\(/);
  assert.doesNotMatch(code, /\bhtml\b\s*:/, 'the mail has a text body only');
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'functions', 'package.json'), 'utf8').includes('"type": "module"'), true);
  // The owner's address is read from the environment, never written here.
  assert.doesNotMatch(src, /[A-Za-z0-9._%+-]+@(?!example\.test)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
});

test.after(() => {
  // Read last, over every case in this file: nothing said by the function or the console holds a secret or a message.
  const everything = JSON.stringify([said, logged]);
  for (const secret of ['@example.test', MARK, '#/card', 'pacing/2', KEY, '198.51.', 'Bearer', FROM, OWNER]) {
    assert.ok(!everything.includes(secret), 'a log line or console line held ' + JSON.stringify(secret));
  }
});
