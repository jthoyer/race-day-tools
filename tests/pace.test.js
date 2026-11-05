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

test('CSS is explained where the app mentions it (RD-021)', () => {
  const p = P.planPace(example);
  const swim = p.why.find((w) => w.leg === 'Swim').text;
  assert.match(swim, /your CSS \(your steady pool pace\) of 1:45/);
  const bad = P.planPace({ ...example, css: 0 });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.find((e) => e.field === 'css').message, /critical swim speed \(CSS\)/);
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

test('low numbers still give a range, never one number (RD-05-A2)', () => {
  for (const ftp of [80, 100, 120, 125]) {
    for (const distance of ['standard', '70.3']) {
      const p = P.planPace({ ...example, ftp, distance });
      assert.ok(p.ok);
      assert.ok(p.bike.watts[0] < p.bike.watts[1], `FTP ${ftp} ${distance}: ${p.bike.watts}`);
      for (const leg of ['swim', 'bike', 'run']) assert.ok(p[leg].minutes[0] < p[leg].minutes[1], `${leg} at FTP ${ftp}`);
    }
  }
  const fast = P.planPace({ ...example, distance: 'standard', css: 65, runThreshold: 180 });
  for (const leg of ['swim', 'bike', 'run']) assert.ok(fast[leg].minutes[0] < fast[leg].minutes[1]);
});

test('kmAt gives about how far into a leg a time is, at an even pace, to the whole km (RD-025)', () => {
  // The start is 0 km and the end is the whole leg, for both distances and both legs.
  assert.equal(P.kmAt('70.3', 'bike', 0, 161), 0);
  assert.equal(P.kmAt('70.3', 'bike', 161, 161), 90);
  assert.equal(P.kmAt('70.3', 'run', 0, 114), 0);
  assert.equal(P.kmAt('70.3', 'run', 114, 114), 21);
  assert.equal(P.kmAt('standard', 'bike', 0, 70), 0);
  assert.equal(P.kmAt('standard', 'bike', 70, 70), 40);
  assert.equal(P.kmAt('standard', 'run', 0, 45), 0);
  assert.equal(P.kmAt('standard', 'run', 45, 45), 10);
  // The middle of a leg is half the distance. 40 min of a 161 min, 90 km bike is about 22 km.
  assert.equal(P.kmAt('70.3', 'bike', 80.5, 161), 45);
  assert.equal(P.kmAt('70.3', 'bike', 40, 161), 22);
  assert.equal(P.kmAt('standard', 'run', 22.5, 45), 5);
});

test('kmAt never passes the leg distance, and a blank or unreadable value gives no km (RD-025)', () => {
  // A time past the end of the leg is held at the whole leg.
  assert.equal(P.kmAt('70.3', 'bike', 999, 161), 90);
  // A blank is not zero: null, undefined, NaN, a string, zero and a negative leg time never give a km.
  for (const bad of [null, undefined, NaN, Infinity, '161', 0, -5]) assert.equal(P.kmAt('70.3', 'bike', 40, bad), null, String(bad));
  for (const bad of [null, undefined, NaN, '40', -1]) assert.equal(P.kmAt('70.3', 'bike', bad, 161), null, String(bad));
  // An unknown distance or leg gives no km. So does a name that only exists on every object.
  for (const d of ['sprint', null, undefined, 'constructor', 'toString']) assert.equal(P.kmAt(d, 'bike', 40, 161), null, String(d));
  for (const l of ['swim', 'toString', undefined]) assert.equal(P.kmAt('70.3', l, 40, 161), null, String(l));
});

test('T1 and T2 split our old combined changeover range, so a plan with no times of its own is unchanged (RD-031)', () => {
  for (const d of ['standard', '70.3']) {
    assert.deepEqual(P.TRANSITIONS[d], [P.T1[d][0] + P.T2[d][0], P.T1[d][1] + P.T2[d][1]]);
  }
  assert.deepEqual(P.TRANSITIONS.standard, [3, 5]);
  assert.deepEqual(P.TRANSITIONS['70.3'], [6, 9]);
  const p = P.planPace(example);
  assert.deepEqual(p.transitions, [6, 9]);
  assert.deepEqual(p.t1, P.T1['70.3']);
  assert.deepEqual(p.t2, P.T2['70.3']);
  assert.equal(p.t1Own, false);
});

test('your own T1 and T2 are used, and the legs and changeovers still add up to the finish (RD-031, RP-05-W2)', () => {
  for (const distance of ['standard', '70.3']) {
    for (const t1 of [null, 1, 4, 12, 30]) {
      for (const t2 of [null, 1, 3, 30]) {
        const p = P.planPace({ ...example, distance, t1, t2 });
        assert.ok(p.ok, JSON.stringify(p.errors));
        if (t1 != null) assert.deepEqual(p.t1, [t1, t1]);
        if (t2 != null) assert.deepEqual(p.t2, [t2, t2]);
        assert.deepEqual(p.transitions, [p.t1[0] + p.t2[0], p.t1[1] + p.t2[1]]);
        const lo = p.swim.minutes[0] + p.bike.minutes[0] + p.run.minutes[0] + p.transitions[0];
        const hi = p.swim.minutes[1] + p.bike.minutes[1] + p.run.minutes[1] + p.transitions[1];
        assert.deepEqual(p.finish, [lo, hi]);
        assert.ok(p.finish[0] < p.finish[1], 'still a range, never one time (RD-05-A2)');
      }
    }
  }
  // A longer T1 moves both ends of the finish by the same minutes.
  const a = P.planPace({ ...example, t1: 4, t2: 3 });
  const b = P.planPace({ ...example, t1: 10, t2: 3 });
  assert.deepEqual([b.finish[0] - a.finish[0], b.finish[1] - a.finish[1]], [6, 6]);
});

test('a T1 or T2 that is not whole minutes from 1 to 30 is refused, and a blank is never zero (RD-031)', () => {
  for (const bad of [0, -2, 0.5, 31, NaN, Infinity, '4']) {
    const p = P.planPace({ ...example, t1: bad });
    assert.equal(p.ok, false, String(bad));
    assert.ok(p.errors.some((e) => e.field === 't1'), String(bad));
    assert.equal(P.planPace({ ...example, t2: bad }).ok, false, 't2 ' + String(bad));
  }
  // undefined and null are both "not set": our guide is used.
  assert.deepEqual(P.planPace({ ...example, t1: undefined }).t1, P.T1['70.3']);
  assert.deepEqual(P.planPace({ ...example, t1: null }).t1, P.T1['70.3']);
});

test('taperDays uses your own length when it is whole days in range, else the guide for the distance (RD-011)', () => {
  assert.equal(P.taperDays('70.3', null), 14);
  assert.equal(P.taperDays('standard', undefined), 10);
  assert.equal(P.taperDays('70.3', 21), 21);
  assert.equal(P.taperDays('standard', 7), 7);
  // A blank, zero, a fraction, a string or a value out of range never sets the taper: the guide stays.
  for (const bad of [0, -1, 2.5, 43, 365, NaN, '21']) assert.equal(P.taperDays('70.3', bad), 14, String(bad));
  assert.equal(P.taperDays('sprint', null), 14);
  P.TAPER.options.forEach((n) => assert.equal(P.taperDays('70.3', n), n));
});
