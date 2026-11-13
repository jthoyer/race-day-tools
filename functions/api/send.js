/*
 * POST /api/send: email one race card PDF to one address (RD-039). A Cloudflare Pages Function. It runs on Cloudflare
 * only; GitHub Pages has no /api/send, and the app says plainly that email is not working there.
 *
 * What it holds: nothing. No database, no KV, no cache, no file. It logs a status code and a count of sends, and
 * nothing else: never the address, the PDF, the visitor's IP or the key. The mail key (env.RESEND_API_KEY) and the
 * sender (env.MAIL_FROM) come from the environment and are never in the repo. Those are the only two env names used.
 *
 * What it takes: JSON with exactly the keys `email` and `pdf` (the PDF as base64), same origin only. The subject,
 * the body and the attachment name are fixed below, so a caller cannot choose what is sent from our sender address.
 *
 * LIMITS, said plainly. The limiter below lives in this isolate's memory. Cloudflare runs many isolates, in many
 * places, and restarts them often, so each one counts for itself and forgets. It slows a loop down; it is NOT a real
 * limit. The real limit is a Cloudflare rate-limiting rule on /api/send, which the owner sets in the dashboard
 * (RD-039 step 5), plus the mail service's own quota. The PDF is made by the visitor's phone, so anyone can post any
 * PDF to any address: the exact keys, the size caps, the content checks and the limits cut that down; they do not
 * remove it.
 *
 * Module format: this file is an ES module (functions/package.json says so). The tests load it with import().
 */

const SUBJECT = 'Your TRI Momentum race card';
const BODY_TEXT = 'Your race card is attached as a PDF.\n\nTypical ranges, not medical advice.\n\nTRI Momentum';
const ATTACHMENT_NAME = 'race-card.pdf';

const MAX_BODY_BYTES = 140000; // the whole request body
const MAX_PDF_BYTES = 100000; // the PDF once decoded. The real card is about 2 KB.
const PROVIDER_TIMEOUT_MS = 10000;

// WHAT THIS CHECKS, and what it does not. The PDF is read the way a PDF reader reads it, and held to what our own card
// holds, in two layers:
//   1. An ALLOWLIST (the main rule). Literal strings ( ... ) are removed by the PDF grammar (balanced parentheses,
//      backslash escapes; an unclosed string is refused). A % comment is allowed only in the header line, the binary
//      marker line after it, and the final %%EOF. Then every /Name in the file, streams included (the PDF must be
//      uncompressed), must be one of ALLOWED_NAMES, the names the real card holds. A name with a # escape is refused,
//      and every /BaseFont must be followed directly by /Helvetica or /Helvetica-Bold. Fonts, images, forms, actions,
//      links, colour spaces and the rest need names that are not on the list, so they are refused without this file
//      having to know about each of them.
//   2. A DENY LIST of names and an inline-image pattern, run over the raw bytes, strings included. It is defence in depth:
//      it does not depend on the reading above being right, and it refuses even where a string only mentions a name.
//   Hex strings <...> are read too (a reader closes them at ">" and skips non-hex bytes, so only hex digits and PDF
//   whitespace are allowed inside), and a literal string may not hold "stream" or "endobj", because a reader skips stream
//   data by its /Length and could otherwise disagree with this reading about where a string starts. Every font must have
//   a valid /BaseFont, a /Type /Font and a /Subtype /Type1, one each.
// WHAT IT DOES NOT DO: stop phishing. Anyone can type text, including a web address a reader turns into a link, into a
// PDF's page text, and plain text passes both layers. Only a PDF built on the server from the plan would close that;
// the owner declined it. This cuts down what can be sent from our address. It does not make what is sent trustworthy.

