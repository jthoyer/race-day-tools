// One table of addresses, shared by tests/card.test.js (the page's check) and tests/send.test.js (the function's check),
// so the two copies of the rule cannot drift apart. Not a test file: the test glob is tests/*.test.js.
const long = 'x'.repeat(250);
module.exports = {
  // Accepted. The address is trimmed first, so the padded one is fine and is sent without its padding.
  good: [
    'sam@example.test',
    'Sam.Lee+race@example.test',
    'a@b.co',
    'sam@mail.example.test',
    '  sam@example.test  ',
    'x'.repeat(240) + '@a.test' // 247 characters
  ],
  // Refused, each for one reason.
  bad: [
    '', '   ', 'sam', 'sam@', '@example.test', 'sam@example', 'a@b.c',
    'sam@@example.test', 'sam@a@example.test',
    'sam@example.test, lee@example.test', 'sam@example.test,lee@example.test', 'sam@example.test;lee@example.test',
    'sam@example.test lee@example.test', 'sam @example.test', 'sam\t@example.test',
    'sam\n@example.test', 'sam@example.test\nBcc: lee@example.test', 'sam@example.test\r\nBcc: lee@example.test', 'sam\u0000@example.test',
    '<sam@example.test>', 'Sam Lee <sam@example.test>', '"sam"@example.test', "o'neil@example.test", 'sam`@example.test', 'sam\\@example.test',
    'sämm@example.test', 'sam@exämple.test', 'sam@example.test x',
    'sam@.example.test', 'sam@example.test.', 'sam@exa..mple.test',
    long + '@a.test', // 257 characters
    ['sam@example.test'], { email: 'sam@example.test' }, null, undefined, 42, true
  ]
};
