const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The truism cards (public/truisms/): static pages that share one stylesheet and make no request of their own.
const ROOT = path.join(__dirname, '..', 'public');
const DIR = path.join(ROOT, 'truisms');
const CARDS = fs.readdirSync(DIR).filter((f) => f.endsWith('.html') && f !== 'index.html').sort();
const INDEX = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const html = Object.fromEntries(CARDS.map((f) => [f, fs.readFileSync(path.join(DIR, f), 'utf8')]));
const css = fs.readFileSync(path.join(ROOT, 'css', 'truisms.css'), 'utf8');
const csp = (src) => /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(src)?.[1];

// The visible words of a page: no tags, no scripts or styles, no comments.
function visibleText(src) {
  return src.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ');
}

test('there are cards, and each is named like a page the site can serve', () => {
  assert.ok(CARDS.length >= 72, `expected the D03 to D14 cards, found ${CARDS.length}`);
  for (const f of CARDS) assert.match(f, /^d\d\d(?:-\d\d)?-[a-z0-9-]+\.html$/, f);
});

test('every card has the same content policy as the app, and it names no outside host', () => {
  const app = csp(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  assert.ok(app, 'the app page has a content policy');
  for (const f of CARDS) {
    assert.equal(csp(html[f]), app, f);
    assert.doesNotMatch(csp(html[f]), /https?:|\*/, f);
  }
});

test('every card has a title ending "· TRI Momentum", one h1, and a description', () => {
  for (const f of CARDS) {
    assert.match(html[f], /<title>[^<]+ · TRI Momentum<\/title>/, f);
    assert.equal((html[f].match(/<h1[ >]/g) || []).length, 1, `${f}: one h1`);
    assert.match(html[f], /<meta name="description" content="[^"]+"/, f);
    assert.doesNotMatch(visibleText(html[f]), /Race-day tools/, f);
  }
});

test('every card loads the one shared stylesheet, at the same ?v=, and nothing else', () => {
  const versions = new Set();
  for (const f of CARDS) {
    const links = [...html[f].matchAll(/<link [^>]*>/g)].map((m) => m[0]);
    assert.equal(links.length, 1, `${f}: one <link>`);
    const m = /href="\.\.\/css\/truisms\.css\?v=(\d+)"/.exec(links[0]);
    assert.ok(m, `${f}: loads ../css/truisms.css?v=N`);
    versions.add(m[1]);
    assert.doesNotMatch(html[f], /<script|<style|<img|<iframe|<form|<a [^>]*href|\sstyle=|\son[a-z]+=/i, `${f}: no script, style, image, frame, form, link or handler`);
    assert.doesNotMatch(html[f].replace(/<!--[\s\S]*?-->/g, ''), /https?:/, `${f}: names no outside host`);
  }
  assert.equal(versions.size, 1, `one ?v= on every card: ${[...versions]}`);
  assert.ok(fs.existsSync(path.join(ROOT, 'css', 'truisms.css')));
});

test('every card is one truism and two stat cards, with their words', () => {
  for (const f of CARDS) {
    const src = html[f];
    assert.equal((src.match(/class="headline"/g) || []).length, 1, `${f}: one headline`);
    assert.equal((src.match(/class="subtext"/g) || []).length, 1, `${f}: one subtext`);
    assert.equal((src.match(/class="pill-card pill-(?:lime|lavender)"/g) || []).length, 2, `${f}: two stat cards`);
    for (const part of ['pill-label', 'pill-detail', 'pill-value']) {
      const found = [...src.matchAll(new RegExp(`class="${part}">([^<]*)<`, 'g'))].map((m) => m[1].trim());
      assert.equal(found.length, 2, `${f}: two ${part}`);
      assert.ok(found.every(Boolean), `${f}: no blank ${part}`);
    }
    assert.match(src, /<div class="brand-row" role="img" aria-label="TRI Momentum">/, `${f}: the wordmark is one image to a screen reader`);
  }
});

test('truisms.css names no outside host, and every file it loads is shipped', () => {
  assert.doesNotMatch(css, /https?:|@import/);
  const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/['"]/g, ''));
  assert.ok(urls.length >= 2, 'Outfit, in two subsets');
  for (const u of urls) {
    assert.match(u, /^\.\.\/fonts\/outfit-[a-z-]+\.woff2$/, u);
    assert.ok(fs.existsSync(path.join(ROOT, 'fonts', path.basename(u))), `${u} is missing`);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'fonts', 'LICENSE.txt')));
});

test('truisms.css has no print rule, and sizes its type with clamp(), never below a size a phone can read', () => {
  assert.doesNotMatch(css, /@media[^{]*print/, 'criterion 14: no print stylesheet');
  const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(sizes.length >= 8);
  for (const s of sizes) {
    const m = /^clamp\((\d+(?:\.\d+)?)px,/.exec(s);
    assert.ok(m, `font-size is a clamp(): ${s}`);
    assert.ok(Number(m[1]) >= 14, `the smallest size is at least 14px: ${s}`);
  }
});

test('the index lists every card once, each link goes to a card that exists, and it names no outside host', () => {
  const links = [...INDEX.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]).filter((href) => !href.startsWith('..'));
  assert.deepEqual([...links].sort(), CARDS, 'the index links to every card, once, and to nothing else');
  for (const href of links) assert.ok(fs.existsSync(path.join(DIR, href)), `${href} is missing`);
  assert.doesNotMatch(INDEX.replace(/<!--[\s\S]*?-->/g, ''), /https?:/);
  assert.doesNotMatch(INDEX, /<script|<img|<iframe|<form|\sstyle=|\son[a-z]+=/i);
});

test('the index is a page of the app: the app\'s content policy, stylesheet version and wordmark, and a title ending "· TRI Momentum"', () => {
  const app = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.equal(csp(INDEX), csp(app));
  assert.match(INDEX, /<title>Truisms · TRI Momentum<\/title>/);
  assert.equal((INDEX.match(/<h1[ >]/g) || []).length, 1);
  assert.equal(/css\/app\.css\?v=(\d+)"/.exec(INDEX)?.[1], /css\/app\.css\?v=(\d+)"/.exec(app)[1], 'the same app.css ?v= as the app');
  assert.match(INDEX, /<span class="tri" aria-hidden="true"><b>T<\/b><b>R<\/b><b>I<\/b><\/span><span class="word">Momentum<\/span>/);
  assert.doesNotMatch(visibleText(INDEX), /Race-day tools/);
});
