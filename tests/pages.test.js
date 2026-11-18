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

// "default-src 'self'; connect-src 'self'" -> { 'default-src': "'self'", 'connect-src': "'self'" }
function directives(policy) {
  return Object.fromEntries(policy.split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.split(/\s+/)[0], d.split(/\s+/).slice(1).join(' ')]));
}

test('the three content-policy tags are identical, and allow only same-origin requests', () => {
  const csp = PAGES.map((p) => /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html[p])[1]);
  assert.equal(new Set(csp).size, 1);
  const meta = directives(csp[0]);
  assert.equal(meta['connect-src'], "'self'", 'a page may call its own address and no other');
  assert.equal(meta['form-action'], "'none'");
  const headers = directives(/Content-Security-Policy:\s*(.*)/.exec(fs.readFileSync(path.join(ROOT, '_headers'), 'utf8'))[1]);
  assert.equal(headers['connect-src'], meta['connect-src'], '_headers and the meta tags say the same about connections');
  assert.equal(headers['form-action'], meta['form-action']);
  // The two are kept in step: every directive a meta tag carries is the same in _headers (which adds frame-ancestors).
  for (const [name, value] of Object.entries(meta)) assert.equal(headers[name], value, name);
  assert.deepEqual(Object.keys(headers).filter((k) => !(k in meta)), ['frame-ancestors']);
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

// Every file under a folder, as text (binary files read as latin1, which is enough to look for words).
function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

test('no file in public/ names the mail service or holds a key, and none in functions/ holds a key (RD-039)', () => {
  const publicFiles = filesUnder(ROOT);
  const functionFiles = filesUnder(path.join(__dirname, '..', 'functions'));
  assert.ok(publicFiles.length > 10 && functionFiles.length >= 2, 'looked at the files');
  for (const f of publicFiles) {
    const text = fs.readFileSync(f, 'latin1');
    assert.doesNotMatch(text, /resend/i, `${path.relative(ROOT, f)} names the mail service: it belongs in functions/ only`);
  }
  for (const f of [...publicFiles, ...functionFiles]) {
    assert.doesNotMatch(fs.readFileSync(f, 'latin1'), /re_[A-Za-z0-9_]{16,}/, `${f} holds something shaped like a mail key`);
  }
  // The check can see a key: the pattern matches the shape it is for.
  assert.match('re_' + 'a1B2c3D4e5F6g7H8', /re_[A-Za-z0-9_]{16,}/);
});

// Criterion 19 and 25. The Race plan panel and status row are built with RD.ui.h(), which makes text nodes. This reads the
// source, so it also catches code that no scenario runs. vendor/ is a pinned library and is not ours to edit.
test('no script in public/js builds HTML from a string (innerHTML, outerHTML, insertAdjacentHTML)', () => {
  const jsDir = path.join(ROOT, 'js');
  const files = fs.readdirSync(jsDir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.js'));
  assert.ok(files.length >= 8, 'looked at the app scripts');
  for (const f of files) {
    assert.doesNotMatch(fs.readFileSync(path.join(jsDir, f.name), 'utf8'), /innerHTML|outerHTML|insertAdjacentHTML/, `${f.name} builds HTML from a string`);
  }
  // The check can see what it is for.
  for (const word of ['innerHTML', 'outerHTML', 'insertAdjacentHTML']) assert.match('el.' + word + ' = x', /innerHTML|outerHTML|insertAdjacentHTML/);
});

// Criterion 19 and 26. The header link of that name is gone: nothing in the app, its scripts, tests or docs says it. The
// pattern is built from two pieces so this file does not match its own search.
test('the old header link name is found nowhere in public/, scripts/, tests/ or the docs', () => {
  const repo = path.join(__dirname, '..');
  const old = new RegExp('my' + ' plan', 'i');
  const files = [
    ...filesUnder(ROOT).filter((f) => !f.split(path.sep).includes('vendor') && /\.(html|js|css|md|txt|json|svg)$/.test(f)),
    ...filesUnder(path.join(repo, 'scripts')),
    ...filesUnder(path.join(repo, 'tests')),
    path.join(repo, 'docs', 'spec.md'),
    path.join(repo, 'README.md'),
    path.join(repo, '.claude', 'skills', 'verify', 'SKILL.md')
  ].filter((f) => fs.existsSync(f));
  assert.ok(files.length > 15, 'looked at the files');
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), old, `${path.relative(repo, f)} still says the old name`);
  assert.match('My ' + 'Plan', old); // the pattern ignores case
});

