/*
 * One details store, shared by every tool (RD-05-S1, RP-02-S1). It lives in this browser only.
 * No account and no server. Clearing the browser loses it (RD-03-W1), so every read and write
 * is wrapped: the app still works, it just forgets.
 */
(function (root) {
  'use strict';

  var KEY = 'race-day-tools.v1';

  function blank() {
    return {
      details: { weight: null, sweat: null, sweatTypical: true, gut: null },
      fitness: { mode: 'power', css: null, ftp: null, ftpRecent: true, runThreshold: null, bikeLthr: null, runLthr: null, steadySpeed: null },
      // race: { name, distance, date, start, transitionOpens, taperDays, t1, t2, course, heat, pace, fuel, splits, splitsByHand }
      // taperDays, t1 and t2 are the athlete's own (RD-031); null or missing means our guide.
      race: null,
      solo: null, // the fuel tool used with no race: { distance, bikeMin, runMin, heat }
      products: null, // null means the generic starter products
      // timing: the athlete's own gel times per leg, { first, every } in minutes. Blank means our suggested times (RD-031).
      choice: { gel: 'gel', drink: 'drink', gelCarbs: null, drinkCarbs: null, timing: { bike: { first: null, every: null }, run: { first: null, every: null } } }
    };
  }

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  // Takes saved values only where their shape matches the defaults, so a damaged or old save can't
  // crash the app. Objects merge key by key; race must be an object; products must be a list.
  function merge(base, saved) {
    if (!isObj(saved)) return base;
    Object.keys(base).forEach(function (k) {
      if (!(k in saved)) return;
      var b = base[k];
      var v = saved[k];
      if (isObj(b)) {
        if (isObj(v)) base[k] = merge(b, v);
      } else if (k === 'race' || k === 'solo') {
        base[k] = isObj(v) ? v : null;
      } else if (k === 'products') {
        // An older save names the starters "Gel (typical)": drop the tag, so every list reads the same.
        base[k] = Array.isArray(v) ? v.filter(isObj).map(function (p) {
          return typeof p.name === 'string' ? Object.assign({}, p, { name: p.name.replace(/ \(typical\)$/, '') }) : p;
        }) : null;
      } else if (v === null || typeof v !== 'object') {
        base[k] = v;
      }
    });
    return base;
  }

  var warned = false;
  function warnOnce(err) {
    if (warned) return;
    warned = true;
    if (typeof console !== 'undefined') console.warn('Race-day tools: could not use browser storage, so nothing will be kept.', err);
  }

  function load() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(KEY);
      return merge(blank(), raw ? JSON.parse(raw) : null);
    } catch (err) {
      warnOnce(err);
      return blank();
    }
  }

  function save(state) {
    try {
      root.localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      warnOnce(err);
      return false;
    }
  }

  function reset() {
    try {
      root.localStorage.removeItem(KEY);
    } catch (err) {
      warnOnce(err);
    }
  }

  var api = { KEY: KEY, blank: blank, load: load, save: save, reset: reset };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RD = root.RD || {}; root.RD.store = api; }
})(typeof window !== "undefined" ? window : globalThis);
