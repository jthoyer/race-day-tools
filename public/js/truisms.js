/*
 * The front page truism: one square card, picked at random once per page load, shown whole on a blue stage beside the
 * front page (S0) content. All thirteen are live text, the same cards as public/truisms/ (the twelve of D01 and D02 were landscape
 * images until 18 Nov 2026).
 *
 * Two halves in one file, so the list and its rules load in Node and the tests can run them:
 *   the list   LIST and pick(). No DOM. tests/front-page-truisms.test.js drives them.
 *   the stage  built with RD.ui.h (text as text nodes), one element for the whole page load, held in memory only.
 *
 * EVERY FIGURE HERE IS UNCHECKED. The words and numbers in the list are the owner's content, not maths. Nothing here reads
 * from, or writes to, the pacing and nutrition code, and no figure here has been checked against a named source. The pull
 * request that changed this file lists each one for the owner to sign off.
 *
 * The pick is held in the page for one load and is never saved anywhere: a reload picks again. The stage is built once and
 * the same element is put back each time the front page redraws, so a redraw never picks again. The stage asks for nothing:
 * every truism is text.
 */
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;

  // ---------- the list (no DOM) ----------

  // In this order: the twelve square cards of D01 and D02, then the fuelling truism. The order is part of the pick: index floor(r * 13).
  // Every entry is live text. In each card, label is the small capitals line, value the big line and detail the sentence (it may be
  // empty, and then it is not drawn). The words are the owner's, read off the twelve landscape graphics this list used to show.
  var LIST = [
    { id: "d01-race-formats-rules-and-logistics", kind: 'live',
      headline: "Fitness sets the ceiling. Execution decides the race.",
      body: "Distance demands, drafting boxes, course profiles, race sequencing, and transition logistics determine whether all your training reaches the finish line.",
      cards: [
        { label: "01 \u00b7 FORMATS", detail: "Threshold ceiling vs durability & gut capacity", value: "STD vs 70.3", tone: 'lime' },
        { label: "02 \u00b7 RULES", detail: "12m clear zone & 25s passing window", value: "DRAFT BOX", tone: 'lavender' },
        { label: "03 \u00b7 PROFILE", detail: "Cap climbing watts & hold aero speed", value: "PACE TERRAIN", tone: 'lavender' },
        { label: "04 \u00b7 SEQUENCE", detail: "One goal peak \u00b7 use B-races as dress rehearsals", value: "A / B / C PLAN", tone: 'lavender' },
        { label: "05 \u00b7 LOGISTICS", detail: "Blue/red bag drops & transition flow check", value: "ADMIN & BAGS", tone: 'lavender' }
      ] },
    { id: "d01-01-race-formats-standard-vs-70-3", kind: 'live',
      headline: "Standard is hard. 70.3 is patient.",
      body: "Standard rewards a high ceiling near the redline. 70.3 rewards durability, disciplined pacing, and gut tolerance across hours.",
      cards: [
        { label: "51.5 KM TOTAL", detail: "1.5k Swim \u00b7 40k Bike \u00b7 10k Run \u00b7 ~90% FTP \u00b7 THRESHOLD CEILING", value: "STANDARD", tone: 'lime' },
        { label: "113 KM TOTAL", detail: "1.9k Swim \u00b7 90k Bike \u00b7 21.1k Run \u00b7 ~75\u201380% FTP \u00b7 DURABILITY \u00b7 SUSTAINED FUEL & HYDRATION", value: "70.3 (MIDDLE DISTANCE)", tone: 'lavender' }
      ] },
    { id: "d01-02-race-rules-drafting-penalties-equipment", kind: 'live',
      headline: "The draft zone is a box, not a suggestion.",
      body: "Twelve metres of clear air, 25 seconds to pass, and zero slotting in. A single blue card in the penalty tent erases weeks of training.",
      cards: [
        { label: "FRONT RIDER", detail: "Hold line & effort", value: "LEAD BIKE", tone: 'lavender' },
        { label: "12-METRE DRAFT BOX", detail: "Wheel-to-wheel exclusion zone \u00b7 Entry begins pass \u00b7 Violation = 5 Min Blue Card", value: "NO DRAFTING \u00b7 DO NOT SLOT IN", tone: 'lavender' },
        { label: "OVERTAKE RULE", detail: "Move cleanly past the front wheel or drop back immediately.", value: "PASS IN 25s", tone: 'lime' }
      ] },
    { id: "d01-03-race-courses-and-conditions", kind: 'live',
      headline: "Pace the profile, not the distance.",
      body: "Hills, wind and heat rewrite your target numbers. Cap your power into headwind climbs, stay tucked on descents, and protect the run.",
      cards: [
        { label: "CLIMB & HEADWIND", detail: "Surging to protect speed spikes lactate. Cap power and spin smooth.", value: "CAP WATTS AT 105%", tone: 'lime' },
        { label: "FLAT & TAILWIND", detail: "Aerodynamics matter most at high speed. Keep head down and stay tucked.", value: "HOLD AERO POSITION", tone: 'lavender' },
        { label: "DESCENT & RUN OUT", detail: "Hydrate, ingest sodium, and arrive in T2 with fresh running legs.", value: "SAVE THE RUN", tone: 'lavender' }
      ] },
    { id: "d01-04-choosing-and-sequencing-races", kind: 'live',
      headline: "One season, one peak.",
      body: "Use C-races for low-pressure gear checks and B-races for tempo simulations. Protect your A-race taper and avoid peak-chasing.",
      cards: [
        { label: "WEEK 6 \u00b7 C-RACE", detail: "Train through \u00b7 zero taper", value: "KIT REHEARSAL", tone: 'lavender' },
        { label: "WEEK 12 \u00b7 B-RACE", detail: "Standard distance at target watts. 3-day freshener.", value: "PACE SIMULATION", tone: 'lavender' },
        { label: "WEEKS 15\u201316", detail: "", value: "SHARP TAPER", tone: 'lavender' },
        { label: "WEEK 18 \u00b7 A-RACE", detail: "One true peak per season. 100% recovered, fully rehearsed, execution-focused.", value: "TARGET PEAK", tone: 'lime' }
      ] },
    { id: "d01-05-race-logistics-and-travel", kind: 'live',
      headline: "Logistics is the fourth discipline.",
      body: "Split transition bags, bike boxes, and strict check-in cut-offs will ruin a race before the swim starts. Front-load the admin early.",
      cards: [
        { label: "T-48H \u00b7 ARRIVAL", detail: "Torque check & test spin", value: "BIKE REBUILD", tone: 'lavender' },
        { label: "T-24H \u00b7 CHECK-IN", detail: "Bike & run bags racked", value: "BAG DROPS", tone: 'lavender' },
        { label: "T-12H \u00b7 EVE", detail: "Bottles mixed & chip on", value: "FUEL LOCKED", tone: 'lavender' },
        { label: "RACE MORNING", detail: "Pump tyres, count rack rows from swim exit, and walk your flow. Zero panic.", value: "TRANSITION WALK", tone: 'lime' }
      ] },
    { id: "d02-swim", kind: 'live',
      headline: "Arrive fresh, not first.",
      body: "Nobody wins a triathlon in the water, but plenty lose it there. Swim hard enough to stay in contention, then save your legs and lungs for the bike.",
      cards: [
        { label: "01 \u00b7 OPEN WATER", detail: "Sight every 6\u201310 strokes \u00b7 straight is faster than strong", value: "NAVIGATION", tone: 'lavender' },
        { label: "02 \u00b7 EFFICIENCY", detail: "Hips high, head neutral & compact kick. Water shape beats raw pull power.", value: "CUT DRAG FIRST", tone: 'lime' },
        { label: "03 \u00b7 THRESHOLD", detail: "Test 400m + 200m \u00b7 never surge the first 200m", value: "CSS PACING", tone: 'lavender' },
        { label: "04 \u00b7 WETSUIT", detail: "Free shoulders & strip to waist before the bike rack", value: "FIT & STRIP", tone: 'lavender' },
        { label: "05 \u00b7 STRUCTURE", detail: "Short frequent swims preserve feel better than 1 long slog", value: "2\u20133 SESSIONS", tone: 'lavender' }
      ] },
    { id: "d02-01-swim-open-water-skills", kind: 'live',
      headline: "Straight is faster than strong.",
      body: "Sight every 6 to 10 strokes with a quick glance. Drift off line and you swim extra metres that no amount of pool fitness can win back.",
      cards: [
        { label: "HEAD DOWN \u00b7 NO SIGHTING \u00b7 +180M WANDERED", detail: "Drifting off-course adds ~3:15 of dead time pool fitness can never win back.", value: "WANDERING ZIG-ZAG PATH", tone: 'lavender' },
        { label: "SIGHT EVERY 6\u201310 STROKES \u00b7 SAVE 18\u201325% DRAG", detail: "Quick forward glance on breath out, head stays low, feet drafting on the hip. Swimming straight is free speed.", value: "BUOY-TO-BUOY TANGENT", tone: 'lime' }
      ] },
    { id: "d02-02-swim-stroke-efficiency-and-drag", kind: 'live',
      headline: "Drag costs more than power.",
      body: "Your engine matters less than your shape in the water. Keep your hips high, your head neutral, and your kick small. Cut drag before you add effort.",
      cards: [
        { label: "HIGH DRAG \u00b7 DROPPED HIPS", detail: "Lifting head drops legs, creating a plough that soaks energy without added speed.", value: "MORE POWER, SAME PACE", tone: 'lavender' },
        { label: "WATER IS 800X DENSER THAN AIR \u00b7 CUT FRONTAL DRAG", detail: "Press the chest, keep hips skimming the surface, and kick compact. Fewer strokes per length at the same pace is real progress.", value: "STREAMLINED TORPEDO", tone: 'lime' },
        { label: "STROKE COUNT", detail: "per 50m = 90 strokes saved", value: "-3 STROKES", tone: 'lavender' }
      ] },
    { id: "d02-03-swim-threshold-sets-and-pacing", kind: 'live',
      headline: "The first 200 m always lies.",
      body: "Adrenaline makes a sprint pace feel deceptively easy off the beach. Settle into your trained Critical Swim Speed; the bike charges interest on every early surge.",
      cards: [
        { label: "CRITICAL SWIM SPEED", detail: "Time difference = exact CSS pace \u00b7 Train from data, not feel", value: "400m + 200m", tone: 'lavender' },
        { label: "THE FIRST 200M TRAP", detail: "Spiking heart rate to 180 bpm in minute 2 burns glycogen that costs 15 watts on the bike later.", value: "ADRENALINE SURGE", tone: 'lavender' },
        { label: "DISCIPLINED SPLITS \u00b7 EVEN PACING", detail: "Let the hotheads sprint. Settle into your trained benchmark by stroke 20. Exit fresh with loose shoulders and a calm heart.", value: "HOLD CSS PACE", tone: 'lime' }
      ] },
    { id: "d02-04-swim-wetsuit-swimming", kind: 'live',
      headline: "Fit beats brand. Practise the strip.",
      body: "A tight suit constricts breathing; a loose suit scoops cold water. Try before you buy, test it in open water, and rehearse peeling it at speed for T1.",
      cards: [
        { label: "01 \u00b7 FIT BEATS BRAND", detail: "Check fit swimming, not standing. Snug chest, zero water scoop at neck, complete arm rotation freedom.", value: "SHOULDER MOBILITY", tone: 'lavender' },
        { label: "02 \u00b7 ACCLIMATISATION", detail: "Swim in cold water before race week. Adjust to neoprene chest compression so panic never takes hold.", value: "REHEARSE FIRST", tone: 'lavender' },
        { label: "TRANSITION SPEED \u00b7 SAVE 30 SECONDS", detail: "Unzip on the exit run, pull arms clear, and strip to waist while running. Seconds disappear when neoprene sticks at the ankles.", value: "PRACTISE THE STRIP", tone: 'lime' }
      ] },
    { id: "d02-05-swim-weekly-structure-and-fitness", kind: 'live',
      headline: "Two or three swims beat one long one.",
      body: "Water feel fades fast within 72 hours. Short, regular sessions keep your catch and body balance; a fortnightly marathon slog only builds fatigue.",
      cards: [
        { label: "TUE \u00b7 JOB 1", detail: "Catch drills, kick alignment & video check (2,000 m)", value: "TECHNIQUE", tone: 'lavender' },
        { label: "THU \u00b7 JOB 2 \u00b7 THE ENGINE", detail: "100m & 200m repeats on CSS pace clock. Build lactate clearance under fatigue (2,800 m).", value: "CSS THRESHOLD", tone: 'lime' },
        { label: "SAT \u00b7 JOB 3", detail: "Continuous rhythm, pack drafting & buoy turns (2,500 m)", value: "OPEN WATER", tone: 'lavender' },
        { label: "WATER FEEL RULE", detail: "3 short swims beat 1 marathon slog every time", value: "FADES IN 72H", tone: 'lavender' }
      ] },
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

  function badge(letter) { return h('span', { class: 'tl-badge' }, letter); }

  // Three or more cards, or a long figure, take the smaller type that lets a long figure wrap. The two fuelling cards keep the
  // owner's size.
  function fits(e) {
    return e.cards.length > 2 || e.cards.some(function (c) { return c.value.length > 14; });
  }

  // A truism. Real text, no heading element. The logo and the tagline are hidden from a screen reader: the page
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
        h('div', { class: fits(e) ? 'tl-cards fit' : 'tl-cards' }, e.cards.map(function (c) {
          return h('div', { class: 'tl-card ' + c.tone },
            h('div', { class: 'tl-left' }, h('span', { class: 'tl-label' }, c.label), c.detail ? h('span', { class: 'tl-detail' }, c.detail) : null),
            h('div', { class: 'tl-value' }, c.value));
        }))));
  }

  function show(i) {
    root.RD.ui.clear(stage);
    stage.setAttribute('data-truism', LIST[i].id);
    stage.appendChild(liveNode(LIST[i]));
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