// Every name in jsPDF 4.2.1's output for the card: the normal, the out-of-date and a 40-gel card, and the committed
// fixture (tests/fixtures/race-card.pdf), collected by reading the real bytes and taking the union. Alphabetical.
// A jsPDF upgrade that writes a new name fails the control test in tests/send.test.js: review the name, then add it here.
export const ALLOWED_NAMES = new Set(['/BaseFont', '/Catalog', '/Contents', '/Count', '/CreationDate', '/Encoding', '/F1', '/F2', '/FirstChar', '/FitH', '/Font',
  '/Helvetica', '/Helvetica-Bold', '/ID', '/ImageB', '/ImageC', '/ImageI', '/Info', '/Kids', '/LastChar', '/Length', '/MediaBox', '/OneColumn', '/OpenAction',
  '/PDF', '/Page', '/PageLayout', '/Pages', '/Parent', '/ProcSet', '/Producer', '/Resources', '/Root', '/Size', '/Subtype', '/Text', '/Title', '/Type', '/Type1',
  '/WinAnsiEncoding', '/XObject']);

const DENIED = ['/JavaScript', '/JS', '/Launch', '/EmbeddedFile', '/RichMedia', '/XFA', '/AA', '/URI', '/SubmitForm', '/ImportData', '/Filter', '/ObjStm',
  '/Annots', '/XObject', '/Image', '/GoToR', '/GoToE', '/Encrypt', '/Names', '/Rendition', '/Sound', '/Movie', '/Named',
  '/FontDescriptor', '/FontFile', '/Type3', '/CharProcs',
  '/Type0', '/DescendantFonts', '/TrueType', '/CIDFont', '/ToUnicode', '/AcroForm', '/Metadata', '/OutputIntents', '/ICCBased', '/ColorSpace', '/Shading',
  '/Pattern', '/FunctionType', '/ExtGState', '/SMask', '/Group', '/Outlines', '/Thread', '/OCProperties', '/Collection', '/PieceInfo', '/AF'];
// jsPDF writes these two on every page. Each is removed (exact text only) before the deny list is applied: the first
// names image types the page does not use, the second is an empty dictionary. Anything else with those names is refused.
const JSPDF_OWN = [/\/ProcSet \[\/PDF \/Text \/ImageB \/ImageC \/ImageI\]/g, /\/XObject <<\s*>>/g];
// A "#xx" hex escape inside a name can spell any of the above without the plain text matching.
const NAME_WITH_HEX_ESCAPE = /\/[^\s/[\]<>(){}%]*#[0-9A-Fa-f]{2}/;
// An inline image starts with the operator BI. Whitespace, NUL and the PDF delimiters (and a digit or dot before it) end a
// token, and a % comment or a name can follow BI with no space, so all of those are boundaries.
const INLINE_IMAGE = /[\s\0()<>[\]{}0-9.+-]BI(?=[\s\0%/]|$)/;

// The PDF read as a reader reads it. Returns the text with literal strings emptied to "()", or null if the PDF breaks the
// grammar rules above (a comment where none is allowed, an unclosed or unbalanced string, a "(" or ")" the reader would
// treat differently).
export function stripStrings(bin) {
  const head = /^%PDF-\d\.\d[^\r\n]*(\r\n|\r|\n)/.exec(bin);
  if (!head) return null;
  let i = head[0].length;
  const marker = /^%[^\r\n]*(\r\n|\r|\n)/.exec(bin.slice(i)); // the optional binary-marker line
  if (marker) i += marker[0].length;
  const tail = /\r?\n?%%EOF\s*$/.exec(bin);
  const end = tail && tail.index >= i ? tail.index : bin.length;
  let out = '';
  while (i < end) {
    const c = bin[i];
    if (c === '%') return null; // a comment anywhere else
    if (c === '<' && bin[i + 1] === '<') { out += '<<'; i += 2; continue; }
    if (c === '<') {
      // A hex string. A reader closes it at ">" and skips anything that is not a hex digit, so a "(" in here is not a
      // string opener to the reader. Only hex digits and PDF whitespace are allowed inside; anything else is refused.
      const close = bin.indexOf('>', i + 1);
      if (close < 0 || close >= end) return null; // unterminated
      if (!/^[0-9A-Fa-f\0\t\n\f\r ]*$/.test(bin.slice(i + 1, close))) return null;
      out += '<>';
      i = close + 1;
      continue;
    }
    if (c === '(') {
      let depth = 1;
      const start = i + 1;
      i += 1;
      while (i < end && depth > 0) {
        const d = bin[i];
        if (d === '\\') i += 1;
        else if (d === '(') depth += 1;
        else if (d === ')') depth -= 1;
        i += 1;
      }
      if (depth !== 0) return null; // an unclosed string
      // Stream data and object boundaries are not text. A string that holds them is trying to make this reading and a
      // reader's (which skips stream data by /Length) disagree about where a string starts.
      if (/stream|endobj/.test(bin.slice(start, i - 1))) return null;
      out += '()';
      continue;
    }
    if (c === ')') return null; // a ")" with no "(" before it
    out += c;
    i += 1;
  }
  return out;
}

