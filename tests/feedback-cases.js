// One table of feedback inputs, shared by tests/card.test.js (the page's rules in public/js/feedback.js) and
// tests/feedback.test.js (the function's rules in functions/api/feedback.js), so the two cannot drift apart. The address
// table is tests/email-cases.js, shared with the race card's email block. Not a test file: the test glob is tests/*.test.js.
//
// The blank address differs from the card on purpose. email-cases.js lists '' and '   ' as bad, because the race card needs an
// address. Feedback does not: a blank or whitespace-only address means "no reply address" and is sent. `blankAddress` names
// those, so no test has to skip them quietly.
const emails = require('./email-cases.js');

module.exports = {
  message: {
    // Accepted: 5 to 2,000 characters after trimming (JavaScript string length). Each says what it is.
    good: [
      ['five characters', 'Hello'],
      ['padded, five after trimming', '  Hello  '],
      ['exactly 2,000', 'x'.repeat(2000)],
      ['2,000 code units made of surrogate pairs', '\u{1F600}'.repeat(1000)],
      ['tab, line feed and carriage return inside', 'a\tb\nc\r\nd'],
      ['2,000 after trimming, padded', '  ' + 'x'.repeat(2000) + '  ']
    ],
    // Refused for length or type, by the page and by the function.
    bad: [
      ['empty', ''],
      ['spaces only', '     '],
      ['four characters', 'abcd'],
      ['two after trimming', '  hi  '],
      ['four after trimming', '   abcd   '],
      ['2,001', 'x'.repeat(2001)],
      ['2,002 code units of surrogate pairs', '\u{1F600}'.repeat(1001)],
      ['not a string: number', 42],
      ['not a string: null', null],
      ['not a string: array', ['hello world']]
    ],
    // The page replaces each run of these with one space before it checks and sends (cleanMessage), so each of these typed
    // becomes the third item. [what, typed, what the page sends, before the function trims it]
    cleaned: [
      ['NUL', 'hello\u0000world', 'hello world'],
      ['first low control after NUL', 'hello\u0008world', 'hello world'],
      ['vertical tab', 'hello\u000bworld', 'hello world'],
      ['form feed', 'hello\u000cworld', 'hello world'],
      ['SO, the first control after CR', 'hello\u000eworld', 'hello world'],
      ['ESC, as a terminal paste carries', 'hello\u001b[31mred\u001b[0m', 'hello [31mred [0m'],
      ['US, the last low control', 'hello\u001fworld', 'hello world'],
      ['DEL', 'hello\u007fworld', 'hello world'],
      ['first C1 control', 'hello\u0080world', 'hello world'],
      ['a C1 control', 'hello\u0085world', 'hello world'],
      ['last C1 control', 'hello\u009fworld', 'hello world'],
      ['a run of them is one space', 'hello\u000b\u000c\u007f\u0085world', 'hello world'],
      ['at the edge, then trimmed', '\u000bhello\u009f', ' hello '],
      ['tab, line feed and carriage return stay', 'a\tb\nc\r\nd', 'a\tb\nc\r\nd'],
      ['U+00A0 is not a control and stays', 'hello\u00a0world', 'hello\u00a0world']
    ],
    // Refused by the function if they arrive (the page cleans every one of these to a space first, so a person never hits
    // the refusal): control characters other than tab, LF and CR.
    controls: [
      ['NUL', 'hello\u0000world'],
      ['vertical tab', 'hello\u000bworld'],
      ['ESC', 'hello\u001bworld'],
      ['U+0008', 'hello\u0008world'],
      ['U+000E', 'hello\u000eworld'],
      ['U+001F', 'hello\u001fworld'],
      ['form feed', 'hello\u000cworld'],
      ['DEL', 'hello\u007fworld'],
      ['a C1 control', 'hello\u0085world']
    ]
  },
  // The `page` value. The function refuses a bad one; the page sends "" instead of it.
  page: {
    good: ['', '#/', '#/card', '#/pacing/2', '#/setup/1', '#/' + 'a'.repeat(40), '#/' + '0/'.repeat(20)],
    bad: ['#/' + 'a'.repeat(41), '#/Card', '#/card?x=1', '#/card\n', '#/card ', ' #/card', '/card', '#card', 'javascript:', '#/ca rd', '#/café', '#/card#x', '#/card\u0000', 42, null, ['#/card']]
  },
  address: emails,
  blankAddress: ['', '   ', '\t  \t']
};
