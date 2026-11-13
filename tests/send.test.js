// The send function (functions/api/send.js), tested with a real Request, a stub env and a stub fetch.
// Nothing here reaches the network, and no real address or key is used.
//
// The function is an ES module and these tests are CommonJS, so it is loaded with import().
// The limiter lives in the module, so each case uses its own visitor and address (nextIp, nextEmail). The day cap and
// the clock-moving cases use their own days, so no case inherits another's count.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const cases = require('./email-cases.js');

const SEND = path.join(__dirname, '..', 'functions', 'api', 'send.js');
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'race-card.pdf'));
const ORIGIN = 'https://tools.example.test';
const KEY = 'test-key-not-real';
const FROM = 'Cards <cards@example.test>';
const ENV = { RESEND_API_KEY: KEY, MAIL_FROM: FROM };
const DAY = 86400000;
const T0 = Date.UTC(2026, 10, 13, 3, 0, 0); // a day for most cases

let mod;
let n = 0;
const nextIp = () => `198.51.${Math.floor(++n / 250)}.${n % 250}`; // documentation range, never a real visitor
const nextEmail = () => `sam${++n}@example.test`;
const b64 = (buf) => Buffer.from(buf).toString('base64');
const PDF = b64(FIXTURE);

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

test.before(async () => { mod = await import(pathToFileURL(SEND).href); });
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
function deps(over = {}) {
  return { fetch: provider(), log: (...a) => logged.push(a), now: () => T0, ...over };
}
function request({ method = 'POST', origin = ORIGIN, type = 'application/json', ip = nextIp(), body, headers = {}, url = ORIGIN + '/api/send' } = {}) {
  const h = new Headers(headers);
  if (origin) h.set('Origin', origin);
  if (type) h.set('Content-Type', type);
  if (ip) h.set('CF-Connecting-IP', ip);
  return new Request(url, { method, headers: h, body: method === 'GET' || method === 'HEAD' ? undefined : body });
}
const good = (over = {}) => ({ email: nextEmail(), pdf: PDF, ...over });
async function send(payload, { d = deps(), env = ENV, ...req } = {}) {
  const body = typeof payload === 'string' || payload instanceof Uint8Array ? payload : JSON.stringify(payload);
  const res = await mod.handler(request({ body, ...req }), env, d);
  return { res, json: JSON.parse(await res.text()), d };
}
const pdfWith = (extra) => b64(Buffer.concat([Buffer.from('%PDF-1.3\n1 0 obj\n<<\n'), Buffer.from(extra), Buffer.from('\n>>\nendobj\n%%EOF\n')]));

// ---------------------------------------------------------------------------------------------------------------

test('A13: the module exports the Pages entries and a pure handler that uses only the deps it is given', async () => {
  assert.equal(typeof mod.handler, 'function');
  assert.equal(typeof mod.onRequestPost, 'function');
  assert.equal(typeof mod.onRequest, 'function');
  const d = deps();
  const { res } = await send(good(), { d });
  assert.equal(res.status, 200);
  assert.equal(d.fetch.calls.length, 1, 'the deps fetch was used');
  assert.equal(globalFetchCalls.length, 0, 'the global fetch was not');
  assert.ok(logged.length > 0, 'the deps log was used');
});

test('A13: the Pages entry refuses other methods and passes the platform deps', async () => {
  const res = await mod.onRequest({ request: request({ method: 'GET' }), env: ENV });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('Allow'), 'POST');
  // onRequestPost builds its own deps: with the key missing it must answer 503 without calling any fetch.
  const later = await mod.onRequestPost({ request: request({ body: JSON.stringify(good()) }), env: {} });
  assert.equal(later.status, 503);
  assert.equal(globalFetchCalls.length, 0);
});

