/*
 * POST /api/feedback: email one short feedback message to the owner. A Cloudflare Pages Function. It runs on Cloudflare
 * only. The app hides the feedback footer on github.io (canEmailHere in card.js), where this function does not exist.
 *
 * What it holds: nothing durable. No database, no KV, no cache, no file. The limiter keeps a SHA-256 hash of the visitor and
 * counters, in memory only. It logs a status code and a count of sends, and nothing else: never the message, the reply
 * address, the page, the visitor's IP or the key. The mail key (env.RESEND_API_KEY), the sender (env.MAIL_FROM) and the
 * one recipient (env.FEEDBACK_TO) come from the environment and are never in the repo. Those are the only three env names used.
 *
 * What it takes: JSON with exactly the keys `message`, `email`, `page` and `website`, all strings, same origin only. The
 * recipient is env.FEEDBACK_TO alone, the sender is env.MAIL_FROM, and the subject is fixed below, so no byte of the request
 * can choose who is mailed or from where. The one caller value that reaches a header is the reply address, as Reply-To, and
 * it has passed the one-plain-address rule below. The body is plain text only.
 *
 * `website` is a trap field: the page keeps it empty and hides it. A request that fills it gets "sent" and nothing is
 * mailed or counted. That cuts down scripts that fill every field. It does not stop a script that posts straight to
 * this address and leaves it empty; the limiter and the owner's Cloudflare rule are what bound that.
 *
 * LIMITS, said plainly. The limiter below lives in this isolate's memory. Cloudflare runs many isolates, in many places, and
 * restarts them often, so each one counts for itself and forgets. It slows a loop down; it is NOT a real limit. The real
 * limit is a Cloudflare rate-limiting rule on /api/feedback, which the owner sets in the dashboard, plus the mail
 * service's own quota. It has its own limiter, apart from /api/send's, so the in-memory counts are separate. The mail quota
 * is NOT separate: this function and send.js use the same Resend key, so a scripted flood of posts (a forged Origin from
 * many addresses passes the same-origin check) can use up the quota and stop race-card email. The owner's go-live steps
 * (not done or checked): a Cloudflare rate-limiting rule on /api/feedback, a Resend usage alert, and consider a separate
 * Resend key for feedback. Someone can still fill the owner's inbox; they cannot mail anyone else from this sender address.
 * A message can imitate the fixed lines above its divider in the email body. The owner is the only reader.
 *
 * Self-contained on purpose: this file shares no code with send.js, so nothing here can change the race-card limits.
 * The address rule is a third copy of normaliseEmail in card.js and send.js; tests/email-cases.js drives all three.
 *
 * Module format: this file is an ES module (functions/package.json says so). The tests load it with a dynamic load.
 */

const SUBJECT = 'TRI Momentum feedback';
const BODY_TOP = 'New feedback from the TRI Momentum app.';
const BODY_DIVIDER = '----------------------------------------';

const MAX_BODY_BYTES = 16384; // the whole request body. The longest valid one is about 12.5 KB (2,000 JSON-escaped surrogates at 6 bytes each).
const MESSAGE_MIN = 5;
const MESSAGE_MAX = 2000; // JavaScript string length (UTF-16 code units), the unit of the textarea's maxlength
const PROVIDER_TIMEOUT_MS = 10000;

const LATER = { status: 503, result: 'later' };
const REFUSED = (status) => ({ status, result: 'refused' });

let sendCount = 0; // sends the mail service accepted, since this isolate started. In memory only.

// ---------- the fields ----------

// The same rules as normaliseEmail in public/js/card.js and functions/api/send.js. One plain address: 6 to 254 characters
// after trimming, one "@", ASCII only, no whitespace or control characters, none of , ; < > ' " ` \, and a dot in the domain.
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

// The trimmed message, or null. 5 to 2,000 characters after trimming, and no control character except tab, line feed and
// carriage return (NUL, vertical tab, ESC, DEL and the C1 range are refused).
function checkMessage(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (s.length < MESSAGE_MIN || s.length > MESSAGE_MAX) return null;
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(s)) return null;
  return s;
}

// The screen the person was on: blank, or "#/" and up to 40 of a-z, 0-9 and "/". Anything else is refused, not cleaned.
const PAGE_SHAPE = /^#\/[a-z0-9/]{0,40}$/;
function checkPage(value) {
  if (typeof value !== 'string') return null;
  return value === '' || PAGE_SHAPE.test(value) ? value : null;
}

// ---------- the limiter (best effort, in memory, see the note at the top) ----------

