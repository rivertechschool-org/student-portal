const A = require('./ai.js');
// Every one of these MUST be rejected. Loosening a checker is only safe if
// wrong answers still fail.
const mustFail = [
  ['1000',          1157.63,      'close but wrong number'],
  ['1000 × 1.05',   1157.63,      'wrong expression'],
  ['3.4 × 10^4',    '3.5 × 10^4', 'wrong mantissa'],
  ['3.5 × 10^5',    '3.5 × 10^4', 'wrong exponent'],
  ['34999',         '3.5 × 10^4', 'near miss on sci-notation'],
  ['√10',           3,            'wrong root'],
  ['2^4',           8,            'wrong power'],
  ['2⁴',            8,            'wrong superscript power'],
  ['x = 6',         5,            'restated but wrong'],
  ['y = 5',         '2x',         'restated at an algebra answer'],
  ['-5',            5,            'sign matters'],
  ['5',             '-5',         'sign matters the other way'],
  ['÷',             '×',          'operation answers still distinct'],
  ['division',      'multiplication', 'operation words still distinct'],
  ['pi',            3,            'pi is not 3'],
  ['1/3',           '1/2',        'wrong fraction'],
  ['0.34',          '1/3',        'fraction tolerance not sloppy'],
];
let leaked = [];
for (const [typed, exp, label] of mustFail) {
  let got; try { got = A.checkAnswer(typed, exp).correct; } catch(e){ got='THREW'; }
  const ok = got === false;
  if (!ok) leaked.push(`${label}: "${typed}" accepted as ${JSON.stringify(exp)}`);
  console.log(`${ok?'ok  ':'LEAK'}  ${label.padEnd(34)} "${typed}" vs ${JSON.stringify(exp)} -> ${got}`);
}
console.log(leaked.length ? `\n${leaked.length} FALSE ACCEPTS:\n  ` + leaked.join('\n  ') : '\nno wrong answer accepted');