// Criterion 31. The guide pages are draft articles with the tool inside: they carry no feedback footer, load no feedback
// code and call no function. Only the app page loads public/js/feedback.js, after card.js, which holds canEmailHere.
test('the guide pages do not load or mention the feedback code, and the app page loads it once, after card.js', () => {
  for (const p of PAGES.slice(1)) {
    assert.doesNotMatch(html[p], /feedback/i, `${p} mentions feedback`);
    assert.doesNotMatch(html[p], /\/api\//, `${p} names a function`);
  }
  assert.equal((html['index.html'].match(/js\/feedback\.js\?v=\d+/g) || []).length, 1);
  assert.match(html['index.html'], /<script src="js\/card\.js\?v=\d+"><\/script>\s*<script src="js\/feedback\.js\?v=\d+"><\/script>/, 'loaded straight after card.js');
  // The footer is built outside <main id="view">, so a redraw of a screen cannot wipe the draft.
  const src = fs.readFileSync(path.join(ROOT, 'js', 'feedback.js'), 'utf8');
  assert.match(src, /view\.parentNode\.insertBefore\(footer, view\.nextSibling\)/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8'), /fb-panel|f-fb-message/, 'app.js does not build the panel');
});

// Criterion 31. The owner's receiving address is set on the host (FEEDBACK_TO) and is in no file. A real address in public/,
// functions/ or tests/ fails here: every email-shaped string must be on example.test. The pattern holds no real address.
// vendor/ is a pinned library and is not ours to edit.
const EMAIL_SHAPE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
// The files that already held short made-up addresses before this rule: the boundary cases of the address rule (6 characters
// is the shortest accepted, 5 the longest refused), and one made-up body in send.test.js. Exact strings, in that one file, so a real address there or anywhere else fails.
const BOUNDARY_FIXTURES = { 'email-cases.js': new Set(['a@b' + '.co', 'a@b' + '.c', 'sam@a' + '.test', 'x@a' + '.test']), 'send.test.js': new Set(['a@b' + '.co']) };
function foreignAddresses(text, file) {
  const allowed = BOUNDARY_FIXTURES[file] || new Set();
  return [...text.matchAll(EMAIL_SHAPE)].filter((m) => !/^(?:[a-z0-9-]+\.)*example\.test$/i.test(m[1]) && !allowed.has(m[0]));
}
test('no address outside example.test in public/ (not vendor/), functions/ or tests/', () => {
  const repo = path.join(__dirname, '..');
  const files = [
    ...filesUnder(ROOT).filter((f) => !f.split(path.sep).includes('vendor') && !/\.(woff2?|png|jpe?g|ico)$/.test(f)),
    ...filesUnder(path.join(repo, 'functions')),
    ...filesUnder(path.join(repo, 'tests')).filter((f) => !/\.(pdf)$/.test(f))
  ];
  assert.ok(files.length > 25, 'looked at the files: ' + files.length);
  for (const f of files) {
    const found = foreignAddresses(fs.readFileSync(f, 'latin1'), path.basename(f));
    assert.deepEqual(found.map((m) => m[0]), [], `${path.relative(repo, f)} holds an address that is not on example.test`);
  }
  // The check can see what it is for, and lets example.test through. These are made-up, so the pattern is shown to work
  // without a real address anywhere in this file.
  assert.equal(foreignAddresses('write to someone@' + 'example.org please').length, 1);
  assert.equal(foreignAddresses('a.b+c@' + 'mail.example.net').length, 1);
  assert.equal(foreignAddresses('sam@example.test and Sam.Lee+race@mail.example.test').length, 0);
  assert.equal(foreignAddresses('sam@' + 'notexample.test').length, 1, 'a look-alike domain is not example.test');
  assert.equal(foreignAddresses('sam@' + 'example.test.evil.test').length, 1, 'example.test must be the whole domain');
  assert.equal(foreignAddresses('a@b' + '.co', 'email-cases.js').length, 0, 'the named boundary fixture is allowed in its own file');
  assert.equal(foreignAddresses('a@b' + '.co', 'other.js').length, 1, 'and nowhere else');
  assert.equal(foreignAddresses('z@b' + '.co', 'email-cases.js').length, 1, 'and only that exact string');
});

// The label for each distance is written out in three scripts (the app, the card, the guide tool), and none can load the
// others. They must say the same thing, in the same order as the legs in pace.js, or one screen names a distance wrongly.
test('the three scripts that label a distance carry the same four labels, in pace.js order (18 Nov 2026)', () => {
  const P = require('../public/js/pace.js');
  const LABELS = { sprint: 'Sprint', standard: 'Olympic', '70.3': '70.3', ironman: 'Ironman' };
  assert.deepEqual(Object.keys(LABELS), Object.keys(P.LEGS), 'one label per distance, in the order pace.js lists them');
  for (const file of ['app.js', 'card.js', 'embed.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', file), 'utf8');
    const m = /var DIST_LABEL = (\{[^}]*\});/.exec(src);
    assert.ok(m, file + ' defines DIST_LABEL');
    assert.deepEqual(Function('return ' + m[1])(), LABELS, file);
  }
});