test('A14: one call to the mail service, with the key, a fixed subject, one address and one attachment', async () => {
  const email = nextEmail();
  const { res, json, d } = await send({ email, pdf: PDF });
  assert.equal(res.status, 200);
  assert.deepEqual(json, { result: 'sent' });
  assert.equal(d.fetch.calls.length, 1);
  const { url, init } = d.fetch.calls[0];
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer ' + KEY);
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.ok(init.signal instanceof AbortSignal, 'a timeout signal is passed');
  const sent = JSON.parse(init.body);
  assert.deepEqual(Object.keys(sent).sort(), ['attachments', 'from', 'subject', 'text', 'to']);
  assert.equal(sent.from, FROM);
  assert.equal(sent.to, email);
  assert.equal(typeof sent.to, 'string');
  assert.equal(sent.subject, 'Your TRI Momentum race card');
  assert.match(sent.text, /not medical advice/);
  assert.deepEqual(sent.attachments, [{ filename: 'race-card.pdf', content: PDF }]);
});

test('A14: the address is trimmed before it is sent, and what is sent is never what the caller chose', async () => {
  const email = nextEmail();
  const { d } = await send({ email: '  ' + email + ' ', pdf: PDF });
  assert.equal(JSON.parse(d.fetch.calls[0].init.body).to, email);
  for (const key of ['subject', 'from', 'to', 'html', 'text', 'cc', 'bcc', 'reply_to', 'attachments']) {
    const r = await send(good({ [key]: key === 'attachments' ? [{ filename: 'x.exe', content: 'AA==' }] : 'Hello' }));
    assert.equal(r.res.status, 400, key);
    assert.equal(r.d.fetch.calls.length, 0, key + ' reached the mail service');
  }
});

test('A15: the reply is JSON, never cached, with no cross-origin headers and never the word "delivered"', async () => {
  const replies = [
    await send(good()),
    await send('{', {}),
    await send(good(), { origin: 'https://other.example.test' }),
    await send(good(), { env: {} }),
    await send(good(), { d: deps({ fetch: provider(429) }) })
  ];
  for (const { res, json } of replies) {
    assert.equal(res.headers.get('Content-Type'), 'application/json');
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    assert.equal([...res.headers.keys()].filter((k) => k.startsWith('access-control-')).length, 0);
    assert.deepEqual(Object.keys(json), ['result']);
    assert.ok(['sent', 'refused', 'later'].includes(json.result));
    assert.doesNotMatch(JSON.stringify(json), /delivered/i);
  }
  assert.deepEqual(replies.map((r) => r.json.result), ['sent', 'refused', 'refused', 'later', 'later']);
  // An OPTIONS preflight is refused too, not answered with permission.
  const pre = await send('', { method: 'OPTIONS' });
  assert.equal(pre.res.status, 405);
  assert.equal(pre.res.headers.get('access-control-allow-origin'), null);
});

test('A15: 200 sent', async () => {
  const { res, json } = await send(good());
  assert.equal(res.status, 200);
  assert.equal(json.result, 'sent');
});

test('A15: 400 refused for bad JSON, a bad address, a bad PDF and unknown keys', async () => {
  for (const body of ['{', '', 'null', '[]', '"x"', '42', '{"email":"sam@example.test"}', JSON.stringify(good({ extra: 1 })), '{"email":"a@b.co","pdf":"x","__proto__":{}}']) {
    const r = await send(body);
    assert.equal(r.res.status, 400, body.slice(0, 40));
    assert.equal(r.json.result, 'refused');
    assert.equal(r.d.fetch.calls.length, 0);
  }
  assert.equal((await send(good({ email: 'nope' }))).res.status, 400);
  assert.equal((await send(good({ pdf: b64('hello world') }))).res.status, 400);
  assert.equal((await send(new Uint8Array([0xff, 0xfe, 0x00, 0x7b]))).res.status, 400, 'not UTF-8');
});

test('A15: 403 refused when the Origin is another site, or missing', async () => {
  for (const origin of ['https://other.example.test', 'http://tools.example.test', 'https://tools.example.test:8443', 'null', null]) {
    const r = await send(good(), { origin });
    assert.equal(r.res.status, 403, String(origin));
    assert.equal(r.json.result, 'refused');
    assert.equal(r.d.fetch.calls.length, 0);
  }
  const ok = await send(good(), { origin: 'http://localhost:8788', url: 'http://localhost:8788/api/send' });
  assert.equal(ok.res.status, 200, 'the same origin on another host is fine');
});

