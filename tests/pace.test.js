const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../public/js/pace.js');

const example = {
  distance: '70.3', mode: 'power', css: 105, ftp: 240, ftpRecent: true, runThreshold: 290,
  weight: 72, course: 'rolling', heat: 'warm'
};

test('blueprint worked example: bike 175-185 W, run 5:15-5:30 /km', () => {
  const p = P.planPace(example);
  assert.ok(p.ok);
  assert.deepEqual(p.bike.watts, [175, 185]);
  assert.deepEqual(p.run.pace, [315, 330]);
  // Finish lands near the blueprint's 5:15-5:30. The bike model is typical, not exact.
  assert.ok(p.finish[0] >= 300 && p.finish[0] <= 330, 'fast end ' + p.finish[0]);
  assert.ok(p.finish[1] >= 315 && p.finish[1] <= 345, 'slow end ' + p.finish[1]);
});

test('the legs always add up to the finish range (RP-05-W2)', () => {
  for (const distance of ['standard', '70.3']) {
    for (const course of ['flat', 'rolling', 'hilly']) {
      for (const heat of ['mild', 'warm', 'hot']) {
        for (const mode of ['power', 'hr', 'effort']) {
          const p = P.planPace({ ...example, distance, course, heat, mode, bikeLthr: 160, runLthr: 170, steadySpeed: 30 });
          assert.ok(p.ok, JSON.stringify(p.errors));
          const lo = p.swim.minutes[0] + p.bike.minutes[0] + p.run.minutes[0] + p.transitions[0];
          const hi = p.swim.minutes[1] + p.bike.minutes[1] + p.run.minutes[1] + p.transitions[1];
          assert.deepEqual(p.finish, [lo, hi]);
          assert.ok(p.finish[0] < p.finish[1], 'a range, never one time (RD-05-A2)');
          for (const leg of ['swim', 'bike', 'run']) assert.ok(p[leg].minutes[0] <= p[leg].minutes[1]);
        }
      }
    }
  }
});

test('hills, heat and an old test all lower the bike target', () => {
  const base = P.planPace(example).bike.watts;
  assert.ok(P.planPace({ ...example, course: 'hilly' }).bike.watts[1] < base[1]);
  assert.ok(P.planPace({ ...example, heat: 'hot' }).bike.watts[1] < base[1]);
  const old = P.planPace({ ...example, ftpRecent: false });
  assert.ok(old.bike.watts[1] < base[1]);
  assert.equal(old.warnings.length, 1);
});

test('hills make the bike slower, heat makes the run slower', () => {
  const base = P.planPace(example);
  assert.ok(P.planPace({ ...example, course: 'hilly' }).bike.minutes[0] > base.bike.minutes[0]);
  assert.ok(P.planPace({ ...example, heat: 'hot' }).run.pace[0] > base.run.pace[0]);
});

test('Standard races go harder than 70.3', () => {
  const s = P.planPace({ ...example, distance: 'standard' });
  assert.ok(s.bike.watts[0] > P.planPace(example).bike.watts[1]);
  assert.ok(s.run.pace[1] < P.planPace(example).run.pace[0]);
});

test('heart-rate mode gives bpm targets and no watts', () => {
  const p = P.planPace({ ...example, mode: 'hr', bikeLthr: 160, runLthr: 170, steadySpeed: 32 });
  assert.ok(p.ok);
  assert.equal(p.bike.watts, null);
  assert.deepEqual(p.bike.hr, [128, 136]);
  assert.ok(p.run.hr[0] > 0);
});

test('effort mode needs no power or heart rate', () => {
  const p = P.planPace({ distance: '70.3', mode: 'effort', css: 105, runThreshold: 290, weight: 72, steadySpeed: 30, course: 'flat', heat: 'mild' });
  assert.ok(p.ok);
  assert.match(p.bike.effort, /out of 10/);
});

test('implausible numbers are refused, not planned (RP-03-A1)', () => {
  const bad = P.planPace({ ...example, ftp: 900, css: 20, runThreshold: null, weight: 10 });
  assert.equal(bad.ok, false);
  const fields = bad.errors.map((e) => e.field).sort();
  assert.deepEqual(fields, ['css', 'ftp', 'runThreshold', 'weight']);
  assert.equal(P.planPace({ ...example, distance: 'ironman' }).ok, false);
});

test('bikeTarget matches the full plan, so the guide and the app agree', () => {
  const t = P.bikeTarget({ ftp: 240, distance: '70.3', course: 'rolling' });
  assert.deepEqual(t.watts, P.planPace(example).bike.watts);
});

test('bike speed rises with power and falls with weight', () => {
  assert.ok(P.bikeSpeed(200, 72) > P.bikeSpeed(150, 72));
  assert.ok(P.bikeSpeed(200, 60) > P.bikeSpeed(200, 90));
  const kmh = P.bikeSpeed(180, 72) * 3.6;
  assert.ok(kmh > 30 && kmh < 38, 'plausible age-group speed, got ' + kmh.toFixed(1));
});

test('midSplits hands the fuel plan the middle of each leg', () => {
  const p = P.planPace(example);
  const m = P.midSplits(p);
  assert.equal(m.bike, Math.round((p.bike.minutes[0] + p.bike.minutes[1]) / 2));
});
