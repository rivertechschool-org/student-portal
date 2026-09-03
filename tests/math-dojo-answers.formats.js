const A = require('./ai.js');
const cases = [
  // [typed, expected, shouldPass, label]
  ['x²+2x+1',   'x^2+2x+1', true,  'superscript polynomial'],
  ['x^2+2x+1',  'x^2+2x+1', true,  'caret polynomial still works'],
  ['3x²',       '3x^2',     true,  'superscript power'],
  ['1157.63',   1157.63,    true,  'plain number unchanged'],
  ['1,157.63',  1157.63,    true,  'comma number unchanged'],
  ['1000 × 1.157625', 1157.63, true,  'x-symbol multiplication'],
  ['1000 x 1.157625', 1157.63, true,  'letter x multiplication'],
  ['1000 * 1.157625', 1157.63, true,  'asterisk multiplication'],
  ['1000*1.05^3',     1157.63, true,  'full expression with power'],
  ['(1000+157.63)',   1157.63, true,  'parentheses'],
  ['1000',            1157.63, false, 'wrong number still wrong'],
  ['1000 × 1.05',     1157.63, false, 'wrong expression still wrong'],
  ['twelve',          12,      true,  'word numbers still work'],
];
let bad = 0;
for (const [typed, exp, want, label] of cases) {
  let got;
  try { got = A.checkAnswer(typed, exp, { tolerance: 0.02 }).correct; }
  catch (e) { got = 'THREW: ' + e.message; }
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${label.padEnd(32)} "${typed}" -> ${got}`);
}
console.log(bad ? `\n${bad} FAILING` : '\nall pass');
