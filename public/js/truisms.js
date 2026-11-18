/*
 * The front page truism: one short graphic, picked at random once per page load, shown whole on a blue stage beside the
 * front page (S0) content. Twelve are images in public/img/truisms/; the thirteenth, on fuelling, is live text.
 *
 * Two halves in one file, so the list and its rules load in Node and the tests can run them:
 *   the list   LIST and pick(). No DOM. tests/truisms.test.js drives them.
 *   the stage  built with RD.ui.h (text as text nodes), one element for the whole page load, held in memory only.
 *
 * EVERY FIGURE HERE IS UNCHECKED. The words and numbers in the list (the alt text of each image, and the live truism) are
 * the owner's content, not maths. Nothing here reads from, or writes to, the pacing and nutrition code, and no figure here
 * has been checked against a named source. The pull request that added this file lists each one for the owner to sign off.
 *
 * The pick is held in the page for one load and is never saved anywhere: a reload picks again. The stage is built once and
 * the same element is put back each time the front page redraws, so a redraw never picks again and never asks for the
 * picture again. If the picked image fails to load, the next truism in the list shows (the live one cannot fail, so the
 * walk always ends), and a failed image is never asked for twice.
 */
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;

  // ---------- the list (no DOM) ----------

  // In this order: the twelve images, then the live truism. The order is part of the pick: index floor(r * 13).
  var LIST = [
    { id: "d01-race-formats-rules-and-logistics", kind: 'image', src: "img/truisms/d01-race-formats-rules-and-logistics.webp", width: 1200, height: 630,
      alt: "Fitness sets the ceiling. Execution decides the race. Distance demands, drafting boxes, course profiles, race sequencing and transition logistics determine whether all your training reaches the finish line. Formats, STD vs 70.3: threshold ceiling vs durability and gut capacity. Rules, draft box: 12 m clear zone and 25 s passing window. Profile, pace terrain: cap climbing watts and hold aero speed. Sequence, A/B/C plan: one goal peak, use B-races as dress rehearsals. Logistics, admin and bags: blue and red bag drops and transition flow check." },
    { id: "d01-01-race-formats-standard-vs-70-3", kind: 'image', src: "img/truisms/d01-01-race-formats-standard-vs-70-3.webp", width: 1200, height: 630,
      alt: "Standard is hard. 70.3 is patient. Standard rewards a high ceiling near the redline. 70.3 rewards durability, disciplined pacing and gut tolerance across hours. Standard, 51.5 km total: 1.5 km swim, 40 km bike, 10 km run, about 90% FTP, threshold ceiling, 2:20 to 3:00. 70.3, middle distance, 113 km total: 1.9 km swim, 90 km bike, 21.1 km run, about 75 to 80% FTP, durability, sustained fuel and hydration, 5:00 to 6:30." },
    { id: "d01-02-race-rules-drafting-penalties-equipment", kind: 'image', src: "img/truisms/d01-02-race-rules-drafting-penalties-equipment.webp", width: 1200, height: 630,
      alt: "The draft zone is a box, not a suggestion. Twelve metres of clear air, 25 seconds to pass, and zero slotting in. A single blue card in the penalty tent erases weeks of training. Front rider, lead bike: hold line and effort. 12-metre draft box, a wheel-to-wheel exclusion zone: no drafting, do not slot in; entry begins the pass; a violation is a 5 minute blue card. Overtake rule, pass in 25 seconds: move cleanly past the front wheel or drop back immediately. Bib and helmet check." },
    { id: "d01-03-race-courses-and-conditions", kind: 'image', src: "img/truisms/d01-03-race-courses-and-conditions.webp", width: 1200, height: 630,
      alt: "Pace the profile, not the distance. Hills, wind and heat rewrite your target numbers. Cap your power into headwind climbs, stay tucked on descents, and protect the run. Climb and headwind: cap watts at 105%; surging to protect speed spikes lactate, so cap power and spin smooth. Flat and tailwind: hold aero position; aerodynamics matter most at high speed. Descent and run out, save the run: hydrate, take sodium, and arrive in T2 with fresh running legs. Heat: extra sodium. Preserve the final 10 km." },
    { id: "d01-04-choosing-and-sequencing-races", kind: 'image', src: "img/truisms/d01-04-choosing-and-sequencing-races.webp", width: 1200, height: 630,
      alt: "One season, one peak. Use C-races for low-pressure gear checks and B-races for tempo simulations. Protect your A-race taper and avoid peak-chasing. Week 6, C-race: kit rehearsal, train through, zero taper. Week 12, B-race: pace simulation, Standard distance at target watts, 3-day freshener. Weeks 15 to 16: sharp taper. Week 18, A-race: target peak, one true peak per season, 100% recovered, fully rehearsed, execution-focused." },
    { id: "d01-05-race-logistics-and-travel", kind: 'image', src: "img/truisms/d01-05-race-logistics-and-travel.webp", width: 1200, height: 630,
      alt: "Logistics is the fourth discipline. Split transition bags, bike boxes and strict check-in cut-offs will ruin a race before the swim starts. Front-load the admin early. 48 hours out, arrival: bike rebuild, torque check and test spin. 24 hours out, check-in: bag drops, bike and run bags racked. 12 hours out, the eve: fuel locked, bottles mixed and chip on. Race morning: transition walk; pump tyres, count rack rows from swim exit, and walk your flow. Zero panic." },
    { id: "d02-swim", kind: 'image', src: "img/truisms/d02-swim.webp", width: 1200, height: 630,
      alt: "Arrive fresh, not first. Nobody wins a triathlon in the water, but plenty lose it there. Swim hard enough to stay in contention, then save your legs and lungs for the bike. Open water, navigation: sight every 6 to 10 strokes; straight is faster than strong. Efficiency, cut drag first: hips high, head neutral and a compact kick. Threshold, CSS pacing: test 400 m and 200 m, never surge the first 200 m. Wetsuit, fit and strip: free shoulders, strip to the waist before the bike rack. Structure, 2 to 3 sessions: short frequent swims preserve feel better than 1 long slog." },
    { id: "d02-01-swim-open-water-skills", kind: 'image', src: "img/truisms/d02-01-swim-open-water-skills.webp", width: 1200, height: 630,
      alt: "Straight is faster than strong. Sight every 6 to 10 strokes with a quick glance. Drift off line and you swim extra metres that no amount of pool fitness can win back. Head down, no sighting: a wandering zig-zag path, 180 m wandered, adding about 3:15 of dead time. Sight every 6 to 10 strokes: buoy-to-buoy tangent, save 18 to 25% drag; a quick forward glance on the breath out, head low, feet drafting on the hip. Swimming straight is free speed." },
    { id: "d02-02-swim-stroke-efficiency-and-drag", kind: 'image', src: "img/truisms/d02-02-swim-stroke-efficiency-and-drag.webp", width: 1200, height: 630,
      alt: "Drag costs more than power. Your engine matters less than your shape in the water. Keep your hips high, your head neutral, and your kick small. Cut drag before you add effort. High drag, dropped hips: more power, same pace; lifting the head drops the legs and makes a plough that soaks energy. Water is 800 times denser than air: streamlined torpedo; press the chest, keep hips skimming the surface, and kick compact. Stroke count: 3 fewer strokes per 50 m is 90 strokes saved. Compact 2-beat kick." },
    { id: "d02-03-swim-threshold-sets-and-pacing", kind: 'image', src: "img/truisms/d02-03-swim-threshold-sets-and-pacing.webp", width: 1200, height: 630,
      alt: "The first 200 m always lies. Adrenaline makes a sprint pace feel deceptively easy off the beach. Settle into your trained Critical Swim Speed; the bike charges interest on every early surge. Critical swim speed: 400 m and 200 m, the time difference gives your exact CSS pace; train from data, not feel. The first 200 m trap, adrenaline surge: spiking heart rate to 180 bpm in minute 2 burns glycogen that costs 15 watts on the bike later. Disciplined splits, even pacing: hold CSS pace; let the hotheads sprint, settle by stroke 20, exit fresh with loose shoulders and a calm heart." },
    { id: "d02-04-swim-wetsuit-swimming", kind: 'image', src: "img/truisms/d02-04-swim-wetsuit-swimming.webp", width: 1200, height: 630,
      alt: "Fit beats brand. Practise the strip. A tight suit constricts breathing; a loose suit scoops cold water. Try before you buy, test it in open water, and rehearse peeling it at speed for T1. Fit beats brand, shoulder mobility: check fit swimming, not standing; snug chest, no water scoop at the neck, full arm rotation. Acclimatisation, rehearse first: swim in cold water before race week so neoprene chest compression never brings panic. Transition speed, save 30 seconds, practise the strip: unzip on the exit run, pull arms clear and strip to the waist while running." },
    { id: "d02-05-swim-weekly-structure-and-fitness", kind: 'image', src: "img/truisms/d02-05-swim-weekly-structure-and-fitness.webp", width: 1200, height: 630,
      alt: "Two or three swims beat one long one. Water feel fades fast within 72 hours. Short, regular sessions keep your catch and body balance; a fortnightly marathon slog only builds fatigue. Tuesday, job 1, technique: catch drills, kick alignment and video check, 2,000 m. Thursday, job 2, the engine, CSS threshold: 100 m and 200 m repeats on the CSS pace clock, 2,800 m. Saturday, job 3, open water: continuous rhythm, pack drafting and buoy turns, 2,500 m. Water feel rule: fades in 72 hours; 3 short swims beat 1 marathon slog every time." },
    { id: 'd07-fuelling-and-hydration', kind: 'live',
      headline: 'Fuelling is a trained skill. 70.3 is an eating contest.',
      body: 'What, when, and how much you consume is calculated and rehearsed in training. Standard forgives minor fuelling errors; 70.3 will completely sink under-fuelled athletes.',
      cards: [
        { label: 'STANDARD FUEL', detail: '~60 g/hr carbs \u00b7 Electrolyte sip \u00b7 Fast burn', value: '60 g / HR', tone: 'lime' },
        { label: '70.3 FUEL', detail: '60\u201390 g/hr carbs \u00b7 500\u20131000 mg sodium \u00b7 Gut lock', value: '60\u201390 g / HR', tone: 'lavender' }
      ] }
  ];

  var TAGLINE = 'Helping Triathletes shift gear';

  // One Math.random() value r in [0, 1) to an index in list order. Anything else (1, below 0, NaN, not a number) is
  // clamped to a valid index, so a stubbed or odd value can never point past the end.
  function pick(r) {
    var n = LIST.length;
    if (typeof r !== 'number' || r !== r) return 0;
    var i = Math.floor(r * n);
    return i < 0 ? 0 : i > n - 1 ? n - 1 : i;
  }

  var api = { LIST: LIST, TAGLINE: TAGLINE, pick: pick };
  if (isNode) { module.exports = api; return; }
  root.RD = root.RD || {};
  root.RD.truisms = api;

  // ---------- the stage ----------

  var h = root.RD.ui.h;
  var stage = null; // the one element, built on first use
  var shown = -1;
  var failed = {}; // ids of images that did not load, this page load

  function badge(letter) { return h('span', { class: 'tl-badge' }, letter); }

  // The live truism. Real text, no heading element. The logo and the tagline are hidden from a screen reader: the page
  // already names TRI Momentum.
  function liveNode(e) {
    return h('div', { class: 'truism-live' },
      h('div', { class: 'tl-body' },
        h('div', { class: 'tl-top' },
          h('div', { class: 'tl-brand', 'aria-hidden': 'true' }, badge('T'), badge('R'), badge('I'), h('span', { class: 'tl-name' }, 'Momentum')),
          h('div', { class: 'tl-tag', 'aria-hidden': 'true' }, TAGLINE),
          h('div', { class: 'tl-copy' },
            h('p', { class: 'tl-headline' }, e.headline),
            h('p', { class: 'tl-text' }, e.body))),
        h('div', { class: 'tl-cards' }, e.cards.map(function (c) {
          return h('div', { class: 'tl-card ' + c.tone },
            h('div', { class: 'tl-left' }, h('span', { class: 'tl-label' }, c.label), h('span', { class: 'tl-detail' }, c.detail)),
            h('div', { class: 'tl-value' }, c.value));
        }))));
  }

  // An image truism. Not lazy: it is the first thing on the page.
  function imageNode(e, i) {
    var img = h('img', {
      class: 'truism-img', loading: 'eager',
      onerror: function () { if (shown === i && img.parentNode === stage) fail(i); },
      src: e.src, alt: e.alt, width: e.width, height: e.height
    });
    return img;
  }

  function show(i) {
    shown = i;
    root.RD.ui.clear(stage); // a failed image leaves the page here
    stage.setAttribute('data-truism', LIST[i].id);
    stage.appendChild(LIST[i].kind === 'live' ? liveNode(LIST[i]) : imageNode(LIST[i], i));
  }

  // The next truism in list order that has not failed (wrapping). The live one never fails, so this always finds one.
  function fail(i) {
    failed[LIST[i].id] = true;
    for (var k = 1; k <= LIST.length; k++) {
      var j = (i + k) % LIST.length;
      if (LIST[j].kind === 'live' || !failed[LIST[j].id]) { show(j); return; }
    }
  }

  // The stage for this page load: picked on first use, then the same element every time.
  api.stage = function () {
    if (!stage) {
      stage = h('section', { class: 'truism', 'aria-label': 'Truism' });
      show(pick(Math.random()));
    }
    return stage;
  };
})(this);