test('A15: 405 refused for any method but POST', async () => {
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']) {
    const r = await mod.handler(request({ method }), ENV, deps());
    assert.equal(r.status, 405, method);
    assert.equal(r.headers.get('Allow'), 'POST');
    if (method !== 'HEAD') assert.deepEqual(JSON.parse(await r.text()), { result: 'refused' });
  }
});

test('A15 and A17: 413 refused over the caps, by the header and by the bytes actually read', async () => {
  const big = JSON.stringify(good()) + ' '.repeat(140001);
  // An honest header.
  const honest = await send(big, { headers: { 'Content-Length': String(Buffer.byteLength(big)) } });
  assert.equal(honest.res.status, 413);
  // No header at all (a chunked or streamed body), and a header that lies low: the bytes decide.
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
  const noHeader = await mod.handler(new Request(ORIGIN + '/api/send', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': nextIp() }, body: stream, duplex: 'half' }), ENV, deps());
  assert.equal(noHeader.status, 413);
  const lying = await send(big, { headers: { 'Content-Length': '10' } });
  assert.equal(lying.res.status, 413, 'a lying Content-Length cannot get a big body through');
  assert.equal(lying.d.fetch.calls.length, 0);
  // An honest header over the cap is refused before a single byte is read.
  let reads = 0;
  const unread = new ReadableStream({ pull() { reads += 1; throw new Error('the body was read'); } }, { highWaterMark: 0 });
  const early = await mod.handler(new Request(ORIGIN + '/api/send', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'Content-Length': '140001', 'CF-Connecting-IP': nextIp() }, body: unread, duplex: 'half' }), ENV, deps());
  assert.equal(early.status, 413);
  assert.equal(reads, 0, 'an over-cap Content-Length is refused without reading the body');
  // A header that is not a number is ignored, and the bytes still decide.
  assert.equal((await send(big, { headers: { 'Content-Length': 'abc' } })).res.status, 413);
});

test('A17: the body cap is 140,000 bytes: exactly that passes, one more does not', async () => {
  const base = JSON.stringify(good());
  const exact = base + ' '.repeat(140000 - Buffer.byteLength(base));
  assert.equal(Buffer.byteLength(exact), 140000);
  assert.equal((await send(exact)).res.status, 200);
  const over = exact + ' ';
  const r = await send(over);
  assert.equal(r.res.status, 413);
  assert.equal(r.d.fetch.calls.length, 0);
});

test('A17: the decoded PDF cap is 100,000 bytes: exactly that passes, one more does not', async () => {
  const pad = (size) => {
    const head = Buffer.from('%PDF-1.3\n');
    return Buffer.concat([head, Buffer.alloc(size - head.length, 0x20)]);
  };
  const exact = await send(good({ pdf: b64(pad(100000)) }));
  assert.equal(exact.res.status, 200);
  const over = await send(good({ pdf: b64(pad(100001)) }));
  assert.equal(over.res.status, 413);
  assert.equal(over.json.result, 'refused');
  assert.equal(over.d.fetch.calls.length, 0);
  // Something enormous that is not even base64 is refused by size first, without being decoded.
  assert.equal((await send(good({ pdf: '*'.repeat(138000) }))).res.status, 413, 'refused by size, not by being unreadable');
});

test('A15: 415 refused when the body is not application/json', async () => {
  for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonp', null]) {
    const r = await send(good(), { type });
    assert.equal(r.res.status, 415, String(type));
    assert.equal(r.json.result, 'refused');
    assert.equal(r.d.fetch.calls.length, 0);
  }
  assert.equal((await send(good(), { type: 'Application/JSON; charset=utf-8' })).res.status, 200, 'a charset on json is fine');
});

test('A15: 429 later at the limit, and 503 later when the service is missing, or the provider fails', async () => {
  const d = deps({ now: () => T0 + 5 * DAY });
  const ip = nextIp();
  for (let i = 0; i < 3; i++) assert.equal((await send(good(), { ip, d })).res.status, 200);
  const limited = await send(good(), { ip, d });
  assert.equal(limited.res.status, 429);
  assert.equal(limited.json.result, 'later');
  for (const reply of [429, 500, 502, 503, 504]) {
    const r = await send(good(), { d: deps({ fetch: provider(reply) }) });
    assert.equal(r.res.status, 503, 'provider ' + reply);
    assert.equal(r.json.result, 'later');
  }
  const thrown = await send(good(), { d: deps({ fetch: provider(() => { throw new TypeError('network down'); }) }) });
  assert.equal(thrown.res.status, 503);
  assert.equal(thrown.json.result, 'later');
  const rejected = await send(good(), { d: deps({ fetch: provider(() => Promise.reject(new Error('reset'))) }) });
  assert.equal(rejected.res.status, 503);
});

