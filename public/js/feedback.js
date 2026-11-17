/*
 * Feedback: a footer button and an inline panel at the foot of every app screen. The person types a message (and, if they
 * like, an address for a reply) and taps Send; one same-origin POST goes to /api/feedback, which emails it to the owner.
 *
 * Two halves in one file, so the rules load in Node and the tests can run them:
 *   the rules   messageOk, cleanMessage, checkAddress, pageValue. No DOM. tests/feedback-cases.js drives them and functions/api/feedback.js.
 *   the panel   built once, OUTSIDE <main id="view">, so render() in app.js never rebuilds it. The draft is the two fields
 *               themselves, held in the page only: no storage, no cookie, no address. A reload loses it.
 *
 * Nothing is requested when the panel opens. The one request is made when Send is tapped. Hidden where the function does
 * not exist (canEmailHere in card.js: github.io, and an unknown host). The guide pages do not load this file.
 *
 * Not a form element: a native submit would be refused by the content policy (form-action 'none'), so Enter does nothing
 * special and Send is a button. The text of the panel goes in as text, through RD.ui.h.
 *
 * The 3 second wait before a send (MIN_FILL_MS) is a nuisance filter for a script that fills this page's form and taps
 * Send at once. It does nothing against a script that posts to /api/feedback directly. It is not a defence.
 */
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var card = isNode ? require('./card.js') : root.RD.card;

  var MESSAGE_MIN = 5;
  var MESSAGE_MAX = 2000; // JavaScript string length, the unit of the textarea's maxlength
  var MIN_FILL_MS = 3000;
  var REPLY_TIMEOUT_MS = 15000;
  var PAGE_SHAPE = /^#\/[a-z0-9/]{0,40}$/;

  // ---------- the rules (no DOM) ----------

  // The message as it is checked and sent: vertical tab, form feed, DEL and the C1 range (U+0080 to U+009F), which the
  // function refuses, each run replaced by one space. Tab, line feed and carriage return stay. NUL, ESC and the other low
  // controls are left for the function to refuse, with its own "We couldn't send that" line. tests/feedback-cases.js
  // (`cleaned`, `controls`) drives this and the function, so the two cannot drift apart.
  function cleanMessage(value) {
    return typeof value === 'string' ? value.replace(/[\x0b\x0c\x7f-\x9f]+/g, ' ') : value;
  }

  // True when the message, trimmed, is 5 to 2,000 characters. (cleanMessage has already turned the hidden controls a paste
  // can carry into spaces. The function still refuses the rest of the control characters, such as NUL and ESC; the page
  // lets the function say so, with its own "We couldn't send that" line, rather than invent a second message.)
  function messageOk(value) {
    if (typeof value !== 'string') return false;
    var n = value.trim().length;
    return n >= MESSAGE_MIN && n <= MESSAGE_MAX;
  }

  // '' for a blank or whitespace-only address (feedback needs no reply address), the trimmed address when it is one plain
  // address (the rule of the race card's email block), else null. The blank case differs from the card on purpose.
  function checkAddress(value) {
    if (typeof value !== 'string') return null;
    if (value.trim() === '') return '';
    return card.normaliseEmail(value);
  }

  // The screen's address when it is "#/" and up to 40 of a-z, 0-9 and "/", else "". Never a query, a case or a space.
  function pageValue(hash) {
    return typeof hash === 'string' && PAGE_SHAPE.test(hash) ? hash : '';
  }

  var TEXT = {
    footer: 'Something broken? Got an idea?',
    open: 'Tell us what to fix',
    intro: 'It goes straight to the person who runs TRI Momentum.',
    messageLabel: 'Your feedback',
    emailLabel: 'Your email (optional)',
    emailHint: "Only if you'd like a reply.",
    sends: 'We send your message and which step you were on. Nothing from your plan is sent.',
    shortMessage: 'Write a little more: at least 5 characters.',
    badEmail: 'Type one email address, such as sam@example.test, or leave this blank.',
    sent: 'Thanks, your feedback is on its way.',
    refused: "We couldn't send that. Check your message and email, then try again. Your message is still here.",
    rate: "You've sent a few messages in a short time. Try again in a little while. Your message is still here.",
    later: "Feedback isn't working right now. Please try again later. Your message is still here.",
    net: "Couldn't reach the server. Check your connection and try again. Your message is still here."
  };

  function countText(n) { return n.toLocaleString('en-AU') + ' of ' + MESSAGE_MAX.toLocaleString('en-AU') + ' characters'; }

  var api = { cleanMessage: cleanMessage, messageOk: messageOk, checkAddress: checkAddress, pageValue: pageValue, TEXT: TEXT, MESSAGE_MIN: MESSAGE_MIN, MESSAGE_MAX: MESSAGE_MAX, MIN_FILL_MS: MIN_FILL_MS };
  if (isNode) { module.exports = api; return; }
  root.RD = root.RD || {};
  root.RD.feedback = api;

  // ---------- the panel ----------

  var doc = root.document;
  var h = root.RD.ui.h;
  var view = doc.getElementById('view');
  if (!view || !view.parentNode || !card.canEmailHere(root.location && root.location.hostname)) return;

  var st = { open: false, busy: false, sent: false, openedAt: 0, refocus: false };

  var btn = h('button', { type: 'button', class: 'fbtn', id: 'fb-btn', 'aria-expanded': 'false', 'aria-controls': 'fb-panel', onclick: toggle }, TEXT.open);

  var msg = h('textarea', {
    id: 'f-fb-message', name: 'feedback-message', rows: '5', maxlength: String(MESSAGE_MAX), 'aria-describedby': 'fb-count',
    oninput: function () {
      count.textContent = countText(msg.value.length);
      if (!msgErr.hidden && messageOk(msg.value)) showMsgError(false);
    }
  });
  var count = h('p', { class: 'help', id: 'fb-count' }, countText(0));
  var msgErr = h('p', { class: 'error', id: 'fb-msg-err', role: 'alert', hidden: true }, TEXT.shortMessage);

  var email = h('input', {
    id: 'f-fb-email', name: 'email', type: 'email', inputmode: 'email', autocomplete: 'email', autocapitalize: 'off', spellcheck: 'false',
    'aria-describedby': 'fb-email-hint',
    oninput: function () { if (!emailErr.hidden && checkAddress(email.value) !== null) showEmailError(false); }
  });
  var emailErr = h('p', { class: 'error', id: 'fb-email-err', role: 'alert', hidden: true }, TEXT.badEmail);

  // The trap field: off screen (not display:none), out of the tab order, hidden from a screen reader, and named so that
  // autofill has no reason to guess it. A person never sees or fills it. Its value goes in the request as `website`.
  var trap = h('input', { type: 'text', id: 'fb-trap', name: 'fb-trap', tabindex: '-1', autocomplete: 'off' });

  var status = h('p', { class: 'mailnote', id: 'fb-status', role: 'status' });
  var sendBtn = h('button', { type: 'button', class: 'fbtn', onclick: send }, 'Send');
  var closeBtn = h('button', { type: 'button', class: 'fbtn', onclick: close }, 'Close');
  var againBtn = h('button', { type: 'button', class: 'fbtn', id: 'fb-again', onclick: again }, 'Send more feedback');
  var closeBtn2 = h('button', { type: 'button', class: 'fbtn', onclick: close }, 'Close');

  var fields = h('div', { class: 'stack' },
    h('div', { class: 'row-wrap' }, h('label', { class: 'field', for: 'f-fb-message' }, TEXT.messageLabel, msg), count, msgErr),
    h('div', { class: 'row-wrap' }, h('label', { class: 'field', for: 'f-fb-email' }, TEXT.emailLabel, email), h('p', { class: 'help', id: 'fb-email-hint' }, TEXT.emailHint), emailErr),
    h('p', { class: 'help' }, TEXT.sends),
    h('div', { class: 'sr-only', 'aria-hidden': 'true' }, trap));
  var formActions = h('div', { class: 'actions' }, sendBtn, closeBtn);
  var doneActions = h('div', { class: 'actions', hidden: true }, againBtn, closeBtn2);

  var panel = h('section', { class: 'card', id: 'fb-panel', 'aria-labelledby': 'fb-h', hidden: true },
    h('h2', { id: 'fb-h' }, TEXT.open),
    h('p', { class: 'help' }, TEXT.intro),
    fields, status, formActions, doneActions);

  var footer = h('footer', { class: 'fb', id: 'feedback' }, h('p', { class: 'small' }, TEXT.footer), btn, panel);
  view.parentNode.insertBefore(footer, view.nextSibling);

  function showMsgError(on) {
    msgErr.hidden = !on;
    if (on) { msg.setAttribute('aria-invalid', 'true'); msg.setAttribute('aria-describedby', 'fb-count fb-msg-err'); }
    else { msg.removeAttribute('aria-invalid'); msg.setAttribute('aria-describedby', 'fb-count'); }
  }
  function showEmailError(on) {
    emailErr.hidden = !on;
    if (on) { email.setAttribute('aria-invalid', 'true'); email.setAttribute('aria-describedby', 'fb-email-hint fb-email-err'); }
    else { email.removeAttribute('aria-invalid'); email.setAttribute('aria-describedby', 'fb-email-hint'); }
  }

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = 'mailnote' + (kind ? ' ' + kind : '');
  }

  function paintBusy() {
    // Read-only while a send is pending, so text typed then cannot be lost or sent half-way. (Not disabled: a disabled
    // field drops focus and is skipped by a screen reader.)
    msg.readOnly = st.busy;
    email.readOnly = st.busy;
    sendBtn.disabled = st.busy;
    var label = st.busy ? 'Sending...' : 'Send';
    if (sendBtn.textContent !== label) sendBtn.textContent = label;
  }

  function paintSent() {
    fields.hidden = !!st.sent;
    formActions.hidden = !!st.sent;
    doneActions.hidden = !st.sent;
  }

  function toggle() { if (st.open) close(); else open(); }

  function open() {
    st.open = true;
    st.openedAt = Date.now(); // for the 3 second wait, a nuisance filter only
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    (st.sent ? againBtn : msg).focus();
  }

  function close() {
    st.open = false;
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    btn.focus();
  }

  // After a send, "Send more feedback": an empty form, and the 3 second wait starts again.
  function again() {
    st.sent = false;
    msg.value = '';
    email.value = '';
    trap.value = '';
    count.textContent = countText(0);
    setStatus('', '');
    paintSent();
    st.openedAt = Date.now();
    msg.focus();
  }

  function send() {
    if (st.busy) return; // a double tap sends once
    var text = cleanMessage(msg.value);
    var okMsg = messageOk(text);
    var address = checkAddress(email.value);
    showMsgError(!okMsg);
    showEmailError(address === null);
    if (!okMsg) { msg.focus(); return; }
    if (address === null) { email.focus(); return; }
    st.busy = true; // before the wait below, so a second tap during the wait is ignored
    st.refocus = doc.activeElement === sendBtn;
    setStatus('', '');
    paintBusy();
    // The body is fixed at the tap, so a change made while it waits is not what goes.
    st.sentMsg = msg.value;
    st.sentEmail = email.value;
    var payload = JSON.stringify({ message: text, email: address === '' ? '' : email.value, page: pageValue(root.location.hash), website: trap.value });
    var wait = Math.max(0, MIN_FILL_MS - (Date.now() - st.openedAt));
    root.setTimeout(function () { post(payload); }, wait);
  }

  function post(payload) {
    if (root.navigator && root.navigator.onLine === false) return done('net');
    var ctl = new AbortController();
    var timer = root.setTimeout(function () { ctl.abort(); }, REPLY_TIMEOUT_MS);
    root.fetch('/api/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
      signal: ctl.signal, cache: 'no-store', credentials: 'omit'
    }).then(function (res) {
      // Only a JSON reply with the function's own words counts, except 429, which is told by its status alone.
      return res.json().then(function (j) { return { status: res.status, result: j && j.result }; }, function () { return { status: res.status, result: null }; });
    }).then(function (o) {
      root.clearTimeout(timer);
      done(o.status === 200 && o.result === 'sent' ? 'sent' : o.status === 429 ? 'rate' : o.status === 400 && o.result === 'refused' ? 'refused' : 'later');
    }, function (err) {
      root.clearTimeout(timer);
      console.warn('TRI Momentum: the feedback request failed.', err && err.name);
      done('net');
    });
  }

  // Every way out of a send comes here, so every one leaves a message. A failure leaves both fields as typed.
  function done(kind) {
    var wasFocused = st.refocus;
    st.busy = false;
    st.refocus = false;
    paintBusy();
    if (kind === 'sent') {
      // Clear a field only if it still holds what was sent, so nothing typed since is wiped unsent.
      if (msg.value === st.sentMsg) msg.value = '';
      if (email.value === st.sentEmail) email.value = '';
      trap.value = '';
      count.textContent = countText(msg.value.length);
      st.sent = true;
      paintSent();
      setStatus(TEXT.sent, 'ok');
      if (st.open && wasFocused) againBtn.focus(); // the Send button is gone, so focus would be lost
    } else {
      setStatus(TEXT[kind], 'bad');
      if (st.open && wasFocused) sendBtn.focus(); // a disabled button drops focus
    }
  }
})(this);
