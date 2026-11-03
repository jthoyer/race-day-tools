/*
 * Small DOM helpers shared by the app and the guide embeds.
 * Text always goes in as text nodes, never as HTML, so nothing a person types can run as code.
 */
(function (root) {
  'use strict';

  var doc = root.document;

  // h('p', { class: 'x', onclick: fn, 'aria-label': 'y' }, 'text', childNode, [more])
  function h(tag, props) {
    var el = doc.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v == null || v === false) return;
        if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'class') el.className = v;
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else if (k === 'disabled') el.disabled = !!v;
        else if (k === 'open') el.open = !!v;
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(typeof c === 'object' ? c : doc.createTextNode(String(c)));
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  // A row of toggle buttons. options: [{ value, label, hint }]. style: 'pill' | 'segbtn' | 'opt'.
  function choice(options, current, onPick, style, groupLabel) {
    var cls = style || 'pill';
    var wrapCls = cls === 'segbtn' ? 'segctl' : cls === 'opt' ? 'three' : 'pills';
    return h('div', { class: wrapCls, role: 'group', 'aria-label': groupLabel },
      options.map(function (o) {
        return h('button', {
          type: 'button',
          class: cls,
          'aria-pressed': String(o.value === current),
          onclick: function () { onPick(o.value); }
        }, o.label, o.hint ? h('span', null, o.hint) : null);
      }));
  }

  // A labelled input with an optional unit, help line and error.
  function field(opts) {
    var id = 'f-' + opts.name;
    var errId = id + '-err';
    var input = h('input', {
      id: id,
      name: opts.name,
      type: opts.type || 'text',
      inputmode: opts.inputmode,
      placeholder: opts.placeholder,
      value: opts.value == null ? '' : opts.value,
      disabled: opts.disabled,
      autocomplete: 'off',
      'aria-invalid': opts.error ? 'true' : null,
      'aria-describedby': opts.error ? errId : null,
      oninput: opts.oninput,
      onchange: opts.onchange
    });
    return h('div', { class: 'row-wrap' },
      h('div', { class: 'row' },
        h('label', { class: 'field', for: id }, opts.label, input),
        opts.unit ? h('span', { class: 'unit' }, opts.unit) : null),
      opts.error ? h('p', { class: 'error', id: errId, role: 'alert' }, opts.error) : null);
  }

  function num(v) {
    if (v == null) return null;
    var s = String(v).trim().replace(',', '.');
    if (s === '' || !/^-?\d*\.?\d+$/.test(s)) return null;
    return Number(s);
  }

  var api = { h: h, clear: clear, choice: choice, field: field, num: num };
  root.RD = root.RD || {};
  root.RD.ui = api;
})(this);
