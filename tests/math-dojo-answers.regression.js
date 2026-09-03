const A = require('./ai.js');
const cases = [
  ['2x',        '2x',       true,  'variable answer unaffected'],
  ['3',         '2x',       false, 'number is not an algebra answer'],
  ['x=5',       'x = 5',    true,  'equation spacing'],
  ['5',         '5 or -5',  false, 'partial abs-value still wrong'],
  ['3/4',       0.75,       true,  'fraction to decimal'],
  ['75%',       0.75,       true,  'percent to decimal'],
  ['1/0',       'undefined',false, 'divide by zero not accepted as a number'],
  ['16π',       '16π',      true,  'pi expression unaffected'],
  ['3√2',       '3√2',      true,  'radical unaffected'],
  ['(3, 4)',    '(3, 4)',   true,  'coordinate unaffected'],
  ['5 R 2',     '5 R 2',    true,  'remainder unaffected'],
  ['3.5 × 10^4',35000,      true,  'scientific notation evaluates'],
  ['yes',       'yes',      true,  'boolean unaffected'],
  ['12 units',  12,         true,  'number with units unaffected'],
];
let bad=0;
for (const [typed, exp, want, label] of cases) {
  let got; try { got = A.checkAnswer(typed, exp).correct; } catch(e){ got='THREW '+e.message; }
  const ok = got===want; if(!ok) bad++;
  console.log(`${ok?'pass':'FAIL'}  ${label.padEnd(36)} "${typed}" vs ${JSON.stringify(exp)} -> ${got}`);
}
console.log(bad?`\n${bad} FAILING`:'\nno regressions');