test('A15: our key or sender refused (provider 401, 403) is 503 later to the athlete and 502 in the log', async () => {
  for (const reply of [401, 403]) {
    const before = logged.length;
    const r = await send(good(), { d: deps({ fetch: provider(reply) }) });
    assert.equal(r.res.status, 503, 'provider ' + reply);
    assert.equal(r.json.result, 'later');
    assert.equal(logged[before][0], 502, 'the log says 502, a status code and nothing else');
    assert.equal(logged[before].length, 2);
  }
});

test('A15: a provider 4xx other than 429, 401 and 403 is refused (400), because the address or PDF was not accepted', async () => {
  for (const reply of [400, 404, 422]) {
    const r = await send(good(), { d: deps({ fetch: provider(reply) }) });
    assert.equal(r.res.status, 400, 'provider ' + reply);
    assert.equal(r.json.result, 'refused');
  }
});

test('A16: addresses: the shared table, through the real handler', async () => {
  for (const g of cases.good) {
    const r = await send({ email: g, pdf: PDF });
    assert.equal(r.res.status, 200, JSON.stringify(g));
    assert.equal(JSON.parse(r.d.fetch.calls[0].init.body).to, g.trim());
  }
  for (const b of cases.bad) {
    const r = await send(JSON.stringify({ email: b, pdf: PDF }));
    assert.equal(r.res.status, 400, JSON.stringify(b));
    assert.equal(r.d.fetch.calls.length, 0, 'sent for ' + JSON.stringify(b));
  }
});

test('A16: a list, an array, an object or a second address never adds a recipient', async () => {
  for (const email of [['sam@example.test'], { to: 'sam@example.test' }, 'a@example.test,b@example.test', 'a@example.test;b@example.test', 'a@example.test b@example.test', 'a@example.test\nb@example.test', 'a@example.test\r\nBcc: b@example.test']) {
    const r = await send({ email, pdf: PDF });
    assert.equal(r.res.status, 400, JSON.stringify(email));
    assert.equal(r.d.fetch.calls.length, 0);
  }
});

test('A16: the PDF must be a base64 string that decodes to bytes starting %PDF-', async () => {
  for (const pdf of [undefined, null, 42, true, [PDF], { a: PDF }, '', '   ', 'not base64!', PDF + '\n', PDF.slice(0, -1), PDF.slice(2), '%PDF-1.3 raw text', b64('PDF-1.3 no percent'), b64(' %PDF-1.3 leading space'), b64('')]) {
    const r = await send(JSON.stringify({ email: nextEmail(), pdf }));
    assert.equal(r.res.status, 400, JSON.stringify(pdf)?.slice(0, 30));
    assert.equal(r.d.fetch.calls.length, 0);
  }
});

test('A17: a PDF that holds any denied name is refused, one name at a time', async () => {
  for (const word of ['/JavaScript', '/JS', '/Launch', '/EmbeddedFile', '/RichMedia', '/XFA', '/AA', '/URI', '/SubmitForm', '/ImportData', '/Filter', '/ObjStm']) {
    const r = await send(good({ pdf: pdfWith(word + ' (x)') }));
    assert.equal(r.res.status, 400, word);
    assert.equal(r.json.result, 'refused');
    assert.equal(r.d.fetch.calls.length, 0, word + ' reached the mail service');
  }
  // The same PDF without one is fine, so the checks above are about the names and not the scaffolding.
  assert.equal((await send(good({ pdf: pdfWith('/Type /Catalog') }))).res.status, 200);
});

