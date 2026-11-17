/*
 * The race card as a PDF (RD-039). No DOM here, so Node can load it and the tests can run it.
 *
 *   sheet(input)     the card as a plain model: the race name and date, the finish range, the swim, bike and run
 *                    targets, nutrition per leg, gel times with their km, and the notes. No drawing, no DOM.
 *   drawPdf(JsPDF)   one A4 page of built-in Helvetica from that model: a black-bordered strip to cut out and stick
 *                    to the top tube, with a "How to use" column beside it. The jsPDF constructor is passed in, so
 *                    this file does not care whether it came from the browser or from Node.
 *   normaliseEmail   the address rules. functions/api/send.js holds the same rules; tests/email-cases.js drives both.
 *
 * It reads the saved plan and does no new maths: every number in the model is one the race card shows. A blank,
 * unreadable or zero value gives no row, or the time alone, never "NaN" or "0". Product names are never put on the
 * sheet. The race name is the one thing a person typed that reaches the PDF (owner decision, 17 Nov 2026): it is
 * cut to the characters Helvetica can draw, set in capitals and kept short. The capitals matter: send.js refuses a
 * PDF text string that holds the lower-case words "stream" or "obj", and a name such as "Mainstream Sprint" would
 * otherwise stop the card sending. tests/card.test.js pins both.
 *
 * The small formatters below (range, hm, pace, kmOf) copy the ones in app.js on purpose, so Node can load this file
 * with no DOM. tests/card.test.js holds what they return.
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
  var NAME_MAX = 40; // characters of the race name that reach the sheet
  var DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

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
  function gelChips(f, leg) {
    var L = f[leg];
    if (!(L.gels > 0)) return [];
    return gelTimes(L).map(function (t) { return { t: T.fmtHM(t), km: kmOf(f, leg, t) }; });
  }
  function showsKm(chips) { return chips.some(function (c) { return !!c.km; }); }

  // The printable characters of built-in Helvetica (WinAnsi) that the card uses: ASCII, the en dash and the middle dot.
  // Anything else is dropped, so a damaged save can never put a character in the PDF that the font cannot draw.
  function winAnsi(text) { return text.replace(/[^\x20-\x7e–·]/g, '').replace(/\s+/g, ' ').trim(); }

  // The race name as it appears on the sheet: drawable characters only, capitals, at most NAME_MAX characters. A blank
  // name is "MY RACE", as on step 1. Capitals keep it clear of send.js's lower-case "stream" and "obj" check.
  function sheetName(name) {
    var s = winAnsi(typeof name === 'string' ? name : '').toUpperCase().slice(0, NAME_MAX).trim();
    return s || 'MY RACE';
  }

  // "MON 16 NOV", from the saved yyyy-mm-dd, read as a calendar day with no time zone. '' when it does not read.
  function sheetDate(iso) {
    var d = T.addDays(typeof iso === 'string' ? iso : '', 0);
    return d ? DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] : '';
  }

  // input: { race, pace, fuel, fuelStale } as saved, plus the out-of-date flag the app already works out.
  function sheet(input) {
    var c = input || {};
    var race = isObj(c.race) ? c.race : {};
    var p = isObj(c.pace) ? c.pace : null;
    var f = isObj(c.fuel) && c.fuel.ok !== false && isObj(c.fuel.bike) && isObj(c.fuel.run) ? c.fuel : null;

    var label = DIST_LABEL[race.distance] || DIST_LABEL[p && p.distance] || DIST_LABEL[f && f.distance] || '';
    var date = sheetDate(race.date);
    var out = {
      name: sheetName(race.name),
      sub: winAnsi([date, label.toUpperCase()].filter(Boolean).join(' · ')),
      finish: p && pair(p.finish) ? hm(p.finish) : '',
      swim: null,
      bike: null,
      run: null,
      stale: !!f && c.fuelStale === true,
      kmNote: false
    };

    var swimValue = p && isObj(p.swim) && pair(p.swim.pace) ? pace(p.swim.pace) : '';
    var swimGel = f && isNum(f.preRaceMin) && f.preRaceMin > 0 ? 'About ' + f.preRaceMin + ' min before the start (optional)' : '';
    if (swimValue || swimGel) out.swim = { value: swimValue, unit: swimValue ? '/100 m' : '', gel: swimGel };

    var bikeValue = '';
    var bikeUnit = '';
    if (p && isObj(p.bike)) {
      if (pair(p.bike.watts)) { bikeValue = range(p.bike.watts[0], p.bike.watts[1]); bikeUnit = 'watts'; }
      else if (pair(p.bike.hr)) { bikeValue = range(p.bike.hr[0], p.bike.hr[1]); bikeUnit = 'bpm'; }
      else if (typeof p.bike.effort === 'string' && p.bike.effort) bikeValue = winAnsi(p.bike.effort.split(':')[0]);
    }
    var runValue = p && isObj(p.run) && pair(p.run.pace) ? pace(p.run.pace) : '';

    if (bikeValue || f) {
      var B = f && f.bike;
      var bc = f ? gelChips(f, 'bike') : [];
      out.bike = {
        value: bikeValue, unit: bikeUnit,
        carbs: B && isNum(B.carbsPerHour) ? B.carbsPerHour + ' g/hr' : '',
        note: B && isNum(B.sipMl) ? 'Sip ~' + B.sipMl + ' ml every 15 min' : '',
        gels: bc
      };
      if (showsKm(bc)) out.kmNote = true;
    }
    if (runValue || f) {
      var R = f && f.run;
      var rc = f ? gelChips(f, 'run') : [];
      out.run = {
        value: runValue, unit: runValue ? 'per km' : '',
        carbs: R && isNum(R.carbsPerHour) ? R.carbsPerHour + ' g/hr' : '',
        note: f ? 'Water at each aid station' : '',
        gels: rc
      };
      if (showsKm(rc)) out.kmNote = true;
    }
    return out;
  }

  // The lines under "How to use", in order. Fixed words, plus the out-of-date line when it applies.
  function notes(s) {
    var n = [];
    if (s.stale) n.push({ bold: true, text: STALE });
    n.push({ bold: false, text: 'Times are from the start of each leg.' });
    if (s.kmNote) n.push({ bold: false, text: P.KM_NOTE });
    n.push({ bold: false, text: 'Typical ranges, not medical advice.' });
    return n;
  }

  // ---------- the PDF ----------

  // The design is 794 px wide for 210 mm, so one design px is 25.4 / 96 mm and one px of type is 0.75 pt.
  var PX = 25.4 / 96;
  var PT = 25.4 / 72; // one point in mm
  var PAGE = { w: 210, h: 297, pad: 48 * PX };
  var STRIP = { w: 200 * PX, border: 3 * PX, padX: 12 * PX };
  var HOW = { w: 220 * PX, gap: 32 * PX };

  // One A4 page, built-in Helvetica, no image, no embedded font, no compression (the send function reads the bytes).
  // putOnlyUsedFonts keeps the file to the two Helvetica faces it draws with: jsPDF would otherwise list all 14 standard fonts.
  // Only rectangles, lines and text, so the PDF needs no name that send.js does not already allow. If the strip would run
  // past the page it is drawn a little smaller, never onto a second page.
  function drawPdf(JsPDF, s) {
    var doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: false, putOnlyUsedFonts: true });
    doc.setProperties({ title: TITLE });
    doc.setCreationDate(CREATION_DATE);
    doc.setTextColor(0);
    doc.setDrawColor(0);
    doc.setFillColor(0);

    var X0 = PAGE.pad;
    var Y0 = PAGE.pad;
    var BW = STRIP.border;
    var LEFT = X0 + BW + STRIP.padX;
    var TW = STRIP.w - 2 * BW - 2 * STRIP.padX; // text width inside the strip
    var room = PAGE.h - 2 * PAGE.pad;

    function setFont(bold, pt) { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(pt); }
    function width(text, bold, pt, cs) { setFont(bold, pt); return doc.getTextWidth(text) + (cs || 0) * text.length; }

    // Lays the strip out at one scale and draws it when draw is true. Returns the strip's height in mm. The same
    // code measures and draws, so the border always fits what is inside it.
    function paint(scale, draw) {
      var y = Y0 + BW;
      function put(text, x, base, bold, pt, cs) {
        if (!draw) return;
        setFont(bold, pt);
        if (cs) doc.text(text, x, base, { charSpace: cs }); else doc.text(text, x, base);
      }
      function lineH(pt, f) { return pt * PT * (f || 1.2); }
      // One line of text at the cursor, left edge dx in from the strip text edge.
      function line(text, bold, pt, o) {
        o = o || {};
        var lh = lineH(pt, o.lh);
        put(text, LEFT + (o.dx || 0), y + (lh - pt * PT) / 2 + pt * PT * 0.78, bold, pt, o.cs);
        y += lh;
      }
      // Text that wraps at spaces, never in the middle of a word, drawn smaller until it fits or reaches the floor.
      function block(text, bold, px, o) {
        o = o || {};
        var pt = px * 0.75 * scale;
        setFont(bold, pt);
        doc.splitTextToSize(text, TW).forEach(function (l) { line(l, bold, pt, o); });
      }
      // One line shrunk to fit the strip, never below the floor.
      function fit(text, bold, px, floorPx, o) {
        var pt = px * 0.75 * scale;
        var floor = floorPx * 0.75 * scale;
        while (pt > floor && width(text, bold, pt) > TW) pt -= 0.25;
        if (width(text, bold, pt) > TW) block(text, bold, floorPx, o); else line(text, bold, pt, o);
      }
      function pad(px) { y += px * PX * scale; }
      function rule() { if (draw) doc.rect(X0, y, STRIP.w, BW, 'F'); y += BW; }
      // The black leg label: white letters, spaced out, on a black box.
      function tag(text) {
        var pt = 13 * 0.75 * scale;
        var cs = 1.5 * PX;
        var boxW = width(text, true, pt, cs) - cs + 2 * 9 * PX;
        var lh = lineH(pt, 1.15) + 2 * PX;
        if (draw) {
          doc.rect(LEFT, y, boxW, lh, 'F');
          doc.setTextColor(255);
          put(text, LEFT + 9 * PX, y + (lh - pt * PT) / 2 + pt * PT * 0.78, true, pt, cs);
          doc.setTextColor(0);
        }
        y += lh + 4 * PX * scale;
      }
      function spaced(text) { line(text, true, 12 * 0.75 * scale, { cs: PX, lh: 1.15 }); }
      // The big figure with its unit on the same line when both fit, else the unit goes underneath.
      function value(text, unit, px) {
        var pt = px * 0.75 * scale;
        var floor = 12 * scale;
        var uPt = 14 * 0.75 * scale;
        var uW = unit ? width(unit, true, uPt) + 6 * PX : 0;
        while (pt > floor && width(text, true, pt) + uW > TW) pt -= 0.25;
        if (width(text, true, pt) + uW <= TW) {
          var lh = lineH(pt, 1.05);
          var base = y + (lh - pt * PT) / 2 + pt * PT * 0.78;
          put(text, LEFT, base, true, pt);
          if (unit) put(unit, LEFT + width(text, true, pt) + 6 * PX, base, true, uPt);
          y += lh;
        } else {
          block(text, true, 16, { lh: 1.1 });
          if (unit) block(unit, true, 14);
        }
      }
      // The design's "GEL" box with a short line beside it, for the optional gel before the swim.
      function gelNote(text) {
        var pt = 16 * 0.75 * scale;
        var lw = 2 * PX;
        var cw = width('GEL', true, pt) + 2 * 6 * PX + 2 * lw;
        var ch = lineH(pt, 1.05) + 2 * PX + 2 * lw;
        var tpt = 14 * 0.75 * scale;
        setFont(true, tpt);
        var ls = doc.splitTextToSize(text, TW - cw - 8 * PX);
        var th = ls.length * lineH(tpt, 1.2);
        var h = Math.max(ch, th);
        if (draw) {
          var cy = y + (h - ch) / 2;
          doc.setLineWidth(lw);
          doc.rect(LEFT + lw / 2, cy + lw / 2, cw - lw, ch - lw, 'S');
          put('GEL', LEFT + lw + 6 * PX, cy + lw + PX + (lineH(pt, 1.05) - pt * PT) / 2 + pt * PT * 0.78, true, pt);
          ls.forEach(function (l, i) {
            var lh = lineH(tpt, 1.2);
            put(l, LEFT + cw + 8 * PX, y + (h - th) / 2 + i * lh + (lh - tpt * PT) / 2 + tpt * PT * 0.78, true, tpt);
          });
        }
        y += h;
      }
      // Gel times in boxes, wrapping onto new rows. Each box holds the time and, under it, about how far into the leg.
      function chips(list) {
        var tPt = 19 * 0.75 * scale;
        var kPt = 8 * scale;
        var padX = 7 * PX;
        var padY = 2 * PX * scale;
        var lw = 2 * PX;
        var gap = 8 * PX * scale;
        var anyKm = showsKm(list);
        var h = 2 * lw + 2 * padY + lineH(tPt, 1.05) + (anyKm ? lineH(kPt, 1.1) : 0);
        var rowX = 0;
        var top = y;
        list.forEach(function (c) {
          var cw = Math.max(width(c.t, true, tPt), c.km ? width(c.km, true, kPt) : 0) + 2 * padX + 2 * lw;
          if (rowX > 0 && rowX + cw > TW) { rowX = 0; top += h + gap; }
          if (draw) {
            doc.setLineWidth(lw);
            doc.rect(LEFT + rowX + lw / 2, top + lw / 2, cw - lw, h - lw, 'S');
            var tx = LEFT + rowX + (cw - width(c.t, true, tPt)) / 2;
            var ty = top + lw + padY + (lineH(tPt, 1.05) - tPt * PT) / 2 + tPt * PT * 0.78;
            put(c.t, tx, ty, true, tPt);
            if (c.km) put(c.km, LEFT + rowX + (cw - width(c.km, true, kPt)) / 2, ty + kPt * PT * 1.25, true, kPt);
          }
          rowX += cw + gap;
        });
        y = top + h;
      }

      // Header: race name, date and distance, then the finish range.
      pad(14);
      fit(s.name, true, 22, 11, { lh: 1.1 });
      if (s.sub) fit(s.sub, true, 14, 9);
      if (s.finish) {
        pad(8);
        spaced('FINISH');
        fit(s.finish, true, 28, 14, { lh: 1.05 });
      }
      pad(14);

      var legs = [['SWIM', s.swim, 34], ['BIKE', s.bike, 30], ['RUN', s.run, 30]].filter(function (l) { return !!l[1]; });
      legs.forEach(function (l) {
        var leg = l[1];
        rule();
        pad(10);
        tag(l[0]);
        if (leg.value) value(leg.value, leg.unit, l[2]);
        if (leg.carbs) line(leg.carbs, true, 16 * 0.75 * scale, { lh: 1.25 });
        if (leg.note) block(leg.note, true, 12);
        if (leg.gel) {
          pad(3);
          gelNote(leg.gel);
        }
        if (leg.gels && leg.gels.length) {
          pad(3);
          spaced('GEL AT');
          pad(2);
          chips(leg.gels);
        }
        pad(10);
      });

      // Footer.
      rule();
      pad(10);
      fit('made by TRI Momentum', true, 12, 9, { lh: 1.3 });
      fit('get yours at TRImomentum.com', true, 12, 9, { lh: 1.3 });
      pad(10);
      y += BW;
      return y - Y0;
    }

    var scale = 1;
    var height = paint(scale, false);
    while (height > room && scale > 0.5) { scale = Math.round((scale - 0.05) * 100) / 100; height = paint(scale, false); }

    // The border, then the strip inside it.
    doc.setLineWidth(BW);
    doc.rect(X0 + BW / 2, Y0 + BW / 2, STRIP.w - BW, height - BW, 'S');
    paint(scale, true);

    // "How to use", beside the strip, with the notes the card has always carried under it.
    var hx = X0 + STRIP.w + HOW.gap;
    var hy = Y0 + 4 * PX;
    function how(text, bold, px, after) {
      var pt = px * 0.75;
      setFont(bold, pt);
      doc.splitTextToSize(text, HOW.w).forEach(function (l) {
        var lh = pt * PT * 1.5;
        doc.text(l, hx, hy + (lh - pt * PT) / 2 + pt * PT * 0.78);
        hy += lh;
      });
      hy += after * PX;
    }
    how('How to use', true, 16, 8);
    how('Print at 100%. Choose actual size, not fit to page.', false, 14, 8);
    how('Cut along the black border. Stick the strip to your top tube.', false, 14, 20);
    notes(s).forEach(function (n) { how(n.text, n.bold, 12, 6); });

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

  var api = { canEmailHere: canEmailHere, CREATION_DATE: CREATION_DATE, sheet: sheet, notes: notes, drawPdf: drawPdf, toBase64: toBase64, normaliseEmail: normaliseEmail, TITLE: TITLE, FILE_NAME: FILE_NAME, STALE: STALE, NAME_MAX: NAME_MAX };
  if (isNode) module.exports = api;
  else { root.RD = root.RD || {}; root.RD.card = api; }
})(this);
