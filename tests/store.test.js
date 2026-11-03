const test = require('node:test');
const assert = require('node:assert/strict');

function withStorage(saved) {
  const mem = { 'race-day-tools.v1': JSON.stringify(saved) };
  global.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; } };
  delete require.cache[require.resolve('../public/js/store.js')];
  return require('../public/js/store.js');
}

test('a damaged save falls back to the defaults instead of crashing', () => {
  const store = withStorage({ details: 'oops', fitness: [1, 2], choice: null, race: 'x', products: { a: 1 }, solo: 5 });
  // store.js reads localStorage from the global object it was loaded into
  const S = store.load();
  assert.equal(typeof S.details, 'object');
  assert.equal(S.details.gut, null);
  assert.equal(S.fitness.mode, 'power');
  assert.equal(S.choice.gel, 'gel');
  assert.equal(S.race, null);
  assert.equal(S.products, null);
  assert.equal(S.solo, null);
});

test('a good save comes back whole, including the fuel-only plan', () => {
  const store = withStorage({ details: { gut: 60 }, solo: { distance: 'standard', bikeMin: 70 }, products: [{ id: 'g' }, 'junk'] });
  const S = store.load();
  assert.equal(S.details.gut, 60);
  assert.equal(S.details.sweatTypical, true);
  assert.deepEqual(S.solo, { distance: 'standard', bikeMin: 70 });
  assert.deepEqual(S.products, [{ id: 'g' }]);
});

test('blocked storage still loads the defaults', () => {
  global.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  delete require.cache[require.resolve('../public/js/store.js')];
  const store = require('../public/js/store.js');
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal(store.load().race, null);
    assert.equal(store.save({}), false);
  } finally { console.warn = warn; }
});
