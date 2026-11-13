const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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

test('the content policy names no outside host, and no page loads from one', () => {
  const headers = /Content-Security-Policy:\s*(.*)/.exec(fs.readFileSync(path.join(ROOT, '_headers'), 'utf8'))[1];
  assert.doesNotMatch(headers, /https?:|\*/, '_headers names an outside host');
  assert.match(headers, /font-src 'self'/);
  for (const p of PAGES) {
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html[p])[1];
    assert.doesNotMatch(csp, /https?:|\*/, `${p}: the content policy names an outside host`);
    assert.match(csp, /font-src 'self'/, p);
    assert.doesNotMatch(html[p], /<(?:link|script|img|iframe)\b[^>]*\b(?:href|src)="(?:https?:)?\/\//i, `${p}: loads from an outside host`);
  }
});

test('every font file app.css names is shipped, and the licence ships with them', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(faces.length >= 4, 'expected DM Sans and Outfit, each in two subsets');
  const families = new Set(faces.map((f) => /font-family:\s*'([^']+)'/.exec(f)[1]));
  assert.deepEqual([...families].sort(), ['DM Sans', 'Outfit']);
  for (const f of faces) {
    const url = /url\(([^)]+)\)/.exec(f)[1].replace(/['"]/g, '');
    assert.doesNotMatch(url, /^(?:https?:)?\/\//, `a font loads from another host: ${url}`);
    assert.ok(fs.existsSync(path.resolve(ROOT, 'css', url)), `${url} is missing`);
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'fonts', 'LICENSE.txt'), 'utf8'), /SIL OPEN FONT LICENSE/i);
});

test('the vendored PDF library ships with its licence, pinned, and has not been edited', () => {
  const dir = path.join(ROOT, 'js', 'vendor');
  const lib = fs.readFileSync(path.join(dir, 'jspdf.umd.min.js'));
  const licence = fs.readFileSync(path.join(dir, 'jspdf.LICENSE.txt'), 'utf8');
  assert.match(licence, /MIT/);
  assert.match(licence, /Permission is hereby granted, free of charge/, 'the licence text itself is there');
  const version = /^jsPDF (\d+\.\d+\.\d+), MIT licence\./.exec(licence);
  assert.ok(version, 'the licence file header names the version');
  assert.ok(lib.toString('utf8', 0, 400).includes('Version ' + version[1] + ' '), 'the file is the version the header says');
  assert.equal(/SHA-256: ([0-9a-f]{64})/.exec(licence)[1], crypto.createHash('sha256').update(lib).digest('hex'), 'a vendored file is never edited by hand');
  assert.equal(Number(/Size:\s+(\d+) bytes/.exec(licence)[1]), lib.length);
  assert.ok(lib.length < 500 * 1024, 'the browser build stays under 500 KB: ' + lib.length);
  assert.match(html['index.html'], /<script src="js\/vendor\/jspdf\.umd\.min\.js\?v=\d+"><\/script>[\s\S]*<script src="js\/card\.js\?v=\d+"><\/script>[\s\S]*<script src="js\/app\.js\?v=\d+"><\/script>/, 'loaded before the app script');
  for (const p of PAGES.slice(1)) assert.doesNotMatch(html[p], /jspdf|card\.js/, p + ' has no race card, so it does not load the PDF code');
});
