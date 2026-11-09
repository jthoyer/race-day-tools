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

test('gel times are in order, on 5-minute marks and clear of the last 10 minutes', () => {
  for (const n of [1, 2, 3, 5, 8, 30, 60]) {
    for (const minutes of [15, 45, 90, 165, 240]) {
      const t = F.spread(n, minutes);
      assert.ok(t.length >= 1 && t.length <= n);
      for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1]);
      assert.ok(t.every((x) => x % 5 === 0 && x >= 5));
      assert.ok(t[t.length - 1] <= Math.max(5, minutes - 10), `n=${n} minutes=${minutes} last=${t[t.length - 1]}`);
    }
  }
  assert.deepEqual(F.spread(0, 100), []);
});

test('a tiny serve that cannot reach the target gives fewer doses and a warning, never more carbs', () => {
  const chew = { id: 'c', name: 'Tiny chew', kind: 'chew', carbs: 4, sodium: 10 };
  const p = F.planFuel({ ...base, gut: 90, gel: chew, drink: null });
  assert.ok(p.bike.gels <= Math.floor((165 - 10) / 5));
  assert.ok(p.bike.carbsPerHour <= 90);
  assert.ok(p.warnings.some((w) => /serve is small/.test(w)));
});

test('four sips an hour never pass the planned fluid or the sweat rate', () => {
  for (let sweat = 0.2; sweat <= 3.0; sweat += 0.01) {
    const s = Math.round(sweat * 100) / 100;
    const p = F.planFuel({ ...base, sweat: s });
    assert.ok(p.bike.sipMl * 4 <= p.bike.fluidPerHour * 1000 + 1e-9, `sweat ${s}: ${p.bike.sipMl} x 4 > ${p.bike.fluidPerHour} L`);
    assert.ok(p.bike.sipMl * 4 <= s * 1000 + 1e-9);
  }
});

