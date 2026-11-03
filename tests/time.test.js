const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../public/js/time.js');

test('parseClock reads m:ss and rejects nonsense', () => {
  assert.equal(T.parseClock('1:45'), 105);
  assert.equal(T.parseClock(' 4:50 '), 290);
  assert.equal(T.parseClock('1:02:03'), 3723);
  assert.equal(T.parseClock('1:75'), null);
  assert.equal(T.parseClock('abc'), null);
  assert.equal(T.parseClock(''), null);
  assert.equal(T.parseClock(null), null);
});

test('parseHM reads h:mm', () => {
  assert.equal(T.parseHM('2:45'), 165);
  assert.equal(T.parseHM('2:5'), null);
  assert.equal(T.parseHM('2:60'), null);
});

test('formatters round to the nearest unit', () => {
  assert.equal(T.fmtPace(115), '1:55');
  assert.equal(T.fmtPace(65.4), '1:05');
  assert.equal(T.fmtHM(161), '2:41');
  assert.equal(T.fmtHM(36), '0:36');
});

test('clockMinutes reads a time of day, and midnight is not blank', () => {
  assert.equal(T.clockMinutes('06:40'), 400);
  assert.equal(T.clockMinutes(' 6:40 '), 400);
  assert.equal(T.clockMinutes('23:59'), 1439);
  assert.equal(T.clockMinutes('00:00'), 0);
  assert.notEqual(T.clockMinutes('00:00'), null); // the bug this guards: null >= 0 is true in JavaScript
  assert.equal(T.clockMinutes(''), null);
  assert.equal(T.clockMinutes(null), null);
  assert.equal(T.clockMinutes(undefined), null);
  assert.equal(T.clockMinutes('24:00'), null);
  assert.equal(T.clockMinutes('06:60'), null);
  assert.equal(T.clockMinutes('6:4'), null);
  assert.equal(T.clockMinutes('abc'), null);
});

test('raceTimesError wants the transition to open before the start', () => {
  assert.equal(T.raceTimesError('06:40', '05:30'), '');
  assert.equal(T.raceTimesError('06:40', '06:39'), '');
  assert.equal(T.raceTimesError('06:40', '07:00'), T.RACE_TIMES_MESSAGE);
  assert.equal(T.raceTimesError('06:40', '06:40'), T.RACE_TIMES_MESSAGE); // at the same minute is not before
});

test('raceTimesError only checks when both times are set', () => {
  assert.equal(T.raceTimesError('', ''), '');
  assert.equal(T.raceTimesError('06:40', ''), '');
  assert.equal(T.raceTimesError('', '05:30'), '');
  assert.equal(T.raceTimesError(null, undefined), '');
  assert.equal(T.raceTimesError('06:40', 'abc'), ''); // unreadable counts as not set
});

test('raceTimesError treats a midnight start as set, not blank', () => {
  // A start of 00:00 is a real time, so a transition at 23:00 opens after it and is refused.
  assert.equal(T.raceTimesError('00:00', '23:00'), T.RACE_TIMES_MESSAGE);
  assert.equal(T.raceTimesError('00:00', ''), '');
});

test('daysUntil counts whole local days', () => {
  const today = new Date(2026, 10, 2);
  assert.equal(T.daysUntil('2026-11-16', today), 14);
  assert.equal(T.daysUntil('2026-11-02', today), 0);
  assert.equal(T.daysUntil('2026-11-01', today), -1);
  assert.equal(T.daysUntil('', today), null);
});