// True if the PDF follows the grammar rules and every name is on the allowlist (the main rule).
export function pdfStructureOk(bin) {
  const text = stripStrings(bin);
  if (text === null) return false;
  for (const m of text.matchAll(/\/[^\0\t\n\f\r ()<>[\]{}/%]*/g)) {
    if (m[0].includes('#') || !ALLOWED_NAMES.has(m[0])) return false;
  }
  // Every font names itself, directly, as one of the two Helvetica faces.
  const base = (text.match(/\/BaseFont(?![^\0\t\n\f\r ()<>[\]{}/%])/g) || []).length;
  const good = (text.match(/\/BaseFont[\0\t\n\f\r ]*\/Helvetica(?:-Bold)?(?=[\0\t\n\f\r ()<>[\]{}/%]|$)/g) || []).length;
  const fonts = (text.match(/\/Type[\0\t\n\f\r ]*\/Font(?![^\0\t\n\f\r ()<>[\]{}/%])/g) || []).length;
  const type1 = (text.match(/\/Subtype[\0\t\n\f\r ]*\/Type1(?![^\0\t\n\f\r ()<>[\]{}/%])/g) || []).length;
  if (base !== good || fonts !== base || type1 !== base) return false;
  // The open-at-page entry only in the form jsPDF writes.
  const opens = (text.match(/\/OpenAction/g) || []).length;
  return opens === (text.match(/\/OpenAction \[\d+ 0 R \/FitH null\]/g) || []).length;
}

const LATER = { status: 503, result: 'later' };
const REFUSED = (status) => ({ status, result: 'refused' });

let sendCount = 0; // sends the mail service accepted, since this isolate started. In memory only.

// ---------- the address ----------