test('a product with a blank number is refused, not read as zero', () => {
  assert.equal(F.planFuel({ ...base, drink: { ...DRINK, carbs: null } }).ok, false);
  assert.equal(F.planFuel({ ...base, drink: { ...DRINK, sodium: null } }).ok, false);
  assert.equal(F.planFuel({ ...base, gel: { ...GEL, sodium: null } }).ok, false);
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

test('the carb list is 20 to 50 g in 5 g steps (RD-018)', () => {
  assert.deepEqual(F.carbSteps(), [20, 25, 30, 35, 40, 45, 50]);
  assert.deepEqual(F.CARB_PICK, { min: 20, max: 50, step: 5 });
});

test('every carb step is a plannable gel and drink, and the gut cap still holds (RD-018)', () => {
  for (const g of F.carbSteps()) {
    for (const gut of [30, 50, 70]) {
      // As a gel or chew serve.
      const gel = { ...GEL, carbs: g };
      const pg = F.planFuel({ ...base, gut, gel });
      assert.ok(pg.ok, 'gel ' + g + ': ' + JSON.stringify(pg.errors));
      assert.ok(carbsTaken('bike', pg, gel) <= gut + 1e-9, `gel ${g} g: bike over gut ${gut}`);
      assert.ok(carbsTaken('run', pg, gel) <= gut + 1e-9, `gel ${g} g: run over gut ${gut}`);
      // As a drink serve (per 500 ml).
      const drink = { ...DRINK, carbs: g };
      const pd = F.planFuel({ ...base, gut, drink });
      assert.ok(pd.ok, 'drink ' + g + ': ' + JSON.stringify(pd.errors));
      assert.ok(carbsTaken('bike', pd, GEL) <= gut + 1e-9, `drink ${g} g: bike over gut ${gut}`);
      assert.ok(pd.bike.carbsPerHour <= gut && pd.run.carbsPerHour <= gut);
    }
  }
});

test('describeProducts says what the plan uses, with carbs, and leaves out what it cannot read (RD-026)', () => {
  assert.equal(F.describeProducts(GEL, DRINK), 'The plan uses Gel at 25g a serve and Sports drink at 30g per 500 ml.');
  assert.equal(F.describeProducts(GEL, null), 'The plan uses Gel at 25g a serve, with water only.');
  assert.equal(F.describeProducts(CHEWS, DRINK), 'The plan uses Chews, 3 pieces at 24g a serve and Sports drink at 30g per 500 ml.');
});

test('describeProducts never shows a blank as 0 or null (RD-026)', () => {
  const blankGel = { ...GEL, carbs: null };
  const t = F.describeProducts(blankGel, DRINK);
  assert.ok(!/null|NaN|undefined| 0 g /.test(t), t);
  assert.match(t, /^The plan uses Gel and Sports drink/);
  const blankDrink = { ...DRINK, carbs: null, serveMl: null };
  const t2 = F.describeProducts(GEL, blankDrink);
  assert.ok(!/null|NaN|undefined/.test(t2), t2);
  assert.equal(t2, 'The plan uses Gel at 25g a serve and Sports drink.');
  // A drink with no carbs (an electrolyte drink) is a real 0, so it is shown.
  assert.equal(F.describeProducts(GEL, { ...DRINK, carbs: 0 }), 'The plan uses Gel at 25g a serve and Sports drink at 0g per 500 ml.');
  // A gel with 0 carbs is not a plannable gel, so its figure is left out.
  assert.ok(!/ 0g a serve/.test(F.describeProducts({ ...GEL, carbs: 0 }, DRINK)));
  assert.equal(F.describeProducts(null, null), 'The plan uses no gel or chew, with water only.');
});

test('the starter products are generic and carry no "typical" tag in their names', () => {
  F.DEFAULT_PRODUCTS.forEach((p) => assert.ok(!/typical/i.test(p.name), p.name));
  assert.deepEqual(F.DEFAULT_PRODUCTS.map((p) => p.name), ['Gel', 'Sports drink', 'Chews, 3 pieces']);
});

test('every carb pick on the fuel step stays under the gut figure (RD-009)', () => {
  const base = { distance: '70.3', bikeMin: 160, runMin: 100, heat: 'warm', sweat: null };
  const gelBase = F.DEFAULT_PRODUCTS[0];
  const drinkBase = F.DEFAULT_PRODUCTS[1];
  for (const gut of [30, 45, 60, 90]) {
    for (const g of F.pickOptions('gel', 22)) {
      for (const d of F.pickOptions('drink', 33)) {
        const p = F.planFuel({ ...base, gut, gel: { ...gelBase, carbs: g }, drink: { ...drinkBase, carbs: d } });
        assert.ok(p.ok, 'plan ok for gut ' + gut);
        assert.ok(p.bike.carbsPerHour <= gut, 'bike ' + p.bike.carbsPerHour + ' over gut ' + gut + ' with gel ' + g + ' drink ' + d);
        assert.ok(p.run.carbsPerHour <= gut, 'run ' + p.run.carbsPerHour + ' over gut ' + gut + ' with gel ' + g + ' drink ' + d);
      }
    }
  }
});

test('pickOptions offers the loads and keeps an off-list figure, and ignores a blank (RD-009)', () => {
  assert.deepEqual(F.pickOptions('gel', 25), [20, 25, 30, 40]);
  assert.deepEqual(F.pickOptions('gel', 22), [20, 22, 25, 30, 40]);
  for (const bad of [null, undefined, NaN, 0, -5, '25']) assert.deepEqual(F.pickOptions('drink', bad), [20, 30, 40, 60]);
});

test('the gel times and their count are what they were before km was shown beside them (RD-025)', () => {
  const base = { heat: 'warm', gut: 60, sweat: null, gel: GEL, drink: DRINK };
  const a = F.planFuel({ ...base, distance: '70.3', bikeMin: 161, runMin: 114 });
  assert.deepEqual(a.bike.gelTimes, [40, 115]);
  assert.deepEqual(a.run.gelTimes, [15, 40, 65, 90]);
  assert.equal(a.distance, '70.3');
  const b = F.planFuel({ ...base, distance: 'standard', bikeMin: 70, runMin: 45 });
  assert.deepEqual(b.bike.gelTimes, [35]);
  assert.deepEqual(b.run.gelTimes, []);
});

test('plainName drops a trailing "(typical)" tag from a name saved by an older version', () => {
  assert.equal(F.plainName('Gel (typical)'), 'Gel');
  assert.equal(F.plainName('Sports drink (typical)'), 'Sports drink');
  assert.equal(F.plainName('Gel'), 'Gel');
  assert.equal(F.plainName('Typical gel brand'), 'Typical gel brand');
  assert.equal(F.plainName(null), null);
  assert.equal(F.plainName(undefined), undefined);
});

test('your own gel times are used on each leg: first, then every so many minutes, clear of the last 10 minutes (RD-031)', () => {
  // A gut figure of 80: four gels plus the drink come to about 72 g an hour, which 70 would refuse.
  const p = F.planFuel({ ...base, gut: 80, timing: { bike: { first: 30, every: 40 }, run: { first: 20, every: 30 } } });
  assert.ok(p.ok);
  assert.deepEqual(p.bike.gelTimes, [30, 70, 110, 150]); // 165 min bike: 150 is the last before 155
  assert.deepEqual(p.run.gelTimes, [20, 50, 80]); // 113 min run: 110 would be in the last 10 minutes
  assert.equal(p.bike.gels, 4);
  assert.equal(p.carry.bikeGels, 4);
  assert.deepEqual(p.timingUsed, { bike: true, run: true });
  assert.deepEqual(p.timingNote, { bike: '', run: '' });
  // Every time is inside the leg and clear of its last 10 minutes.
  for (const t of p.bike.gelTimes) assert.ok(t >= 1 && t <= 165 - 10);
  for (const t of p.run.gelTimes) assert.ok(t >= 1 && t <= 113 - 10);
});

test('your own gel times never take carbs past the gut figure: they are refused and the suggested times stay (RD-031, RD-02-A1)', () => {
  const plain = F.planFuel(base);
  // A gel every 10 minutes on the bike is far past a 70 g gut figure.
  const p = F.planFuel({ ...base, timing: { bike: { first: 10, every: 10 }, run: { first: 5, every: 5 } } });
  assert.ok(p.ok);
  assert.deepEqual(p.bike.gelTimes, plain.bike.gelTimes);
  assert.deepEqual(p.run.gelTimes, plain.run.gelTimes);
  assert.equal(p.timingUsed.bike, false);
  assert.match(p.timingNote.bike, /over your gut figure of 70 g/);
  assert.match(p.timingNote.run, /over your gut figure of 70 g/);
  // Across many timings, gut figures and gels, the cap always holds.
  for (const gut of [0, 30, 60, 90, 120]) {
    for (const every of [5, 10, 15, 20, 30, 45, 60, 120]) {
      for (const gel of [GEL, CHEWS, { id: 'big', name: 'Big gel', kind: 'gel', carbs: 40, sodium: 100 }]) {
        const q = F.planFuel({ ...base, gut, gel, timing: { bike: { first: 15, every }, run: { first: 15, every } } });
        assert.ok(q.ok);
        assert.ok(carbsTaken('bike', q, gel) <= gut + 1e-9, `bike gut ${gut} every ${every}`);
        assert.ok(carbsTaken('run', q, gel) <= gut + 1e-9, `run gut ${gut} every ${every}`);
      }
    }
  }
});

test('unreadable or half-filled gel timing is refused with a message, and a blank is never zero (RD-031)', () => {
  const plain = F.planFuel(base);
  const cases = [
    [{ first: 30, every: null }, /Enter both/],
    [{ first: null, every: 30 }, /Enter both/],
    [{ first: 0, every: 30 }, /first gel time as h:mm/],
    [{ first: 30.5, every: 30 }, /first gel time as h:mm/],
    [{ first: 30, every: 2 }, /whole minutes, 5 to 120/],
    [{ first: 30, every: 121 }, /whole minutes, 5 to 120/],
    [{ first: 30, every: NaN }, /whole minutes, 5 to 120/],
    [{ first: 160, every: 30 }, /at least 10 minutes before the end/]
  ];
  for (const [bike, msg] of cases) {
    const p = F.planFuel({ ...base, timing: { bike } });
    assert.ok(p.ok);
    assert.match(p.timingNote.bike, msg, JSON.stringify(bike));
    assert.deepEqual(p.bike.gelTimes, plain.bike.gelTimes, JSON.stringify(bike));
  }
  // Both blank means the suggested times, with no message.
  const none = F.planFuel({ ...base, timing: { bike: { first: null, every: null }, run: null } });
  assert.deepEqual(none.bike.gelTimes, plain.bike.gelTimes);
  assert.deepEqual(none.timingNote, { bike: '', run: '' });
  assert.deepEqual(none.suggested.bike, plain.bike.gelTimes);
});

test('an unknown distance is refused with "Pick Olympic or 70.3." (the stored value stays "standard")', () => {
  const base = { distance: 'ironman', bikeMin: 165, runMin: 115, heat: 'warm', gut: 60, sweat: null, gel: F.DEFAULT_PRODUCTS[0], drink: F.DEFAULT_PRODUCTS[1] };
  const bad = F.planFuel(base);
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.find((e) => e.field === 'distance').message, 'Pick Olympic or 70.3.');
  assert.equal(F.planFuel({ ...base, distance: 'standard' }).ok, true);
});