test('A17: a name spelled with a #xx hex escape is refused', async () => {
  for (const extra of ['/J#53 (x)', '/#4AS (x)', '/Fil#74er /FlateDecode', '/Type /Catalog /Name#20x 1']) {
    const r = await send(good({ pdf: pdfWith(extra) }));
    assert.equal(r.res.status, 400, extra);
    assert.equal(r.d.fetch.calls.length, 0);
  }
  // A "#" in page text, outside a name, is not a name and is fine.
  assert.equal((await send(good({ pdf: pdfWith('(Rank #12 /km #1)') }))).res.status, 200);
});

test('A17: names and shapes the real card never holds are refused, one at a time (links, images, files, encryption)', async () => {
  for (const extra of ['/Annots [1 0 R]', '/XObject << /I1 5 0 R >>', '/Subtype /Image', '/GoToR (x)', '/GoToE (x)', '/Encrypt 9 0 R', '/Names << >>', '/Rendition (x)', '/Sound (x)', '/Movie (x)', '/Named /NextPage', '/URI (https://x.example.test)']) {
    const r = await send(good({ pdf: pdfWith(extra) }));
    assert.equal(r.res.status, 400, extra);
    assert.equal(r.d.fetch.calls.length, 0, extra + ' reached the mail service');
  }
  const inline = await send(good({ pdf: pdfWith('q\nBI /W 1 /H 1 /CS /G /BPC 8 ID \x00 EI\nQ') }));
  assert.equal(inline.res.status, 400, 'an inline image');
  // jsPDF's own empty XObject and ProcSet lines are fine on their own; a real XObject next to them is not.
  assert.equal((await send(good({ pdf: pdfWith('/ProcSet [/PDF /Text /ImageB /ImageC /ImageI]\n/XObject <<\n>>') }))).res.status, 200);
  assert.equal((await send(good({ pdf: pdfWith('/ProcSet [/PDF /Text /ImageB /ImageC /ImageI]\n/XObject <<\n/I1 5 0 R\n>>') }))).res.status, 400);
});

test('A17: an inline image hidden by a comment or a NUL, and fonts that carry a program, are refused', async () => {
  const cases = {
    'BI then a % comment': 'q\nBI%x\n/W 1 /H 1 /CS /G /BPC 8 ID \x00 EI\nQ',
    'BI then NUL': 'q\nBI\0/W 1 /H 1 /CS /G /BPC 8 ID \x00 EI\nQ',
    'BI after NUL': 'q\0BI /W 1 /H 1 ID x EI',
    'BI after a closing bracket': '[(a)]BI/W 1 ID x EI',
    'a Type3 font': '/Type /Font /Subtype /Type3 /FontBBox [0 0 1 1]',
    'an embedded font program under Helvetica': '/BaseFont /Helvetica /FontDescriptor 7 0 R /FontFile2 8 0 R',
    'a font descriptor on its own': '/BaseFont /Helvetica /FontDescriptor 7 0 R',
    'a FontFile3': '/FontFile3 9 0 R',
    'CharProcs': '/CharProcs << /a 5 0 R >>'
  };
  for (const [what, extra] of Object.entries(cases)) {
    const r = await send(good({ pdf: pdfWith(extra) }));
    assert.equal(r.res.status, 400, what);
    assert.equal(r.d.fetch.calls.length, 0, what + ' reached the mail service');
  }
  // BI inside ordinary words and text is not an operator.
  for (const ok of ['/BIG 1 /OBIT 2 /NUBIAN', '(BIG day BI)', '(A BIKE)', '/Name /BI']) assert.equal((await send(good({ pdf: pdfWith(ok) }))).res.status, 200, ok);
});

test('A17: /OpenAction only as jsPDF writes it, and /BaseFont only Helvetica or Helvetica-Bold', async () => {
  assert.equal((await send(good({ pdf: pdfWith('/OpenAction [3 0 R /FitH null]') }))).res.status, 200);
  for (const extra of ['/OpenAction << /S /GoTo /D [3 0 R /Fit] >>', '/OpenAction 7 0 R', '/OpenAction [3 0 R /FitH null] /OpenAction 7 0 R', '/OpenAction [3 0 R /FitH 10]', '/OpenAction << /FS 4 0 R >>']) {
    const r = await send(good({ pdf: pdfWith(extra) }));
    assert.equal(r.res.status, 400, extra);
  }
  assert.equal((await send(good({ pdf: pdfWith('/BaseFont /Helvetica\n/BaseFont /Helvetica-Bold') }))).res.status, 200);
  for (const font of ['Courier', 'Helvetica-Oblique', 'Times-Roman', 'ABCDEF+Arial', 'HelveticaX', '']) {
    const r = await send(good({ pdf: pdfWith('/BaseFont /' + font) }));
    assert.equal(r.res.status, 400, 'font ' + font);
  }
});

