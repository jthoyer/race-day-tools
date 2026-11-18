/*
 * POST /api/event: add one to a daily tally. A Cloudflare Pages Function. It runs on Cloudflare only. The app does not call
 * it on github.io (canEmailHere in card.js), where it does not exist.
 *
 * What it takes: JSON with exactly the keys `kind` and `key`, both strings, same origin only, a body of at most 512 bytes.
 *   visit    key is a source label: 1 to 60 of a-z, 0-9, dot, underscore and hyphen ("direct", a utm_source, a host name).
 *   step     key is one of the screens in STEPS.
 *   card     key is one of DISTANCES.
 *   emailed  key is one of DISTANCES.
 * Anything else is refused, not cleaned. No free text reaches the store.
 *
 * What it keeps: one row for each (UTC day, kind, key) with a count, in the D1 database bound as env.STATS. No id, no IP
 * address, no user agent, no time finer than the day, no request body. Nothing links one count to one person. The in-memory
 * limiter below holds a SHA-256 hash of the visitor for a few minutes and is never written anywhere. It logs a status code
 * and a count of tallies added since this isolate started, and nothing else.
 *
 * A request from a browser that says Do Not Track (DNT: 1) or Global Privacy Control (Sec-GPC: 1) is answered "counted" and
 * not kept. The app does not send one in that case either: this is the second check.
 *
 * LIMITS, said plainly. The tally is a rough guide, not a ledger. A script can post straight to this address and add to any
 * count; the same-origin check stops a page on another site, not a script. The in-memory limiter is per isolate and forgets,
 * so it slows a loop down and is NOT a real limit. The real limit is a Cloudflare rate-limiting rule on /api/event, which the
 * owner sets in the dashboard. A visit's `key` is capped at VISIT_KEYS_MAX distinct labels a day; later new labels count as
 * "other", so a script cannot grow the table. The app counts each thing once a page load, so a reload counts again and a
 * "card" is a race card with a complete plan opened, not a new plan.
 *
 * Self-contained on purpose: no code shared with send.js or feedback.js, so nothing here can change their limits.
 * Module format: an ES module (functions/package.json says so). The tests load it with a dynamic load.
 */

export const STEPS = ['home', 'race', 'pacing1', 'pacing2', 'pacing3', 'nutrition', 'card', 'products'];
export const DISTANCES = ['sprint', 'standard', '70.3', 'ironman'];
const KINDS = ['visit', 'step', 'card', 'emailed'];
const SOURCE_SHAPE = /^[a-z0-9._-]{1,60}$/;
const KEYS = ['key', 'kind'];

const MAX_BODY_BYTES = 512;
export const VISIT_KEYS_MAX = 60; // distinct visit labels a day; a new one after that is "other"

// The table the tally lives in. Run once by the owner (docs/analytics.md); the function never creates it.
export const SCHEMA = 'CREATE TABLE IF NOT EXISTS counts (day TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind, key))';

const COUNTED = { status: 200, result: 'counted' };
const REFUSED = (status) => ({ status, result: 'refused' });
const LATER = { status: 503, result: 'later' };

let counted = 0; // tallies added since this isolate started. In memory only.

// ---------- the fields ----------

// The checked { kind, key }, or null.
export function checkEvent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body).sort();
  if (keys.length !== KEYS.length || keys.some((k, i) => k !== KEYS[i])) return null;
  const { kind, key } = body;
  if (typeof kind !== 'string' || typeof key !== 'string' || !KINDS.includes(kind)) return null;
  if (kind === 'visit' && !SOURCE_SHAPE.test(key)) return null;
  if (kind === 'step' && !STEPS.includes(key)) return null;
  if ((kind === 'card' || kind === 'emailed') && !DISTANCES.includes(key)) return null;
  return { kind, key };
}

// ---------- the limiter (best effort, in memory, see the note at the top) ----------

export function createLimiter({ perVisitor = 120, windowMs = 10 * 60 * 1000, maxEntries = 2000 } = {}) {
  const visitors = new Map(); // key -> times inside the window. Map order is oldest-touched first.
  return {
    take(visitorKey, now) {
      for (const [key, times] of visitors) {
        if (now - times[times.length - 1] < windowMs) break;
        visitors.delete(key);
      }
      const v = (visitors.get(visitorKey) || []).filter((t) => now - t < windowMs);
      if (v.length >= perVisitor) return false;
      v.push(now);
      visitors.delete(visitorKey);
      visitors.set(visitorKey, v);
      while (visitors.size > maxEntries) visitors.delete(visitors.keys().next().value);
      return true;
    },
    size() { return { visitors: visitors.size }; }
  };
}

const limiter = createLimiter();

// The limiter holds only this hash, never the visitor's address itself.
async function digest(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- the store: the only place that knows D1 ----------

// Adds one to the tally for (day, kind, key). A visit label past the day's cap is counted as "other".
export async function addCount(db, day, kind, key) {
  let label = key;
  if (kind === 'visit' && key !== 'other') {
    const known = await db.prepare('SELECT 1 AS x FROM counts WHERE day = ?1 AND kind = ?2 AND key = ?3').bind(day, 'visit', key).first();
    if (!known) {
      const row = await db.prepare('SELECT COUNT(*) AS c FROM counts WHERE day = ?1 AND kind = ?2').bind(day, 'visit').first();
      if (row && Number(row.c) >= VISIT_KEYS_MAX) label = 'other';
    }
  }
  await db.prepare('INSERT INTO counts (day, kind, key, n) VALUES (?1, ?2, ?3, 1) ON CONFLICT (day, kind, key) DO UPDATE SET n = n + 1').bind(day, kind, label).run();
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

// deps = { log, now }. The handler reads nothing from the platform's globals for those two, so a test can stub each.
// log is called once a reply, with a status code and the count of tallies so far: numbers only.
export async function handler(request, env, deps) {
  function reply({ status, result }, extra) {
    deps.log(status, counted);
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
    const event = checkEvent(body);
    if (event === null) return reply(REFUSED(400));

    // A person who said no: answered as counted, kept as nothing.
    if (request.headers.get('DNT') === '1' || request.headers.get('Sec-GPC') === '1') return reply(COUNTED);

    if (!env || !env.STATS || typeof env.STATS.prepare !== 'function') return reply(LATER);

    const visitor = await digest(request.headers.get('CF-Connecting-IP') || 'unknown');
    if (!limiter.take(visitor, deps.now())) return reply({ status: 429, result: 'later' });

    const day = new Date(deps.now()).toISOString().slice(0, 10); // the UTC day: nothing finer is kept
    await addCount(env.STATS, day, event.kind, event.key);
    counted += 1;
    return reply(COUNTED);
  } catch (err) {
    // Anything unexpected is "try again later". The error is not logged: it could quote a request.
    return reply(LATER);
  }
}

// The Pages entries. POST goes to onRequestPost; any other method goes to onRequest, which answers 405.
export function onRequestPost(context) {
  return handler(context.request, context.env, {
    log: (status, count) => console.log('event status=' + status + ' count=' + count),
    now: () => Date.now()
  });
}
export const onRequest = onRequestPost;
