/*
 * The tool inside a guide (F7, RD-02-A4). One step works on its own, with no race set up.
 * The guide passes its case through data- attributes (RP-07-S1). "Save to a race plan" carries
 * every number into a new plan, so later steps come pre-filled (RP-07-A2).
 *
 *   <div data-embed="bike-target" data-distance="70.3" data-course="rolling" data-ftp="240"></div>
 *   <div data-embed="fuel" data-distance="70.3" data-bike="2:45" data-run="1:55" data-gut="60"></div>
 */
(function (root) {
  'use strict';

  var RD = root.RD;
  var h = RD.ui.h;
  var T = RD.time;
  var APP = root.RD_APP_URL || '../index.html';

  function startPlan(apply) {
    var S = RD.store.load();
    if (S.race && !root.confirm('You already have a race plan on this phone. Replace it with a new one? Your details stay.')) return;
    S.race = { name: '', distance: '70.3', date: '', start: '07:00', course: 'rolling', heat: 'warm', pace: null, fuel: null, splits: null };
    apply(S);
    RD.store.save(S);
    root.location.href = APP + '#/setup/1';
  }

  function saveBox(onSave, text) {
    return h('section', { class: 'savebox' },
      h('p', null, h('b', null, 'Racing soon? Make it a full plan.')),
      h('p', { class: 'help' }, text),
      h('button', { type: 'button', class: 'btn', onclick: onSave }, 'Save to a race plan'),
      h('p', { class: 'small center' }, 'No account. Saved on this phone.'));
  }

  // ---------- bike target ----------

  function bikeTarget(el) {
    var st = {
      distance: el.getAttribute('data-distance') || '70.3',
      course: el.getAttribute('data-course') || 'rolling',
      ftp: Number(el.getAttribute('data-ftp')) || null,
      ftpText: el.getAttribute('data-ftp') || ''
    };

    function draw() {
      RD.ui.clear(el);
      var ok = st.ftp >= RD.pace.LIMITS.ftp[0] && st.ftp <= RD.pace.LIMITS.ftp[1];
      var t = ok ? RD.pace.bikeTarget({ ftp: st.ftp, distance: st.distance, course: st.course }) : null;
      el.appendChild(h('div', { class: 'stack' },
        h('section', { class: 'tool', 'aria-label': 'Bike target calculator' },
          h('div', { class: 'head' }, h('h2', null, 'Bike target'), h('span', { class: 'free' }, 'Free to try')),
          RD.ui.field({
            name: 'embed-ftp', label: 'Your FTP', unit: 'watts', inputmode: 'numeric', value: st.ftpText,
            error: st.ftpText && !ok ? 'Enter an FTP between 80 and 500 watts.' : null,
            oninput: function (e) {
              st.ftpText = e.target.value;
              st.ftp = RD.ui.num(e.target.value);
              update();
            }
          }),
          h('div', null, h('p', { class: 'label' }, 'Course'),
            RD.ui.choice([{ value: 'flat', label: 'Flat' }, { value: 'rolling', label: 'Rolling' }, { value: 'hilly', label: 'Hilly' }], st.course,
              function (v) { st.course = v; draw(); }, 'pill', 'Course')),
          h('div', { class: 'result', 'aria-live': 'polite' },
            h('span', { class: 'k' }, 'RIDE AT'),
            h('span', { class: 'v' }, t ? t.watts[0] + '–' + t.watts[1] + ' W' : '–')),
          h('p', { class: 'help' }, t ? Math.round(t.factor[0] * 100) + '–' + Math.round(t.factor[1] * 100) + '% of FTP. A typical range, not medical advice.' : 'Enter your FTP to see your target.')),
        saveBox(function () {
          startPlan(function (S) {
            S.race.distance = st.distance;
            S.race.course = st.course;
            S.fitness.mode = 'power';
            if (ok) S.fitness.ftp = st.ftp;
          });
        }, 'Add your race date and we’ll set swim and run targets, a finish range and a fuel plan. Your FTP and course come with you.')));
    }

    // Update the result without rebuilding the input, so typing is never interrupted.
    function update() {
      var input = el.querySelector('input');
      var pos = input ? input.selectionStart : null;
      draw();
      var again = el.querySelector('input');
      if (again) { again.focus(); if (pos != null) again.setSelectionRange(pos, pos); }
    }

    draw();
  }

  // ---------- fuel ----------

  function fuel(el) {
    var st = {
      distance: el.getAttribute('data-distance') || '70.3',
      bike: el.getAttribute('data-bike') || '',
      run: el.getAttribute('data-run') || '',
      gut: el.getAttribute('data-gut') || '',
      heat: el.getAttribute('data-heat') || 'warm'
    };
    var P = RD.fuel.DEFAULT_PRODUCTS;

    function plan() {
      return RD.fuel.planFuel({
        distance: st.distance, bikeMin: T.parseHM(st.bike), runMin: T.parseHM(st.run), heat: st.heat,
        gut: RD.ui.num(st.gut), sweat: null, gel: P[0], drink: P[1]
      });
    }

    function draw() {
      RD.ui.clear(el);
      var p = plan();
      function inp(name, label, unit, key, mode) {
        return RD.ui.field({
          name: 'embed-' + name, label: label, unit: unit, inputmode: mode || 'numeric', value: st[key], placeholder: name === 'bike' ? '2:45' : name === 'run' ? '1:55' : '60',
          oninput: function (e) { st[key] = e.target.value; update(e.target.id); }
        });
      }
      el.appendChild(h('div', { class: 'stack' },
        h('section', { class: 'tool', 'aria-label': 'Fuel calculator' },
          h('div', { class: 'head' }, h('h2', null, 'Your ' + (st.distance === '70.3' ? '70.3' : 'Standard') + ' fuel'), h('span', { class: 'free' }, 'Free to try')),
          h('div', { class: 'two' }, inp('bike', 'Bike time', null, 'bike'), inp('run', 'Run time', null, 'run')),
          inp('gut', 'Carbs your gut handles', 'g an hour', 'gut', 'decimal'),
          h('div', null, h('p', { class: 'label' }, 'Heat'),
            RD.ui.choice([{ value: 'mild', label: 'Mild' }, { value: 'warm', label: 'Warm' }, { value: 'hot', label: 'Hot' }], st.heat,
              function (v) { st.heat = v; draw(); }, 'pill', 'Heat')),
          p.ok
            ? h('div', { class: 'stack', 'aria-live': 'polite' },
              h('div', { class: 'result' }, h('span', { class: 'k' }, 'BIKE'), h('span', { class: 'v' }, p.bike.carbsPerHour + ' g/hr')),
              h('p', { class: 'help' }, p.bike.gels + ' gels on the bike, plus about ' + p.bike.sipMl + ' ml of sports drink every 15 minutes.'),
              h('div', { class: 'result' }, h('span', { class: 'k' }, 'RUN'), h('span', { class: 'v' }, p.run.carbsPerHour + ' g/hr')),
              h('p', { class: 'help' }, p.run.gels ? p.run.gels + ' gels on the run, at ' + p.run.gelTimes.map(T.fmtHM).join(', ') + '. Water at each aid station.' : 'No gels needed on the run. Water at each aid station.'),
              h('p', { class: 'help' }, 'Capped at your gut figure. Uses a typical gel (25 g) and sports drink, and a typical sweat rate. Not medical advice.'))
            : h('p', { class: 'help', 'aria-live': 'polite' }, 'Enter your bike and run times as h:mm, and the carbs your gut handles, to see your plan.')),
        saveBox(function () {
          startPlan(function (S) {
            S.race.distance = st.distance;
            S.race.heat = st.heat;
            S.race.splitsByHand = { bike: T.parseHM(st.bike), run: T.parseHM(st.run) };
            var g = RD.ui.num(st.gut);
            if (g != null) S.details.gut = g;
          });
        }, 'Add your race date and we’ll time your plan to your splits, with your own gels and drink. Your numbers come with you.')));
    }

    function update(focusId) {
      var a = document.getElementById(focusId);
      var pos = a ? a.selectionStart : null;
      draw();
      var again = document.getElementById(focusId);
      if (again) { again.focus(); if (pos != null) again.setSelectionRange(pos, pos); }
    }

    draw();
  }

  var kinds = { 'bike-target': bikeTarget, fuel: fuel };
  Array.prototype.forEach.call(document.querySelectorAll('[data-embed]'), function (el) {
    var fn = kinds[el.getAttribute('data-embed')];
    if (fn) fn(el);
  });
})(this);