test('A17: control: fresh jsPDF output and the committed fixture pass the widened list', async () => {
  const C = require('../public/js/card.js');
  const P = require('../public/js/pace.js');
  const F = require('../public/js/fuel.js');
  const { jsPDF } = require('../public/js/vendor/jspdf.umd.min.js');
  const pace = P.planPace({ distance: '70.3', mode: 'power', css: 105, ftp: 240, ftpRecent: true, runThreshold: 290, weight: 72, course: 'rolling', heat: 'warm' });
  const [G, D] = F.DEFAULT_PRODUCTS;
  const fuel = F.planFuel({ distance: '70.3', bikeMin: 110, runMin: 45, heat: 'warm', gut: 70, sweat: null, gel: G, drink: D });
  const fresh = C.toBase64(C.drawPdf(jsPDF, C.rows({ race: { distance: '70.3' }, pace, fuel, fuelStale: true })));
  for (const pdf of [fresh, PDF]) assert.equal((await send(good({ pdf }))).res.status, 200);
  assert.match(Buffer.from(fresh, 'base64').toString('latin1'), /\/OpenAction \[\d+ 0 R \/FitH null\]/, 'the control really contains the OpenAction form it must allow');
});

test('A20: IPv6 visitors are one visitor per /64, IPv4 per address', async () => {
  const k = mod.visitorKey;
  assert.equal(k('2001:db8:1:2:3:4:5:6'), k('2001:DB8:1:2:ffff:ffff:ffff:ffff'));
  assert.equal(k('2001:db8:1:2::9'), k('2001:db8:1:2:aaaa::1'));
  assert.notEqual(k('2001:db8:1:2::1'), k('2001:db8:1:3::1'));
  assert.notEqual(k('203.0.113.5'), k('203.0.113.6'));
  assert.equal(k('203.0.113.5'), '203.0.113.5');
  assert.equal(k(null), 'unknown');
  // Through the handler: the 4th send from one /64 is 429 even though every address inside it differs.
  const d = deps({ now: () => T0 + 50 * DAY });
  const prefix = '2001:db8:' + (++n).toString(16) + ':1';
  for (let i = 1; i <= 3; i++) assert.equal((await send(good(), { ip: prefix + '::' + i, d })).res.status, 200);
  assert.equal((await send(good(), { ip: prefix + ':9:8:7:6', d })).res.status, 429);
  assert.equal((await send(good(), { ip: '2001:db8:' + (++n).toString(16) + ':2::1', d })).res.status, 200, 'another /64 is another visitor');
});

test('A17: the committed fixture, drawn by the vendored library from made-up data, is accepted, with room to spare', async () => {
  assert.ok(FIXTURE.subarray(0, 5).toString() === '%PDF-');
  assert.ok(FIXTURE.length * 3 <= 100000, 'the real card is at most a third of the PDF cap: ' + FIXTURE.length);
  assert.ok(Buffer.byteLength(JSON.stringify({ email: 'x'.repeat(254), pdf: PDF })) * 3 <= 140000, 'and of the body cap');
  const r = await send(good());
  assert.equal(r.res.status, 200);
  assert.equal(r.d.fetch.calls.length, 1);
});

