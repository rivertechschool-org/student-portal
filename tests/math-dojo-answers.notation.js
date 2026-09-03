const A = require('./ai.js');
// Realistic ways a student types an answer they were SHOWN in that notation.
const cases = [
  ['3.5 x 10^4',  '3.5 × 10^4', 'scientific: x for ×'],
  ['3.5*10^4',    '3.5 × 10^4', 'scientific: asterisk'],
  ['35000',       '3.5 × 10^4', 'scientific: plain number'],
  ['3.5 × 10⁴',   '3.5 × 10^4', 'scientific: superscript'],
  ['2 x 3',       6,            'times table with x'],
  ['12 ÷ 4',      3,            'division sign'],
  ['1/2',         '0.5',        'fraction vs decimal'],
  ['0.5',         '1/2',        'decimal vs fraction'],
  ['50%',         '1/2',        'percent vs fraction'],
  ['sqrt(9)',     3,            'sqrt spelled out'],
  ['√9',          3,            'radical symbol as a number'],
  ['2^3',         8,            'power as a number'],
  ['2³',          8,            'superscript power as number'],
  ['pi',          'π',          'pi spelled out'],
  ['3.14159',     'π',          'pi as decimal'],
  ['-5',          '−5',         'unicode minus in expected'],
  ['−5',          '-5',         'unicode minus typed'],
  ['1 1/2',       1.5,          'mixed number'],
  ['$1,157.63',   1157.63,      'money with symbol'],
  ['x = 5',       5,            'answers with x= prefix'],
];
let fails = [];
for (const [typed, exp, label] of cases) {
  let got; try { got = A.checkAnswer(typed, exp).correct; } catch (e) { got = 'THREW'; }
  console.log(`${got === true ? 'ok  ' : 'MISS'}  ${label.padEnd(32)} "${typed}" vs ${JSON.stringify(exp)}`);
  if (got !== true) fails.push(label);
}
console.log(`\n${fails.length} not accepted:`, fails.join(' | '));
