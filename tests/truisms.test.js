const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The truism cards (public/truisms/): static pages that share one stylesheet and make no request of their own.
const ROOT = path.join(__dirname, '..', 'public');
const DIR = path.join(ROOT, 'truisms');
const CARDS = fs.readdirSync(DIR).filter((f) => f.endsWith('.html') && f !== 'index.html').sort();
const INDEX = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const RESEARCH = fs.readFileSync(path.join(DIR, 'research', 'index.html'), 'utf8');
const html = Object.fromEntries(CARDS.map((f) => [f, fs.readFileSync(path.join(DIR, f), 'utf8')]));
const css = fs.readFileSync(path.join(ROOT, 'css', 'truisms.css'), 'utf8');
const csp = (src) => /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(src)?.[1];

// The visible words of a page: no tags, no scripts or styles, no comments.
function visibleText(src) {
  return src.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ');
}

test('there are cards, and each is named like a page the site can serve', () => {
  assert.ok(CARDS.length >= 84, `expected the D01 to D14 cards, found ${CARDS.length}`);
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

test('every card is one truism and two to five stat cards, with their words', () => {
  for (const f of CARDS) {
    const src = html[f];
    assert.equal((src.match(/class="headline"/g) || []).length, 1, `${f}: one headline`);
    assert.equal((src.match(/class="subtext"/g) || []).length, 1, `${f}: one subtext`);
    const n = (src.match(/class="pill-card pill-(?:lime|lavender)"/g) || []).length;
    assert.ok(n >= 2 && n <= 5, `${f}: two to five stat cards, found ${n}`);
    // Three or more cards, as the D01 and D02 cards have, take the smaller size so the card stays near a square.
    assert.equal(/class="diagram-wrap dense"/.test(src), n >= 3, `${f}: dense only with three or more stat cards`);
    for (const part of ['pill-label', 'pill-value']) {
      const found = [...src.matchAll(new RegExp(`class="${part}">([^<]*)<`, 'g'))].map((m) => m[1].trim());
      assert.equal(found.length, n, `${f}: a ${part} on every stat card`);
      assert.ok(found.every(Boolean), `${f}: no blank ${part}`);
    }
    // The sentence under a label is optional: the "Sharp taper" tile of the owner's design has none.
    const details = [...src.matchAll(/class="pill-detail">([^<]*)</g)].map((m) => m[1].trim());
    assert.ok(details.length <= n && details.every(Boolean), `${f}: no blank pill-detail`);
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

// Links on the index that are not cards: the page switch and the research notes (19 Nov 2026).
const OTHER_LINKS = ['index.html', 'research/index.html'];
const cardLinks = (src) => [...src.matchAll(/<a (?:class="[^"]*" )?href="([^"]+)"/g)].map((m) => m[1]).filter((href) => /^d\d\d(?:-\d\d)?-[a-z0-9-]+\.html$/.test(href));

test('the index lists every card once, each link goes to a card that exists, and it names no outside host', () => {
  const links = cardLinks(INDEX);
  assert.deepEqual([...links].sort(), CARDS, 'the index links to every card, once');
  for (const href of links) assert.ok(fs.existsSync(path.join(DIR, href)), `${href} is missing`);
  // Every other link goes to the page switch, the app, or the research notes (an anchor on a note that exists).
  const others = [...INDEX.matchAll(/<a (?:class="[^"]*" )?href="([^"]+)"/g)].map((m) => m[1]).filter((href) => !links.includes(href));
  for (const href of others) {
    assert.ok(href === '../index.html' || OTHER_LINKS.includes(href) || /^research\/index\.html#D\d\d\.\d$/.test(href), `unexpected link ${href}`);
  }
  assert.doesNotMatch(INDEX.replace(/<!--[\s\S]*?-->/g, ''), /https?:/);
  assert.doesNotMatch(INDEX, /<img|<iframe|<form|\sstyle=|\son[a-z]+=/i);
  // One script, the filter, from the app's own address, and nothing inline.
  assert.deepEqual([...INDEX.matchAll(/<script[^>]*>/g)].map((m) => m[0]), ['<script src="../js/truism-filter.js?v=1" defer>']);
  assert.doesNotMatch(INDEX, /<script>[\s\S]*?\S[\s\S]*?<\/script>/);
});

test('the grid: every topic, D01 to D14, is tiles, one per card, each linking to its card, and the tile shows the card\'s own headline (18 Nov 2026)', () => {
  const grid = [...INDEX.matchAll(/<section class="truism-grid" aria-label="(D\d\d)[^"]*">([\s\S]*?)<\/section>/g)];
  assert.deepEqual(grid.map((m) => m[1]), Array.from({ length: 14 }, (_, i) => 'D' + String(i + 1).padStart(2, '0')), 'the grid holds D01 to D14, in order');
  for (const [, d, body] of grid) {
    const tiles = [...body.matchAll(/<li data-item data-topic="(D\d\d)" data-status="(notes|none)" data-search="[^"]*"><a class="tile" href="([^"]+)"><span class="tile-label">([^<]+)<\/span><span class="tile-headline">([^<]+)<\/span><span class="tile-go" aria-hidden="true">View card →<\/span><\/a>(?:<a class="tile-research" href="research\/index\.html#(D\d\d\.\d)">Research notes<span class="sr-only"> for D\d\d\.\d<\/span> →<\/a>)?<\/li>/g)];
    const cards = CARDS.filter((f) => f.startsWith(d.toLowerCase() + '-'));
    assert.ok(cards.length >= 5, `${d}: an overview and its cards`);
    assert.deepEqual(tiles.map((t) => t[3]).sort(), cards, `${d}: one tile for every card`);
    assert.equal((body.match(/<li /g) || []).length, tiles.length, `${d}: every list item is a tile`);
    for (const [whole, topic, status, href, label, headline, notes] of tiles) {
      assert.equal(topic, d, `${href}: filed under its topic`);
      assert.equal(headline, /<h1 class="headline">([^<]*)<\/h1>/.exec(html[href])[1], `${href}: the tile shows the card's headline`);
      assert.match(label, new RegExp('^' + d + '(\\.\\d| · Overview)$'), `${href}: label ${label}`);
      assert.equal(status === 'notes', Boolean(notes), `${href}: a research link exactly when it has notes`);
      if (notes) assert.equal(notes, label, `${href}: the research link names this truism`);
    }
  }
});

test('the grid has its own stylesheet, with no media rule, no print rule and the owner\'s colours, and app.css does not hold them', () => {
  const grid = fs.readFileSync(path.join(ROOT, 'css', 'truism-grid.css'), 'utf8');
  assert.match(INDEX, /<link rel="stylesheet" href="\.\.\/css\/truism-grid\.css\?v=\d+" \/>/);
  assert.equal((INDEX.match(/<link /g) || []).length, 2, 'the index loads app.css and the grid, nothing else');
  assert.doesNotMatch(grid, /@media|@import|url\(/);
  assert.match(grid, /#0b23ef/);
  const fontSizes = [...grid.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(fontSizes.length && fontSizes.every((n) => n >= 14), 'type is 14px or more');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8'), /truism-grid|\.tile\b/);
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

// ---------------------------------------------------------------------------------------------------------------
// The research notes (19 Nov 2026): public/truisms/research/index.html, and the way the two pages and the app link.
const RSRC = path.join(DIR, 'research');
const NOTES = [...RESEARCH.matchAll(/<article class="rcard" id="(D\d\d\.\d)" aria-labelledby="h-D\d\d\.\d">([\s\S]*?)<\/article>/g)].map((m) => ({ id: m[1], body: m[2] }));
const notesLinkedFromIndex = [...INDEX.matchAll(/href="research\/index\.html#(D\d\d\.\d)"/g)].map((m) => m[1]);

test('the research page is a page of the app: same content policy, stylesheet version, wordmark and title, and no outside host', () => {
  const app = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.equal(csp(RESEARCH), csp(app));
  assert.doesNotMatch(csp(RESEARCH), /https?:|\*/);
  assert.match(RESEARCH, /<title>Research notes · TRI Momentum<\/title>/);
  assert.equal((RESEARCH.match(/<h1[ >]/g) || []).length, 1);
  assert.equal(/css\/app\.css\?v=(\d+)"/.exec(RESEARCH)?.[1], /css\/app\.css\?v=(\d+)"/.exec(app)[1], 'the same app.css ?v= as the app');
  assert.match(RESEARCH, /<span class="tri" aria-hidden="true"><b>T<\/b><b>R<\/b><b>I<\/b><\/span><span class="word">Momentum<\/span>/);
  assert.deepEqual([...RESEARCH.matchAll(/<link [^>]*>/g)].map((m) => /href="([^"]+)"/.exec(m[0])[1].replace(/\?v=\d+$/, '')), ['../../css/app.css', '../../css/truism-grid.css', '../../css/truism-research.css']);
  assert.deepEqual([...RESEARCH.matchAll(/<script[^>]*>/g)].map((m) => m[0]), ['<script src="../../js/truism-filter.js?v=1" defer>']);
  assert.doesNotMatch(RESEARCH, /<img|<iframe|<form|\sstyle=|\son[a-z]+=/i);
  assert.doesNotMatch(visibleText(RESEARCH), /Race-day tools/);
  for (const f of ['css/truism-grid.css', 'css/truism-research.css', 'js/truism-filter.js']) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
});

test('every research note is for a card that exists, shows that card\'s headline, links to it, and is linked from its tile', () => {
  assert.ok(NOTES.length >= 16, `found ${NOTES.length} notes`);
  assert.deepEqual([...notesLinkedFromIndex].sort(), NOTES.map((n) => n.id).sort(), 'a tile links to exactly the notes that exist');
  assert.equal(new Set(NOTES.map((n) => n.id)).size, NOTES.length, 'one note for each truism');
  for (const n of NOTES) {
    const tile = new RegExp('<a class="tile" href="([^"]+)"><span class="tile-label">' + n.id.replace('.', '\\.') + '</span><span class="tile-headline">([^<]+)</span>').exec(INDEX);
    assert.ok(tile, `${n.id}: a tile on the index`);
    assert.match(n.body, new RegExp('<h2 id="h-' + n.id.replace('.', '\\.') + '">' + tile[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&#39;/g, "&#39;") + '</h2>'), `${n.id}: the card's own headline`);
    assert.ok(n.body.includes(`href="../${tile[1]}"`), `${n.id}: links to its card`);
    assert.ok(fs.existsSync(path.join(DIR, tile[1])), `${n.id}: the card exists`);
  }
});

test('every note says how far to trust its source: a status, a check, and a DOI link only where PubMed holds the paper', () => {
  const stats = { found: 0, closest: 0, notfound: 0 };
  for (const n of NOTES) {
    const status = /data-status="(found|closest|notfound)"/.exec(RESEARCH.slice(0, RESEARCH.indexOf(`id="${n.id}"`)).split('<li data-item').pop() + ' data-status=""') ;
    const label = /<span class="tag(?: warn)?">([^<]+)<\/span>/.exec(n.body)?.[1];
    assert.match(label, /^(Found in PubMed|Closest match in PubMed|Not found in PubMed)$/, `${n.id}: a source status`);
    stats[{ 'Found in PubMed': 'found', 'Closest match in PubMed': 'closest', 'Not found in PubMed': 'notfound' }[label]]++;
    assert.match(n.body, /<h3>Check before you rely on it<\/h3><p class="rcard-check">[^<]{20,}</, `${n.id}: a check`);
    const dois = [...n.body.matchAll(/href="(https:\/\/doi\.org\/[^"]+)" rel="noopener noreferrer"/g)];
    assert.equal(dois.length, label === 'Not found in PubMed' ? 0 : 1, `${n.id}: a DOI link only for a source PubMed holds`);
    assert.equal((n.body.match(/href="https?:/g) || []).length, dois.length, `${n.id}: no other outside link`);
  }
  // The counts on the page add up to the notes on the page.
  const stat = (name) => Number(new RegExp('<dt>' + name + '</dt><dd>(\\d+)</dd>').exec(RESEARCH)[1]);
  assert.equal(stat('Notes'), NOTES.length);
  assert.equal(stat('Source found'), stats.found);
  assert.equal(stat('Closest match'), stats.closest);
  assert.equal(stat('Source not found'), stats.notfound);
  assert.equal(stats.found + stats.closest + stats.notfound, NOTES.length);
});

test('no truisms page says the figures are checked, peer-reviewed or fully sourced: every figure is still UNCHECKED (README, Numbers to verify)', () => {
  for (const [name, src] of [['index', INDEX], ['research', RESEARCH]]) {
    assert.doesNotMatch(visibleText(src), /peer[- ]reviewed|fully sourced|84 ?\/ ?84|verified figures/i, name);
    assert.match(visibleText(src), /not yet been checked|every figure is still unchecked/i, `${name} says the figures are unchecked`);
  }
});

test('each truisms page links to the other, the page switch marks the page you are on, and both link home', () => {
  assert.match(INDEX, /<a href="index\.html" aria-current="page">All truisms<\/a>/);
  assert.match(INDEX, /<a href="research\/index\.html">Research notes<\/a>/);
  assert.match(RESEARCH, /<a href="\.\.\/index\.html">All truisms<\/a>/);
  assert.match(RESEARCH, /<a href="index\.html" aria-current="page">Research notes<\/a>/);
  assert.match(INDEX, /<a class="mark" href="\.\.\/index\.html"/);
  assert.match(RESEARCH, /<a class="mark" href="\.\.\/\.\.\/index\.html"/);
  for (const [, id] of RESEARCH.matchAll(/href="\.\.\/index\.html#(D\d\d)"/g)) assert.ok(INDEX.includes(`id="${id}"`), `${id}: the index has this topic`);
});

test('the footer of every app screen links to both truisms pages under a Truisms heading, apart from the guides', () => {
  const appJs = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  const hrefs = [...appJs.matchAll(/var TRUISM_LINKS = \[([\s\S]*?)\];/g)][0][1].match(/href: '([^']+)'/g).map((h) => /'([^']+)'/.exec(h)[1]);
  assert.deepEqual(hrefs, ['truisms/index.html', 'truisms/research/index.html']);
  for (const h of hrefs) assert.ok(fs.existsSync(path.join(ROOT, h)), `${h} is missing`);
  assert.match(appJs, /class: 'tlinks'[\s\S]*?h\('h3', null, 'Truisms'\)/);
  assert.match(appJs, /guideLinks\(\), truismLinks\(\)/);
  assert.doesNotMatch(appJs, /class: 'guides'[\s\S]{0,400}Truisms/, 'the guides section holds the guides only');
});

test('truism-research.css has no media, print or import rule, no outside file, type of 14px or more, and the card colours stay out of app.css', () => {
  const rcss = fs.readFileSync(path.join(ROOT, 'css', 'truism-research.css'), 'utf8');
  assert.doesNotMatch(rcss, /@media|@import|url\(|https?:/);
  assert.match(rcss, /#0b23ef/);
  const sizes = [...rcss.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length && sizes.every((n) => n >= 14), 'type is 14px or more');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8'), /rcard|truism-research/);
  const grid = fs.readFileSync(path.join(ROOT, 'css', 'truism-grid.css'), 'utf8');
  assert.doesNotMatch(grid, /@media|@import|url\(/);
  const gsizes = [...grid.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(gsizes.every((n) => n >= 14), 'grid type is 14px or more');
});

test('truism-filter.js: words all have to match, topic and status narrow it, a blank filter shows everything, and it builds no HTML', () => {
  const { matches, countText } = require(path.join(ROOT, 'js', 'truism-filter.js'));
  const item = { topic: 'D07', status: 'found', search: 'd07.2 mix your sugars. glucose fructose jentjens' };
  assert.equal(matches(item, { q: '', topic: 'all', status: 'all' }), true);
  assert.equal(matches(item, { q: 'JENTJENS fructose', topic: 'all', status: 'all' }), true);
  assert.equal(matches(item, { q: 'fructose taper', topic: 'all', status: 'all' }), false, 'every word must match');
  assert.equal(matches(item, { q: 'd07.2', topic: 'D07', status: 'found' }), true);
  assert.equal(matches(item, { q: '', topic: 'D08', status: 'all' }), false);
  assert.equal(matches(item, { q: '', topic: 'all', status: 'notfound' }), false);
  assert.equal(matches({ topic: 'D01', status: 'none' }, { q: '  ', topic: 'all', status: 'all' }), true, 'a missing search text and a blank query still match');
  assert.equal(countText(84, 84, 'cards'), 'Showing all 84 cards');
  assert.equal(countText(3, 84, 'cards'), 'Showing 3 of 84 cards');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'js', 'truism-filter.js'), 'utf8'), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|fetch\(|XMLHttpRequest|localStorage|sessionStorage/);
});
