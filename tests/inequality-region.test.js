// A question with infinitely many right answers must accept any of them.
//
// Systems of Inequalities asks for a point in the overlap of two half-planes.
// That region is unbounded, so there is no list of correct answers to write
// down - and for a while there was no need for one, because the question was
// multiple choice and "which of these four" has exactly one right button.
//
// Tier 5 then started typing answers instead of choosing them
// (shouldTypeAnswer: tier >= 5 && the answer is typeable, and a coordinate is
// typeable). The options vanished, the question still read "Which point...",
// and grading still compared against the single point the generator happened
// to draw. A student who read the region off the graph correctly and wrote any
// other point in it was marked wrong - every time, on every draw.
//
// So this checks the property, not the string: any point inside the region
// passes, anything on or outside the boundary fails.
//
// Run: node tests/inequality-region.test.js

const fs = require('fs');
const path = require('path');
const AnswerInterpreter = require('./ai.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');
const lines = src.split('\n');

function region(re, kind) {
  const m = src.match(re);
  if (!m) throw new Error('could not extract ' + kind + ' from math-dojo.html');
  return m[0];
}

// The generator body, taken verbatim so this tests the shipped code.
const at = lines.findIndex(l => l.includes('M-218  Systems of Inequalities'));
if (at === -1) throw new Error('Systems of Inequalities generator not found');
const open = lines.findIndex((l, i) => i > at && l.trim().startsWith('}, function(){'));
const close = lines.findIndex((l, i) => i > open && l.trim() === '});');
let gen = lines.slice(open, close + 1).join('\n').replace('}, function(){', 'const GEN = function(){');
gen = gen.slice(0, gen.lastIndexOf('});')) + '};';

const harness = [
  "const ri = (a,b) => Math.floor(Math.random()*(b-a+1))+a;",
  "const optS = (ans, ds) => [ans, ...ds];",
  region(/const NON_TYPEABLE_ANSWER_TYPES = new Set\(\[[\s\S]*?\]\);/, 'NON_TYPEABLE_ANSWER_TYPES'),
  region(/function answerIsTypeable\(answer\) \{[\s\S]*?\n\}/, 'answerIsTypeable'),
  region(/function shouldTypeAnswer\(q, tier\) \{[\s\S]*?\n\}/, 'shouldTypeAnswer'),
  region(/function typedAnswerIsCorrect\(userInput, expectedOrQuestion\) \{[\s\S]*?\n\}/, 'typedAnswerIsCorrect'),
  gen,
  'return { GEN, shouldTypeAnswer, typedAnswerIsCorrect };'
].join('\n');

const { GEN, shouldTypeAnswer, typedAnswerIsCorrect } =
  new Function('AnswerInterpreter', '"use strict";' + harness)(AnswerInterpreter);

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  if (ok) pass++;
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
};

const DRAWS = 300;
for (let t = 0; t < DRAWS; t++) {
  const q = GEN();
  const m = q.question.match(/y > x\s*(?:([+-])\s*(\d+))?,\s+y < (\d+)/);
  if (!m) { check('question states the system', false, q.question); continue; }
  const h = m[1] ? (m[1] === '+' ? 1 : -1) * Number(m[2]) : 0;
  const cap = Number(m[3]);
  const nums = q.answer.match(/-?\d+/g).map(Number);

  // The wording has to match how it is actually rendered. "Which point" with
  // no options on screen is a question the student cannot answer as asked.
  if (shouldTypeAnswer(q, 5)) {
    check('typed question does not say "Which"', !/\bwhich\b/i.test(q.question), q.question);
  }

  check('canonical answer is accepted', typedAnswerIsCorrect(q.answer, q), q.question + ' / ' + q.answer);

  // Every integer point inside the region, in a window around it.
  let insideTested = 0, insideOk = 0;
  for (let x = -6; x <= 6; x++) {
    for (let y = -6; y <= 14; y++) {
      if (y > x + h && y < cap) {
        insideTested++;
        if (typedAnswerIsCorrect('(' + x + ', ' + y + ')', q)) insideOk++;
      }
    }
  }
  check('every point inside the region is accepted',
        insideTested > 0 && insideOk === insideTested,
        q.question + ' -> ' + insideOk + '/' + insideTested + ' accepted');

  // Strict inequalities: the boundaries themselves are not solutions.
  check('a point on the y = cap boundary is rejected',
        !typedAnswerIsCorrect('(0, ' + cap + ')', q), q.question);
  check('a point on the y = x + h boundary is rejected',
        !typedAnswerIsCorrect('(0, ' + h + ')', q), q.question);
  check('a point above the cap is rejected',
        !typedAnswerIsCorrect('(0, ' + (cap + 2) + ')', q), q.question);

  // Non-integer answers are points too.
  const mid = (h + cap) / 2;
  if (mid > h && mid < cap && mid !== Math.floor(mid)) {
    check('a non-integer point inside is accepted',
          typedAnswerIsCorrect('(0, ' + mid + ')', q), q.question + ' -> (0, ' + mid + ')');
  }

  // Nonsense must not sneak through the validator.
  check('junk is rejected',
        !typedAnswerIsCorrect('banana', q) && !typedAnswerIsCorrect('5', q)
        && !typedAnswerIsCorrect('(1, 2, 3)', q), q.question);

  if (nums.length !== 2) check('answer is a coordinate pair', false, q.answer);
}

// The grader contract the fix rests on, independent of this one generator.
check('validate() accepts what the string comparison rejects',
      typedAnswerIsCorrect('anything', { answer: '(0, 0)', validate: () => true }));
check('validate() is not consulted when the string already matches',
      typedAnswerIsCorrect('(0, 0)', { answer: '(0, 0)', validate: () => false }));
const boom = () => { throw new Error('deliberate'); };
const warn = console.warn; console.warn = () => {};   // the throw is the point here
check('a throwing validate() leaves the string result standing',
      typedAnswerIsCorrect('(0, 0)', { answer: '(0, 0)', validate: boom })
      && !typedAnswerIsCorrect('nope', { answer: '(0, 0)', validate: boom }));
console.warn = warn;
check('a question with no validate() still grades by string',
      typedAnswerIsCorrect('(0, 0)', { answer: '(0, 0)' }) && !typedAnswerIsCorrect('(1, 1)', { answer: '(0, 0)' }));

console.log('\n  ' + DRAWS + ' draws checked');
console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
