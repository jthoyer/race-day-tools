/*
 * The race card as a PDF (RD-039). No DOM here, so Node can load it and the tests can run it.
 *
 *   rows(input)      the card as an ordered list of { kind, text } rows. Same words, same order as the print card
 *                    (buildPrint in app.js), without its race title and date lines.
 *   drawPdf(JsPDF)   one A4 page of built-in Helvetica from those rows. The jsPDF constructor is passed in, so this
 *                    file does not care whether it came from the browser or from Node.
 *   normaliseEmail   the address rules. functions/api/send.js holds the same rules; tests/email-cases.js drives both.
 *
 * It reads the saved plan and does no new maths: every number in a row is one the print card shows. A blank,
 * unreadable or zero value gives no row, or the time alone, never "NaN" or "0". Product names and the race name
 * are never put in a row, so nothing a person typed reaches the PDF.
 *
 * The small formatters below (range, hm, pace, kmOf) copy the ones in app.js on purpose: the print card was not
 * refactored for this change. The smoke test compares the print card's text with these rows, so a drift fails there.
 */
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var T = isNode ? require('./time.js') : root.RD.time;
  var P = isNode ? require('./pace.js') : root.RD.pace;

  var DIST_LABEL = { standard: 'Olympic', '70.3': '70.3' };
  var TITLE = 'TRI Momentum race card';
  var FILE_NAME = 'race-card.pdf';
  // A fixed creation date, so the PDF carries no date or time of today. jsPDF would write the moment it was drawn.
  var CREATION_DATE = 'D:20260101000000+00\'00\'';
  var STALE = 'Nutrition plan out of date. Update it before race day.';

  // A real, finite number. null >= 0 is true in JavaScript, so a plain comparison is not enough.
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function pair(r) { return Array.isArray(r) && r.length === 2 && isNum(r[0]) && isNum(r[1]); }

  function range(a, b, f) {
    var x = f ? f(a) : a;
    var y = f ? f(b) : b;
    return x === y ? String(x) : x + '–' + y;
  }
  function hm(r) { return range(r[0], r[1], T.fmtHM); }
  function pace(r) { return range(r[0], r[1], T.fmtPace); }

  // A gel time with about how far into the leg it is. '' when the leg time cannot be read (criterion 18).
  function kmOf(f, leg, t) {
    var k = P.kmAt(f.distance, leg, t, f[leg].minutes);
    return k == null ? '' : '~' + k + ' km';
  }
  function gelTimes(L) { return Array.isArray(L.gelTimes) ? L.gelTimes.filter(function (t) { return isNum(t) && t >= 0; }) : []; }
  function showsKm(f, leg) {
    var L = f[leg];
    return L.gels > 0 && gelTimes(L).some(function (t) { return !!kmOf(f, leg, t); });
  }

  // The printable characters of built-in Helvetica (WinAnsi) that the card uses: ASCII, the en dash and the middle dot.
  // Anything else is dropped, so a damaged save can never put a character in the PDF that the font cannot draw.
  function winAnsi(text) { return text.replace(/[^\x20-\x7e–·]/g, '').replace(/\s+/g, ' ').trim(); }

  // input: { race, pace, fuel, fuelStale } as saved, plus the out-of-date flag the app already works out.
  function rows(input) {
    var c = input || {};
    var race = isObj(c.race) ? c.race : {};
    var p = isObj(c.pace) ? c.pace : null;
    var f = isObj(c.fuel) && c.fuel.ok !== false && isObj(c.fuel.bike) && isObj(c.fuel.run) ? c.fuel : null;
    var out = [];
    function add(kind, text) { out.push({ kind: kind, text: text }); }

    var label = DIST_LABEL[race.distance] || DIST_LABEL[p && p.distance] || DIST_LABEL[f && f.distance] || '';
    add('title', TITLE + (label ? ' · ' + label : ''));

    if (p) {
      var pr = [];
      if (isObj(p.swim) && pair(p.swim.pace)) pr.push(['big', 'Swim ' + pace(p.swim.pace) + ' /100m']);
      if (isObj(p.bike)) {
        if (pair(p.bike.watts)) pr.push(['big', 'Bike ' + range(p.bike.watts[0], p.bike.watts[1]) + ' W']);
        else if (pair(p.bike.hr)) pr.push(['big', 'Bike ' + range(p.bike.hr[0], p.bike.hr[1]) + ' bpm']);
        else if (typeof p.bike.effort === 'string' && p.bike.effort) pr.push(['big', 'Bike ' + p.bike.effort.split(':')[0]]);
      }
      if (isObj(p.run) && pair(p.run.pace)) pr.push(['big', 'Run ' + pace(p.run.pace) + ' /km']);
      if (pair(p.finish)) pr.push(['line', 'Finish ' + hm(p.finish)]);
      if (pr.length) { add('heading', 'Pace'); pr.forEach(function (r) { add(r[0], r[1]); }); }
    }

    if (f) {
      if (c.fuelStale === true) add('line', STALE);
      var B = f.bike;
      var R = f.run;
      add('heading', 'Bike nutrition' + (isNum(B.carbsPerHour) ? ' · ' + B.carbsPerHour + ' g/hr' : ''));
      if (isNum(B.sipMl)) add('line', 'Sip ~' + B.sipMl + ' ml every 15 min');
      var bt = gelTimes(B);
      if (B.gels > 0 && bt.length) add('big', 'Gel ' + bt.map(T.fmtHM).join(' · '));
      if (showsKm(f, 'bike')) add('fine', 'at ' + bt.map(function (t) { return kmOf(f, 'bike', t) || '?'; }).join(' · '));
      add('heading', 'Run nutrition' + (isNum(R.carbsPerHour) ? ' · ' + R.carbsPerHour + ' g/hr' : ''));
      var rt = gelTimes(R);
      if (R.gels > 0 && rt.length) add('big', 'Gel ' + rt.map(T.fmtHM).join(' · '));
      if (showsKm(f, 'run')) add('fine', 'at ' + rt.map(function (t) { return kmOf(f, 'run', t) || '?'; }).join(' · '));
      add('line', 'Water at each aid station');
    }

    add('fine', 'Times are from the start of each leg. ' + (f && (showsKm(f, 'bike') || showsKm(f, 'run')) ? P.KM_NOTE + ' ' : '') + 'Typical ranges, not medical advice.');

    return out.map(function (r) { return { kind: r.kind, text: winAnsi(r.text) }; });
  }

  // ---------- the PDF ----------

  // Font size in points, space above and below in mm, bold, and a rule under it.
  var STYLE = {
    title: { size: 20, bold: true, before: 0, after: 5, rule: false },
    heading: { size: 12, bold: true, before: 7, after: 1.5, rule: true },
    line: { size: 12, bold: false, before: 0, after: 1.5, rule: false },
    big: { size: 18, bold: true, before: 0, after: 1.5, rule: false },
    fine: { size: 9.5, bold: false, before: 3, after: 1, rule: false }
  };
  var PT = 25.4 / 72; // one point in mm
  var PAGE = { w: 210, h: 297, margin: 20 };

  // One A4 page, built-in Helvetica, no image, no embedded font, no compression (the send function reads the bytes).
  // putOnlyUsedFonts keeps the file to the two Helvetica faces it draws with: jsPDF would otherwise list all 14 standard fonts.
  // If the rows would run past the page they are drawn a little smaller, never onto a second page.
  function drawPdf(JsPDF, list) {
    var doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: false, putOnlyUsedFonts: true });
    doc.setProperties({ title: TITLE });
    doc.setCreationDate(CREATION_DATE);
    var width = PAGE.w - 2 * PAGE.margin;
    var room = PAGE.h - 2 * PAGE.margin;

    function measure(scale) {
      var y = 0;
      var laid = list.map(function (r) {
        var s = STYLE[r.kind] || STYLE.line;
        var size = s.size * scale;
        doc.setFont('helvetica', s.bold ? 'bold' : 'normal');
        doc.setFontSize(size);
        var lines = doc.splitTextToSize(r.text, width);
        var lh = size * PT * 1.25;
        y += s.before * scale;
        var item = { style: s, size: size, lines: lines, lh: lh, top: y };
        y += lines.length * lh + s.after * scale;
        return item;
      });
      return { laid: laid, height: y };
    }

    var scale = 1;
    var m = measure(scale);
    while (m.height > room && scale > 0.5) { scale = Math.round((scale - 0.05) * 100) / 100; m = measure(scale); }

    doc.setTextColor(0);
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    m.laid.forEach(function (it) {
      doc.setFont('helvetica', it.style.bold ? 'bold' : 'normal');
      doc.setFontSize(it.size);
      it.lines.forEach(function (line, i) {
        doc.text(line, PAGE.margin, PAGE.margin + it.top + (i + 0.8) * it.lh);
      });
      if (it.style.rule) {
        var yr = PAGE.margin + it.top + it.lines.length * it.lh + 0.6;
        doc.line(PAGE.margin, yr, PAGE.margin + width, yr);
      }
    });
    return new Uint8Array(doc.output('arraybuffer'));
  }

  function toBase64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // ---------- the address ----------

  // Returns the trimmed address when it is one plain address, else null. One "@", no space, line break or NUL, no comma,
  // semicolon, angle bracket, quote or backslash, plain ASCII, a dot in the domain, 6 to 254 characters.
  function normaliseEmail(value) {
    if (typeof value !== 'string') return null;
    var s = value.trim();
    if (s.length < 6 || s.length > 254) return null;
    if (!/^[\x21-\x7e]+$/.test(s)) return null;
    if (/[,;<>"'`\\]/.test(s)) return null;
    var parts = s.split('@');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    var dom = parts[1];
    if (dom.indexOf('.') < 0 || dom.charAt(0) === '.' || dom.charAt(dom.length - 1) === '.' || dom.indexOf('..') >= 0) return null;
    return s;
  }

  // Where the send function exists. On GitHub Pages it does not, and the address would be posted to GitHub, so the email
  // block is not shown there. An unknown host (empty or missing) is treated the same way: no block, nothing posted.
  function canEmailHere(hostname) {
    if (typeof hostname !== 'string') return false;
    var h = hostname.trim().toLowerCase().replace(/\.$/, '');
    if (!h) return false;
    return h !== 'github.io' && !/\.github\.io$/.test(h);
  }

  var api = { canEmailHere: canEmailHere, CREATION_DATE: CREATION_DATE, rows: rows, drawPdf: drawPdf, toBase64: toBase64, normaliseEmail: normaliseEmail, TITLE: TITLE, FILE_NAME: FILE_NAME, STALE: STALE };
  if (isNode) module.exports = api;
  else { root.RD = root.RD || {}; root.RD.card = api; }
})(this);
