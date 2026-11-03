/* Time helpers shared by every tool. Plain script: attaches to window.RD, or exports for Node tests. */
(function (root) {
  'use strict';

  // "1:45" -> 105 seconds. Accepts m:ss or h:mm:ss. Returns null when it can't read it.
  function parseClock(text) {
    if (typeof text !== 'string') return null;
    var t = text.trim();
    if (!/^\d{1,2}(:\d{1,2}){1,2}$/.test(t)) return null;
    var parts = t.split(':').map(Number);
    if (parts.slice(1).some(function (p) { return p >= 60; })) return null;
    return parts.reduce(function (acc, p) { return acc * 60 + p; }, 0);
  }

  // "2:45" -> 165 minutes. Reads h:mm.
  function parseHM(text) {
    if (typeof text !== 'string') return null;
    var m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
    if (!m || Number(m[2]) >= 60) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // 115 seconds -> "1:55"
  function fmtPace(seconds) {
    var s = Math.round(seconds);
    return Math.floor(s / 60) + ':' + pad(s % 60);
  }

  // 161 minutes -> "2:41"
  function fmtHM(minutes) {
    var m = Math.round(minutes);
    return Math.floor(m / 60) + ':' + pad(m % 60);
  }

  // Whole days from today to an ISO date (yyyy-mm-dd), in local time.
  function daysUntil(isoDate, today) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || '');
    if (!m) return null;
    var race = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var now = today ? new Date(today.getFullYear(), today.getMonth(), today.getDate()) : null;
    if (!now) { var d = new Date(); now = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
    return Math.round((race - now) / 86400000);
  }

  function addDays(isoDate, days) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || '');
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  }

  // A time of day, "06:40" -> 400 minutes since midnight. Blank or unreadable gives null.
  // "00:00" is 0, which is a real time and not the same as blank, so test the result with == null.
  function clockMinutes(text) {
    if (typeof text !== 'string') return null;
    var m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
    if (!m) return null;
    var hr = Number(m[1]);
    var min = Number(m[2]);
    if (hr > 23 || min > 59) return null;
    return hr * 60 + min;
  }

  var RACE_TIMES_MESSAGE = 'Transition should open before the race starts.';

  // The transition area opens before the race starts. Checked only when both times are set and
  // readable: a blank time is "not set", never midnight. Returns a message, or '' when fine.
  function raceTimesError(start, opens) {
    var s = clockMinutes(start);
    var o = clockMinutes(opens);
    if (s == null || o == null) return '';
    return o < s ? '' : RACE_TIMES_MESSAGE;
  }

  // A time of day plus some minutes: addMinutes('07:00', 291) is { time: '11:51', days: 0 }. `days` counts the
  // midnights passed, so a finish after midnight says so. A blank or unreadable start gives null, never a made-up time.
  function addMinutes(start, minutes) {
    var s = clockMinutes(start);
    if (s == null || typeof minutes !== 'number' || !isFinite(minutes)) return null;
    var total = s + Math.round(minutes);
    var days = Math.floor(total / 1440);
    var m = total - days * 1440;
    return { time: pad(Math.floor(m / 60)) + ':' + pad(m % 60), days: days };
  }

  var api = {
    parseClock: parseClock, parseHM: parseHM, fmtPace: fmtPace, fmtHM: fmtHM, daysUntil: daysUntil, addDays: addDays,
    clockMinutes: clockMinutes, raceTimesError: raceTimesError, RACE_TIMES_MESSAGE: RACE_TIMES_MESSAGE
  };
  api.addMinutes = addMinutes;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RD = root.RD || {}; root.RD.time = api; }
})(this);
