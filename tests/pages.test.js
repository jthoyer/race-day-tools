const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'public');
const PAGES = ['index.html', 'guides/bike-pacing.html', 'guides/race-fuel.html'];
const html = Object.fromEntries(PAGES.map((p) => [p, fs.readFileSync(path.join(ROOT, p), 'utf8')]));

// The visible words of a page: no tags, no scripts or styles, no comments.
function visibleText(src) {
  return src.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ');
}

test('the app title is TRI Momentum and each guide title ends "· TRI Momentum"', () => {
  assert.match(html['index.html'], /<title>TRI Momentum<\/title>/);
  for (const p of PAGES.slice(1)) assert.match(html[p], /<title>[^<]+ · TRI Momentum<\/title>/, p);
});

test('no page says "Race-day tools" in words a person reads, noscript included', () => {
  for (const p of PAGES) assert.doesNotMatch(visibleText(html[p]), /Race-day tools/, p);
  assert.match(html['index.html'], /<noscript>[\s\S]*?TRI Momentum needs JavaScript/);
});

test('the meta descriptions say nutrition and Olympic where they name a plan or a distance', () => {
  const d = /<meta name="description" content="([^"]*)"/.exec(html['index.html'])[1];
  assert.match(d, /nutrition/);
  assert.match(d, /Olympic/);
  for (const p of PAGES) assert.doesNotMatch(/<meta name="description" content="([^"]*)"/.exec(html[p])[1], /\bfuel\b|\bStandard\b/i, p);
});

test('every file loaded by more than one page carries the same ?v= on each', () => {
  const seen = {};
  for (const p of PAGES) {
    for (const m of html[p].matchAll(/(?:src|href)="([^"?]+\.(?:js|css))\?v=(\d+)"/g)) {
      const file = path.basename(m[1]);
      (seen[file] = seen[file] || {})[p] = m[2];
    }
  }
  const shared = Object.entries(seen).filter(([, pages]) => Object.keys(pages).length > 1);
  assert.ok(shared.length >= 6, 'expected the guides to share several files with the app');
  for (const [file, pages] of shared) assert.equal(new Set(Object.values(pages)).size, 1, `${file}: ${JSON.stringify(pages)}`);
});

test('every script and stylesheet a page loads has a ?v=, and the file exists', () => {
  for (const p of PAGES) {
    for (const m of html[p].matchAll(/(?:src|href)="((?:\.\.\/)?(?:js|css)\/[^"]+)"/g)) {
      assert.match(m[1], /\?v=\d+$/, `${p}: ${m[1]}`);
      assert.ok(fs.existsSync(path.join(ROOT, path.dirname(p), m[1].replace(/\?.*$/, ''))), `${p}: ${m[1]} is missing`);
    }
  }
});

test('the three content-policy tags are identical and block every network request', () => {
  const csp = PAGES.map((p) => /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html[p])[1]);
  assert.equal(new Set(csp).size, 1);
  assert.match(csp[0], /connect-src 'none'/);
});