test('A17: a PDF drawn now by the card module and the vendored library is accepted too', async () => {
  const C = require('../public/js/card.js');
  const P = require('../public/js/pace.js');
  const F = require('../public/js/fuel.js');
  const { jsPDF } = require('../public/js/vendor/jspdf.umd.min.js');
  const ex = { distance: 'standard', mode: 'hr', css: 100, ftp: null, runThreshold: 270, bikeLthr: 165, runLthr: 172, steadySpeed: 32, weight: 65, course: 'flat', heat: 'hot' };
  const pace = P.planPace(ex);
  const [G, D] = F.DEFAULT_PRODUCTS;
  const fuel = F.planFuel({ distance: 'standard', bikeMin: 70, runMin: 40, heat: 'hot', gut: 60, sweat: null, gel: G, drink: D });
  assert.ok(pace.ok && fuel.ok);
  for (const fuelStale of [false, true]) {
    const bytes = C.drawPdf(jsPDF, C.rows({ race: { distance: 'standard' }, pace, fuel, fuelStale }));
    const r = await send(good({ pdf: C.toBase64(bytes) }));
    assert.equal(r.res.status, 200, 'stale ' + fuelStale);
  }
});

test('A19: the count goes up only when the mail service takes the send', async () => {
  const last = () => logged[logged.length - 1];
  await send(good());
  const [, before] = last();
  await send(good({ email: 'nope' }));
  assert.equal(last()[1], before, 'a refusal is not counted');
  await send(good(), { d: deps({ fetch: provider(500) }) });
  assert.equal(last()[1], before, 'a failed send is not counted');
  await send(good());
  assert.deepEqual(last(), [200, before + 1]);
});

test('A19: nothing is stored: the only env names are the two, and no store or file is touched', () => {
  const src = fs.readFileSync(SEND, 'utf8');
  const names = new Set([...src.matchAll(/\benv\.([A-Za-z_]+)/g)].map((m) => m[1]));
  assert.deepEqual([...names].sort(), ['MAIL_FROM', 'RESEND_API_KEY']);
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /\b(KV|D1|R2|caches|localStorage|sessionStorage|indexedDB|writeFile|appendFile|env\.[A-Z_]+_(KV|DB))\b|\bimport\b|\brequire\(/);
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'functions', 'package.json'), 'utf8').includes('"type": "module"'), true);
});