// The same rules as normaliseEmail in public/js/card.js, which checks the same address on the phone first.
// tests/email-cases.js drives both. One plain address: 6 to 254 characters after trimming, one "@", ASCII only, no
// whitespace or control characters, none of , ; < > ' " ` \, and a dot in the domain.
function normaliseEmail(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (s.length < 6 || s.length > 254) return null;
  if (!/^[\x21-\x7e]+$/.test(s)) return null;
  if (/[,;<>"'`\\]/.test(s)) return null;
  const parts = s.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const dom = parts[1];
  if (!dom.includes('.') || dom.startsWith('.') || dom.endsWith('.') || dom.includes('..')) return null;
  return s;
}

// ---------- the limiter (best effort, in memory, see the note at the top) ----------

export function createLimiter({ perVisitor = 3, visitorWindowMs = 10 * 60 * 1000, perAddress = 3, addressWindowMs = 60 * 60 * 1000, perDay = 100, maxEntries = 1000 } = {}) {
  const visitors = new Map(); // key -> send times inside the window. Map order is oldest-touched first.
  const addresses = new Map();
  let day = { id: null, n: 0 };

  function recent(map, key, now, windowMs) {
    return (map.get(key) || []).filter((t) => now - t < windowMs);
  }
  // Entries expire: drop from the oldest end while the newest send in the entry is outside its window.
  function sweep(map, now, windowMs) {
    for (const [key, times] of map) {
      if (now - times[times.length - 1] < windowMs) break;
      map.delete(key);
    }
  }
  function remember(map, key, times) {
    map.delete(key);
    map.set(key, times);
    while (map.size > maxEntries) map.delete(map.keys().next().value); // bounded: the oldest entry goes first
  }

  return {
    // True and counted if this send is inside every limit; false and not counted if not.
    take(visitorKey, addressKey, now) {
      sweep(visitors, now, visitorWindowMs);
      sweep(addresses, now, addressWindowMs);
      const dayId = Math.floor(now / 86400000); // UTC day
      if (day.id !== dayId) day = { id: dayId, n: 0 };
      const v = recent(visitors, visitorKey, now, visitorWindowMs);
      const a = recent(addresses, addressKey, now, addressWindowMs);
      if (v.length >= perVisitor || a.length >= perAddress || day.n >= perDay) return false;
      v.push(now);
      a.push(now);
      day.n += 1;
      remember(visitors, visitorKey, v);
      remember(addresses, addressKey, a);
      return true;
    },
    size() { return { visitors: visitors.size, addresses: addresses.size }; }
  };
}

const limiter = createLimiter();

// One visitor per IPv4 address, and per /64 for IPv6: a person on IPv6 holds a whole /64 and can rotate within it.
export function visitorKey(ip) {
  if (!ip || !ip.includes(':')) return ip || 'unknown';
  let [head, tail = ''] = ip.toLowerCase().split('%')[0].split('::').length === 2 ? ip.toLowerCase().split('%')[0].split('::') : [ip.toLowerCase().split('%')[0]];
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(tail || head);
  if (v4) return ip; // an IPv4-mapped address: keep it whole
  const first = head ? head.split(':') : [];
  const last = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...first, ...Array(Math.max(0, 8 - first.length - last.length)).fill('0'), ...last] : first;
  return groups.slice(0, 4).map((g) => g.padStart(4, '0')).join(':') + '::/64';
}

// The limiter holds only these hashes, never the address or the IP themselves.
async function digest(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- the mail adapter: the only place that knows the mail service ----------

// Input { to, pdfBase64 } and the env; output { ok, retry }. ok: the service took it. retry: worth trying again later.
// Swapping provider changes this function and nothing else.
// UNVERIFIED against Resend docs (the session could not reach resend.com): the endpoint, the Bearer header, and the
// body shape { from, to, subject, text, attachments: [{ filename, content (base64) }] }, with `to` as a string.
// Check each against https://resend.com/docs/api-reference/emails/send-email before this goes live.
async function sendMail({ to, pdfBase64 }, env, deps) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs || PROVIDER_TIMEOUT_MS);
  try {
    const res = await deps.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to, subject: SUBJECT, text: BODY_TEXT, attachments: [{ filename: ATTACHMENT_NAME, content: pdfBase64 }] }),
      signal: ctl.signal,
      redirect: 'error'
    });
    if (res.status >= 200 && res.status < 300) return { ok: true, retry: false };
    if (res.status === 429 || res.status >= 500) return { ok: false, retry: true };
    // Our key or sender was refused: the athlete did nothing wrong, and the owner needs to see it. "Later" to the
    // athlete; a distinct status (502) in the log. Only the status code is logged.
    if (res.status === 401 || res.status === 403) return { ok: false, retry: true, auth: true };
    return { ok: false, retry: false };
  } catch (err) {
    // A timeout or a network failure: the athlete can try again. The error is dropped on purpose, because its
    // message can carry the request, and so the address. Nothing is logged from it.
    return { ok: false, retry: true };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- the request ----------

// The body as bytes, read in full but never past the cap, so a missing or false Content-Length cannot get past it.
async function readCapped(request, cap) {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

// The PDF as a binary string when it is acceptable, else the reply to give.
function checkPdf(pdf) {
  if (typeof pdf !== 'string' || pdf.length === 0) return { reply: REFUSED(400) };
  if (pdf.length > Math.ceil(MAX_PDF_BYTES / 3) * 4) return { reply: REFUSED(413) };
  if (pdf.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(pdf)) return { reply: REFUSED(400) };
  const size = (pdf.length / 4) * 3 - (pdf.endsWith('==') ? 2 : pdf.endsWith('=') ? 1 : 0);
  if (size > MAX_PDF_BYTES) return { reply: REFUSED(413) };
  const bin = atob(pdf);
  if (!bin.startsWith('%PDF-')) return { reply: REFUSED(400) };
  const scan = JSPDF_OWN.reduce((t, re) => t.replace(re, ''), bin);
  if (!pdfStructureOk(bin)) return { reply: REFUSED(400) };
  if (DENIED.some((word) => scan.includes(word)) || NAME_WITH_HEX_ESCAPE.test(scan) || INLINE_IMAGE.test(scan)) return { reply: REFUSED(400) };
  return { bin };
}

// deps = { fetch, log, now }. The handler reads nothing from the platform's globals for those three, so a test
// can stub each. deps.timeoutMs is optional (tests only). log is called once a reply, with a status code and the
// count of sends so far: numbers only.
export async function handler(request, env, deps) {
  function reply({ status, result }, extra, logAs) {
    deps.log(logAs || status, sendCount);
    return new Response(JSON.stringify({ result }), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra }
    });
  }
  try {
    if (request.method !== 'POST') return reply(REFUSED(405), { Allow: 'POST' });

    const origin = request.headers.get('Origin');
    if (!origin || origin !== new URL(request.url).origin) return reply(REFUSED(403));

    const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') return reply(REFUSED(415));

    const declared = request.headers.get('Content-Length');
    if (declared !== null && /^\d+$/.test(declared) && Number(declared) > MAX_BODY_BYTES) return reply(REFUSED(413));
    const bytes = await readCapped(request, MAX_BODY_BYTES);
    if (bytes === null) return reply(REFUSED(413));

    let body;
    try {
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (err) {
      return reply(REFUSED(400)); // not JSON: the parse error is not logged, it can quote the body
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(REFUSED(400));
    const keys = Object.keys(body).sort();
    if (keys.length !== 2 || keys[0] !== 'email' || keys[1] !== 'pdf') return reply(REFUSED(400));

    const to = normaliseEmail(body.email);
    if (!to) return reply(REFUSED(400));
    const checked = checkPdf(body.pdf);
    if (checked.reply) return reply(checked.reply);

    if (!env || !env.RESEND_API_KEY || !env.MAIL_FROM) return reply(LATER);

    const visitor = await digest(visitorKey(request.headers.get('CF-Connecting-IP')));
    if (!limiter.take(visitor, await digest(to.toLowerCase()), deps.now())) return reply({ status: 429, result: 'later' });

    const sent = await sendMail({ to, pdfBase64: body.pdf }, env, deps);
    if (sent.ok) {
      sendCount += 1;
      return reply({ status: 200, result: 'sent' });
    }
    if (sent.auth) return reply(LATER, undefined, 502);
    return reply(sent.retry ? LATER : REFUSED(400));
  } catch (err) {
    // Anything unexpected is "try again later". The error is not logged: its message could hold the address.
    return reply(LATER);
  }
}

// The Pages entries. POST goes to onRequestPost; any other method goes to onRequest, which answers 405.
// fetch is wrapped, because some runtimes refuse a platform function called without its owner.
export function onRequestPost(context) {
  return handler(context.request, context.env, {
    fetch: (...args) => fetch(...args),
    log: (status, count) => console.log('send status=' + status + ' count=' + count),
    now: () => Date.now()
  });
}
export const onRequest = onRequestPost;
