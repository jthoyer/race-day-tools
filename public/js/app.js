/*
 * TRI Momentum: the app. One race plan, built in four steps, written to one race card.
 * 1 Choose a race, 2 Choose pacing (three parts), 3 Review nutrition, 4 the race card. The owner's four-step flow,
 * 8-9 Nov 2026. Code names such as fuel.js and #/fuel are older than the word "nutrition" and stay as they are.
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

  var DIST_LABEL = { standard: 'Olympic', '70.3': '70.3' };
  // A real, finite number. Note null >= 0 is true in JavaScript, so a plain comparison is not enough.
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
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
  // The km alone, in the same order as the times, for the 70 mm print card: "~22 km · ~64 km".
  function kmList(p, leg) { return p[leg].gelTimes.map(function (t) { return kmOf(p, leg, t) || '?'; }).join(' · '); }
  function showsKm(p, leg) { return p[leg].gels > 0 && p[leg].gelTimes.some(function (t) { return !!kmOf(p, leg, t); }); }
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
    var node = RD.ui.field({
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
        // Times can be typed as digits ("130" is 1:30) or with a dot ("1.30"). See time.js, tidyTime.
        var parsed = kind === 'num' ? RD.ui.num(text)
          : kind === 'clock' ? T.parseClock(T.tidyTime(text))
            : kind === 'hm' ? T.parseHM(T.tidyTime(text))
              : text;
        if (kind !== 'text' && parsed == null && text.trim() !== '') raw[path] = text;
        else delete raw[path];
        set(path, kind !== 'text' && text.trim() === '' ? null : parsed);
        // An error stays on screen until the next Next, so take it off as soon as what is typed reads. A field with
        // its own rule (opts.invalid, which reads the store) keeps it until the entry passes that rule.
        // A new one waits for the person to leave the field or press Next.
        var reads = opts.invalid ? !opts.invalid() : kind !== 'text' && parsed != null;
        if (errors[path] && reads) clearFieldError(e.target, path);
        if (opts.live) opts.live();
      },
      // When the person leaves a time field, show the time we read, so a slip is easy to see.
      onchange: kind === 'clock' || kind === 'hm' ? function (e) {
        var p = kind === 'clock' ? T.parseClock(T.tidyTime(e.target.value)) : T.parseHM(T.tidyTime(e.target.value));
        if (p != null) e.target.value = kind === 'clock' ? T.fmtPace(p) : T.fmtHM(p);
      } : null
    });
    // opts.invalid() gives a message when the entry can't be used. It shows once the person leaves the field, in place,
    // with no redraw: a redraw here would swallow the tap on whatever they are moving to.
    if (opts.invalid) {
      node.addEventListener('focusout', function (e) {
        var m = e.target.tagName === 'INPUT' ? opts.invalid() : '';
        if (m) showFieldError(e.target, path, m);
      });
    }
    return node;
  }

  // Take an error message off a field without redrawing the screen, so typing is not interrupted.
  function clearFieldError(input, path) {
    delete errors[path];
    var msg = document.getElementById(input.id + '-err');
    if (msg) msg.remove();
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  }

  // Put an error message by a field without redrawing the screen.
  function showFieldError(input, path, msg) {
    errors[path] = msg;
    var errId = input.id + '-err';
    var el = document.getElementById(errId);
    if (el) el.textContent = msg;
    else input.closest('.row-wrap').appendChild(h('p', { class: 'error', id: errId, role: 'alert' }, msg));
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', errId);
  }

  // True when something typed in this field can't be read.
  function unreadable(path) { return raw[path] != null; }

  // ---------- chrome ----------

  function topBar(left, right) {
    return h('header', { class: 'top' }, left, right);
  }
  // The wordmark (the owner's, 9 Nov 2026): three ink boxes holding white T, R and I, then "Momentum" in Outfit.
  // In a header it is a link home. Big, on the front page, it is a picture with the same name.
  function wordmark(big) {
    var kids = [h('span', { class: 'tri', 'aria-hidden': 'true' }, h('b', null, 'T'), h('b', null, 'R'), h('b', null, 'I')),
      h('span', { class: 'word' }, 'Momentum')];
    return big ? h('div', { class: 'mark big', role: 'img', 'aria-label': 'TRI Momentum' }, kids)
      : h('a', { class: 'mark', href: '#/', 'aria-label': 'TRI Momentum' }, kids);
  }
  function myPlan() { return h('a', { class: 'toplink', href: '#/' }, 'My plan'); }
  function backLink(href, text) {
    return h('a', { class: 'back', href: href },
      svg('M15 5l-7 7 7 7'), text || 'Back');
  }
  // A quiet link under the actions, such as "Back: choose a race".
  function quietLink(href, text) { return h('a', { class: 'back', href: href }, text); }
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
  var TICK = 'M5 12l5 5 9-10';

  // The four steps, and where each opens. Home and the rail both read this, so they never disagree about what is done.
  // Race is done when the race has a date, Pacing when pace is saved, Nutrition when nutrition is saved. The race card
  // (step 4) is done only once pace and nutrition are both saved, and the rail never shows it done (it is the goal).
  function stepState(r) {
    return {
      race: !!(r && r.date),
      pacing: !!(r && r.pace),
      nutrition: !!(r && r.fuel),
      card: !!(r && r.pace && r.fuel)
    };
  }
  function pacingHref(r) { return r && r.pace ? '#/pacing/3' : '#/pacing/1'; }

  // The rail (replaces the step bar, 9 Nov 2026): Race, Pacing, Nutrition and Race card, on every step and the race card.
  // Any step opens from any other, so a person can change one thing and go straight back to the card. A step that is
  // done has a green circle with a tick, and says so to a screen reader. It stays in view as the page scrolls.
  function rail(current) {
    var r = S.race;
    if (!r) return null;
    var done = stepState(r);
    var steps = [
      { id: 'race', label: 'Race', href: '#/setup/1', done: done.race },
      { id: 'pacing', label: 'Pacing', href: pacingHref(r), done: done.pacing },
      { id: 'nutrition', label: 'Nutrition', href: '#/fuel', done: done.nutrition },
      { id: 'card', label: 'Race card', href: '#/card', done: false, goal: true }
    ];
    return h('nav', { class: 'rail noprint', 'aria-label': 'Your four steps' }, steps.map(function (st, i) {
      var cls = ['r', st.done ? 'done' : '', st.goal ? 'goal' : '', st.id === current ? 'now' : ''].filter(Boolean).join(' ');
      return h('a', { href: st.href, class: cls, 'aria-current': st.id === current ? 'step' : null },
        h('span', { class: 'c', 'aria-hidden': 'true' }, st.done ? svg(TICK, 14) : String(i + 1)),
        st.label, st.done ? h('span', { class: 'sr-only' }, ', done') : null);
    }));
  }
  // The part bar on the three pacing parts.
  var PARTS = ['Your fitness', 'Course and heat', 'Your targets'];
  function partBar(n) {
    var segs = [];
    for (var i = 1; i <= PARTS.length; i++) segs.push(h('span', { class: 'seg' + (i < n ? ' done' : i === n ? ' now' : '') }));
    return h('div', { class: 'progress' },
      h('p', { class: 'label' }, 'Pacing · part ' + n + ' of ' + PARTS.length),
      h('div', { class: 'segs three', 'aria-hidden': 'true' }, segs),
      h('p', { class: 'help parts' }, PARTS.map(function (t, i) { return [i ? ' · ' : null, i === n - 1 ? h('b', null, t) : t]; })));
  }
  function title(text, sub) {
    return h('div', null, h('h1', { tabindex: '-1' }, text), sub ? h('p', { class: 'sub' }, sub) : null);
  }
  function note(text) { return h('p', { class: 'foot' }, text); }

  // ---------- routing ----------

  // #/setup/1 is step 1 (the guides link to it). #/pacing/1 to #/pacing/3 are the parts of step 2. #/fuel is step 3.
  // The old addresses still open a live screen: #/setup/2 and #/setup/3 open part 1, #/setup/4 part 2, #/setup/5 part 3,
  // and #/saved opens the race card.
  var routes = {
    '': home,
    setup: setup,
    pacing: pacing,
    saved: raceCard,
    fuel: fuelStep,
    card: raceCard,
    products: products
  };

  function render() {
    var hash = (location.hash || '').replace(/^#\/?/, '');
    var parts = hash.split('/');
    var fn = routes[parts[0]] || home;
    currentPrint = null;
    if (!render.quiet) {
      aboutShown = false;
      // The "targets saved" line shows on the first arrival at step 3 only, and stays while that screen redraws.
      if (savedNote === 'shown') savedNote = false;
      else if (savedNote === 'pending') savedNote = parts[0] === 'fuel' ? 'shown' : false;
    }
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

  // ---------- home ----------

  // A race with no name, date, pace or nutrition is the same as no race: show the front page.
  // (Opening step 1 and then leaving it with nothing typed leaves such a race behind.)
  function isBlankRace(r) { return !r || (!r.name && !r.date && !r.pace && !r.fuel); }

  // The guides, at the bottom of the front page only (owner, 9 Nov 2026). A new guide is one more entry here. Both are
  // drafts: their ranges are not yet checked against sources, so each link says so.
  var GUIDES = [
    { href: 'guides/race-fuel.html', title: 'How many gels for a 70.3?', draft: true },
    { href: 'guides/bike-pacing.html', title: 'How hard should you ride a 70.3 bike?', draft: true }
  ];
  function guideLinks() {
    return h('section', { class: 'guides', 'aria-label': 'Guides' },
      h('p', { class: 'label' }, 'Guides'),
      h('ul', null, GUIDES.map(function (g) {
        return h('li', null, h('a', { href: g.href }, g.title, g.draft ? h('span', { class: 'tag' }, 'Draft') : null));
      })));
  }

  // One of the four steps, as on the front page and the coming-back screen.
  // o: { state: 'done' | 'now' | 'todo' or '' for the plain front-page look, goal, desc, link: [href, text] }
  function stepItem(n, name, o) {
    return h('li', { class: 'step' + (o.state ? ' ' + o.state : '') + (o.goal ? ' goal' : '') },
      h('span', { class: 'dot', 'aria-hidden': 'true' }, o.state === 'done' ? svg(TICK, 14) : String(n)),
      h('div', null,
        h('p', { class: 't' }, name, o.state === 'done' ? h('span', { class: 'sr-only' }, ', done') : null),
        o.desc ? h('p', { class: 'd' }, o.desc) : null),
      o.link ? h('a', { href: o.link[0] }, o.link[1]) : null);
  }

  var COUNT_SENTENCE = ['Four steps to go.', 'One step done, three to go.', 'Two steps done, two to go.', 'Three steps done, one to go.', 'All four steps done.'];
  var STEP_NAMES = ['Choose a race', 'Choose pacing', 'Review nutrition', 'Get your race card for your top tube'];
  var OUT_OF_DATE = 'Out of date: Edit to update it';
  var SWEAT_NEEDED = 'Add your sweat rate on step 3, or use a typical value.';

  function home() {
    var r = S.race;
    if (isBlankRace(r)) {
      return h('div', { class: 'app home' },
        h('div', { class: 'startmark' }, wordmark(true)),
        h('div', null,
          h('h1', { tabindex: '-1' }, 'Race with a plan.'),
          h('p', { class: 'lead' }, 'Pace targets and a timed nutrition plan for your triathlon, on one race card for your bike.')),
        h('ol', { class: 'steps' }, STEP_NAMES.map(function (t, i) { return stepItem(i + 1, t, { goal: i === 3 }); })),
        h('div', { class: 'actions' },
          h('a', { class: 'btn', href: '#/setup/1' }, 'Get started'),
          note('Free. No account needed. Saved on this phone only.')),
        guideLinks());
    }

    var days = T.daysUntil(r.date);
    var done = stepState(r);
    var count = [done.race, done.pacing, done.nutrition, done.card].filter(Boolean).length;
    var tp = taperInfo(r);
    // The first step not done among 1 to 3 is the next one. When 1 to 3 are all done the action opens the card.
    var nextStep = !done.race ? 1 : !done.pacing ? 2 : !done.nutrition ? 3 : 0;
    var dist = DIST_LABEL[r.distance] || '70.3';
    var p = r.pace;
    var f = r.fuel;
    var bikeText = p ? (p.bike.watts ? range(p.bike.watts[0], p.bike.watts[1]) + ' W' : p.bike.hr ? range(p.bike.hr[0], p.bike.hr[1]) + ' bpm' : p.bike.effort.split(':')[0]) : '';
    var items = [
      stepItem(1, STEP_NAMES[0], {
        state: done.race ? 'done' : nextStep === 1 ? 'now' : 'todo',
        desc: dist + ' · ' + (r.date ? longDate(r.date) : 'No date yet'),
        link: done.race ? ['#/setup/1', 'Edit'] : null
      }),
      stepItem(2, STEP_NAMES[1], {
        state: done.pacing ? 'done' : nextStep === 2 ? 'now' : 'todo',
        desc: done.pacing ? (paceStale(r) ? OUT_OF_DATE : 'Bike ' + bikeText + ' · finish ' + hm(p.finish)) : 'Targets for each leg and a finish range',
        link: done.pacing ? [pacingHref(r), 'Edit'] : null
      }),
      stepItem(3, STEP_NAMES[2], {
        state: done.nutrition ? 'done' : nextStep === 3 ? 'now' : 'todo',
        desc: done.nutrition ? (ownSweatBad() || fuelStale(r) ? [fuelStale(r) ? OUT_OF_DATE : '', ownSweatBad() ? SWEAT_NEEDED : ''].filter(Boolean).join(' ') : 'Bike ' + f.bike.carbsPerHour + ' g/hr · run ' + f.run.carbsPerHour + ' g/hr')
          : nextStep === 3 ? 'Next: check your gut figure and pick your carbs' : 'Carbs, fluid and sodium per leg',
        link: done.nutrition ? ['#/fuel', 'Edit'] : null
      }),
      stepItem(4, STEP_NAMES[3], {
        state: done.card ? 'done' : 'todo',
        goal: !done.card,
        desc: done.card ? 'Ready to print' : 'Ready once nutrition is done',
        link: done.card ? ['#/card', 'Open'] : null
      })
    ];
    var action = nextStep === 1 ? ['#/setup/1', 'Continue: choose a race']
      : nextStep === 2 ? [pacingHref(r), 'Continue: choose pacing']
        : nextStep === 3 ? ['#/fuel', 'Continue: review nutrition'] : ['#/card', 'Open my race card'];

    return h('div', { class: 'app home' },
      topBar(wordmark(), null),
      h('div', null,
        days != null ? h('p', { class: 'label' }, daysText(days)) : null,
        h('h1', { tabindex: '-1' }, raceTitle(r)),
        h('p', { class: 'sub' }, (r.date ? longDate(r.date) : 'No date yet') + '. ' + COUNT_SENTENCE[count]),
        tp && tp.short ? h('p', { class: 'small' }, tp.short) : null),
      h('ol', { class: 'steps' }, items),
      h('div', { class: 'actions' },
        h('a', { class: 'btn', href: action[0] }, action[1]),
        h('button', {
          type: 'button', class: 'back', onclick: function () {
            if (root.confirm('Start a new race? This clears the current race plan. Your details stay.')) {
              S.race = null; commit(); go('setup/1');
            }
          }
        }, 'Start a new race'),
        note('Saved on this phone only.')));
  }

  // ---------- step 1: choose a race ----------

  function ensureRace() {
    if (!S.race) {
      S.race = { name: '', distance: '70.3', date: '', course: 'rolling', heat: 'warm', pace: null, fuel: null, splits: null };
      commit();
    }
    return S.race;
  }

  // The old addresses #/setup/2 to #/setup/5 land on the parts of step 2.
  var LEGACY_PART = { 2: 1, 3: 1, 4: 2, 5: 3 };
  function setup(args) {
    var n = Number(args[0]) || 1;
    if (LEGACY_PART[n]) return pacing([String(LEGACY_PART[n])]);
    return setupRace(ensureRace());
  }
  function pacing(args) {
    var n = Number(args[0]) || 1;
    if (n < 1 || n > 3) n = 1;
    var r = ensureRace();
    var parts = { 1: pacingFitness, 2: pacingCourse, 3: pacingTargets };
    return h('div', { class: 'app' },
      topBar(wordmark(), myPlan()),
      rail('pacing'),
      partBar(n),
      parts[n](r));
  }

  // Runs a step's check. Returns true when it passes; otherwise shows the errors and puts focus on the first one.
  function passes(check) {
    errors = check ? check() : {};
    if (Object.keys(errors).length) { refresh(); var first = view.querySelector('[aria-invalid="true"]'); if (first) first.focus(); return false; }
    return true;
  }
  function next(path, check) {
    return function () { if (passes(check)) go(path); };
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

  function setupRace(r) {
    var tp = taperInfo(r);
    var days = tp ? tp.days : null;
    function checkRace() {
      if (!r.name) set('race.name', 'My race');
      return {};
    }
    return h('div', { class: 'app' },
      topBar(wordmark(), myPlan()),
      rail('race'),
      h('div', { class: 'stack' },
        title('Choose a race', 'Every step works back from race day.'),
        bound('race.name', 'text', { label: 'Race name', placeholder: 'For example, Spring 70.3' }),
        h('section', { class: 'card' },
          h('p', { class: 'label' }, 'Distance'),
          RD.ui.choice([{ value: 'standard', label: 'Olympic' }, { value: '70.3', label: '70.3' }], r.distance,
            function (v) { set('race.distance', v); refresh(); }, 'pill', 'Distance'),
          h('p', { class: 'help' }, legsText(r.distance))),
        bound('race.date', 'text', { label: 'Race date', type: 'date', live: refresh }),
        // A date field shows nothing at all on some phones while it is empty, so say what to do.
        r.date ? null : h('p', { class: 'help' }, 'Tap the date to choose it.'),
        tp ? h('section', { class: 'countdown' },
          h('div', { style: 'flex:1' }, h('p', { class: 'k' }, 'COUNTDOWN'), h('p', { class: 'v' }, daysText(days))),
          h('p', { class: 'n' }, tp.line)) : null,
        tp && days >= 0 ? taperPicker(r, tp) : null,
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', onclick: next('pacing/1', checkRace) }, 'Next: choose pacing'),
          hasPlan(r) ? backToCard(checkRace) : null,
          h('p', { class: 'small center' }, 'Saved on this phone as you go.'))));
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
      h('p', { class: 'help' }, 'We count back from race day. Our guide is ' + guide + ' days for ' + (r.distance === 'standard' ? 'an Olympic' : 'a 70.3') + ' race' +
        (tp.own ? '. You chose ' + tp.len + '.' : '.') + ' If your coach says otherwise, go with your coach.'));
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


  // ---------- step 2: choose pacing, part 1 (your fitness) ----------

  var MODE_NEEDS = {
    power: 'Power needs your FTP.',
    hr: 'Heart rate needs your threshold heart rates and the speed of a hard long ride.',
    effort: 'Effort needs only the speed of a hard long ride.'
  };

  function pacingFitness() {
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
      title('Choose pacing', 'How will you pace the bike and the run?'),
      // The choice comes first (S2). What each mode needs is checked against validate() in pace.js: the run threshold
      // pace is needed in all three, and so are CSS and body weight.
      h('div', { class: 'stack tight' },
        RD.ui.choice([{ value: 'power', label: 'Power' }, { value: 'hr', label: 'Heart rate' }, { value: 'effort', label: 'Effort' }], mode,
          function (v) { set('fitness.mode', v); errors = {}; refresh(); }, 'pill', 'How you pace the bike and run'),
        h('p', { class: 'help' }, MODE_NEEDS[mode] + ' The swim always uses your CSS.')),
      h('section', { class: 'card' },
        h('p', { class: 'legname' }, 'Swim'),
        bound('fitness.css', 'clock', { label: 'CSS, your critical swim speed', unit: '/100m', placeholder: '1:45' }),
        h('p', { class: 'help' }, 'Your steady swim pace per 100 m in a pool. It comes from a 200 m and a 400 m test. Your swim target starts from it.'),
        h('details', { class: 'test' }, h('summary', null, 'How to test CSS'),
          h('p', { class: 'help' }, 'Swim a 400 m and a 200 m time trial with a rest between. CSS pace per 100 m is (400 time − 200 time) ÷ 2.'))),
      bike,
      h('section', { class: 'card' },
        h('p', { class: 'legname' }, 'Run'),
        mode === 'hr' ? bound('fitness.runLthr', 'num', { label: 'Run threshold heart rate', unit: 'bpm' }) : null,
        bound('fitness.runThreshold', 'clock', { label: 'Run threshold', unit: '/km', placeholder: '4:50' }),
        h('details', { class: 'test' }, h('summary', null, 'How to test it'),
          h('p', { class: 'help' }, 'Run 30 minutes solo as hard as you can hold evenly. Your average pace for the last 20 minutes is your threshold pace. A recent 10 km race pace is close enough.'))),
      h('section', { class: 'card' },
        bound('details.weight', 'num', { label: 'Body weight', unit: 'kg' }),
        // Weight is used only to turn a power target into a bike time (pace.js, bikeSpeed). The nutrition plan
        // never reads it, so this line must not say it sets fluid or sodium. The owner's wording.
        h('p', { class: 'help' }, 'Turns your power into a bike time. It does not change your nutrition plan.')),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: next('pacing/2', checkFitness) }, 'Next: course and heat'),
        hasPlan(S.race) ? backToCard(checkFitness) : null,
        quietLink('#/setup/1', 'Back: choose a race')));
  }

  function checkFitness() {
    var e = {};
    var map = { css: 'fitness.css', ftp: 'fitness.ftp', runThreshold: 'fitness.runThreshold', bikeLthr: 'fitness.bikeLthr', runLthr: 'fitness.runLthr', steadySpeed: 'fitness.steadySpeed', weight: 'details.weight' };
    var msgs = {};
    RD.pace.validate(paceInput()).forEach(function (x) { msgs[x.field] = x.message; if (map[x.field]) e[map[x.field]] = x.message; });
    Object.keys(map).forEach(function (k) {
      if (!unreadable(map[k])) return;
      // The swim and run pace fields are times: say what to type. A weight we can't read gets the weight message,
      // which pace.js owns. The rest are plain numbers.
      e[map[k]] = k === 'css' || k === 'runThreshold' ? T.unreadableTimeMessage(raw[map[k]], 'clock')
        : k === 'weight' && msgs.weight ? msgs.weight : 'That doesn’t look right. Check the format.';
    });
    return e;
  }

  // ---------- step 2, part 2 (course and heat) ----------

  function pacingCourse(r) {
    return h('div', { class: 'stack' },
      title('Course and heat', 'Hills change your bike target. Heat changes your run and your nutrition.'),
      h('section', { class: 'card' },
        h('p', { class: 'legname' }, 'Bike course'),
        RD.ui.choice(COURSE, r.course, function (v) { set('race.course', v); refresh(); }, 'opt', 'Bike course'),
        h('p', { class: 'help' }, 'Not sure? The race manual shows the elevation. Under 500 m of climbing over 90 km is flat; over 1,000 m is hilly.')),
      h('section', { class: 'card' },
        h('p', { class: 'legname' }, 'Forecast heat on race day'),
        RD.ui.choice(HEAT, r.heat, function (v) { set('race.heat', v); refresh(); }, 'opt', 'Forecast heat'),
        h('p', { class: 'help' }, 'Check it again in race week. You can change it any time.')),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: next('pacing/3') }, 'Next: your targets'),
        hasPlan(r) ? backToCard() : null,
        quietLink('#/pacing/1', 'Back: your fitness')));
  }

  // ---------- step 2, part 3 (your targets) ----------

  function targetsBlock(p) {
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
      h('div', { class: 'finish' }, h('span', { class: 'k' }, 'FINISH'), h('span', { class: 'v' }, hm(p.finish))));
  }

  // The line that says targets were saved. It shows on step 3 the first time round (see render).
  var savedNote = false;
  function statusLine(text) {
    return h('div', { class: 'info', role: 'status', style: 'background:var(--go-bg);color:var(--go);font-weight:700' }, text);
  }

  function pacingTargets(r) {
    var p = RD.pace.planPace(paceInput());
    if (!p.ok) {
      return h('div', { class: 'stack' },
        title('A number is missing', 'We need these before we can set your targets.'),
        h('div', { class: 'info warn', role: 'alert' }, h('ul', null, p.errors.map(function (e) { return h('li', null, e.message); }))),
        h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#/pacing/1' }, 'Fix my numbers'), quietLink('#/pacing/2', 'Back: course and heat')));
    }
    currentPrint = { race: r, pace: p, fuel: r.fuel };
    // The changeover fields show their message as soon as an entry can't be used. The plan above uses our guide
    // for that changeover until it can, and Save waits for it.
    ['race.t1', 'race.t2'].forEach(function (path) { var m = changeoverError(path); if (m) errors[path] = m; else delete errors[path]; });
    var guide = RD.pace.T1[r.distance] ? r.distance : '70.3';
    return h('div', { class: 'stack' },
      title('Your pace targets', 'Hold these and you finish strong. Each is a range, not one number.'),
      targetsBlock(p),
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
            // The first time through, step 3 follows, and says the targets were saved. After that, back to the card.
            if (first) savedNote = 'pending';
            go(first ? 'fuel' : 'card');
          }
        }, 'Save to my race card'),
        quietLink('#/pacing/2', 'Back: course and heat')));
  }

  // ---------- step 4: the race card ----------

  function raceCard() {
    var r = S.race;
    if (!r) return home();
    currentPrint = { race: r, pace: r.pace, fuel: r.fuel };
    // The yellow action is the next step until pace and nutrition are both saved. Then it is Print (one yellow a screen).
    var nextAction = !r.pace ? h('a', { class: 'btn', href: '#/pacing/1' }, 'Choose pacing')
      : !r.fuel ? h('a', { class: 'btn', href: '#/fuel' }, 'Review nutrition') : null;
    return h('div', { class: 'app' },
      topBar(wordmark(), myPlan()),
      rail('card'),
      cardBody(r),
      nextAction,
      printButton(!nextAction),
      note('Typical ranges, not medical advice.'));
  }

  function cardBody(r) {
    var d = T.addDays(r.date, 0);
    var days = T.daysUntil(r.date);
    var p = r.pace;
    var f = r.fuel;
    var paceSec;
    if (p) {
      var bikeStat = p.bike.watts ? [range(p.bike.watts[0], p.bike.watts[1]), 'watts'] : p.bike.hr ? [range(p.bike.hr[0], p.bike.hr[1]), 'bpm'] : ['Effort', p.bike.effort.split(':')[0]];
      paceSec = h('section', { class: 'sec' },
        h('div', { class: 'sechead' }, h('p', { class: 'label' }, 'Pacing'), h('a', { href: pacingHref(r) }, 'Step 2')),
        paceStale(r) ? h('p', { class: 'notice warn', role: 'status' }, 'Your numbers changed since these targets. Open Pacing to update them.') : null,
        h('div', { class: 'stats' },
          stat('Swim', pace(p.swim.pace), '/100m'),
          stat('Bike', bikeStat[0], bikeStat[1]),
          stat('Run', pace(p.run.pace), '/km')),
        h('p', null, 'Finish ', h('b', null, hm(p.finish))),
        // The changeovers the finish includes: the athlete's own, or our guide (RD-031).
        p.t1 && p.t2 ? h('p', { class: 'small' }, 'Changeovers: T1 ' + hm(p.t1) + ' · T2 ' + hm(p.t2)) : null);
    } else {
      paceSec = h('section', { class: 'sec' },
        h('div', { class: 'sechead' }, h('p', { class: 'label' }, 'Pacing'), h('a', { href: '#/pacing/1' }, 'Step 2')),
        h('p', { class: 'small' }, 'Targets for each leg and a finish range.'));
    }
    var nutSec;
    if (f) {
      nutSec = h('section', { class: 'sec' },
        h('div', { class: 'sechead' }, h('p', { class: 'label' }, 'Nutrition'), h('a', { href: '#/fuel' }, 'Step 3')),
        // Both can show at once: the sweat line never hides the out-of-date notice.
        fuelStale(r) ? h('p', { class: 'notice warn', role: 'status' }, 'Your splits, details or products changed since this plan. Open Nutrition to update it.') : null,
        ownSweatBad() ? h('p', { class: 'notice warn', role: 'status' }, 'Add your sweat rate on ', h('a', { href: '#/fuel' }, 'step 3'), ', or use a typical value.') : null,
        legCard('Bike', f, 'bike'),
        legCard('Run', f, 'run'),
        clockNote(f),
        h('p', { class: 'small' }, h('a', { href: '#/fuel' }, 'Change gel times')));
    } else {
      nutSec = h('section', { class: 'sec' },
        h('div', { class: 'sechead' }, h('p', { class: 'label' }, 'Nutrition'), h('a', { href: '#/fuel' }, 'Step 3')),
        p && r.splits ? h('p', null, 'Uses your splits: bike about ' + T.fmtHM(r.splits.bike) + ', run about ' + T.fmtHM(r.splits.run) + '.') : h('p', { class: 'small' }, 'Carbs, fluid and sodium per leg.'));
    }
    return h('article', { class: 'racecard' },
      h('div', { class: 'band' },
        h('div', { class: 'date' },
          h('strong', null, d ? String(d.getDate()) : '–'),
          h('span', null, d ? d.toLocaleDateString('en-AU', { month: 'short' }).toUpperCase() : '')),
        h('div', { style: 'flex:1;min-width:0' },
          h('h1', { tabindex: '-1' }, raceTitle(r)),
          h('p', null, [d ? d.toLocaleDateString('en-AU', { weekday: 'long' }) : '', daysText(days)].filter(Boolean).join(' · ')),
          taperInfo(r) && taperInfo(r).short ? h('p', null, taperInfo(r).short) : null)),
      paceSec,
      nutSec);
  }

  // The pace behind one leg of the pace plan, in the middle of its range: "~1:45 /100m", "~34 km/h", "~4:50 /km" (RD-030).
  // Falls back to 'h:mm' when the plan holds no readable pace, so a blank is never shown as zero.
  function legPace(r, leg) {
    function isPos(v) { return typeof v === 'number' && isFinite(v) && v > 0; }
    var p = r && r.pace && r.pace[leg];
    if (leg === 'bike') {
      var km = RD.pace.LEGS[r && r.distance] && RD.pace.LEGS[r.distance].bike;
      var min = r && r.splits && r.splits.bike;
      return isPos(km) && isPos(min) ? '~' + Math.round(km / (min / 60)) + ' km/h' : 'h:mm';
    }
    var pace = p && p.pace;
    if (!pace || !isPos(pace[0]) || !isPos(pace[1])) return 'h:mm';
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
  // What the bike bottle holds: water, the drink on its own, or the drink mixed with water.
  function bottleKind(f) {
    var dn = drinkName(f);
    var share = f.bike.drinkShare;
    return !dn || !(share > 0) ? 'water' : share < 1 ? 'both' : 'drink';
  }
  function cap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
  function sipKind(f) {
    var k = bottleKind(f);
    return k === 'water' ? 'water' : k === 'both' ? drinkName(f) + ' and water' : drinkName(f);
  }
  // One leg of the nutrition plan as a card (step 3 and the race card): the leg and its carbs an hour, the drink line on
  // the bike, then each gel as a row with its time first and large and its km on the right (RD-025), then the bottles,
  // sodium and top-up lines. The words match the old plan rows.
  function legCard(name, f, leg) {
    var L = f[leg];
    var gel = cap(gelName(f));
    var kids = [h('header', null, h('h3', null, name), h('span', { class: 'badge' }, L.carbsPerHour + ' g/hr'))];
    function line(text) { kids.push(h('p', { class: 'tlline' }, text)); }
    if (leg === 'bike') {
      line(cap(sipKind(f)) + ': about ' + L.sipMl + ' ml every 15 min');
      if (bottleKind(f) === 'both') line('Mix: ' + Math.round(L.drinkShare * 100) + '% ' + drinkName(f) + ', the rest water');
    }
    if (L.gels) {
      L.gelTimes.forEach(function (t) {
        var k = kmOf(f, leg, t);
        kids.push(h('div', { class: 'tlrow' }, h('b', null, T.fmtHM(t)), h('span', null, gel), k ? h('span', { class: 'km' }, k) : null));
      });
    } else {
      line(leg === 'bike' ? 'No gels needed: the drink covers it' : 'No gels needed; sports drink at aid stations if you want it.');
    }
    if (leg === 'run') {
      line('Water at each aid station');
      if (isNum(L.fluidPerHour)) line('A few sips: about ' + Math.round(L.fluidPerHour * 1000) + ' ml an hour');
    }
    if (leg === 'bike' && isNum(L.bottlesAtStart)) line('Bottles: start with ' + L.bottlesAtStart + (L.refills ? '; pick up ' + L.refills + ' more at aid stations' : ''));
    if (isNum(L.sodiumTarget) && isNum(L.sodiumFromProducts)) line('Sodium: ~' + L.sodiumTarget + ' mg/hr (' + L.sodiumFromProducts + ' from your ' + (leg === 'bike' ? 'products' : 'gels') + ')');
    if (L.sodiumShort) line('Top up: ~' + L.sodiumShort + ' mg/hr more' + (leg === 'bike' ? ': a salt capsule or salty snack you have tried' : ', or cola or sports drink at aid stations'));
    return h('div', { class: 'tl' }, kids);
  }
  // One go-by-the-clock note for the whole plan, whenever any km shows. The text is KM_NOTE in pace.js. Its first
  // sentence is set in bold, taken from that text and never retyped here.
  function clockNote(f) {
    if (!showsKm(f, 'bike') && !showsKm(f, 'run')) return null;
    var n = RD.pace.KM_NOTE;
    var cut = n.indexOf('. ') + 1;
    return h('p', { class: 'notice go' }, cut > 0 ? [h('b', null, n.slice(0, cut)), n.slice(cut)] : n);
  }
  // Print is outlined, and yellow only when it is the one action left on the screen.
  function printButton(primary) {
    return h('button', { type: 'button', class: 'btn' + (primary ? '' : ' ghost'), onclick: function () { root.print(); } },
      svg('M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z'), 'Print top-tube card');
  }

  // ---------- nutrition data ----------

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
  // An own sweat rate (typical not chosen) that is blank, unreadable or out of range. fuelInput() reads a blank own rate
  // as "typical", so on its own it would swap the typical rate in without a word. The plan refuses it instead (fuelStep).
  function ownSweatBad() {
    var d = S.details;
    if (d.sweatTypical) return false;
    // An unreadable entry is stored as null, so !isNum covers it too.
    return !isNum(d.sweat) || fuelFieldBad('sweat');
  }
  // The input is checked by fuel.js, so the limits stay there. fuelMessage() is fuel.js's own message for a field.
  function fuelFieldBad(field) { return RD.fuel.validate(fuelInput().input).some(function (e) { return e.field === field; }); }
  function fuelMessage(field) {
    var bad = Object.assign({}, fuelInput().input);
    bad[field] = NaN;
    var e = RD.fuel.validate(bad).filter(function (x) { return x.field === field; })[0];
    return e ? e.message : '';
  }
  // Only the input key says a plan is out of date, so a save from before this change is never called out of date by it.
  // A bad own sweat rate is said beside it, never instead of it (SWEAT_NEEDED), and step 3 refuses to re-plan until it is fixed.
  function fuelStale(r) { return !!(r && r.fuel && r.fuel.inputKey !== inputKey(fuelInput().input)); }

  // ---------- step 3: review nutrition ----------

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
    // An own sweat rate that is blank or unreadable is read by fuelInput() as "typical". Here it is refused instead,
    // so it is never quietly swapped for the typical rate. No plan is made, and none can be saved, until it is fixed.
    if (ownSweatBad() && (plan.ok || !plan.errors.some(function (e) { return e.field === 'sweat'; }))) {
      plan = { ok: false, errors: (plan.ok ? [] : plan.errors).concat([{ field: 'sweat', message: fuelMessage('sweat') }]) };
    }
    if (plan.ok) plan.inputKey = inputKey(input);

    // Splits: from the pacing, or typed in.
    var splitsBox;
    if (fromPlan) {
      splitsBox = h('section', { class: 'fromplan' },
        h('p', { class: 'label' }, 'From your pacing'),
        // The same tiles as the race card. The big time is the middle of each pace range, which is what the plan uses.
        // The small line is the pace it came from (RD-030).
        h('div', { class: 'stats' }, stat('Swim', T.fmtHM(r.splits.swim), legPace(r, 'swim')), stat('Bike', T.fmtHM(r.splits.bike), legPace(r, 'bike')), stat('Run', T.fmtHM(r.splits.run), legPace(r, 'run'))),
        h('p', { class: 'help' }, 'Times are h:mm. The big time is the middle of each range in your pacing, and the small line is its pace.'),
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
          RD.ui.choice([{ value: 'standard', label: 'Olympic' }, { value: '70.3', label: '70.3' }], S.solo.distance,
            function (v) { set('solo.distance', v); refresh(); }, 'pill', 'Distance')) : null,
        h('div', { class: 'two' },
          bound(solo ? 'solo.bikeMin' : timesPath + '.bike', 'hm', { label: 'Bike time', placeholder: '2:45', live: refreshLater }),
          bound(solo ? 'solo.runMin' : timesPath + '.run', 'hm', { label: 'Run time', placeholder: '1:55', live: refreshLater })),
        h('p', { class: 'help' }, 'Type h:mm.' + (!solo && r.splits ? '' : ' Your pacing fills these in for you.')),
        !solo && r.splits ? h('button', { type: 'button', class: 'back', style: 'color:var(--link)', onclick: function () { r.splitsByHand = null; commit(); refresh(); } }, 'Use my pacing times') : null);
    }

    // Your gut and sweat. First time, or after Change, two questions. Later, a summary with a Change link.
    // The gut figure has no default: its field starts empty, and the plan waits until it reads. A blank is never zero
    // (isNum, not a truthiness test: 0 g/hr is a real figure).
    var gutBad = fuelFieldBad('gut');
    var sweatBad = ownSweatBad();
    if (gutBad || sweatBad) aboutShown = true;
    var heatKey = RD.fuel.TYPICAL_SWEAT[ctx.heat] ? ctx.heat : 'warm';
    var typicalText = 'Typical for ' + heatKey + ': ' + RD.fuel.TYPICAL_SWEAT[heatKey] + ' L/hr';
    var heatChoice = RD.ui.choice(HEAT.map(function (x) { return { value: x.value, label: x.label + ', ' + x.hint }; }), ctx.heat,
      function (v) { set(base + '.heat', v); refresh(); }, 'pill', 'Forecast heat');
    var gutSweat;
    if (aboutShown) {
      gutSweat = h('section', { class: 'card' },
        h('p', { class: 'label' }, 'Your gut and sweat'),
        h('p', { class: 'legname' }, 'Forecast heat'),
        heatChoice,
        bound('details.gut', 'num', {
          label: 'Carbs your gut handles', unit: 'g an hour', live: refreshLater,
          invalid: function () { return fuelFieldBad('gut') ? fuelMessage('gut') : ''; }
        }),
        h('p', { class: 'help' }, 'The most you have taken on long rides without trouble. The plan never goes above it.'),
        h('p', { class: 'legname' }, 'Sweat rate'),
        RD.ui.choice([{ value: true, label: typicalText }, { value: false, label: 'I know mine' }], !!d.sweatTypical,
          function (v) { set('details.sweatTypical', v); refresh(); }, 'pill', 'Sweat rate'),
        !d.sweatTypical ? bound('details.sweat', 'num', {
          label: 'Sweat rate', unit: 'L an hour', live: refreshLater,
          invalid: function () { return ownSweatBad() ? fuelMessage('sweat') : ''; }
        }) : null);
    } else {
      gutSweat = h('section', { class: 'card' },
        h('div', { class: 'sechead' },
          h('p', { class: 'label' }, 'Your gut and sweat'),
          h('a', {
            href: '#/fuel', onclick: function (e) {
              e.preventDefault(); aboutShown = true; refresh();
              var gut = document.getElementById('f-details-gut');
              if (gut) gut.focus();
            }
          }, 'Change')),
        h('div', { class: 'kv' }, h('span', null, 'Your gut handles'), h('span', null, h('b', null, d.gut + ' g/hr'))),
        h('div', { class: 'kv' }, h('span', null, 'Sweat rate'), h('span', null, d.sweatTypical ? typicalText : d.sweat + ' L/hr')),
        h('p', { class: 'legname' }, 'Forecast heat'),
        heatChoice);
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
      h('div', { class: 'sechead' }, h('p', { class: 'label' }, 'Your nutrition'), h('a', { href: '#/products' }, 'Edit my products')),
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
      currentPrint = { race: r || { name: 'Nutrition plan', distance: ctx.distance }, pace: r && r.pace, fuel: plan };
      out = nutritionPlan(plan, gel);
    }

    var saveBtn = null;
    if (plan.ok && !solo) {
      saveBtn = h('button', {
        type: 'button', class: 'btn', onclick: function () {
          r.fuel = plan; commit(); go('card');
        }
      }, r.fuel ? 'Update my race card' : 'Next: get your race card');
    } else if (plan.ok && solo) {
      saveBtn = h('button', {
        type: 'button', class: 'btn', onclick: function () {
          S.race = {
            name: '', distance: S.solo.distance, date: '', course: 'rolling', heat: S.solo.heat,
            pace: null, fuel: plan, splits: null, splitsByHand: { bike: S.solo.bikeMin, run: S.solo.runMin }
          };
          commit(); go('setup/1');
        }
      }, 'Save to a race plan');
    }

    return h('div', { class: 'app' },
      topBar(wordmark(), myPlan()),
      rail('nutrition'),
      title('Review nutrition', fromPlan ? 'Built from your pacing. Change anything that looks wrong.' : 'Add your bike and run times. Change anything that looks wrong.'),
      savedNote ? statusLine('Pace targets saved to your race card') : null,
      splitsBox,
      gutSweat,
      productsBox,
      out,
      plan.ok ? timingBox(plan) : null,
      plan.ok ? capNote(plan) : null,
      h('div', { class: 'actions noprint' },
        saveBtn,
        plan.ok ? printButton(false) : null,
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

  // The plan as the owner writes it (S3): a heading, one summary line, a card per leg, one go-by-the-clock note.
  // The count in the summary is the number of gel rows shown. Chews are never called gels.
  function summaryLine(p, gel) {
    var n = p.bike.gels + p.run.gels;
    var chew = gel && gel.kind === 'chew';
    var what = chew ? (n === 1 ? 'serving of chews' : 'servings of chews') : n === 1 ? 'gel' : 'gels';
    var bottle = bottleKind(p);
    var bike = bottle === 'water' ? 'water' : bottle === 'both' ? 'a drink and water' : 'a drink';
    return (n > 0 ? n : 'No') + ' ' + what + ', ' + bike + ' on the bike, water on the run.';
  }
  function nutritionPlan(p, gel) {
    return h('section', { class: 'stack' },
      h('div', null,
        h('h2', { class: 'planhead' }, 'Nutrition plan'),
        h('p', { class: 'sub' }, summaryLine(p, gel))),
      h('section', { class: 'legplan' },
        h('header', null, h('h2', null, 'Before the swim'), null),
        h('p', { class: 'help', style: 'padding-bottom:8px' }, p.preRace)),
      legCard('Bike', p, 'bike'),
      legCard('Run', p, 'run'),
      clockNote(p));
  }
  // The cap and safety note, the last block before the actions.
  function capNote(p) {
    return h('div', { class: 'info warn' },
      h('div', null,
        h('p', null, 'Capped at what your gut has trained: ' + p.gut + ' g an hour. Fluid stays under your ' + (p.sweatTypical ? 'typical ' : '') + 'sweat rate of ' + p.sweat + ' L an hour.'),
        p.warnings.length ? h('ul', null, p.warnings.map(function (w) { return h('li', null, w); })) : null,
        h('p', null, h('b', null, 'Typical ranges, not medical advice.'), ' Practise this plan in training first. Never drink more than you sweat.')));
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
      topBar(wordmark(), backLink('#/fuel', 'Nutrition')),
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
      r.date ? h('p', null, longDate(r.date)) : null];
    if (p) {
      kids.push(h('h3', null, 'Pace'),
        h('p', null, 'Swim ', h('span', { class: 'big' }, pace(p.swim.pace)), ' /100m'),
        h('p', null, 'Bike ', h('span', { class: 'big' }, p.bike.watts ? range(p.bike.watts[0], p.bike.watts[1]) + ' W' : p.bike.hr ? range(p.bike.hr[0], p.bike.hr[1]) + ' bpm' : p.bike.effort.split(':')[0])),
        h('p', null, 'Run ', h('span', { class: 'big' }, pace(p.run.pace)), ' /km'),
        h('p', null, 'Finish ' + hm(p.finish)));
    }
    if (f && f.ok !== false) {
      if (c.race && c.race.fuel === f && fuelStale(c.race)) kids.push(h('p', null, h('b', null, 'Nutrition plan out of date. Update it before race day.')));
      kids.push(h('h3', null, 'Bike nutrition · ' + f.bike.carbsPerHour + ' g/hr'),
        h('p', null, 'Sip ~' + f.bike.sipMl + ' ml every 15 min'),
        f.bike.gels ? h('p', null, 'Gel ', h('span', { class: 'big' }, minutesList(f.bike.gelTimes))) : null,
        showsKm(f, 'bike') ? h('p', { class: 'fine' }, 'at ' + kmList(f, 'bike')) : null,
        h('h3', null, 'Run nutrition · ' + f.run.carbsPerHour + ' g/hr'),
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
