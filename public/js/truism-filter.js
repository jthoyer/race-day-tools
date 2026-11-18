// Search and filter for the truisms pages (public/truisms/index.html and public/truisms/research/index.html).
// Both pages are complete without it: every card and every note shows. This script only hides what does not match.
// It reads the page and sets the `hidden` attribute. It builds no HTML, makes no request and saves nothing.
(function (root) {
  'use strict';

  var api = (root.RD = root.RD || {}).truismFilter = {};

  // Does one item match? `item` has { topic, status, search } (all strings, search already lower case).
  // `state` has { q, topic, status }. A blank filter ('' or 'all') matches everything.
  // A curly apostrophe in the page's words matches a straight one typed in the box.
  function plain(t) { return String(t || '').toLowerCase().replace(/[\u2018\u2019]/g, "'"); }

  api.matches = function (item, state) {
    var q = plain(state.q).trim();
    var words = q ? q.split(/\s+/) : [];
    var hay = plain(item.search);
    for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) === -1) return false;
    if (state.topic && state.topic !== 'all' && item.topic !== state.topic) return false;
    if (state.status && state.status !== 'all' && item.status !== state.status) return false;
    return true;
  };

  api.countText = function (shown, total, noun) {
    return shown === total ? 'Showing all ' + total + ' ' + noun : 'Showing ' + shown + ' of ' + total + ' ' + noun;
  };

  if (typeof document === 'undefined') return;

  var list = document.querySelector('[data-filter-list]');
  if (!list) return;
  var controls = document.querySelector('[data-filter-controls]');
  var items = Array.prototype.slice.call(list.querySelectorAll('[data-item]'));
  var groups = Array.prototype.slice.call(list.querySelectorAll('[data-group]'));
  var chips = Array.prototype.slice.call(document.querySelectorAll('[data-topic-chip]'));
  var input = document.getElementById('tq');
  var statusSelect = document.getElementById('tstatus');
  var count = document.getElementById('tcount');
  var empty = document.getElementById('tempty');
  var reset = document.getElementById('treset');
  var noun = list.getAttribute('data-noun') || 'items';
  var state = { q: '', topic: 'all', status: 'all' };

  function apply() {
    var shown = 0;
    items.forEach(function (el) {
      var ok = api.matches({ topic: el.getAttribute('data-topic'), status: el.getAttribute('data-status'), search: el.getAttribute('data-search') }, state);
      el.hidden = !ok;
      if (ok) shown++;
    });
    groups.forEach(function (g) {
      g.hidden = !g.querySelector('[data-item]:not([hidden])');
    });
    chips.forEach(function (c) {
      c.setAttribute('aria-pressed', c.getAttribute('data-topic-chip') === state.topic ? 'true' : 'false');
    });
    if (count) count.textContent = api.countText(shown, items.length, noun);
    if (empty) empty.hidden = shown !== 0;
  }

  if (controls) controls.hidden = false;
  // A browser can put back what was typed or chosen before a reload or a Back. Start from what the controls show.
  if (input) state.q = input.value;
  if (statusSelect) state.status = statusSelect.value;
  if (input) input.addEventListener('input', function () { state.q = input.value; apply(); });
  if (statusSelect) statusSelect.addEventListener('change', function () { state.status = statusSelect.value; apply(); });
  chips.forEach(function (c) {
    c.addEventListener('click', function () { state.topic = c.getAttribute('data-topic-chip'); apply(); });
  });
  if (reset) {
    reset.addEventListener('click', function () {
      state = { q: '', topic: 'all', status: 'all' };
      if (input) input.value = '';
      if (statusSelect) statusSelect.value = 'all';
      apply();
      if (input) input.focus();
    });
  }
  apply();
})(this);

if (typeof module !== 'undefined') module.exports = this.RD.truismFilter;