test('A20: the 4th send in 10 minutes from one visitor is 429 later; 11 minutes on it passes again', async () => {
  let t = T0 + 20 * DAY;
  const d = deps({ now: () => t });
  const ip = nextIp();
  for (let i = 0; i < 3; i++) assert.equal((await send(good(), { ip, d })).res.status, 200);
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

test('A20: the 4th send to one address in an hour is 429 later, whoever asks, and the address is not case sensitive', async () => {
  let t = T0 + 30 * DAY;
  const d = deps({ now: () => t });
  const email = nextEmail();
  assert.equal((await send({ email, pdf: PDF }, { d })).res.status, 200);
  assert.equal((await send({ email: email.toUpperCase(), pdf: PDF }, { d })).res.status, 200);
  assert.equal((await send({ email, pdf: PDF }, { d })).res.status, 200);
  const fourth = await send({ email: email.replace('@', '@'), pdf: PDF }, { d });
  assert.equal(fourth.res.status, 429);
  assert.equal(fourth.json.result, 'later');
  t += 61 * 60 * 1000;
  assert.equal((await send({ email, pdf: PDF }, { d })).res.status, 200, 'an hour later');
});

test('A20: the day cap is 100 sends a UTC day for the isolate, and a new UTC day starts again', async () => {
  const day = Date.UTC(2027, 0, 5);
  let t = day + 60000;
  const d = deps({ now: () => t });
  let ok = 0;
  for (let i = 0; i < 100; i++) if ((await send(good(), { ip: nextIp(), d })).res.status === 200) ok++;
  assert.equal(ok, 100);
  const over = await send(good(), { ip: nextIp(), d });
  assert.equal(over.res.status, 429);
  assert.equal(over.json.result, 'later');
  t = day + DAY - 1000;
  assert.equal((await send(good(), { ip: nextIp(), d })).res.status, 429, 'the last second of the same UTC day');
  t = day + DAY + 1000;
  assert.equal((await send(good(), { ip: nextIp(), d })).res.status, 200, 'the next UTC day');
});

test('A20: the limiter map stays under 1,000 entries and drops the oldest first', () => {
  const lim = mod.createLimiter({ perDay: 1e9 });
  const t = Date.UTC(2027, 5, 1);
  for (let i = 0; i < 2000; i++) lim.take('v' + i, 'a' + i, t + i);
  assert.deepEqual(lim.size(), { visitors: 1000, addresses: 1000 });
  // The oldest was evicted, so visitor 0 is a stranger again and may send 3 more; the newest is still counted.
  for (let i = 0; i < 3; i++) assert.equal(lim.take('v0', 'a0', t + 3000 + i), true, 'evicted visitor ' + i);
  const newest = 'v1999';
  for (let i = 0; i < 2; i++) assert.equal(lim.take(newest, 'b' + i, t + 4000 + i), true);
  assert.equal(lim.take(newest, 'b9', t + 4100), false, 'the newest visitor is still remembered: 1 + 2 sends, then the limit');
});

test('A20: entries expire, so a quiet isolate holds nothing', () => {
  const lim = mod.createLimiter({ perDay: 1e9 });
  const t = Date.UTC(2027, 6, 1);
  for (let i = 0; i < 50; i++) lim.take('v' + i, 'a' + i, t + i);
  assert.deepEqual(lim.size(), { visitors: 50, addresses: 50 });
  lim.take('late', 'late', t + 11 * 60 * 1000);
  assert.deepEqual(lim.size(), { visitors: 1, addresses: 50 + 1 }, 'visitors expire after 10 minutes, addresses after an hour');
  lim.take('later', 'later', t + 72 * 60 * 1000);
  assert.deepEqual(lim.size(), { visitors: 1, addresses: 1 });
});

test('A20: the limiter holds only hashes, never the address or the visitor', async () => {
  const src = fs.readFileSync(SEND, 'utf8');
  assert.match(src, /limiter\.take\(visitor, await digest\(to\.toLowerCase\(\)\)/);
  assert.match(src, /digest\(visitorKey\(request\.headers\.get\('CF-Connecting-IP'\)\)\)/);
});

test('A21: a missing key or sender is 503 later and calls no fetch', async () => {
  for (const env of [{}, { MAIL_FROM: FROM }, { RESEND_API_KEY: KEY }, { RESEND_API_KEY: '', MAIL_FROM: FROM }, { RESEND_API_KEY: KEY, MAIL_FROM: '' }, null]) {
    const r = await send(good(), { env });
    assert.equal(r.res.status, 503, JSON.stringify(env));
    assert.equal(r.json.result, 'later');
    assert.equal(r.d.fetch.calls.length, 0);
  }
});

test('A21: the mail service call has a timeout, and a hung service is 503 later', async () => {
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
  assert.match(fs.readFileSync(SEND, 'utf8'), /PROVIDER_TIMEOUT_MS = 10000/, 'about 10 s in real use');
});

test('A18: what the function and the console said holds only status codes and counts', async () => {
  // Cases built to tempt a leak: an error whose message holds the address, and a provider that echoes the request.
  const email = 'leak.check@example.test';
  const ip = '198.51.100.77';
  const echo = provider((url, init) => { throw new Error('boom ' + init.body); });
  await send({ email, pdf: PDF }, { ip, d: deps({ fetch: echo }) });
  await send({ email, pdf: PDF }, { ip, d: deps({ fetch: provider(() => new Response(init => init, { status: 500 })) }) });
  await send('{"email":"' + email + '", broken', { ip });
  await send({ email: email + ',x@example.test', pdf: PDF }, { ip });
  await mod.handler(request({ ip, body: JSON.stringify({ email, pdf: PDF }) }), ENV, { fetch: () => { throw new Error('direct ' + email); }, log: (...a) => logged.push(a), now: () => T0 + 40 * DAY });
  assert.ok(logged.length > 10);
  for (const args of logged) {
    assert.equal(args.length, 2, JSON.stringify(args));
    assert.ok(args.every((a) => typeof a === 'number' && Number.isInteger(a)), 'numbers only: ' + JSON.stringify(args));
    assert.ok(args[0] >= 200 && args[0] < 600);
  }
});

test.after(() => {
  // Read last, over every case in this file: nothing said by the function or the console holds a secret.
  const everything = JSON.stringify([said, logged]);
  for (const secret of ['@example.test', '%PDF', 'JVBER', KEY, '198.51.', 'Bearer', FROM]) {
    assert.ok(!everything.includes(secret), 'a log line or console line held ' + JSON.stringify(secret));
  }
});
