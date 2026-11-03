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
      race: null, // { name, distance, date, start, course, heat, pace, fuel, splits }
      products: null, // null means the typical defaults
      choice: { gel: 'gel', drink: 'drink' }
    };
  }

  function merge(base, saved) {
    if (!saved || typeof saved !== 'object') return base;
    Object.keys(base).forEach(function (k) {
      if (!(k in saved)) return;
      var b = base[k];
      var v = saved[k];
      if (b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object' && !Array.isArray(v)) {
        base[k] = merge(b, v);
      } else {
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
})(this);
