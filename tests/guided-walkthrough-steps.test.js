// Math Dojo's guided walkthrough, built from a lesson's worked steps.
//
// Lessons without hand-written interactiveSteps get theirs from
// generateInteractiveSteps(). Two bugs lived there:
//
//   1. The final question was prompted with the LAST step's label, which often
//      names a middle step: "Root of 16" expecting 4√3, "4 × 2" expecting x^8.
//      A student who did what the prompt said was marked wrong.
//   2. A middle step's expected answer was the first digits found anywhere in
//      its text: "−16" checked as 16, "(x + 4)(x − 2) = 0" as 0.
//
// Run: node tests/guided-walkthrough-steps.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');

function fnSource(name) {
  const d = src.indexOf(`function ${name}(`);
  if (d < 0) throw new Error(`function ${name} not found`);
  let i = src.indexOf('{', d), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(d, i + 1);
}

const ctx = vm.createContext({});
vm.runInContext(['generateInteractiveSteps', 'extractAnswer', 'buildMistakeMap'].map(fnSource).join('\n'), ctx);

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};

console.log('\n== a middle step is asked only for a plain number ==\n');
const ex = v => ctx.extractAnswer(v);
check('"−16" keeps its sign', ex('−16'), '-16');
check('"√16 = 4" asks 4', ex('√16 = 4'), '4');
check('"2 − 6 = −4" asks −4', ex('2 − 6 = −4'), '-4');
check('a fraction', ex('8/6'), '8/6');
check('degrees', ex('90° − 35° = 55°'), '55°');
check('an equation is not "0"', ex('(x + 4)(x − 2) = 0'), null);
check('algebra is shown, not asked', ex('x²(5x + 2) + 3(5x + 2)'), null);
check('prose is shown, not asked', ex('60 + 45 = 105 → .05, carry 1'), null);
check('"?" is not an answer', ex('?'), null);

console.log('\n== the final question is the whole problem\'s ==\n');
// The lesson shape that shipped broken: last label names a middle step.
const old = { problem: 'Simplify √48', answer: '4√3',
  steps: [{ label: 'Largest perfect-square factor', value: '16 · 3' }, { label: 'Root of 16', value: '?' }] };
let steps = ctx.generateInteractiveSteps(old, {});
const last = steps[steps.length - 1];
check('not prompted "Root of 16"', last.prompt, 'Final answer: Simplify √48');
check('  that label is shown as the next move', (last.showWork || []).slice(-1)[0], 'next: Root of 16');
check('  and the answer is still 4√3', last.answer, '4√3');

const labelled = { problem: 'Simplify (x^4)^2', answer: 'x^8', answerLabel: '(x^4)^2 =',
  steps: [{ label: 'Power of a power', value: 'multiply the exponents' },
          { label: '4 × 2', value: '4 × 2 = 8' }, { label: 'Write x with that exponent', value: '?' }] };
steps = ctx.generateInteractiveSteps(labelled, {});
check('Laws of Exponents asks 4 × 2 = 8, then (x^4)^2', steps.map(s => [s.prompt, s.answer]),
      [['4 × 2', '8'], ['(x^4)^2 =', 'x^8']]);

console.log('\n== the shipped lessons ==\n');
const lessonGuided = (problem) => {
  const i = src.indexOf(`problem: "${problem}"`);
  const block = src.slice(i, src.indexOf('}', src.indexOf('answer', src.indexOf(']', i))) + 1);
  return block;
};
check('Simplifying Radicals asks √16 = 4, then √48 =', /value: "√16 = 4"[\s\S]*answerLabel: "√48 ="/.test(lessonGuided('Simplify √48')), true);
check('Laws of Exponents ends on (x^4)^2 =', /answerLabel: "\(x\^4\)\^2 ="/.test(lessonGuided('Simplify (x^4)^2')), true);
check('Statistics Basics asks the count, then the mode', /value: "3"[\s\S]*answerLabel: "mode ="/.test(src.slice(src.indexOf('Find the mode of 4, 7, 4, 2, 9, 4.'), src.indexOf('Find the mode of 4, 7, 4, 2, 9, 4.') + 400)), true);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