export function createLimiter({ perVisitor = 3, visitorWindowMs = 10 * 60 * 1000, perDay = 30, maxEntries = 1000 } = {}) {
  const visitors = new Map(); // key -> send times inside the window. Map order is oldest-touched first.
  let day = { id: null, n: 0 };

  // Entries expire: drop from the oldest end while the newest send in the entry is outside its window.
  function sweep(now) {
    for (const [key, times] of visitors) {
      if (now - times[times.length - 1] < visitorWindowMs) break;
      visitors.delete(key);
    }
  }

  return {
    // True and counted if this send is inside every limit; false and not counted if not.
    take(visitorKey, now) {
      sweep(now);
      const dayId = Math.floor(now / 86400000); // UTC day
      if (day.id !== dayId) day = { id: dayId, n: 0 };
      const v = (visitors.get(visitorKey) || []).filter((t) => now - t < visitorWindowMs);
      if (v.length >= perVisitor || day.n >= perDay) return false;
      v.push(now);
      day.n += 1;
      visitors.delete(visitorKey);
      visitors.set(visitorKey, v);
      while (visitors.size > maxEntries) visitors.delete(visitors.keys().next().value); // bounded: the oldest entry goes first
      return true;
    },
    size() { return { visitors: visitors.size }; }
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

// The limiter holds only this hash, never the visitor's address itself.
async function digest(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- the mail adapter: the only place that knows the mail service ----------

// Input { to, replyTo, text } and the env; output { ok, retry }. ok: the service took it. retry: worth trying again later.
// Swapping provider changes this function and nothing else.
// UNVERIFIED against Resend docs (the session could not reach resend.com): the endpoint, the Bearer header, and the
// body shape { from, to, subject, text, reply_to }, with `to` as a string. The Reply-To field name `reply_to` is a
// belief, not a check. Check each against https://resend.com/docs/api-reference/emails/send-email before this goes live.
// The body has a `text` field only, never `html`, and no attachment.
async function sendMail({ to, replyTo, text }, env, deps) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs || PROVIDER_TIMEOUT_MS);
  const mail = { from: env.MAIL_FROM, to, subject: SUBJECT, text };
  if (replyTo) mail.reply_to = replyTo;
  try {
    const res = await deps.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(mail),
      signal: ctl.signal,
      redirect: 'manual'
    });
    if (res.status >= 200 && res.status < 300) return { ok: true, retry: false };
    if (res.status === 429 || res.status >= 500) return { ok: false, retry: true };
    // Our key or sender was refused: the person did nothing wrong, and the owner needs to see it. "Later" to the
    // person; a distinct status (502) in the log. Only the status code is logged.
    if (res.status === 401 || res.status === 403) return { ok: false, retry: true, auth: true };
    return { ok: false, retry: false };
  } catch (err) {
    // A timeout or a network failure: the person can try again. The error is dropped on purpose, because its message
    // can carry the request. Nothing is logged from it.
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

const KEYS = ['email', 'message', 'page', 'website'];

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
    if (keys.length !== KEYS.length || keys.some((k, i) => k !== KEYS[i])) return reply(REFUSED(400));
    if (KEYS.some((k) => typeof body[k] !== 'string')) return reply(REFUSED(400));

    // The trap field. Answered "sent", nothing mailed, nothing counted, nothing else read.
    if (body.website !== '') return reply({ status: 200, result: 'sent' });

    const message = checkMessage(body.message);
    if (message === null) return reply(REFUSED(400));
    const email = body.email.trim() === '' ? '' : normaliseEmail(body.email); // blank is allowed here: no reply address
    if (email === null) return reply(REFUSED(400));
    const page = checkPage(body.page);
    if (page === null) return reply(REFUSED(400));

    // The recipient is the environment's and no one else's, and must itself be one plain address, so a mistyped list
    // cannot fan out.
    const to = env && normaliseEmail(env.FEEDBACK_TO);
    if (!env || !env.RESEND_API_KEY || !env.MAIL_FROM || !to) return reply(LATER);

    const visitor = await digest(visitorKey(request.headers.get('CF-Connecting-IP')));
    if (!limiter.take(visitor, deps.now())) return reply({ status: 429, result: 'later' });

    const text = [BODY_TOP, 'Page: ' + (page || 'home'), 'Reply to: ' + (email || 'not given'), BODY_DIVIDER, message].join('\n');
    const sent = await sendMail({ to, replyTo: email, text }, env, deps);
    if (sent.ok) {
      sendCount += 1;
      return reply({ status: 200, result: 'sent' });
    }
    if (sent.auth) return reply(LATER, undefined, 502);
    return reply(sent.retry ? LATER : REFUSED(400));
  } catch (err) {
    // Anything unexpected is "try again later". The error is not logged: its message could hold the message or address.
    return reply(LATER);
  }
}

// The Pages entries. POST goes to onRequestPost; any other method goes to onRequest, which answers 405.
// fetch is wrapped, because some runtimes refuse a platform function called without its owner.
export function onRequestPost(context) {
  return handler(context.request, context.env, {
    fetch: (...args) => fetch(...args),
    log: (status, count) => console.log('feedback status=' + status + ' count=' + count),
    now: () => Date.now()
  });
}
export const onRequest = onRequestPost;
