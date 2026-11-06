/*
 * Race-day tools: the app. One race plan, built step by step, written to one race card.
 * Screens follow the 2 Nov 2026 blueprint: set-up F1-F6, fuel step A2, race home A1, race card C1.
 * Everything is saved on this device as you go. No account, no server.
 */
(function (root) {
  'use strict';

  var RD = root.RD;
  var h = RD.ui.h;
  var T = RD.time;
  var store = RD.store;

  var S = store.load();
  var raw = {}; // what the person is typing, before it parses
  var errors = {}; // field -> message, shown after they press Next
  var currentPrint = null; // what the print button and Ctrl+P print
  var view = document.getElementById('view');

  function commit() { store.save(S); }

  // ---------- formatting ----------

  var DIST_LABEL = { standard: 'Standard', '70.3': '70.3' };
  var HEAT = [
    { value: 'mild', label: 'Mild', hint: 'Under 22°C' },
    { value: 'warm', label: 'Warm', hint: '22–28°C' },
    { value: 'hot', label: 'Hot', hint: 'Over 28°C' }
  ];
  var COURSE = [
    { value: 'flat', label: 'Flat', hint: 'Little climbing' },
    { value: 'rolling', label: 'Rolling', hint: 'Short climbs' },
    { value: 'hilly', label: 'Hilly', hint: 'Long climbs' }
  ];
  function legsText(d) {
    var l = RD.pace.LEGS[d];
    return l ? 'Swim ' + l.swim + ' km · Bike ' + l.bike + ' km · Run ' + l.run + ' km' : '';
  }
  function range(a, b, f) {
    var x = f ? f(a) : a;
    var y = f ? f(b) : b;
    return x === y ? String(x) : x + '–' + y;
  }
  function hm(r) { return range(r[0], r[1], T.fmtHM); }
  function pace(r) { return range(r[0], r[1], T.fmtPace); }
  function longDate(iso) {
    var d = T.addDays(iso, 0);
    return d ? d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  }
  function startText(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
    if (!m) return '';
    var hr = Number(m[1]);
    return (hr % 12 || 12) + ':' + m[2] + (hr < 12 ? 'am' : 'pm');
  }
  // "7:00am start", "Transition opens 6:00am". A time that is blank or unreadable is left out,
  // so a label never shows on its own with nothing after it. "00:00" is a real time: "12:00am".
  function timeParts(r) {
    var parts = [];
    var s = startText(r.start);
    if (s) parts.push(s + ' start');
    var o = startText(r.transitionOpens);
    if (o) parts.push('Transition opens ' + o);
    return parts;
  }
  function daysText(n) {
    if (n == null) return '';
    if (n > 1) return n + ' days to go';
    if (n === 1) return 'Tomorrow';
    if (n === 0) return 'Race day';
    return 'Race done';
  }
  // "Spring 70.3" stays as it is; "Lake Run" becomes "Lake Run · 70.3".
  function raceTitle(r) {
    var name = r.name || 'My race';
    var dist = DIST_LABEL[r.distance];
    if (!dist || name.toLowerCase().indexOf(dist.toLowerCase()) !== -1) return name;
    return name + ' · ' + dist;
  }
  function minutesList(times) { return times.map(T.fmtHM).join(' · '); }
  // RD-025. A gel time with about how far into the leg it is: "0:40 (~22 km)". The time comes first and is the rule;
  // the km is a guide from an even pace. A leg time that cannot be read gives the time alone.
  function kmOf(p, leg, t) { var k = RD.pace.kmAt(p.distance, leg, t, p[leg].minutes); return k == null ? '' : '~' + k + ' km'; }
  function gelTimesText(p, leg) {
    return p[leg].gelTimes.map(function (t) { var k = kmOf(p, leg, t); return T.fmtHM(t) + (k ? ' (' + k + ')' : ''); }).join(' · ');
  }
  // The km alone, in the same order as the times, for the 70 mm print card: "~22 km · ~64 km".
  function kmList(p, leg) { return p[leg].gelTimes.map(function (t) { return kmOf(p, leg, t) || '?'; }).join(' · '); }
  function showsKm(p, leg) { return p[leg].gels > 0 && p[leg].gelTimes.some(function (t) { return !!kmOf(p, leg, t); }); }
  // The same times as rows: each time on its own line, with its km beside it in a quieter style.
  function gelTimesNode(p, leg) {
    var kids = [];
    p[leg].gelTimes.forEach(function (t) {
      var k = kmOf(p, leg, t);
      kids.push(h('span', { class: 'gt' }, T.fmtHM(t), k ? h('span', { class: 'km' }, ' ' + k) : null));
    });
    return h('span', { class: 'gtimes' }, kids);
  }

  // The finish as a time of day, such as "11:51am–12:05pm": the start time plus the finish range shown, to the
  // minute. After midnight it says so. With no start time it gives '' and nothing is shown, never a made-up time.
  function finishClock(start, finish) {
    var lo = T.addMinutes(start, finish[0]);
    var hi = T.addMinutes(start, finish[1]);
    if (!lo || !hi) return '';
    var text = lo.time === hi.time && lo.days === hi.days ? startText(lo.time) : startText(lo.time) + '–' + startText(hi.time);
    return hi.days > 0 ? text + ', next day' : text;
  }
  // ---------- taper (RD-011, RD-031) ----------

  function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  // When the taper starts, from the race date and the taper length: the athlete's own, else our guide (pace.js).
  // null when there is no race date, so nothing is shown rather than a made-up date.
  function taperInfo(r) {
    if (!r || !r.date) return null;
    var days = T.daysUntil(r.date);
    var len = RD.pace.taperDays(r.distance, r.taperDays);
    var start = T.addDays(r.date, -len);
    if (days == null || !start) return null;
    var longDay = start.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
    var shortDay = start.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    var tDays = T.daysUntil(isoOf(start));
    return {
      days: days, len: len, own: len === r.taperDays, iso: isoOf(start),
      line: days < 0 ? 'This date has passed. Pick your next race.'
        : tDays > 0 ? 'Your taper starts ' + longDay + '.'
          : tDays === 0 ? 'Your taper starts today, ' + longDay + '.'
            : 'You are in your taper. It started ' + longDay + '.',
      // The short form for the race card band and the home screen. Nothing after race day.
      short: days < 0 ? '' : tDays > 0 ? 'Taper starts ' + shortDay : 'In your taper'
    };
  }

  // Shown where a finish exists but there is no start time to add it to.
  function finishClockHint() {
    return h('span', null, h('a', { href: '#/setup/1' }, 'Add a start time'), ' to see your finish time of day.');
  }

  // ---------- inputs bound to the store ----------

  function get(path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, S);
  }
  function set(path, v) {
    var keys = path.split('.');
    var o = S;
    for (var i = 0; i < keys.length - 1; i++) { if (o[keys[i]] == null) o[keys[i]] = {}; o = o[keys[i]]; }
    o[keys[keys.length - 1]] = v;
    commit();
  }

  // kind: 'num' | 'clock' (m:ss, stored as seconds) | 'hm' (h:mm, stored as minutes) | 'text'
  function bound(path, kind, opts) {
    var v = get(path);
    var shown = raw[path] != null ? raw[path]
      : v == null ? ''
        : kind === 'clock' ? T.fmtPace(v)
          : kind === 'hm' ? T.fmtHM(v)
            : String(v);
    return RD.ui.field({
      name: path.replace(/\./g, '-'),
      label: opts.label,
      unit: opts.unit,
      type: opts.type,
      inputmode: kind === 'num' ? 'decimal' : kind === 'text' ? null : 'numeric',
      placeholder: opts.placeholder,
      value: shown,
      disabled: opts.disabled,
      error: errors[path],
      oninput: function (e) {
        var text = e.target.value;
        // opts.validate(text) returns a message when the entry breaks a rule with another field.
        // The entry stays on screen with the message and is not saved, so a bad pair never reaches the card.
        var bad = opts.validate ? opts.validate(text) : '';
        if (bad) { raw[path] = text; errors[path] = bad; if (opts.live) opts.live(); return; }
        if (opts.validate) delete errors[path];
        // Times can be typed as digits ("130" is 1:30) or with a dot ("1.30"). See time.js, tidyTime.
        var parsed = kind === 'num' ? RD.ui.num(text)
          : kind === 'clock' ? T.parseClock(T.tidyTime(text))
            : kind === 'hm' ? T.parseHM(T.tidyTime(text))
              : text;
        if (kind !== 'text' && parsed == null && text.trim() !== '') raw[path] = text;
        else delete raw[path];
        // An error stays on screen until the next Next, so take it off as soon as what is typed reads.
        // A new one waits for the person to leave the field or press Next.
        if (kind !== 'text' && parsed != null && errors[path]) clearFieldError(e.target, path);
        set(path, kind !== 'text' && text.trim() === '' ? null : parsed);
        if (opts.live) opts.live();
      },
      // When the person leaves a time field, show the time we read, so a slip is easy to see.
      onchange: kind === 'clock' || kind === 'hm' ? function (e) {
        var p = kind === 'clock' ? T.parseClock(T.tidyTime(e.target.value)) : T.parseHM(T.tidyTime(e.target.value));
        if (p != null) e.target.value = kind === 'clock' ? T.fmtPace(p) : T.fmtHM(p);
      } : null
    });
  }

  // Take an error message off a field without redrawing the screen, so typing is not interrupted.
  function clearFieldError(input, path) {
    delete errors[path];
    var msg = document.getElementById(input.id + '-err');
    if (msg) msg.remove();
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  }

  // True when something typed in this field can't be read.
  function unreadable(path) { return raw[path] != null; }

  // ---------- chrome ----------

  function topBar(left, right) {
    return h('header', { class: 'top' }, left, right);
  }
  function brandLink() { return h('a', { class: 'brand', href: '#/' }, 'Race-day tools'); }
  function backLink(href, text) {
    return h('a', { class: 'back', href: href },
      svg('M15 5l-7 7 7 7'), text || 'Back');
  }
  // A stroke icon from one path, or several (an array).
  function svg(d, size) {
    var ns = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(ns, 'svg');
    var px = String(size || 18);
    s.setAttribute('width', px); s.setAttribute('height', px); s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    [].concat(d).forEach(function (one) { var p = document.createElementNS(ns, 'path'); p.setAttribute('d', one); s.appendChild(p); });
    return s;
  }

  // The floating step bar (RD-031): Race, Pacing, Fuel and Card, on every step of a race plan and on the race card.
  // Any step opens from any other, so a person can change one thing and go straight back to the card.
  // A step that is done has a green dot, and says so to a screen reader.
  var STEP_ICONS = {
    race: ['M5 21V4', 'M5 4h11l-2 4 2 4H5'],
    pacing: ['M20 13a8 8 0 1 1-16 0a8 8 0 1 1 16 0', 'M12 9v4l2 2', 'M10 2h4'],
    fuel: ['M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z'],
    card: ['M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M7 10h10', 'M7 14h6']
  };
  function stepBar(current) {
    var r = S.race;
    if (!r) return null;
    var steps = [
      { id: 'race', label: 'Race', href: '#/setup/1', done: !!r.date },
      { id: 'pacing', label: 'Pacing', href: r.pace ? '#/setup/5' : '#/setup/2', done: !!r.pace },
      { id: 'fuel', label: 'Fuel', href: '#/fuel', done: !!r.fuel },
      { id: 'card', label: 'Card', href: '#/card', done: false }
    ];
    return h('nav', { class: 'stepbar noprint', 'aria-label': 'Race plan steps' }, steps.map(function (s) {
      return h('a', { href: s.href, class: s.done ? 'done' : null, 'aria-current': s.id === current ? 'step' : null },
        svg(STEP_ICONS[s.id], 20), h('span', null, s.label), s.done ? h('span', { class: 'sr-only' }, ', done') : null);
    }));
  }
  function progress(n, of, label) {
    var segs = [];
    for (var i = 1; i <= of; i++) segs.push(h('span', { class: 'seg' + (i < n ? ' done' : i === n ? ' now' : '') }));
    return h('div', { class: 'progress' },
      h('p', { class: 'label' }, label || 'Set up · ' + n + ' of ' + of),
      h('div', { class: 'segs' + (of === 4 ? ' four' : ''), 'aria-hidden': 'true' }, segs));
  }
  function title(text, sub) {
    return h('div', null, h('h1', { tabindex: '-1' }, text), sub ? h('p', { class: 'sub' }, sub) : null);
  }
  function note(text) { return h('p', { class: 'foot' }, text); }

  // ---------- routing ----------

  var routes = {
    '': home,
    setup: setup,
    saved: saved,
    fuel: fuelStep,
    card: raceCard,
    products: products
  };

  function render() {
    var hash = (location.hash || '').replace(/^#\/?/, '');
    var parts = hash.split('/');
    var fn = routes[parts[0]] || home;
    currentPrint = null;
    if (!render.quiet) aboutShown = false;
    RD.ui.clear(view);
    var out = fn(parts.slice(1));
    view.appendChild(out);
    var h1 = view.querySelector('h1');
    if (h1 && !render.quiet) h1.focus();
    render.quiet = false;
  }
  // Re-render after a tap on the same screen without stealing focus from where the person is.
  function refresh() {
    var y = root.scrollY;
    var a = document.activeElement;
    var active = a && a.id;
    var caret = a && typeof a.selectionStart === 'number' && a.type === 'text' ? [a.selectionStart, a.selectionEnd] : null;
    render.quiet = true;
    render();
    if (active) {
      var el = document.getElementById(active);
      if (el) {
        el.focus();
        if (caret && el.type === 'text') el.setSelectionRange(caret[0], caret[1]);
      }
    }
    root.scrollTo(0, y);
  }
  function go(path) {
    errors = {};
    if (location.hash === '#/' + path) render();
    else location.hash = '#/' + path;
    root.scrollTo(0, 0);
  }

  // ---------- home (A1) ----------

  // A race with no name, date, pace or fuel is the same as no race: show the blank card.
  // (Opening step 1 and then pressing Cancel leaves such a race behind.)
  function isBlankRace(r) { return !r || (!r.name && !r.date && !r.pace && !r.fuel); }

  // The first screen for a new athlete (RD-033): what the app is for, in four steps, and two ways in.
  // The steps are plain text in the order the app takes you through them.
  var SPLASH_STEPS = ['Choose a race', 'Choose pacing', 'Review nutrition', 'Get your race card for your top tube'];

  function splash() {
    return h('section', { class: 'splash', 'aria-label': 'Welcome' },
      h('img', { class: 'splash-logo', src: 'img/tri-momentum-logo.png', alt: 'TRI Momentum' }),
      h('div', { class: 'splash-head' },
        h('h1', { tabindex: '-1' }, 'Race with a plan.'),
        h('p', null, 'Pace targets and a timed fuel plan for your triathlon, on one race card for your bike.')),
      h('ol', { class: 'splash-steps', role: 'list' }, SPLASH_STEPS.map(function (t, i) {
        return h('li', null, h('span', { class: 'n', 'aria-hidden': 'true' }, String(i + 1)), h('span', null, t));
      })),
      h('div', { class: 'actions' },
        h('a', { class: 'btn', href: '#/setup/1' }, 'Start my race card'),
        h('a', { class: 'linkbtn', href: '#/fuel' }, 'Just plan my fuel'),
        h('p', { class: 'foot' }, 'Free. No account. Saved on this phone only. Typical ranges, not medical advice.')));
  }

  // The guides on the first screen. A new guide is one more entry here. Both are drafts: their
  // ranges are not yet checked against sources, so each card says so (see the draft note on the page).
  var GUIDES = [
    { href: 'guides/race-fuel.html', topic: 'Fuelling', draft: true,
      title: 'How many gels for a 70.3?',
      summary: 'Gel times for the bike and run, capped at what your gut has trained.' },
    { href: 'guides/bike-pacing.html', topic: 'Bike pacing', draft: true,
      title: 'How hard should you ride a 70.3 bike?',
      summary: 'Your bike power target, from your FTP and the course.' }
  ];

  // One tappable card per guide. One column on a phone, two across when there is room.
  function guidesGallery() {
    return h('section', { class: 'stack', 'aria-label': 'Guides' },
      h('p', { class: 'label' }, 'Guides'),
      h('div', { class: 'gallery' }, GUIDES.map(function (g) {
        return h('a', { class: 'gcard', href: g.href },
          h('span', { class: 'gtop' }, h('span', { class: 'label' }, g.topic), g.draft ? h('span', { class: 'tag' }, 'Draft') : null),
          h('span', { class: 'gtitle' }, g.title),
          h('span', { class: 'gsum' }, g.summary));
      })));
  }

  function home() {
    var r = S.race;
    if (isBlankRace(r)) {
      return h('div', { class: 'app' }, splash(), guidesGallery());
    }

    var days = T.daysUntil(r.date);
    var paceDone = !!r.pace;
    var fuelDone = !!r.fuel;
    var done = (paceDone ? 1 : 0) + (fuelDone ? 1 : 0);
    var segs = [paceDone, fuelDone].map(function (x, i) {
      return h('span', { class: 'seg' + (x ? ' done' : i === done ? ' now' : '') });
    });

    function step(n, name, isDone, isNow, detail, href, linkText) {
      return h('li', { class: 'step' + (isDone ? ' done' : isNow ? ' now' : '') },
        h('span', { class: 'dot', 'aria-hidden': 'true' }, isDone ? '✓' : String(n)),
        h('div', null, h('p', { class: 't' }, n + ' · ' + name), h('p', { class: 'd' }, detail)),
        href ? h('a', { href: href }, linkText) : h('span', { class: 'later' }, 'Later'));
    }

    var d = S.details;
    var f = S.fitness;
    var chips = [];
    if (d.weight) chips.push(d.weight + ' kg');
    if (f.mode === 'power' && f.ftp) chips.push('FTP ' + f.ftp + ' W');
    if (f.css) chips.push('CSS ' + T.fmtPace(f.css) + ' /100m');
    if (f.runThreshold) chips.push('Run ' + T.fmtPace(f.runThreshold) + ' /km');
    chips.push(d.sweatTypical || !d.sweat ? 'Sweat: typical' : 'Sweat ' + d.sweat + ' L/hr');
    if (d.gut != null) chips.push('Gut ' + d.gut + ' g/hr');

    return h('div', { class: 'app' },
      topBar(brandLink(), null),
      h('section', { class: 'hero' },
        h('p', { class: 'k' }, 'YOUR NEXT RACE'),
        h('h1', { tabindex: '-1' }, raceTitle(r)),
        h('p', null, [longDate(r.date)].concat(timeParts(r)).filter(Boolean).join(' · ') || 'No date yet'),
        taperInfo(r) && taperInfo(r).short ? h('p', null, taperInfo(r).short) : null,
        h('div', { class: 'meta' },
          days != null ? h('span', { class: 'chip' }, daysText(days)) : h('span'),
          h('a', { href: '#/setup/1' }, 'Change race'))),
      h('section', { class: 'card' },
        h('div', { class: 'sechead' }, h('h2', null, 'Your plan'), h('span', { class: 'small' }, done + ' of 2 done')),
        h('div', { class: 'segs two', 'aria-hidden': 'true' }, segs),
        h('ol', { class: 'steps' },
          step(1, 'Pace', paceDone, !paceDone,
            paceDone ? 'Finish ' + hm(r.pace.finish) + (r.pace.bike.watts ? ' · bike ' + range(r.pace.bike.watts[0], r.pace.bike.watts[1]) + ' W' : '') : 'Targets for each leg and a finish range',
            paceDone ? '#/setup/5' : '#/setup/2', paceDone ? 'View' : 'Start'),
          step(2, 'Fuel', fuelDone, paceDone && !fuelDone,
            fuelDone ? (fuelStale(r) ? 'Out of date: open Fuel to update it' : r.fuel.bike.carbsPerHour + ' g carbs an hour on the bike') : 'Carbs, fluid and sodium per leg',
            '#/fuel', fuelDone ? 'View' : 'Plan'))),
      h('a', { class: 'btn', href: '#/card' }, 'Open race card'),
      h('section', { class: 'card' },
        h('div', { class: 'sechead' }, h('p', { class: 'label' }, 'Your details'), h('a', { href: '#/setup/2' }, 'Edit')),
        h('div', { class: 'chips' }, chips.map(function (c) { return h('span', { class: 'chip' }, c); })),
        h('p', { class: 'help' }, 'Entered once. Saved on this phone. Every step uses them.')),
      h('button', {
        type: 'button', class: 'btn ghost', onclick: function () {
          if (root.confirm('Start a new race? This clears the current race plan. Your details stay.')) {
            S.race = null; commit(); go('setup/1');
          }
        }
      }, 'Start a new race'),
      note('Typical ranges, not medical advice.'));
  }

  // ---------- set-up flow (F1-F5) ----------

  function ensureRace() {
    if (!S.race) {
      S.race = { name: '', distance: '70.3', date: '', start: '', transitionOpens: '', course: 'rolling', heat: 'warm', pace: null, fuel: null, splits: null };
      commit();
    }
    return S.race;
  }

  function setup(args) {
    var n = Number(args[0]) || 1;
    if (n < 1 || n > 5) n = 1;
    var r = ensureRace();
    var screens = { 1: setupRace, 2: setupYou, 3: setupFitness, 4: setupCourse, 5: setupTargets };
    var left = n === 1 ? h('a', { class: 'back', href: '#/' }, 'Cancel') : backLink('#/setup/' + (n - 1));
    // Step 1 is the Race step. Steps 2 to 5 are the Pacing step, with their own progress under the step bar.
    return h('div', { class: 'app' },
      topBar(left, h('span', { class: 'racename' }, r.name || '')),
      stepBar(n === 1 ? 'race' : 'pacing'),
      n === 1 ? null : progress(n - 1, 4, 'Pacing · ' + (n - 1) + ' of 4'),
      screens[n](r));
  }

  // Runs a step's check. Returns true when it passes; otherwise shows the errors and puts focus on the first one.
  function passes(check) {
    errors = check ? check() : {};
    if (Object.keys(errors).length) { refresh(); var first = view.querySelector('[aria-invalid="true"]'); if (first) first.focus(); return false; }
    return true;
  }
  function next(n, check) {
    return function () { if (passes(check)) go('setup/' + (n + 1)); };
  }

  // "Save and back to race card" (RD-031). Details save as they are typed, but the pace targets are worked out from
  // them, so a race that already has targets gets them worked out again here. If the numbers can't make a plan yet,
  // the old targets stay and the card says they are out of date (paceStale).
  function backToCard(check) {
    return h('button', {
      type: 'button', class: 'btn second', onclick: function () {
        if (!passes(check)) return;
        var r = S.race;
        if (r && r.pace) { var p = RD.pace.planPace(paceInput()); if (p.ok) savePace(r, p); }
        go('card');
      }
    }, 'Save and back to race card');
  }
  // Only once the card has something on it. On a first pass through the steps, Next is the way on.
  function hasPlan(r) { return !!(r && (r.pace || r.fuel)); }

  // A small button that empties an optional time. The saved value becomes blank, never midnight.
  function clearTime(path, label) {
    return h('button', {
      type: 'button', class: 'back', style: 'color:var(--link)',
      onclick: function () { delete raw[path]; delete errors[path]; set(path, ''); refresh(); }
    }, label);
  }

  function setupRace(r) {
    // Re-draw only when the Clear buttons or an error appear or go. Re-drawing on every keystroke
    // would drop a person out of the time field they are typing in.
    var clearShown = !!(r.start || r.transitionOpens);
    var errShown = !!(errors['race.start'] || errors['race.transitionOpens']);
    function timesChanged() {
      var clearNow = !!(r.start || r.transitionOpens);
      var errNow = !!(errors['race.start'] || errors['race.transitionOpens']);
      if (clearNow !== clearShown || errNow !== errShown) refresh();
    }
    var tp = taperInfo(r);
    var days = tp ? tp.days : null;
    var taperLine = tp ? tp.line : null;
    // An entry held back by the order check is not saved, so it must be fixed before moving on.
    function checkRace() {
      var e = {};
      ['race.start', 'race.transitionOpens'].forEach(function (p) { if (unreadable(p)) e[p] = T.RACE_TIMES_MESSAGE; });
      if (Object.keys(e).length) return e;
      if (!r.name) set('race.name', 'My race');
      return e;
    }
    return h('div', { class: 'stack' },
      title('Which race?', 'Add the date to see your days to go and when your taper starts. The times are optional.'),
      bound('race.name', 'text', { label: 'Race name', placeholder: 'For example, Spring 70.3' }),
      h('section', { class: 'card' },
        h('p', { class: 'label' }, 'Distance'),
        RD.ui.choice([{ value: 'standard', label: 'Standard' }, { value: '70.3', label: '70.3' }], r.distance,
          function (v) { set('race.distance', v); refresh(); }, 'pill', 'Distance'),
        h('p', { class: 'help' }, legsText(r.distance))),
      h('div', { class: 'two' },
        bound('race.date', 'text', { label: 'Race date', type: 'date', live: refresh }),
        bound('race.start', 'text', {
          label: 'Start time (optional)', type: 'time', live: timesChanged,
          validate: function (t) { return T.raceTimesError(t, r.transitionOpens); }
        })),
      // A date field shows nothing at all on some phones while it is empty, so say what to do.
      r.date ? null : h('p', { class: 'help' }, 'Tap the date to choose it.'),
      bound('race.transitionOpens', 'text', {
        label: 'Transition opens (optional)', type: 'time', live: timesChanged,
        validate: function (t) { return T.raceTimesError(r.start, t); }
      }),
      // A phone's time picker may have no way to empty a time that is set, so give one.
      r.start || r.transitionOpens ? h('div', { style: 'display:flex;flex-wrap:wrap;gap:0 18px' },
        r.start ? clearTime('race.start', 'Clear start time') : null,
        r.transitionOpens ? clearTime('race.transitionOpens', 'Clear transition time') : null) : null,
      taperLine ? h('section', { class: 'countdown' },
        h('div', { style: 'flex:1' }, h('p', { class: 'k' }, 'COUNTDOWN'), h('p', { class: 'v' }, daysText(days))),
        h('p', { class: 'n' }, taperLine)) : null,
      tp && days >= 0 ? taperPicker(r, tp) : null,
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: next(1, checkRace) }, 'Next: about you'),
        hasPlan(r) ? backToCard(checkRace) : null,
        h('p', { class: 'small center' }, 'Saved on this phone as you go. No account.')));
  }

  // Taper length (RD-011, RD-031): one tap for 10, 14 or 21 days, or pick the day it starts. Our guide is marked.
  // A picked day must fall 1 to 42 days before race day (pace.js, TAPER.limits); anything else is refused, not saved.
  function taperPicker(r, tp) {
    var T_ = RD.pace.TAPER;
    var guide = RD.pace.taperDays(r.distance, null);
    var opts = T_.options.slice();
    if (opts.indexOf(guide) < 0) { opts.push(guide); opts.sort(function (a, b) { return a - b; }); }
    var picked = opts.indexOf(tp.len) >= 0 ? tp.len : null;
    var dateErr = errors['race.taperDate'];
    return h('section', { class: 'card' },
      h('p', { class: 'label' }, 'Taper length'),
      RD.ui.choice(opts.map(function (n) { return { value: n, label: n + ' days' + (n === guide ? ' (our guide)' : '') }; }), picked,
        function (v) { delete errors['race.taperDate']; delete raw['race.taperDate']; set('race.taperDays', v === guide ? null : v); refresh(); }, 'pill', 'Taper length'),
      h('div', { class: 'row-wrap' },
        h('label', { class: 'field', for: 'f-race-taperDate' }, 'Or pick the day your taper starts',
          h('input', {
            // A refused day stays on screen beside its message, so the person can see what was refused.
            id: 'f-race-taperDate', type: 'date', value: dateErr && raw['race.taperDate'] ? raw['race.taperDate'] : tp.iso, max: r.date,
            'aria-invalid': dateErr ? 'true' : null, 'aria-describedby': dateErr ? 'f-race-taperDate-err' : null,
            onchange: function (e) {
              var day = T.addDays(e.target.value, 0);
              var len = day ? T.daysUntil(r.date, day) : null;
              var lim = T_.limits;
              if (len == null || len < lim[0] || len > lim[1]) {
                raw['race.taperDate'] = e.target.value;
                errors['race.taperDate'] = 'Pick a day ' + lim[0] + ' to ' + lim[1] + ' days before race day.';
                refresh(); return;
              }
              delete errors['race.taperDate'];
              delete raw['race.taperDate'];
              set('race.taperDays', len === guide ? null : len);
              refresh();
            }
          })),
        dateErr ? h('p', { class: 'error', id: 'f-race-taperDate-err', role: 'alert' }, dateErr) : null),
      h('p', { class: 'help' }, 'We count back from race day. Our guide is ' + guide + ' days for a ' + (DIST_LABEL[r.distance] || '70.3') +
        (tp.own ? '. You chose ' + tp.len + '.' : '.') + ' If your coach says otherwise, go with your coach.'));
  }

  function setupYou() {
    var d = S.details;
    return h('div', { class: 'stack' },
      title('About you', 'You enter these once. Every race and every step uses them.'),
      h('section', { class: 'card' },
        bound('details.weight', 'num', { label: 'Body weight', unit: 'kg' }),
        // Weight is used only to turn a power target into a bike time (pace.js, bikeSpeed). The fuel plan
        // never reads it, so this text must not say it sets fluid or sodium.
        h('p', { class: 'help' }, 'Your weight and your bike’s together set how much power it takes to roll, so the same watts give a different speed. In Power mode we use it to turn your target into a bike time. It does not change your fuel plan.')),
      h('section', { class: 'card' },
        bound('details.sweat', 'num', { label: 'Sweat rate', unit: 'L an hour', disabled: d.sweatTypical, placeholder: d.sweatTypical ? 'Typical for the heat' : '' }),
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: d.sweatTypical, onchange: function (e) { set('details.sweatTypical', e.target.checked); refresh(); } }),
          'Use a typical value for now'),
        d.sweatTypical ? h('span', { class: 'tag' }, 'Typical') : null,
        h('details', { class: 'test' }, h('summary', null, 'How to test it'),
          h('p', { class: 'help' }, 'Weigh yourself with no clothes before and after a one-hour ride at race effort. Each kilogram lost is about one litre. Add what you drank during the ride.'))),
      h('section', { class: 'card' },
        bound('details.gut', 'num', { label: 'Carbs your gut handles', unit: 'g an hour' }),
        h('p', { class: 'help' }, 'The most you have taken on long rides without trouble. Your fuel plan never goes above it.')),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: next(2, checkYou) }, 'Next: fitness numbers'),
        hasPlan(S.race) ? backToCard(checkYou) : null,
        h('p', { class: 'small center' }, 'Saved on this phone only. Not medical advice.')));
  }

  function checkYou() {
    var e = {};
    var d = S.details;
    function ok(v, lo, hi) { return typeof v === 'number' && isFinite(v) && v >= lo && v <= hi; }
    if (unreadable('details.weight') || !ok(d.weight, 35, 150)) e['details.weight'] = 'Enter a body weight between 35 and 150 kg.';
    if (!d.sweatTypical && (unreadable('details.sweat') || !ok(d.sweat, 0.2, 3))) e['details.sweat'] = 'Enter 0.2 to 3 L an hour, or tick typical.';
    if (unreadable('details.gut') || !ok(d.gut, 0, 120)) e['details.gut'] = 'Enter 0 to 120 g an hour. Not sure? Start with 40.';
    return e;
  }

  function setupFitness() {
    var f = S.fitness;
    var mode = f.mode || 'power';
    var bike;
    if (mode === 'power') {
      bike = h('section', { class: 'card' },
        h('p', { class: 'legname' }, 'Bike'),
        bound('fitness.ftp', 'num', { label: 'FTP', unit: 'watts' }),
        h('p', { class: 'help', style: 'font-weight:600;color:var(--ink)' }, 'When did you test it?'),
        RD.ui.choice([{ value: true, label: 'In the last 6 weeks' }, { value: false, label: 'Longer ago' }], f.ftpRecent !== false,
          function (v) { set('fitness.ftpRecent', v); refresh(); }, 'pill', 'When you tested FTP'),
        h('details', { class: 'test' }, h('summary', null, 'How to test FTP'),
          h('p', { class: 'help' }, 'After a good warm-up, ride 20 minutes as hard as you can hold evenly. Your FTP is about 95% of the average power.')));
    } else {
      bike = h('section', { class: 'card' },
        h('p', { class: 'legname' }, 'Bike'),
        mode === 'hr' ? bound('fitness.bikeLthr', 'num', { label: 'Bike threshold heart rate', unit: 'bpm' }) : null,
        bound('fitness.steadySpeed', 'num', { label: 'Speed on a hard long ride', unit: 'km/h' }),
        h('p', { class: 'help' }, 'Your average on a two-hour ride at a strong, steady effort. It sets your bike time.'));
    }
    return h('div', { class: 'stack' },
      title('Fitness numbers', 'Your targets come from these. Use your latest test.'),
      h('section', { class: 'card' },
        h('p', { class: 'legname' }, 'Swim'),
        bound('fitness.css', 'clock', { label: 'Critical swim speed (CSS)', unit: '/100m', placeholder: '1:45' }),
        h('p', { class: 'help' }, 'Your steady swim pace per 100 m in a pool. It comes from a 200 m and a 400 m test. Your swim target starts from it.'),
        h('details', { class: 'test' }, h('summary', null, 'How to test CSS'),
          h('p', { class: 'help' }, 'Swim a 400 m and a 200 m time trial with a rest between. CSS pace per 100 m is (400 time − 200 time) ÷ 2.'))),
      // This choice changes the bike and the run, and never the swim, so it sits between them and the swim.
      // What each mode asks for is checked against validate() in pace.js: the run threshold pace is needed in all three.
      h('section', { class: 'card' },
        h('p', { class: 'label' }, 'How do you pace the bike and run?'),
        RD.ui.choice([{ value: 'power', label: 'Power' }, { value: 'hr', label: 'Heart rate' }, { value: 'effort', label: 'Effort' }], mode,
          function (v) { set('fitness.mode', v); errors = {}; refresh(); }, 'segbtn', 'How you pace the bike and run'),
        h('p', { class: 'help' }, 'Power needs your FTP. Heart rate needs your threshold heart rates and the speed of a hard long ride. Effort needs only the speed of a hard long ride.')),
      bike,
      h('section', { class: 'card' },
        h('p', { class: 'legname' }, 'Run'),
        mode === 'hr' ? bound('fitness.runLthr', 'num', { label: 'Run threshold heart rate', unit: 'bpm' }) : null,
        bound('fitness.runThreshold', 'clock', { label: 'Run threshold pace', unit: '/km', placeholder: '4:50' }),
        h('details', { class: 'test' }, h('summary', null, 'How to test it'),
          h('p', { class: 'help' }, 'Run 30 minutes solo as hard as you can hold evenly. Your average pace for the last 20 minutes is your threshold pace. A recent 10 km race pace is close enough.'))),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: next(3, checkFitness) }, 'Next: course and heat'),
        hasPlan(S.race) ? backToCard(checkFitness) : null,
        h('p', { class: 'small center' }, mode === 'effort' ? 'Effort mode gives targets out of 10, with a talk test.' : 'Don’t know a number? Choose Effort.')));
  }

  function paceInput() {
    var f = S.fitness;
    var r = S.race || {};
    return {
      distance: r.distance, mode: f.mode || 'power', css: f.css, ftp: f.ftp, ftpRecent: f.ftpRecent !== false,
      runThreshold: f.runThreshold, weight: S.details.weight, bikeLthr: f.bikeLthr, runLthr: f.runLthr,
      steadySpeed: f.steadySpeed, course: r.course, heat: r.heat,
      // The athlete's own changeovers, only when they can be used. A blank or bad entry is our guide, and the
      // targets screen shows the message by the field (RD-031).
      t1: RD.pace.goodChangeover(r.t1) ? r.t1 : null,
      t2: RD.pace.goodChangeover(r.t2) ? r.t2 : null
    };
  }

  // Saves pace targets to the race card, with what they were worked out from, so the card can say when they are out
  // of date (paceStale). The pace plan now sets the splits; a saved fuel plan shows as out of date if they changed.
  function savePace(r, p) {
    r.pace = p;
    r.pace.inputKey = JSON.stringify(paceInput());
    r.splits = RD.pace.midSplits(p);
    r.splitsByHand = null;
    commit();
  }
  // True when the details, fitness, course, heat or changeovers changed since the targets were saved. A plan saved
  // before this check existed has no key, and is never called out of date for that alone.
  function paceStale(r) { return !!(r && r.pace && r.pace.inputKey && r.pace.inputKey !== JSON.stringify(paceInput())); }

  // A T1 or T2 the athlete typed that can't be used, as a message for the field, or ''.
  function changeoverError(path) {
    var v = get(path);
    if (unreadable(path) || (v != null && !RD.pace.goodChangeover(v))) return RD.pace.CHANGEOVER_MESSAGE;
    return '';
  }

  function checkFitness() {
    var e = {};
    var map = { css: 'fitness.css', ftp: 'fitness.ftp', runThreshold: 'fitness.runThreshold', bikeLthr: 'fitness.bikeLthr', runLthr: 'fitness.runLthr', steadySpeed: 'fitness.steadySpeed' };
    RD.pace.validate(paceInput()).forEach(function (x) { if (map[x.field]) e[map[x.field]] = x.message; });
    Object.keys(map).forEach(function (k) {
      if (!unreadable(map[k])) return;
      // The swim and run pace fields are times: say what to type. The rest are plain numbers.
      e[map[k]] = k === 'css' || k === 'runThreshold' ? T.unreadableTimeMessage(raw[map[k]], 'clock') : 'That doesn’t look right. Check the format.';
    });
    return e;
  }

  function setupCourse(r) {
    return h('div', { class: 'stack' },
      title('Course and heat', 'Hills change your bike target. Heat changes your run and your fuel.'),
      h('section', { class: 'card' },
        h('p', { class: 'legname' }, 'Bike course'),
        RD.ui.choice(COURSE, r.course, function (v) { set('race.course', v); refresh(); }, 'opt', 'Bike course'),
        h('p', { class: 'help' }, 'Not sure? The race manual shows the elevation. Under 500 m of climbing over 90 km is flat; over 1,000 m is hilly.')),
      h('section', { class: 'card' },
        h('p', { class: 'legname' }, 'Forecast heat on race day'),
        RD.ui.choice(HEAT, r.heat, function (v) { set('race.heat', v); refresh(); }, 'opt', 'Forecast heat'),
        h('p', { class: 'help' }, 'Check it again in race week. You can change it any time.')),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: next(4) }, 'See my pace targets'),
        hasPlan(r) ? backToCard() : null));
  }

  function targetsBlock(p, r) {
    var clock = finishClock(r && r.start, p.finish);
    var bikeT;
    var bikeSub = null;
    if (p.bike.watts) bikeT = range(p.bike.watts[0], p.bike.watts[1]) + ' W';
    else if (p.bike.hr) { bikeT = range(p.bike.hr[0], p.bike.hr[1]) + ' bpm'; bikeSub = p.bike.effort; }
    else bikeT = p.bike.effort;
    var runSub = p.run.hr ? range(p.run.hr[0], p.run.hr[1]) + ' bpm' : p.mode === 'effort' ? p.run.effort : null;
    function leg(name, t, sub, time) {
      return h('div', { class: 'leg' }, h('span', { class: 'n' }, name), h('span', { class: 't' }, t, sub ? h('small', null, sub) : null), h('span', { class: 's' }, time));
    }
    return h('section', { class: 'targets', 'aria-label': 'Pace targets' },
      leg('Swim', pace(p.swim.pace) + ' /100m', null, hm(p.swim.minutes)),
      leg('Bike', bikeT, bikeSub, hm(p.bike.minutes)),
      leg('Run', pace(p.run.pace) + ' /km', runSub, hm(p.run.minutes)),
      // Each changeover on its own row (RD-031). A plan saved before T1 and T2 were split shows them together.
      p.t1 ? leg('T1', 'Swim to bike', p.t1Own ? 'Your time' : 'Our guide', hm(p.t1)) : leg('Changes', 'T1 and T2', null, hm(p.transitions)),
      p.t2 ? leg('T2', 'Bike to run', p.t2Own ? 'Your time' : 'Our guide', hm(p.t2)) : null,
      h('div', { class: 'finish' }, h('span', { class: 'k' }, 'FINISH'), h('span', { class: 'v' }, hm(p.finish))),
      h('p', { class: 'fclock' }, clock ? 'About ' + clock : finishClockHint()));
  }

  function setupTargets(r) {
    var p = RD.pace.planPace(paceInput());
    if (!p.ok) {
      return h('div', { class: 'stack' },
        title('A number is missing', 'We need these before we can set your targets.'),
        h('div', { class: 'info warn', role: 'alert' }, h('ul', null, p.errors.map(function (e) { return h('li', null, e.message); }))),
        h('div', { class: 'actions' }, h('a', { class: 'btn', href: p.errors.some(function (e) { return e.field === 'weight'; }) ? '#/setup/2' : '#/setup/3' }, 'Fix my numbers')));
    }
    currentPrint = { race: r, pace: p, fuel: r.fuel };
    // The changeover fields show their message as soon as an entry can't be used. The plan above uses our guide
    // for that changeover until it can, and Save waits for it.
    ['race.t1', 'race.t2'].forEach(function (path) { var m = changeoverError(path); if (m) errors[path] = m; else delete errors[path]; });
    var guide = RD.pace.T1[r.distance] ? r.distance : '70.3';
    return h('div', { class: 'stack' },
      title('Your pace targets', 'Hold these and you finish strong. Each is a range, not one number.'),
      targetsBlock(p, r),
      h('section', { class: 'card' },
        h('p', { class: 'label' }, 'Your changeovers'),
        h('div', { class: 'two' },
          bound('race.t1', 'num', { label: 'T1, swim to bike', unit: 'min', placeholder: range(RD.pace.T1[guide][0], RD.pace.T1[guide][1]), live: refreshLater }),
          bound('race.t2', 'num', { label: 'T2, bike to run', unit: 'min', placeholder: range(RD.pace.T2[guide][0], RD.pace.T2[guide][1]), live: refreshLater })),
        h('p', { class: 'help' }, 'Our guide: T1 ' + range(RD.pace.T1[guide][0], RD.pace.T1[guide][1]) + ' min, T2 ' + range(RD.pace.T2[guide][0], RD.pace.T2[guide][1]) +
          ' min. Type your own in whole minutes, or leave a box blank to use our guide. Your finish updates and the legs still add up to it.')),
      p.warnings.length ? h('div', { class: 'info warn' }, h('ul', null, p.warnings.map(function (w) { return h('li', null, w); }))) : null,
      h('details', { class: 'why', open: true },
        h('summary', null, 'How we got these'),
        h('ul', null, p.why.map(function (w) { return h('li', null, h('b', null, w.leg + ': '), w.text); }))),
      h('p', { class: 'small' }, 'Typical ranges, not yet checked against current sources. Not medical advice.'),
      h('div', { class: 'actions' },
        h('button', {
          type: 'button', class: 'btn', onclick: function () {
            if (!passes(function () {
              var e = {};
              ['race.t1', 'race.t2'].forEach(function (path) { var m = changeoverError(path); if (m) e[path] = m; });
              return e;
            })) return;
            var first = !r.pace && !r.fuel;
            savePace(r, p);
            // The first time through, F6 says it was saved and offers fuel. After that, back to the card.
            go(first ? 'saved' : 'card');
          }
        }, 'Save to my race card'),
        h('a', { class: 'btn second', href: '#/setup/3' }, 'Change a number')));
  }

  // ---------- saved (F6) ----------

  function saved() {
    var r = S.race;
    if (!r || !r.pace) return home();
    currentPrint = { race: r, pace: r.pace, fuel: r.fuel };
    return h('div', { class: 'app' },
      topBar(brandLink(), h('a', { class: 'toplink', href: '#/' }, 'My race')),
      stepBar('card'),
      h('div', { class: 'info', role: 'status', style: 'background:var(--go-bg);color:var(--go);font-weight:700' }, 'Pace targets saved to your race card'),
      cardBody(r, true),
      printButton(),
      note('Typical ranges, not medical advice.'));
  }

  // ---------- race card (C1) ----------

  function raceCard() {
    var r = S.race;
    if (!r) return home();
    currentPrint = { race: r, pace: r.pace, fuel: r.fuel };
    return h('div', { class: 'app' },
      topBar(brandLink(), h('a', { class: 'toplink', href: '#/' }, 'My race')),
      stepBar('card'),
      cardBody(r, false),
      printButton(),
      note('Typical ranges, not medical advice.'));
  }

  function cardBody(r, showNext) {
    var d = T.addDays(r.date, 0);
    var days = T.daysUntil(r.date);
    var p = r.pace;
    var f = r.fuel;
    var paceSec;
    if (p) {
      var bikeStat = p.bike.watts ? [range(p.bike.watts[0], p.bike.watts[1]), 'watts'] : p.bike.hr ? [range(p.bike.hr[0], p.bike.hr[1]), 'bpm'] : ['Effort', p.bike.effort.split(':')[0]];
      var clock = finishClock(r.start, p.finish);
      paceSec = h('section', { class: 'sec' },
        h('div', { class: 'sechead' }, h('p', { class: 'label' }, 'Pace'), h('a', { href: '#/setup/5' }, 'Edit')),
        paceStale(r) ? h('p', { class: 'notice warn', role: 'status' }, 'Your numbers changed since these targets. Open Pacing to update them.') : null,
        h('div', { class: 'stats' },
          stat('Swim', pace(p.swim.pace), '/100m'),
          stat('Bike', bikeStat[0], bikeStat[1]),
          stat('Run', pace(p.run.pace), '/km')),
        h('p', null, 'Finish ', h('b', null, hm(p.finish)), clock ? ' · about ' + clock : ''),
        // The changeovers the finish includes: the athlete's own, or our guide (RD-031).
        p.t1 && p.t2 ? h('p', { class: 'small' }, 'Changeovers: T1 ' + hm(p.t1) + ' · T2 ' + hm(p.t2)) : null,
        clock ? null : h('p', { class: 'small' }, finishClockHint()));
    } else {
      paceSec = h('section', { class: 'sec' },
        h('div', { class: 'sechead' }, h('p', { class: 'label' }, 'Pace'), h('a', { href: '#/setup/2' }, 'Set up')),
        h('p', { class: 'small' }, 'Targets for each leg and a finish range.'));
    }
    var fuelSec;
    if (f) {
      fuelSec = h('section', { class: 'sec' },
        h('div', { class: 'sechead' }, h('p', { class: 'label' }, 'Fuel'), h('a', { href: '#/fuel' }, 'Edit')),
        fuelStale(r) ? h('p', { class: 'notice warn', role: 'status' }, 'Your splits, details or products changed since this plan. Open Fuel to update it.') : null,
        fuelLeg('Bike', f, 'bike'),
        fuelLeg('Run', f, 'run'),
        showsKm(f, 'bike') || showsKm(f, 'run') ? h('p', { class: 'notice go' }, RD.pace.KM_NOTE) : null,
        h('p', { class: 'small' }, h('a', { href: '#/fuel' }, 'Change gel times')));
    } else {
      fuelSec = h('section', { class: 'sec' },
        h('div', { class: 'sechead' }, h('p', { class: 'label' }, 'Fuel'), h('span', { class: 'later' }, p ? 'Next' : '')),
        p ? h('p', null, 'Uses your splits: bike about ' + T.fmtHM(r.splits.bike) + ', run about ' + T.fmtHM(r.splits.run) + '.') : h('p', { class: 'small' }, 'Carbs, fluid and sodium per leg.'),
        showNext || p ? h('a', { class: 'btn', href: '#/fuel' }, 'Plan my fuel') : null);
    }
    return h('article', { class: 'racecard' },
      h('div', { class: 'band' },
        h('div', { class: 'date' },
          h('strong', null, d ? String(d.getDate()) : '–'),
          h('span', null, d ? d.toLocaleDateString('en-AU', { month: 'short' }).toUpperCase() : '')),
        h('div', { style: 'flex:1;min-width:0' },
          h('h1', { tabindex: '-1' }, raceTitle(r)),
          h('p', null, timeParts(r).concat(daysText(days)).filter(Boolean).join(' · ')),
          taperInfo(r) && taperInfo(r).short ? h('p', null, taperInfo(r).short) : null)),
      paceSec,
      fuelSec);
  }

  // The pace behind one leg of the pace plan, in the middle of its range: "~1:45 /100m", "~34 km/h", "~4:50 /km" (RD-030).
  // Falls back to 'h:mm' when the plan holds no readable pace, so a blank is never shown as zero.
  function legPace(r, leg) {
    function isNum(v) { return typeof v === 'number' && isFinite(v) && v > 0; }
    var p = r && r.pace && r.pace[leg];
    if (leg === 'bike') {
      var km = RD.pace.LEGS[r && r.distance] && RD.pace.LEGS[r.distance].bike;
      var min = r && r.splits && r.splits.bike;
      return isNum(km) && isNum(min) ? '~' + Math.round(km / (min / 60)) + ' km/h' : 'h:mm';
    }
    var pace = p && p.pace;
    if (!pace || !isNum(pace[0]) || !isNum(pace[1])) return 'h:mm';
    return '~' + T.fmtPace((pace[0] + pace[1]) / 2) + (leg === 'swim' ? ' /100m' : ' /km');
  }
  function stat(name, value, unit) {
    return h('div', { class: 'stat' }, h('span', null, name), h('b', null, value), h('span', null, unit));
  }
  // The gel or chew and the drink a plan was made with, by the names the person chose or typed.
  // The plan holds them (carry.gelName, carry.drink). A null drink means water only.
  // Both read through plainName, so a plan saved before the " (typical)" tag was dropped shows the plain name.
  function gelName(f) { return RD.fuel.plainName(f.carry && f.carry.gelName) || 'gel or chews'; }
  function drinkName(f) { return f.carry && f.carry.drink ? RD.fuel.plainName(f.carry.drink) : null; }
  // What the bike sips are made of: water, the drink on its own, or the drink mixed with water.
  function sipKind(f) {
    var dn = drinkName(f);
    var share = f.bike.drinkShare;
    return !dn || share <= 0 ? 'water' : share < 1 ? dn + ' and water' : dn;
  }
  // One leg of the fuel plan on the race card: the leg and its carbs an hour, then each gel as a row with its time
  // first and its km beside it (RD-025), as the 4 Nov 2026 timeline blueprint. The words match the old paragraph.
  function fuelLeg(name, f, leg) {
    var L = f[leg];
    var gel = gelName(f);
    var kids = [h('header', null, h('h3', null, name), h('span', { class: 'badge' }, L.carbsPerHour + ' g/hr'))];
    if (leg === 'bike') kids.push(h('p', { class: 'tlline' }, 'Sip about ' + L.sipMl + ' ml of ' + sipKind(f) + ' every 15 min.'));
    if (L.gels) {
      L.gelTimes.forEach(function (t) {
        var k = kmOf(f, leg, t);
        kids.push(h('div', { class: 'tlrow' }, h('b', null, T.fmtHM(t)), h('span', null, gel.charAt(0).toUpperCase() + gel.slice(1)), k ? h('span', { class: 'km' }, k) : null));
      });
    } else if (leg === 'run') {
      kids.push(h('p', { class: 'tlline' }, 'No gels needed; sports drink at aid stations if you want it.'));
    }
    if (leg === 'run') kids.push(h('p', { class: 'tlline' }, 'Water at each aid station.'));
    return h('div', { class: 'tl' }, kids);
  }
  function printButton() {
    return h('button', { type: 'button', class: 'btn ghost', onclick: function () { root.print(); } },
      svg('M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z'), 'Print top-tube card');
  }

  // ---------- fuel step (A2) ----------

  // null means "never edited": use the generic starter products. An empty list means the athlete removed them all.
  function productList() {
    if (!Array.isArray(S.products)) return RD.fuel.DEFAULT_PRODUCTS.map(function (p) { return Object.assign({}, p); });
    return S.products;
  }
  // Look a product up in the right list only: a product whose type changed to Drink is no longer a gel.
  function findIn(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // Everything the fuel plan depends on, read from the store. The fuel step plans from it, and the
  // card compares it with what a saved plan was made from, to say when the plan is out of date.
  function pickedCarbs(v) { return typeof v === 'number' && isFinite(v) && v > 0; }
  function fuelInput() {
    var r = S.race;
    var solo = !r;
    var ctx = solo ? S.solo || {} : r;
    var fromPlan = !solo && !!r.splits && !r.splitsByHand;
    var hand = solo ? S.solo || {} : r.splitsByHand ? { bikeMin: r.splitsByHand.bike, runMin: r.splitsByHand.run } : {};
    var list = productList();
    var gels = list.filter(function (p) { return p.kind !== 'drink'; });
    var drinks = list.filter(function (p) { return p.kind === 'drink'; });
    var gel = findIn(gels, S.choice.gel) || gels[0] || null;
    var drink = S.choice.drink === 'none' ? null : findIn(drinks, S.choice.drink) || drinks[0] || null;
    // The carbs picked on the fuel step replace the product's own figure. The name and sodium stay the product's (RD-009).
    // A blank or unreadable pick is ignored, never read as 0.
    if (gel && pickedCarbs(S.choice.gelCarbs)) gel = Object.assign({}, gel, { carbs: S.choice.gelCarbs });
    if (drink && pickedCarbs(S.choice.drinkCarbs)) drink = Object.assign({}, drink, { carbs: S.choice.drinkCarbs });
    var d = S.details;
    var input = {
      distance: ctx.distance,
      bikeMin: fromPlan ? r.splits.bike : hand.bikeMin != null ? hand.bikeMin : null,
      runMin: fromPlan ? r.splits.run : hand.runMin != null ? hand.runMin : null,
      heat: ctx.heat, gut: d.gut, sweat: d.sweatTypical || d.sweat == null ? null : d.sweat, gel: gel, drink: drink
    };
    // The athlete's own gel times (RD-031). Added only when some are set, so a plan saved before this existed
    // is not called out of date for that alone. A time typed but unreadable goes in as blank, never as zero.
    var tm = S.choice.timing || {};
    function own(leg) {
      var t = tm[leg] || {};
      var first = unreadable('choice.timing.' + leg + '.first') ? null : t.first;
      var every = unreadable('choice.timing.' + leg + '.every') ? null : t.every;
      return { first: first == null ? null : first, every: every == null ? null : every };
    }
    var ownBike = own('bike');
    var ownRun = own('run');
    if (RD.fuel.hasTiming(ownBike) || RD.fuel.hasTiming(ownRun)) input.timing = { bike: ownBike, run: ownRun };
    return { fromPlan: fromPlan, gels: gels, drinks: drinks, input: input };
  }
  function inputKey(input) { return JSON.stringify(input); }
  function fuelStale(r) { return !!(r && r.fuel && r.fuel.inputKey !== inputKey(fuelInput().input)); }

  function fuelStep() {
    var r = S.race;
    var solo = !r;
    if (solo && !S.solo) { S.solo = { distance: '70.3', bikeMin: null, runMin: null, heat: 'warm' }; commit(); }
    var ctx = solo ? S.solo : r;
    var base = solo ? 'solo' : 'race';
    var fi = fuelInput();
    var fromPlan = fi.fromPlan;
    var gels = fi.gels;
    var drinks = fi.drinks;
    var input = fi.input;
    var gel = input.gel;
    var drink = input.drink;
    var d = S.details;
    var plan = RD.fuel.planFuel(input);
    if (plan.ok) plan.inputKey = inputKey(input);

    // Splits: from the pace plan, or typed in.
    var splitsBox;
    if (fromPlan) {
      splitsBox = h('section', { class: 'fromplan' },
        h('p', { class: 'label' }, 'From your pace plan'),
        // The same tiles as the race card. The big time is the middle of each pace range, which is what the fuel plan uses.
        // The small line is the pace it came from (RD-030).
        h('div', { class: 'stats' }, stat('Swim', T.fmtHM(r.splits.swim), legPace(r, 'swim')), stat('Bike', T.fmtHM(r.splits.bike), legPace(r, 'bike')), stat('Run', T.fmtHM(r.splits.run), legPace(r, 'run'))),
        h('p', { class: 'help' }, 'Times are h:mm. The big time is the middle of each range in your pace plan, and the small line is its pace.'),
        h('button', {
          type: 'button', class: 'back', style: 'color:var(--link)', onclick: function () {
            r.splitsByHand = { bike: r.splits.bike, run: r.splits.run }; commit(); refresh();
          }
        }, 'Use different times'));
    } else {
      var timesPath = solo ? 'solo' : 'race.splitsByHand';
      if (!solo && !r.splitsByHand) { r.splitsByHand = { bike: null, run: null }; commit(); }
      splitsBox = h('section', { class: 'card' },
        solo ? h('div', null, h('p', { class: 'label' }, 'Distance'),
          RD.ui.choice([{ value: 'standard', label: 'Standard' }, { value: '70.3', label: '70.3' }], S.solo.distance,
            function (v) { set('solo.distance', v); refresh(); }, 'pill', 'Distance')) : null,
        h('div', { class: 'two' },
          bound(solo ? 'solo.bikeMin' : timesPath + '.bike', 'hm', { label: 'Bike time', placeholder: '2:45', live: refreshLater }),
          bound(solo ? 'solo.runMin' : timesPath + '.run', 'hm', { label: 'Run time', placeholder: '1:55', live: refreshLater })),
        h('p', { class: 'help' }, 'Type h:mm.' + (!solo && r.splits ? '' : ' Your pace plan fills these in for you.')),
        !solo && r.splits ? h('button', { type: 'button', class: 'back', style: 'color:var(--link)', onclick: function () { r.splitsByHand = null; commit(); refresh(); } }, 'Use my pace plan times') : null);
    }

    var aboutYou = null;
    if (d.gut == null || unreadable('details.gut')) aboutShown = true;
    if (aboutShown) {
      aboutYou = h('section', { class: 'card' },
        h('p', { class: 'legname' }, 'About you'),
        bound('details.gut', 'num', { label: 'Carbs your gut handles', unit: 'g an hour', placeholder: '60', live: refreshLater }),
        h('p', { class: 'help' }, 'The most you have taken on long rides without trouble. The plan never goes above it.'),
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: d.sweatTypical, onchange: function (e) { set('details.sweatTypical', e.target.checked); refresh(); } }),
          'Use a typical sweat rate'),
        !d.sweatTypical ? bound('details.sweat', 'num', { label: 'Sweat rate', unit: 'L an hour', live: refreshLater }) : null);
    }

    // One card for the choice and what to pack. The carry list sits right under the choice that changes it.
    var starter = !Array.isArray(S.products);
    // One selector per product: the carbs in a gel, and the carbs in a serve of drink. The unit is in the label (RD-009).
    function carbPick(kind, label, product, key) {
      return h('label', { class: 'field' }, label,
        h('select', { onchange: function (e) { set('choice.' + key, e.target.value === '' ? null : Number(e.target.value)); refresh(); } },
          RD.fuel.pickOptions(kind, product.carbs).map(function (g) {
            return h('option', { value: String(g), selected: g === product.carbs ? 'selected' : null }, g + 'g');
          })));
    }
    var drinkSelect = null;
    if (drinks.length) {
      drinkSelect = h('label', { class: 'field' }, 'Bike drink, carbs per ' + (drink ? drink.serveMl : drinks[0].serveMl) + ' ml',
        h('select', { onchange: function (e) {
          if (e.target.value === 'none') set('choice.drink', 'none');
          else { set('choice.drink', drinks[0].id); set('choice.drinkCarbs', Number(e.target.value)); }
          refresh();
        } },
          RD.fuel.pickOptions('drink', drink ? drink.carbs : drinks[0].carbs).map(function (g) {
            return h('option', { value: String(g), selected: drink && g === drink.carbs ? 'selected' : null }, g + 'g');
          }),
          h('option', { value: 'none', selected: !drink ? 'selected' : null }, 'Water only')));
    }
    var productsBox = h('section', { class: 'card' },
      h('div', { class: 'sechead' }, h('p', { class: 'label' }, 'Your fuel'), h('a', { href: '#/products' }, 'Edit my products')),
      h('div', { class: 'two' },
        gel ? carbPick('gel', 'Gel or chew, carbs per serve', gel, 'gelCarbs') : null,
        drinkSelect),
      // Says what the choice does, right under the choice, with the carbs per serve the plan will use.
      h('p', { class: 'help' }, RD.fuel.describeProducts(gel, drink)),
      starter ? h('p', { class: 'help' }, 'These are generic starter products, not a brand. Add the ones you race with under Edit my products.') : null,
      plan.ok ? h('hr', { class: 'divider' }) : null,
      plan.ok ? carryList(plan) : null);

    var out;
    if (!plan.ok) {
      out = h('div', { class: 'info warn', role: 'status' },
        h('p', null, 'To see your plan:'),
        h('ul', null, plan.errors.map(function (e) { return h('li', null, e.message); })));
    } else {
      currentPrint = { race: r || { name: 'Fuel plan', distance: ctx.distance }, pace: r && r.pace, fuel: plan };
      out = fuelPlanBlock(plan);
    }

    var saveBtn = null;
    if (plan.ok && !solo) {
      saveBtn = h('button', {
        type: 'button', class: 'btn', onclick: function () {
          r.fuel = plan; commit(); go('card');
        }
      }, r.fuel ? 'Update my race card' : 'Save to my race card');
    } else if (plan.ok && solo) {
      saveBtn = h('button', {
        type: 'button', class: 'btn', onclick: function () {
          S.race = {
            name: '', distance: S.solo.distance, date: '', start: '', transitionOpens: '', course: 'rolling', heat: S.solo.heat,
            pace: null, fuel: plan, splits: null, splitsByHand: { bike: S.solo.bikeMin, run: S.solo.runMin }
          };
          commit(); go('setup/1');
        }
      }, 'Save to a race plan');
    }

    return h('div', { class: 'app' },
      topBar(solo ? brandLink() : backLink('#/', r.name || 'My race'), null),
      solo ? null : stepBar('fuel'),
      title('Fuel plan', 'Carbs, fluid and sodium for each leg, timed to your splits.'),
      splitsBox,
      h('section', { class: 'card' },
        h('p', { class: 'label' }, 'Forecast heat'),
        RD.ui.choice(HEAT.map(function (x) { return { value: x.value, label: x.label + ', ' + x.hint }; }), ctx.heat,
          function (v) { set(base + '.heat', v); refresh(); }, 'pill', 'Forecast heat')),
      aboutYou,
      productsBox,
      plan.ok ? timingBox(plan) : null,
      out,
      h('div', { class: 'actions noprint' },
        saveBtn,
        plan.ok ? printButton() : null,
        solo ? h('p', { class: 'small center' }, 'No account. Saved on this phone.') : null));
  }

  // Gel timing (RD-031): for each leg, the first gel and then one every so many minutes. Blank uses our suggested
  // times, which show as the placeholders. Times that would pass the gut figure are refused by fuel.js, and the
  // message shows here, by the fields, while the plan keeps the suggested times.
  function timingBox(plan) {
    function gap(times) { return times.length >= 2 ? String(times[1] - times[0]) : ''; }
    function legBox(leg, name) {
      var firstPath = 'choice.timing.' + leg + '.first';
      var everyPath = 'choice.timing.' + leg + '.every';
      var sug = plan.suggested[leg];
      var msg = unreadable(firstPath) ? T.unreadableTimeMessage(raw[firstPath], 'hm')
        : unreadable(everyPath) ? 'Enter how often in whole minutes, such as 30.'
          : plan.timingNote[leg];
      var times = plan[leg].gelTimes;
      return h('div', { class: 'stack timing' },
        h('p', { class: 'legname' }, name),
        h('div', { class: 'two' },
          bound(firstPath, 'hm', { label: name + ': first gel at', placeholder: sug.length ? T.fmtHM(sug[0]) : '0:30', live: refreshLater }),
          bound(everyPath, 'num', { label: name + ': then every', unit: 'min', placeholder: gap(sug) || '30', live: refreshLater })),
        h('p', { class: 'help' }, (plan.timingUsed[leg] ? 'Your times: ' : 'Suggested: ') + (times.length ? minutesList(times) : 'no gels on this leg')),
        msg ? h('p', { class: 'error', role: 'alert' }, msg) : null);
    }
    var tm = S.choice.timing || {};
    var anyOwn = ['bike', 'run'].some(function (leg) { return RD.fuel.hasTiming(tm[leg]) || unreadable('choice.timing.' + leg + '.first') || unreadable('choice.timing.' + leg + '.every'); });
    return h('section', { class: 'card', id: 'gel-timing' },
      h('p', { class: 'label' }, 'Gel timing'),
      h('p', { class: 'help' }, 'We suggest these times. Set your own to match how you train. Your times never take carbs past your gut figure.'),
      legBox('bike', 'Bike'),
      legBox('run', 'Run'),
      anyOwn ? h('button', {
        type: 'button', class: 'back', style: 'color:var(--link)', onclick: function () {
          ['bike', 'run'].forEach(function (leg) { ['first', 'every'].forEach(function (k) { delete raw['choice.timing.' + leg + '.' + k]; }); });
          S.choice.timing = { bike: { first: null, every: null }, run: { first: null, every: null } };
          commit(); refresh();
        }
      }, 'Use the suggested times') : null);
  }

  var aboutShown = false; // once the fuel step asks for gut and sweat, it keeps asking until you leave
  var refreshTimer = null;
  function refreshLater() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 400);
  }

  function fuelPlanBlock(p) {
    var b = p.bike;
    var rn = p.run;
    var bikeRows = [
      // The rows name the products the person chose, so the choice shows where it is used.
      prow('Every 15 min', 'About ' + b.sipMl + ' ml of ' + (!drinkName(p) || b.drinkShare <= 0 ? 'water' : b.drinkShare < 1 ? 'fluid' : drinkName(p))),
      b.drinkShare > 0 && b.drinkShare < 1 && drinkName(p) ? prow('Mix', Math.round(b.drinkShare * 100) + '% ' + drinkName(p) + ', the rest water') : null,
      b.gels ? prow(gelTimesNode(p, 'bike'), '1 serve of ' + gelName(p)) : prow('Gels', 'None needed: the drink covers it'),
      prow('Bottles', 'Start with ' + b.bottlesAtStart + (b.refills ? '; pick up ' + b.refills + ' more at aid stations' : '')),
      prow('Sodium', '~' + b.sodiumTarget + ' mg/hr (' + b.sodiumFromProducts + ' from your products)'),
      b.sodiumShort ? prow('Top up', '~' + b.sodiumShort + ' mg/hr more: a salt capsule or salty snack you have tried') : null
    ];
    var runRows = [
      rn.gels ? prow(gelTimesNode(p, 'run'), '1 serve of ' + gelName(p)) : prow('Gels', 'None needed for this run'),
      prow('Each aid station', 'Water, a few sips: about ' + Math.round(rn.fluidPerHour * 1000) + ' ml an hour'),
      prow('Sodium', '~' + rn.sodiumTarget + ' mg/hr (' + rn.sodiumFromProducts + ' from your gels)'),
      rn.sodiumShort ? prow('Top up', '~' + rn.sodiumShort + ' mg/hr more, or cola or sports drink at aid stations') : null
    ];
    return h('div', { class: 'stack' },
      h('section', { class: 'legplan' },
        h('header', null, h('h2', null, 'Before the swim'), null),
        h('p', { class: 'help', style: 'padding-bottom:8px' }, p.preRace)),
      h('section', { class: 'legplan' },
        h('header', null, h('h2', null, 'Bike · ' + T.fmtHM(b.minutes)), h('span', { class: 'badge' }, b.carbsPerHour + ' g/hr')),
        bikeRows,
        showsKm(p, 'bike') ? h('p', { class: 'help kmnote' }, RD.pace.KM_NOTE) : null),
      h('section', { class: 'legplan' },
        h('header', null, h('h2', null, 'Run · ' + T.fmtHM(rn.minutes)), h('span', { class: 'badge' }, rn.carbsPerHour + ' g/hr')),
        runRows,
        showsKm(p, 'run') ? h('p', { class: 'help kmnote' }, RD.pace.KM_NOTE) : null),
      h('div', { class: 'info warn' },
        h('div', null,
          h('p', null, 'Capped at what your gut has trained: ' + p.gut + ' g an hour. Fluid stays under your ' + (p.sweatTypical ? 'typical ' : '') + 'sweat rate of ' + p.sweat + ' L an hour.'),
          p.warnings.length ? h('ul', null, p.warnings.map(function (w) { return h('li', null, w); })) : null,
          h('p', null, h('b', null, 'Typical ranges, not medical advice.'), ' Practise this plan in training first. Never drink more than you sweat.'))));
  }
  // The packing list. It lives in the "Your fuel" card, under the choice that changes it.
  function carryList(p) {
    return h('div', { class: 'stack' },
      h('p', { class: 'label' }, 'Carry list'),
      h('ul', { class: 'carry' },
        h('li', null, p.carry.bikeGels + ' × ' + gelName(p) + ' on the bike'),
        h('li', null, p.carry.runGels + ' × ' + gelName(p) + ' for the run (T2 bag or race belt)'),
        h('li', null, p.carry.bottles + ' bottle' + (p.carry.bottles > 1 ? 's' : '') + (drinkName(p) && p.bike.drinkShare > 0 ? ' (' + drinkName(p) + (p.bike.drinkShare < 1 ? ' and water' : '') + ')' : ' of water')),
        p.bike.sodiumShort || p.run.sodiumShort ? h('li', null, 'Salt capsules or a salty snack you have tried in training') : null));
  }
  function prow(a, b) { return h('div', { class: 'prow' }, h('span', null, a), h('span', null, b)); }

  // ---------- products ----------

  // Which products are showing the typed "Other" box for carbs. A figure that is not on the list always shows it.
  var carbOther = {};

  // Carbs per serve: pick from the list (20 to 50 g in 5 g steps, from fuel.js), or choose Other and type the exact
  // figure from the label. A saved figure that is not on the list is shown as it is under Other, never rounded to a step.
  function carbPick(id, p, save) {
    var key = p.id || id;
    var steps = RD.fuel.carbSteps();
    var onList = typeof p.carbs === 'number' && steps.indexOf(p.carbs) !== -1;
    var other = !!carbOther[key] || !onList;
    var select = h('select', {
      id: id,
      onchange: function (e) {
        if (e.target.value === 'other') { carbOther[key] = true; }
        else { delete carbOther[key]; save(Number(e.target.value)); }
        refresh();
      }
    },
      steps.map(function (g) { return h('option', { value: String(g), selected: !other && g === p.carbs ? 'selected' : null }, g + ' g'); }),
      h('option', { value: 'other', selected: other ? 'selected' : null }, 'Other'));
    return h('div', { class: 'row-wrap' },
      h('label', { class: 'field', for: id }, 'Carbs per serve (g)', select),
      other ? numIn(id + 'x', 'Exact figure (g)', p.carbs, save) : null);
  }

  function products() {
    if (!Array.isArray(S.products)) { S.products = productList(); commit(); }
    var list = S.products;
    function upd(i, k, v) { list[i][k] = v; commit(); }
    return h('div', { class: 'app' },
      topBar(backLink('#/fuel', 'Fuel plan'), null),
      title('My products', 'Enter what you race with. Check the label: brands change their recipes.'),
      list.map(function (p, i) {
        var id = 'p' + i;
        return h('section', { class: 'card product' },
          h('div', { class: 'head' }, h('p', { class: 'legname' }, p.name || 'Product'),
            h('button', { type: 'button', class: 'back', onclick: function () { list.splice(i, 1); commit(); refresh(); } }, 'Remove')),
          h('label', { class: 'field', for: id + 'n' }, 'Name', h('input', { id: id + 'n', value: p.name, oninput: function (e) { upd(i, 'name', e.target.value); } })),
          RD.ui.choice([{ value: 'gel', label: 'Gel' }, { value: 'chew', label: 'Chews' }, { value: 'drink', label: 'Drink' }], p.kind,
            function (v) { upd(i, 'kind', v); if (v === 'drink' && !p.serveMl) upd(i, 'serveMl', 500); refresh(); }, 'pill', 'Kind'),
          h('div', { class: 'two' },
            carbPick(id + 'c', p, function (v) { upd(i, 'carbs', v); }),
            numIn(id + 's', 'Sodium per serve (mg)', p.sodium, function (v) { upd(i, 'sodium', v); })),
          p.kind === 'drink' ? numIn(id + 'm', 'Serve size (ml)', p.serveMl, function (v) { upd(i, 'serveMl', v); }) : null,
          p.kind === 'chew' ? h('p', { class: 'help' }, 'A serve is what you eat at once, for example 3 chews.') : null);
      }),
      h('div', { class: 'actions' },
        h('button', {
          type: 'button', class: 'btn second', onclick: function () {
            list.push({ id: 'p' + Date.now(), name: 'My product', kind: 'gel', carbs: 25, sodium: 0, serveMl: 0 }); commit(); refresh();
          }
        }, 'Add a product'),
        h('button', { type: 'button', class: 'btn ghost', onclick: function () { S.products = null; commit(); refresh(); } }, 'Back to the starter products'),
        h('a', { class: 'btn', href: '#/fuel' }, 'Done')));
  }
  // A blank or unreadable number is stored as null, never as 0, and the fuel plan refuses it.
  // The error updates in place, so typing and tapping Done are never interrupted by a redraw.
  function numIn(id, label, v, on) {
    var err = h('p', { class: 'error', id: id + '-err', role: 'alert' }, 'Enter a number, such as 25.');
    var input = h('input', {
      id: id, inputmode: 'decimal', value: v == null ? '' : v,
      oninput: function (e) { var n = RD.ui.num(e.target.value); on(n); show(n == null); }
    });
    function show(bad) {
      err.hidden = !bad;
      if (bad) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', err.id); }
      else { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }
    }
    show(v == null);
    return h('div', { class: 'row-wrap' }, h('label', { class: 'field', for: id }, label, input), err);
  }

  // ---------- print: the top-tube card ----------

  function buildPrint() {
    var pr = document.getElementById('print-root');
    RD.ui.clear(pr);
    var c = currentPrint;
    if (!c) return;
    var r = c.race || {};
    var p = c.pace;
    var f = c.fuel;
    var kids = [h('h2', null, raceTitle(r)),
      r.date ? h('p', null, longDate(r.date) + (startText(r.start) ? ' · ' + startText(r.start) : '')) : null,
      startText(r.transitionOpens) ? h('p', null, 'Transition opens ' + startText(r.transitionOpens)) : null];
    if (p) {
      var clockPrint = finishClock(r.start, p.finish);
      kids.push(h('h3', null, 'Pace'),
        h('p', null, 'Swim ', h('span', { class: 'big' }, pace(p.swim.pace)), ' /100m'),
        h('p', null, 'Bike ', h('span', { class: 'big' }, p.bike.watts ? range(p.bike.watts[0], p.bike.watts[1]) + ' W' : p.bike.hr ? range(p.bike.hr[0], p.bike.hr[1]) + ' bpm' : p.bike.effort.split(':')[0])),
        h('p', null, 'Run ', h('span', { class: 'big' }, pace(p.run.pace)), ' /km'),
        h('p', null, 'Finish ' + hm(p.finish)),
        clockPrint ? h('p', null, 'About ' + clockPrint) : null);
    }
    if (f && f.ok !== false) {
      if (c.race && c.race.fuel === f && fuelStale(c.race)) kids.push(h('p', null, h('b', null, 'Fuel plan out of date. Update it before race day.')));
      kids.push(h('h3', null, 'Bike fuel · ' + f.bike.carbsPerHour + ' g/hr'),
        h('p', null, 'Sip ~' + f.bike.sipMl + ' ml every 15 min'),
        f.bike.gels ? h('p', null, 'Gel ', h('span', { class: 'big' }, minutesList(f.bike.gelTimes))) : null,
        showsKm(f, 'bike') ? h('p', { class: 'fine' }, 'at ' + kmList(f, 'bike')) : null,
        h('h3', null, 'Run fuel · ' + f.run.carbsPerHour + ' g/hr'),
        f.run.gels ? h('p', null, 'Gel ', h('span', { class: 'big' }, minutesList(f.run.gelTimes))) : null,
        showsKm(f, 'run') ? h('p', { class: 'fine' }, 'at ' + kmList(f, 'run')) : null,
        h('p', null, 'Water at each aid station'));
    }
    kids.push(h('p', { class: 'fine' }, 'Times are from the start of each leg. ' + (f && f.ok !== false && (showsKm(f, 'bike') || showsKm(f, 'run')) ? RD.pace.KM_NOTE + ' ' : '') + 'Typical ranges, not medical advice.'));
    pr.appendChild(h('div', { class: 'tt' }, kids));
  }

  root.addEventListener('beforeprint', buildPrint);
  root.addEventListener('hashchange', function () { errors = {}; render(); });
  render();
})(this);
