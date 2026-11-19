/*
 * Counts (decided 18 Nov 2026, replacing "no analytics"): a few anonymous tallies so the owner can see where people come
 * from, where they stop and how many race cards each distance makes.
 *
 * What is sent: one small same-origin POST to /api/event, with exactly two strings, `kind` and `key`:
 *   visit    key is where the person came from: a utm_source label, or the referring site's host name, or "direct".
 *   step     key is the screen reached: home, race, pacing1, pacing2, pacing3, nutrition, card or products.
 *   card     key is the distance (sprint, standard, 70.3, ironman) when a race card with a complete plan is opened.
 *   emailed  key is the distance, after the person's own "Email my race card" tap sent.
 * Nothing else goes: no id, no cookie, no address, no race name, no date, no number from the plan. The server keeps a
 * daily total for each (day, kind, key) and nothing that links one count to one person. One count for each thing for each
 * page load, held in memory only; a reload counts again. This file keeps nothing in storage.
 *
 * Off where the function does not exist (canEmailHere in card.js: github.io, an unknown host), and off for a person whose
 * browser says Do Not Track or Global Privacy Control. The guide pages do not load this file.
 *
 * Two halves, as feedback.js has: the rules load in Node for the tests; the counter runs in the page only.
 */
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var card = isNode ? require('./card.js') : root.RD.card;

  var STEPS = ['home', 'race', 'pacing1', 'pacing2', 'pacing3', 'nutrition', 'card', 'products'];
  var DISTANCES = ['sprint', 'standard', '70.3', 'ironman'];
  var KINDS = ['visit', 'step', 'card', 'emailed'];
  var SOURCE_SHAPE = /^[a-z0-9._-]{1,60}$/;
  // The old addresses #/setup/2 to #/setup/5 open the parts of step 2 (the same table as app.js).
  var LEGACY_PART = { 2: 1, 3: 1, 4: 2, 5: 3 };

  // ---------- the rules (no DOM) ----------

  // The screen a hash opens, as one of STEPS. An address we do not know opens home, as the router does.
  function stepOf(hash) {
    var parts = String(hash || '').replace(/^#\/?/, '').split('/');
    var n;
    switch (parts[0]) {
      case 'setup':
        n = Number(parts[1]) || 1;
        return LEGACY_PART[n] ? 'pacing' + LEGACY_PART[n] : 'race';
      case 'pacing':
        n = Number(parts[1]) || 1;
        return 'pacing' + (n < 1 || n > 3 ? 1 : n);
      case 'fuel': return 'nutrition';
      case 'card': case 'saved': return 'card';
      case 'products': return 'products';
      default: return 'home';
    }
  }

  // Where the person came from, as one short label. A utm_source in the address wins (a link we shared says what it is);
  // then the referring site's host name, with "www." dropped, never its path or query; else "direct". Our own host is
  // "direct". The result always fits SOURCE_SHAPE, which the function checks again.
  function sourceOf(referrer, search, ownHost) {
    var utm = /[?&]utm_source=([A-Za-z0-9_-]{1,30})(?:&|$)/.exec(typeof search === 'string' ? search : '');
    if (utm) return utm[1].toLowerCase();
    var m = /^https?:\/\/([^/?#:@]+)(?::\d+)?(?:[/?#]|$)/i.exec(typeof referrer === 'string' ? referrer : '');
    if (!m) return 'direct';
    var host = m[1].toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    var own = String(ownHost || '').toLowerCase().replace(/^www\./, '');
    if (!host || host === own || !SOURCE_SHAPE.test(host) || host.indexOf('.') < 0) return 'direct';
    return host;
  }

  // Counting is on only where the function exists and the person has not said no.
  function allowed(hostname, nav) {
    if (!card.canEmailHere(hostname)) return false;
    if (nav && (nav.doNotTrack === '1' || nav.globalPrivacyControl === true)) return false;
    return true;
  }

  // The body of one count, or null for a value we would not send. The function's rules are these same ones.
  function eventBody(kind, key) {
    if (KINDS.indexOf(kind) < 0 || typeof key !== 'string') return null;
    if (kind === 'visit' && !SOURCE_SHAPE.test(key)) return null;
    if (kind === 'step' && STEPS.indexOf(key) < 0) return null;
    if ((kind === 'card' || kind === 'emailed') && DISTANCES.indexOf(key) < 0) return null;
    return { kind: kind, key: key };
  }

  // One counter for one page load. send(body) does the posting. Each (kind, key) is sent once.
  function createCounter(send) {
    var seen = {};
    function count(kind, key) {
      var body = eventBody(kind, key);
      if (!body) return false;
      var id = kind + ':' + key;
      if (seen[id]) return false;
      seen[id] = true;
      send(body);
      return true;
    }
    return { count: count };
  }

  var api = { stepOf: stepOf, sourceOf: sourceOf, allowed: allowed, eventBody: eventBody, createCounter: createCounter, STEPS: STEPS, DISTANCES: DISTANCES, KINDS: KINDS };
  if (isNode) { module.exports = api; return; }
  root.RD = root.RD || {};

  // ---------- the counter (page only) ----------

  var nav = root.navigator;
  var on = allowed(root.location && root.location.hostname, nav);
  var warned = false;
  var counter = createCounter(function (body) {
    if (!on) return;
    root.fetch('/api/event', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      keepalive: true, cache: 'no-store', credentials: 'omit'
    }).then(null, function (err) {
      // A count that does not get through is dropped, once noted: nothing waits on it.
      if (!warned) { warned = true; console.warn('TRI Momentum: a count did not send.', err && err.name); }
    });
  });

  api.visit = function () {
    var loc = root.location || {};
    counter.count('visit', sourceOf(root.document && root.document.referrer, loc.search, loc.hostname));
  };
  api.step = function (hash) { counter.count('step', stepOf(hash)); };
  api.card = function (distance) { counter.count('card', distance); };
  api.emailed = function (distance) { counter.count('emailed', distance); };
  root.RD.stats = api;
})(this);
