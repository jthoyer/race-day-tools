/*
 * Race Fuel Planner: the maths. No DOM. Runs on the device; nothing is sent anywhere.
 *
 * Safety rules this file enforces (blueprint cards RD-02-A1, RP-02-A2, RD-02-W1):
 *  - Planned carbs never go above the gut tolerance the athlete entered.
 *  - Planned fluid never goes above the sweat rate. Drinking more than you sweat is the main
 *    cause of exercise-associated hyponatraemia.
 *
 * Every range below is TYPICAL and UNCHECKED. Verify each against current sources before launch,
 * for example the ACSM nutrition and fluid position stands and the exercise-associated
 * hyponatraemia consensus statements. Change a number here, never in the UI.
 */
(function (root) {
  'use strict';

  // UNCHECKED. Upper carb targets (g an hour) before the gut cap. Common guidance: 30-60 g/h for
  // events of 1-2.5 hours, up to 90 g/h beyond 2.5 hours with mixed sugars.
  var CARB_CEILING = {
    standard: { bike: 60, run: 30 },
    '70.3': { bike: 90, run: 60 }
  };
  var LOW_GUT = 30; // Below this we suggest gut training before race day.

  // UNCHECKED. Typical sweat rate (L an hour) when the athlete has not tested. Marked Typical (RP-02-W1).
  var TYPICAL_SWEAT = { mild: 0.6, warm: 0.8, hot: 1.1 };

  // UNCHECKED. Share of sweat loss to replace. Never more than 1 (the hyponatraemia guard).
  var REPLACE = { bike: 0.75, run: 0.5 };
  var FLUID_FLOOR = { bike: 0.4, run: 0.3 }; // L an hour, but never above sweat rate
  var FLUID_CEILING = { bike: 1.0, run: 0.6 }; // L an hour

  // UNCHECKED. Sodium (mg) per litre of planned fluid, by heat. Clamped to 300-1000 mg an hour.
  var SODIUM_PER_L = { mild: 600, warm: 700, hot: 800 };
  var SODIUM_RANGE = [300, 1000];

  var BOTTLE_L = 0.75;
  var BOTTLES_ON_BIKE = 2;

  // Generic starting products. People should enter their own (RD-02-A3, RD-02-W2).
  var DEFAULT_PRODUCTS = [
    { id: 'gel', name: 'Gel (typical)', kind: 'gel', carbs: 25, sodium: 50, serveMl: 0 },
    { id: 'drink', name: 'Sports drink (typical)', kind: 'drink', carbs: 30, sodium: 250, serveMl: 500 },
    { id: 'chews', name: 'Chews, 3 pieces (typical)', kind: 'chew', carbs: 24, sodium: 60, serveMl: 0 }
  ];

  // UNCHECKED. The carbs-per-serve choices offered on the My products screen, in grams: a floor, a ceiling and a
  // step (RD-018). A figure off the list, such as a label that says 22 g, is still allowed through "Other".
  var CARB_PICK = { min: 20, max: 50, step: 5 };
  function carbSteps() {
    var out = [];
    for (var g = CARB_PICK.min; g <= CARB_PICK.max; g += CARB_PICK.step) out.push(g);
    return out;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function roundTo(v, step) { return Math.round(v / step) * step; }
  function floorTo(v, step) { return Math.floor(v / step + 1e-9) * step; }

  function fluidFor(leg, sweat) {
    var want = clamp(sweat * REPLACE[leg], FLUID_FLOOR[leg], FLUID_CEILING[leg]);
    // Never above sweat rate. Round down so rounding can't push it over.
    return Number(floorTo(Math.min(want, sweat), 0.05).toFixed(2));
  }

  // Spread up to n doses evenly through a leg of `minutes`, on 5-minute marks from 0:05, never in
  // the last 10 minutes. If n doses don't fit, it returns fewer: fewer doses only ever means fewer
  // carbs, so the gut cap still holds.
  function spread(n, minutes) {
    var times = [];
    if (n <= 0) return times;
    var slots = Math.max(1, Math.floor((minutes - 10) / 5));
    var k = Math.min(n, slots);
    for (var i = 0; i < k; i++) {
      var idx = Math.floor((i * slots) / k + slots / (2 * k));
      times.push((idx + 1) * 5);
    }
    return times;
  }

  // A real, finite number. Note null >= 0 is true in JavaScript, so a plain comparison is not enough.
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function between(v, lo, hi) { return isNum(v) && v >= lo && v <= hi; }

  function validate(input) {
    var errs = [];
    if (!CARB_CEILING[input.distance]) errs.push({ field: 'distance', message: 'Pick Standard or 70.3.' });
    if (!between(input.bikeMin, 30, 480)) errs.push({ field: 'bikeMin', message: 'Enter a bike time between 0:30 and 8:00.' });
    if (!between(input.runMin, 15, 300)) errs.push({ field: 'runMin', message: 'Enter a run time between 0:15 and 5:00.' });
    if (!between(input.gut, 0, 120)) errs.push({ field: 'gut', message: 'Enter the carbs your gut handles, 0 to 120 g an hour.' });
    if (input.sweat != null && !between(input.sweat, 0.2, 3)) errs.push({ field: 'sweat', message: 'Enter a sweat rate between 0.2 and 3 L an hour, or use a typical value.' });
    if (!input.gel || !(isNum(input.gel.carbs) && input.gel.carbs > 0) || !between(input.gel.sodium, 0, 5000)) errs.push({ field: 'gel', message: 'Pick a gel or chew with its carbs per serve.' });
    if (input.drink && !(between(input.drink.carbs, 0, 1000) && between(input.drink.sodium, 0, 5000) && isNum(input.drink.serveMl) && input.drink.serveMl > 0)) errs.push({ field: 'drink', message: 'A drink needs its carbs and serve size in ml.' });
    return errs;
  }

  /*
   * input: { distance, bikeMin, runMin, heat, gut (g/h), sweat (L/h or null for typical),
   *          gel: product (gel or chew), drink: product or null }
   */
  function planFuel(input) {
    var errors = validate(input);
    if (errors.length) return { ok: false, errors: errors };

    var d = input.distance;
    var heat = TYPICAL_SWEAT[input.heat] ? input.heat : 'warm';
    var sweatTypical = input.sweat == null;
    var sweat = sweatTypical ? TYPICAL_SWEAT[heat] : input.sweat;
    var gut = input.gut;
    var gel = input.gel;
    var drink = input.drink || null;
    var warnings = [];

    if (gut < LOW_GUT) {
      warnings.push('Your gut figure is under ' + LOW_GUT + ' g an hour. The plan stays at or below it. Training your gut on long rides can raise it safely over a few weeks.');
    }
    if (sweatTypical) warnings.push('Sweat rate is a typical value for ' + heat + ' weather. Test yours on a one-hour ride to make the fluid plan fit you.');

    // ---- Bike ----
    var bikeH = input.bikeMin / 60;
    var bikeTarget = Math.min(CARB_CEILING[d].bike, gut);
    var bikeFluid = fluidFor('bike', sweat);
    var drinkCarbsPerL = drink ? (drink.carbs / drink.serveMl) * 1000 : 0;
    var drinkSodiumPerL = drink ? (drink.sodium / drink.serveMl) * 1000 : 0;
    // Drink carbs count towards the target. If drinking only the drink would pass the target,
    // part of the fluid becomes water, so the drinking itself stays under the gut cap.
    var drinkShare = drink && drinkCarbsPerL > 0 ? Math.min(1, bikeTarget / (bikeFluid * drinkCarbsPerL)) : drink ? 1 : 0;
    drinkShare = Math.floor(drinkShare * 20) / 20; // whole 5% steps, rounded down
    var drinkCarbsH = bikeFluid * drinkShare * drinkCarbsPerL;
    if (drink && drinkShare < 1) {
      warnings.push('Your drink is strong enough to pass your carb limit on its own, so the plan makes ' +
        Math.round((1 - drinkShare) * 100) + '% of your bike fluid plain water.');
    }
    var bikeWanted = Math.max(0, Math.floor(((bikeTarget - drinkCarbsH) * bikeH) / gel.carbs + 1e-9));
    var bikeGelTimes = spread(bikeWanted, input.bikeMin);
    var bikeGelCount = bikeGelTimes.length;
    var bikeCarbsH = drinkCarbsH + (bikeGelCount * gel.carbs) / bikeH;
    var bikeSodiumTarget = roundTo(clamp(bikeFluid * SODIUM_PER_L[heat], SODIUM_RANGE[0], SODIUM_RANGE[1]), 50);
    var bikeSodiumFrom = bikeFluid * drinkShare * drinkSodiumPerL + (bikeGelCount * gel.sodium) / bikeH;
    var bikeTotalL = bikeFluid * bikeH;
    // Round the sip DOWN, so four sips an hour never pass the planned fluid or the sweat rate.
    var sipMl = floorTo((bikeFluid * 1000) / 4, 25);
    var bottlesAtStart = Math.min(BOTTLES_ON_BIKE, Math.max(1, Math.ceil(bikeTotalL / BOTTLE_L - 1e-9)));
    var refills = Math.max(0, Math.ceil(bikeTotalL / BOTTLE_L - 1e-9) - bottlesAtStart);

    // ---- Run ----
    var runH = input.runMin / 60;
    var runTarget = Math.min(CARB_CEILING[d].run, gut);
    var runFluid = fluidFor('run', sweat);
    var runWanted = Math.max(0, Math.floor((runTarget * runH) / gel.carbs + 1e-9));
    var runGelTimes = spread(runWanted, input.runMin);
    var runGelCount = runGelTimes.length;
    if (bikeGelCount < bikeWanted || runGelCount < runWanted) {
      warnings.push('Your gel or chew serve is small, so it can’t be taken often enough to reach the target. The plan takes one every 5 minutes at most. A bigger serve would help.');
    }
    var runCarbsH = (runGelCount * gel.carbs) / runH;
    var runSodiumTarget = roundTo(clamp(runFluid * SODIUM_PER_L[heat], SODIUM_RANGE[0], SODIUM_RANGE[1]), 50);
    var runSodiumFrom = (runGelCount * gel.sodium) / runH;

    // Suggest a sodium top-up only where it matters: a 70.3, or a hot day, and a real gap.
    var sodiumMatters = d === '70.3' || heat === 'hot';
    function short(target, from) {
      var gap = roundTo(target - from, 50);
      return sodiumMatters && gap >= 150 ? gap : 0;
    }
    var bikeShort = short(bikeSodiumTarget, bikeSodiumFrom);
    var runShort = short(runSodiumTarget, runSodiumFrom);

    return {
      ok: true,
      distance: d,
      heat: heat,
      sweat: sweat,
      sweatTypical: sweatTypical,
      gut: gut,
      preRace: 'Optional: a gel about 15 minutes before the swim start, if you have practised it.',
      bike: {
        minutes: input.bikeMin,
        target: bikeTarget,
        carbsPerHour: Math.round(bikeCarbsH),
        drinkCarbsPerHour: Math.round(drinkCarbsH),
        fluidPerHour: bikeFluid,
        sipMl: sipMl,
        drink: drink ? drink.name : 'water',
        drinkShare: drinkShare,
        gelTimes: bikeGelTimes,
        gels: bikeGelCount,
        sodiumTarget: bikeSodiumTarget,
        sodiumFromProducts: roundTo(bikeSodiumFrom, 10),
        sodiumShort: bikeShort,
        bottlesAtStart: bottlesAtStart,
        refills: refills
      },
      run: {
        minutes: input.runMin,
        target: runTarget,
        carbsPerHour: Math.round(runCarbsH),
        fluidPerHour: runFluid,
        gelTimes: runGelTimes,
        gels: runGelCount,
        sodiumTarget: runSodiumTarget,
        sodiumFromProducts: roundTo(runSodiumFrom, 10),
        sodiumShort: runShort
      },
      carry: {
        bikeGels: bikeGelCount,
        runGels: runGelCount,
        bottles: bottlesAtStart,
        drink: drink ? drink.name : null,
        gelName: gel.name
      },
      warnings: warnings
    };
  }

  var api = {
    CARB_CEILING: CARB_CEILING,
    TYPICAL_SWEAT: TYPICAL_SWEAT,
    DEFAULT_PRODUCTS: DEFAULT_PRODUCTS,
    CARB_PICK: CARB_PICK,
    carbSteps: carbSteps,
    spread: spread,
    validate: validate,
    planFuel: planFuel
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RD = root.RD || {}; root.RD.fuel = api; }
})(this);
