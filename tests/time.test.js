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

test('daysUntil counts whole local days', () => {
  const today = new Date(2026, 10, 2);
  assert.equal(T.daysUntil('2026-11-16', today), 14);
  assert.equal(T.daysUntil('2026-11-02', today), 0);
  assert.equal(T.daysUntil('2026-11-01', today), -1);
  assert.equal(T.daysUntil('', today), null);
});
