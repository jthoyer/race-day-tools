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

test('tidyTime turns digits into a time (RD-015)', () => {
  assert.equal(T.tidyTime('130'), '1:30');
  assert.equal(T.tidyTime('450'), '4:50');
  assert.equal(T.tidyTime('1030'), '10:30');
  assert.equal(T.tidyTime('245'), '2:45');
  assert.equal(T.tidyTime(' 130 '), '1:30');
  assert.equal(T.tidyTime('1.30'), '1:30'); // a dot works like a colon
  assert.equal(T.tidyTime('2.45'), '2:45');
  assert.equal(T.tidyTime('1:30'), '1:30'); // already has a colon: left alone
  assert.equal(T.tidyTime('1:5'), '1:5');
});

test('tidyTime never guesses (RD-015)', () => {
  assert.equal(T.tidyTime('45'), '45'); // seconds or minutes? refused, not guessed
  assert.equal(T.tidyTime('5'), '5');
  assert.equal(T.tidyTime('1.5'), '1.5'); // a dot needs two digits after it
  assert.equal(T.tidyTime('1,30'), '1,30'); // a comma is not decided, so it is not read
  assert.equal(T.tidyTime('12345'), '12345');
  assert.equal(T.tidyTime('abc'), 'abc');
  assert.equal(T.tidyTime(''), '');
  assert.equal(T.tidyTime(null), null);
  assert.equal(T.tidyTime(undefined), undefined);
});

test('typed digits go through the strict parsers (RD-015)', () => {
  assert.equal(T.parseClock(T.tidyTime('130')), 90);
  assert.equal(T.parseClock(T.tidyTime('450')), 290);
  assert.equal(T.parseClock(T.tidyTime('1.45')), 105);
  assert.equal(T.parseHM(T.tidyTime('245')), 165);
  assert.equal(T.parseHM(T.tidyTime('2.45')), 165);
  // Refused, never read as some other time:
  for (const bad of ['45', '5', '175', '1.5', '0', '00', '000', '0000', '12345', '']) {
    assert.equal(T.parseClock(T.tidyTime(bad)), null, 'm:ss refuses "' + bad + '"');
  }
  assert.equal(T.parseHM(T.tidyTime('275')), null); // 2:75
  assert.equal(T.parseHM(T.tidyTime('45')), null);
});

test('unreadableTimeMessage says what to type (RD-015)', () => {
  assert.match(T.unreadableTimeMessage('45', 'clock'), /Type minutes and seconds, such as 1:45 or 145/);
  assert.match(T.unreadableTimeMessage('abc', 'clock'), /Type minutes and seconds/);
  assert.match(T.unreadableTimeMessage('175', 'clock'), /Seconds go up to 59/);
  assert.match(T.unreadableTimeMessage('1.75', 'clock'), /Seconds go up to 59/);
  assert.match(T.unreadableTimeMessage('45', 'hm'), /Type hours and minutes, such as 2:45 or 245/);
  assert.match(T.unreadableTimeMessage('275', 'hm'), /Minutes go up to 59/);
  assert.match(T.unreadableTimeMessage(null, 'clock'), /Type minutes and seconds/);
});

test('daysUntil counts whole local days', () => {
  const today = new Date(2026, 10, 2);
  assert.equal(T.daysUntil('2026-11-16', today), 14);
  assert.equal(T.daysUntil('2026-11-02', today), 0);
  assert.equal(T.daysUntil('2026-11-01', today), -1);
  assert.equal(T.daysUntil('', today), null);
});
