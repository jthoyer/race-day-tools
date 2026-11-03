const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../public/js/fuel.js');

const [GEL, DRINK, CHEWS] = F.DEFAULT_PRODUCTS;
const base = { distance: '70.3', bikeMin: 165, runMin: 113, heat: 'warm', gut: 70, sweat: null, gel: GEL, drink: DRINK };

function carbsTaken(leg, p, gel) {
  // Everything the plan asks for on this leg, per hour.
  const drink = leg === 'bike' ? p.bike.drinkCarbsPerHour : 0;
  return drink + (p[leg].gels * gel.carbs) / (p[leg].minutes / 60);
}

test('carbs never go above the gut figure, on any leg (RD-02-A1, RP-02-A2)', () => {
  for (const distance of ['standard', '70.3']) {
    for (const gut of [0, 20, 30, 45, 60, 70, 90, 120]) {
      for (const gel of [GEL, CHEWS, { id: 'big', name: 'Big gel', kind: 'gel', carbs: 40, sodium: 100 }]) {
        for (const drink of [DRINK, null, { id: 's', name: 'Strong', kind: 'drink', carbs: 90, sodium: 500, serveMl: 500 }]) {
          for (const bikeMin of [60, 150, 200]) {
            const p = F.planFuel({ ...base, distance, gut, gel, drink, bikeMin });
            assert.ok(p.ok, JSON.stringify(p.errors));
            assert.ok(carbsTaken('bike', p, gel) <= gut + 1e-9, `bike ${carbsTaken('bike', p, gel)} > gut ${gut}`);
            assert.ok(carbsTaken('run', p, gel) <= gut + 1e-9, `run > gut ${gut}`);
            assert.ok(p.bike.carbsPerHour <= gut && p.run.carbsPerHour <= gut);
          }
        }
      }
    }
  }
});

test('fluid never goes above the sweat rate (hyponatraemia guard, RD-02-W1)', () => {
  for (const sweat of [0.2, 0.3, 0.5, 0.8, 1.2, 2.0, 3.0, null]) {
    for (const heat of ['mild', 'warm', 'hot']) {
      const p = F.planFuel({ ...base, sweat, heat });
      const s = sweat == null ? F.TYPICAL_SWEAT[heat] : sweat;
      assert.ok(p.bike.fluidPerHour <= s, `bike ${p.bike.fluidPerHour} > sweat ${s}`);
      assert.ok(p.run.fluidPerHour <= s, `run ${p.run.fluidPerHour} > sweat ${s}`);
      assert.ok(p.bike.fluidPerHour <= 1.0);
    }
  }
});

test('a drink too strong for the gut is diluted with water, with a warning', () => {
  const strong = { id: 's', name: 'Strong', kind: 'drink', carbs: 90, sodium: 500, serveMl: 500 };
  const p = F.planFuel({ ...base, drink: strong });
  assert.ok(p.bike.drinkShare < 1);
  assert.ok(p.bike.drinkCarbsPerHour <= 70);
  assert.ok(p.warnings.some((w) => /plain water/.test(w)));
});

test('the worked example gives a sensible 70.3 plan', () => {
  const p = F.planFuel(base);
  assert.equal(p.bike.target, 70);
  assert.equal(p.run.target, 60);
  assert.ok(p.bike.carbsPerHour >= 55 && p.bike.carbsPerHour <= 70);
  assert.ok(p.bike.gels >= 2 && p.bike.gels <= 5);
  assert.ok(p.run.gels >= 3);
  assert.equal(p.sweatTypical, true);
});

test('gel times are in order, inside the leg and clear of its last 10 minutes', () => {
  for (const n of [1, 2, 3, 5, 8]) {
    for (const minutes of [45, 90, 165, 240]) {
      const t = F.spread(n, minutes);
      assert.equal(t.length, n);
      for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1]);
      assert.ok(t.every((x) => x % 5 === 0 && x >= 5));
      if (minutes / n >= 10) assert.ok(t[t.length - 1] <= minutes - 10 || minutes <= 15);
    }
  }
  assert.deepEqual(F.spread(0, 100), []);
});

test('a low gut figure gets a training warning and stays capped', () => {
  const p = F.planFuel({ ...base, gut: 20 });
  assert.ok(p.warnings.some((w) => /Training your gut/.test(w)));
  assert.ok(p.bike.carbsPerHour <= 20);
});

test('sodium top-up is only suggested where it matters', () => {
  const mild = F.planFuel({ ...base, distance: 'standard', bikeMin: 75, runMin: 50, heat: 'mild', drink: null });
  assert.equal(mild.bike.sodiumShort, 0);
  assert.equal(mild.run.sodiumShort, 0);
  const hot = F.planFuel({ ...base, heat: 'hot', drink: null });
  assert.ok(hot.bike.sodiumShort >= 150);
});

test('bad inputs are refused, not planned', () => {
  const p = F.planFuel({ ...base, bikeMin: null, runMin: 5, gut: 300, sweat: 9, gel: null });
  assert.equal(p.ok, false);
  assert.deepEqual(p.errors.map((e) => e.field).sort(), ['bikeMin', 'gel', 'gut', 'runMin', 'sweat']);
});

test('a blank gut figure is refused, never read as zero', () => {
  const p = F.planFuel({ ...base, gut: null });
  assert.equal(p.ok, false);
  assert.deepEqual(p.errors.map((e) => e.field), ['gut']);
  assert.equal(F.planFuel({ ...base, gut: NaN }).ok, false);
  assert.equal(F.planFuel({ ...base, bikeMin: '' }).ok, false);
});
