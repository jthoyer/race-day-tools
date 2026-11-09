/*
 * Race Pacing Planner: the maths. No DOM. Runs on the device; nothing is sent anywhere.
 *
 * Every range below is a TYPICAL value for intermediate age-group athletes. None has been
 * checked against current sources yet (blueprint cards RP-05-W1, RD-05-O1). Each is marked
 * UNCHECKED with the place it should be verified. Change a number here, never in the UI.
 */
(function (root) {
  'use strict';

  var LEGS = {
    standard: { swim: 1.5, bike: 40, run: 10 },
    '70.3': { swim: 1.9, bike: 90, run: 21.1 }
  };

  // UNCHECKED. Open-water race pace as a multiple of pool CSS (slower: sighting, start, wetsuit varies).
  var SWIM_FACTOR = { standard: [1.03, 1.08], '70.3': [1.06, 1.12] };

  // UNCHECKED. Bike intensity factor (share of FTP) by distance and course.
  // 70.3 rolling 0.73-0.77 is the blueprint's figure (RP-05-A1). Verify against current coaching sources.
  var BIKE_IF = {
    standard: { flat: [0.84, 0.89], rolling: [0.83, 0.88], hilly: [0.81, 0.86] },
    '70.3': { flat: [0.74, 0.78], rolling: [0.73, 0.77], hilly: [0.71, 0.75] }
  };
  var HOT_IF_CUT = 0.02; // UNCHECKED. Ride a little easier in the heat.
  var OLD_TEST_IF_CUT = 0.02; // UNCHECKED. An FTP test over 6 weeks old: aim lower (RP-03-W1).

  // UNCHECKED. Heart-rate targets as a share of threshold heart rate.
  var BIKE_HR = { standard: [0.88, 0.93], '70.3': [0.8, 0.85] };
  var RUN_HR = { standard: [0.93, 0.98], '70.3': [0.85, 0.9] };

  // UNCHECKED. Effort mode: targets out of 10 with a talk test (RP-03-A2).
  var EFFORT = {
    standard: { bike: '7 out of 10: a few words at a time', run: '7–8 out of 10: a word or two at a time' },
    '70.3': { bike: '5–6 out of 10: you can speak in short sentences', run: '6–7 out of 10: short phrases only' }
  };

  // UNCHECKED. Race speed against the speed of a hard long ride, for Heart rate and Effort modes.
  var SPEED_FACTOR = { standard: [1.02, 1.08], '70.3': [0.98, 1.04] };

  // UNCHECKED. Run pace off the bike as a multiple of run threshold pace (RP-05-A2).
  var RUN_FACTOR = { standard: [1.02, 1.06], '70.3': [1.08, 1.13] };
  var RUN_HEAT = { mild: 1.0, warm: 1.01, hot: 1.04 };

  // UNCHECKED. Each changeover on its own, in whole minutes: T1 (swim to bike) and T2 (bike to run). They add up to
  // the combined range this file used before (Standard 3-5, 70.3 6-9), so a plan with no times of its own is unchanged.
  // The athlete can set their own T1 and T2 (RD-031); our range stays as the guide beside each field.
  var T1 = { standard: [2, 3], '70.3': [4, 5] };
  var T2 = { standard: [1, 2], '70.3': [2, 4] };
  var TRANSITIONS = { standard: [T1.standard[0] + T2.standard[0], T1.standard[1] + T2.standard[1]], '70.3': [T1['70.3'][0] + T2['70.3'][0], T1['70.3'][1] + T2['70.3'][1]] };

  // UNCHECKED. Taper length in days before race day: the guide for each distance, the lengths offered as one tap,
  // and the shortest and longest we accept from a picked date (RD-011, RD-031). A coach's plan wins over the guide.
  var TAPER = { guide: { standard: 10, '70.3': 14 }, options: [10, 14, 21], limits: [1, 42] };

  // Bike speed model: steady-state power balance on flat roads, then a time multiplier per course.
  // UNCHECKED. CdA 0.29 m2 suits an age-grouper on aero bars; Crr 0.005 suits good road tyres.
  var BIKE_MODEL = { cda: 0.29, crr: 0.005, bikeKitKg: 10, rho: 1.2, drivetrain: 0.97, g: 9.81 };
  var COURSE_TIME = { flat: 1.0, rolling: 1.04, hilly: 1.1 };

  // Plausible input ranges (RP-03-A1). Outside these we ask the athlete to check.
  var LIMITS = {
    css: [65, 210], // seconds per 100 m
    ftp: [80, 500], // watts
    runThreshold: [180, 540], // seconds per km
    weight: [35, 150], // kg
    lthr: [100, 210], // beats per minute
    steadySpeed: [15, 50], // km/h
    changeover: [1, 30] // whole minutes, for a T1 or T2 the athlete sets
  };

  function within(v, range) { return typeof v === 'number' && isFinite(v) && v >= range[0] && v <= range[1]; }
  // A T1 or T2 the athlete set: whole minutes inside the limits. A blank (null) means "use our guide", never zero.
  function goodChangeover(v) { return within(v, LIMITS.changeover) && Math.round(v) === v; }
  var CHANGEOVER_MESSAGE = 'Enter whole minutes, 1 to 30, or leave it blank to use our guide.';

  // The taper length to use, in days: the athlete's own if it is a whole number of days inside the limits, else the
  // guide for the distance. A blank or unreadable value is never read as zero days.
  function taperDays(distance, chosen) {
    if (within(chosen, TAPER.limits) && Math.round(chosen) === chosen) return chosen;
    return TAPER.guide[distance] || TAPER.guide['70.3'];
  }

  // Speed in m/s for a power in watts, on flat road, by bisection.
  function bikeSpeed(watts, riderKg) {
    var m = BIKE_MODEL;
    var mass = riderKg + m.bikeKitKg;
    var p = watts * m.drivetrain;
    var lo = 0, hi = 30;
    for (var i = 0; i < 60; i++) {
      var v = (lo + hi) / 2;
      var need = 0.5 * m.rho * m.cda * v * v * v + m.crr * mass * m.g * v;
      if (need > p) hi = v; else lo = v;
    }
    return (lo + hi) / 2;
  }

  function round5(n) { return Math.round(n / 5) * 5; }

  // A range never collapses to one number (RD-05-A2): rounding can make both ends equal, so the
  // top end is kept at least one step above the bottom.
  function widen(r, step) { return [r[0], Math.max(r[1], r[0] + step)]; }

  // Bike power target. Shared by the full plan and the guide embed (F7), so both give the same answer.
  function bikeTarget(o) {
    var d = BIKE_IF[o.distance] ? o.distance : '70.3';
    var course = BIKE_IF[d][o.course] ? o.course : 'rolling';
    var f = BIKE_IF[d][course];
    var cut = (o.heat === 'hot' ? HOT_IF_CUT : 0) + (o.ftpRecent === false ? OLD_TEST_IF_CUT : 0);
    var factor = [Number((f[0] - cut).toFixed(2)), Number((f[1] - cut).toFixed(2))];
    return { factor: factor, watts: widen([round5(o.ftp * factor[0]), round5(o.ftp * factor[1])], 5) };
  }

  // Checks the inputs. Returns a list of { field, message }. Empty means good to go.
  function validate(input) {
    var errs = [];
    if (!LEGS[input.distance]) errs.push({ field: 'distance', message: 'Pick Olympic or 70.3.' });
    if (!within(input.css, LIMITS.css)) errs.push({ field: 'css', message: 'Enter your critical swim speed (CSS) as m:ss per 100 m, between 1:05 and 3:30.' });
    if (!within(input.runThreshold, LIMITS.runThreshold)) errs.push({ field: 'runThreshold', message: 'Enter your run threshold as m:ss per km, between 3:00 and 9:00.' });
    if (!within(input.weight, LIMITS.weight)) errs.push({ field: 'weight', message: 'Enter a body weight between 35 and 150 kg.' });
    var mode = input.mode || 'power';
    if (mode === 'power' && !within(input.ftp, LIMITS.ftp)) errs.push({ field: 'ftp', message: 'Enter an FTP between 80 and 500 watts.' });
    if (mode !== 'power' && !within(input.steadySpeed, LIMITS.steadySpeed)) errs.push({ field: 'steadySpeed', message: 'Enter your speed on a hard long ride, between 15 and 50 km/h.' });
    if (mode === 'hr') {
      if (!within(input.bikeLthr, LIMITS.lthr)) errs.push({ field: 'bikeLthr', message: 'Enter a bike threshold heart rate between 100 and 210.' });
      if (!within(input.runLthr, LIMITS.lthr)) errs.push({ field: 'runLthr', message: 'Enter a run threshold heart rate between 100 and 210.' });
    }
    // T1 and T2 are optional: null means our guide. Anything else must be whole minutes inside the limits.
    if (input.t1 != null && !goodChangeover(input.t1)) errs.push({ field: 't1', message: 'T1: ' + CHANGEOVER_MESSAGE });
    if (input.t2 != null && !goodChangeover(input.t2)) errs.push({ field: 't2', message: 'T2: ' + CHANGEOVER_MESSAGE });
    return errs;
  }

  /*
   * input: { distance, mode: 'power'|'hr'|'effort', css (s/100m), ftp (W), ftpRecent (bool),
   *          runThreshold (s/km), weight (kg), bikeLthr, runLthr, steadySpeed (km/h),
   *          course: 'flat'|'rolling'|'hilly', heat: 'mild'|'warm'|'hot' }
   * Returns targets and leg times as ranges. Leg times are whole minutes, and the finish range is
   * the sum of those whole minutes, so the numbers on screen always add up (RP-05-W2).
   */
  function planPace(input) {
    var errors = validate(input);
    if (errors.length) return { ok: false, errors: errors };

    var d = input.distance;
    var legs = LEGS[d];
    var course = COURSE_TIME[input.course] ? input.course : 'rolling';
    var heat = RUN_HEAT[input.heat] ? input.heat : 'warm';
    var mode = input.mode || 'power';
    var warnings = [];
    var why = [];

    // Swim
    var sf = SWIM_FACTOR[d];
    var swimPace = [input.css * sf[0], input.css * sf[1]];
    var swimMin = widen([Math.round((swimPace[0] * legs.swim * 10) / 60), Math.round((swimPace[1] * legs.swim * 10) / 60)], 1);
    why.push({ leg: 'Swim', text: 'a little slower than your CSS (your steady pool pace) of ' + fmt(input.css) + ', for open water and a steady start.' });

    // Bike
    var bike = { watts: null, hr: null, effort: null };
    var bikeMin;
    if (mode === 'power') {
      var bt = bikeTarget({ ftp: input.ftp, distance: d, course: course, heat: heat, ftpRecent: input.ftpRecent });
      var f = bt.factor;
      bike.watts = bt.watts;
      var vFast = bikeSpeed(bike.watts[1], input.weight);
      var vSlow = bikeSpeed(bike.watts[0], input.weight);
      bikeMin = widen([
        Math.round(((legs.bike * 1000) / vFast / 60) * COURSE_TIME[course]),
        Math.round(((legs.bike * 1000) / vSlow / 60) * COURSE_TIME[course])
      ], 1);
      why.push({
        leg: 'Bike',
        text: Math.round(f[0] * 100) + '–' + Math.round(f[1] * 100) + '% of your FTP of ' + input.ftp + ' W, a typical range for ' +
          (d === '70.3' ? 'a 70.3' : 'an Olympic race') + ' on a ' + course + ' course' + (heat === 'hot' ? ', eased for the heat' : '') + '.'
      });
      if (input.ftpRecent === false) warnings.push('Your FTP test is over 6 weeks old, so the bike target is set a little lower. Retest if you can.');
    } else {
      var sp = SPEED_FACTOR[d];
      var kmh = [input.steadySpeed * sp[1], input.steadySpeed * sp[0]];
      bikeMin = widen([
        Math.round((legs.bike / kmh[0]) * 60 * COURSE_TIME[course]),
        Math.round((legs.bike / kmh[1]) * 60 * COURSE_TIME[course])
      ], 1);
      if (mode === 'hr') {
        var bh = BIKE_HR[d];
        bike.hr = widen([Math.round(input.bikeLthr * bh[0]), Math.round(input.bikeLthr * bh[1])], 1);
        why.push({ leg: 'Bike', text: Math.round(bh[0] * 100) + '–' + Math.round(bh[1] * 100) + '% of your bike threshold heart rate of ' + input.bikeLthr + '. Times come from your hard long-ride speed.' });
      } else {
        why.push({ leg: 'Bike', text: 'an effort you can hold for the whole ride. Times come from your hard long-ride speed.' });
      }
      bike.effort = EFFORT[d].bike;
    }

    // Run
    var rf = RUN_FACTOR[d];
    var rh = RUN_HEAT[heat];
    var runPace = widen([round5(input.runThreshold * rf[0] * rh), round5(input.runThreshold * rf[1] * rh)], 5);
    var runMin = widen([Math.round((runPace[0] * legs.run) / 60), Math.round((runPace[1] * legs.run) / 60)], 1);
    var run = { pace: runPace, hr: null, effort: EFFORT[d].run };
    if (mode === 'hr') {
      run.hr = widen([Math.round(input.runLthr * RUN_HR[d][0]), Math.round(input.runLthr * RUN_HR[d][1])], 1);
    }
    why.push({
      leg: 'Run',
      text: 'slower than your threshold of ' + fmt(input.runThreshold) + ' /km, because you run after ' + legs.bike + ' km on the bike' +
        (heat === 'hot' ? ', and slower again for the heat' : '') + '.'
    });

    // Changeovers: the athlete's own T1 and T2 where set (one time, so both ends are the same), else our guide range.
    var t1 = input.t1 != null ? [input.t1, input.t1] : T1[d].slice();
    var t2 = input.t2 != null ? [input.t2, input.t2] : T2[d].slice();
    var t = [t1[0] + t2[0], t1[1] + t2[1]];
    var finish = [swimMin[0] + bikeMin[0] + runMin[0] + t[0], swimMin[1] + bikeMin[1] + runMin[1] + t[1]];
    why.push({ leg: 'Finish', text: 'the three legs plus changeovers, with the fast and slow ends added up.' +
      (input.t1 != null || input.t2 != null ? ' Your own changeover times are used where you set them.' : '') });

    return {
      ok: true,
      distance: d,
      mode: mode,
      course: course,
      heat: heat,
      legs: legs,
      swim: { pace: [Math.round(swimPace[0]), Math.round(swimPace[1])], minutes: swimMin },
      bike: { watts: bike.watts, hr: bike.hr, effort: bike.effort, minutes: bikeMin },
      run: { pace: runPace, hr: run.hr, effort: run.effort, minutes: runMin },
      transitions: t.slice(),
      t1: t1,
      t2: t2,
      t1Own: input.t1 != null,
      t2Own: input.t2 != null,
      finish: finish,
      why: why,
      warnings: warnings
    };
  }

  function fmt(seconds) {
    var s = Math.round(seconds);
    return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }

  // Mid-point split in minutes, for handing to the fuel plan (RP-06-A2).
  function midSplits(plan) {
    function mid(r) { return Math.round((r[0] + r[1]) / 2); }
    return { swim: mid(plan.swim.minutes), bike: mid(plan.bike.minutes), run: mid(plan.run.minutes) };
  }
  // RD-025. About how far into a leg a time is, at an even pace: time / leg time x leg distance, to the whole km.
  // It is a guide only. Time is the rule for fuel, so nothing in the plan is worked out from this number.
  // A blank, unreadable or zero leg time gives null, never a km. A time past the end is held at the whole leg.
  var KM_NOTE = 'Go by the clock. Never take a gel earlier than its time. Km are a guide, from an even pace.'; // the owner's wording, 8-9 Nov 2026
  function kmAt(distance, leg, minutesIn, legMinutes) {
    function isNum(v) { return typeof v === 'number' && isFinite(v); }
    if (!Object.prototype.hasOwnProperty.call(LEGS, distance) || (leg !== 'bike' && leg !== 'run')) return null;
    if (!isNum(minutesIn) || !isNum(legMinutes) || minutesIn < 0 || legMinutes <= 0) return null;
    return Math.round(Math.min(minutesIn / legMinutes, 1) * LEGS[distance][leg]);
  }


  var api = {
    LEGS: LEGS,
    kmAt: kmAt,
    KM_NOTE: KM_NOTE,
    LIMITS: LIMITS,
    T1: T1,
    T2: T2,
    TRANSITIONS: TRANSITIONS,
    TAPER: TAPER,
    taperDays: taperDays,
    goodChangeover: goodChangeover,
    CHANGEOVER_MESSAGE: CHANGEOVER_MESSAGE,
    BIKE_IF: BIKE_IF,
    bikeSpeed: bikeSpeed,
    bikeTarget: bikeTarget,
    validate: validate,
    planPace: planPace,
    midSplits: midSplits
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RD = root.RD || {}; root.RD.pace = api; }
})(this);
