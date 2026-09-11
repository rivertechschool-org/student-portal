// What the Decimals lesson teaches, and what it then asks.
//
// The "Understanding Decimals" sub-skill teaches place value: tenths,
// hundredths, thousandths, the value of a digit, decimals as fractions. Its own
// guided steps accept "tenths", "hundredths", "0.06", "6/100".
//
// Its practice generator mapped that sub-skill to 'compare' and asked "Which is
// greater: 4.2 or 7.1?" — and because 'understanding' is the FIRST sub-skill,
// it is the only one unlocked when the lesson ends. So a student finished a
// lesson on place value and then answered a comparison question every single
// time, never once naming a place.
//
// This holds two things:
//
//   * PRACTICE ASKS WHAT THE LESSON TAUGHT. Place value is the substance, not
//     an occasional variety.
//   * THE QUESTIONS ARE ANSWERABLE. A generated question whose digit is 0, or
//     that names a place the number does not have, is unanswerable in a way a
//     student reads as their own mistake.
//
// Run: node tests/decimals-understanding.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---- pull the generator out of the file ---------------------------------
const key = '"Decimal Operations": () => {';
const start = html.indexOf(key);
if (start < 0) throw new Error('Decimal Operations generator not found');
let i = html.indexOf('{', start + key.length - 1), depth = 0, end = i;
for (; i < html.length; i++) {
  const c = html[i];
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const body = html.slice(html.indexOf('{', start + key.length - 1), end);

// Only the sub-skill under test is unlocked, which is the situation a student
// is in the moment the lesson ends — and the situation that made this a bug.
let unlockedArg = null;
const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const getUnlockedSubSkillTypes = (id, map) => { unlockedArg = id; return [map.understanding]; };
const gen = new Function('rand', 'pick', 'getUnlockedSubSkillTypes',
  'return (() => ' + body + ')();');

const sample = [];
for (let n = 0; n < 400; n++) sample.push(gen(rand, pick, getUnlockedSubSkillTypes));

console.log('\n== practice matches the lesson ==\n');

check('the generator reads the right sub-skill list', unlockedArg, '3_Decimal Operations');
check('every question has text and an answer',
  sample.every(q => q && typeof q.question === 'string' && q.question.length > 5
                 && q.answer !== undefined && q.answer !== null && q.answer !== ''), true);

const comparisons = sample.filter(q => /which is greater/i.test(q.question));
const placeValue  = sample.filter(q => /place|value of the|as a fraction/i.test(q.question));

ok('place value is the substance now', placeValue.length > sample.length * 0.6);
// It stays in the mix — reading place by place is the same skill — but as one
// shape among several rather than the only one.
ok('comparison survives as a minority', comparisons.length > 0 && comparisons.length < sample.length * 0.4);
check('every question is one or the other', placeValue.length + comparisons.length, sample.length);

console.log('\n== the four shapes the lesson set up ==\n');

const shape = (re) => sample.filter(q => re.test(q.question)).length;
ok('naming the place is asked',      shape(/which place is the \d in/i) > 0);
ok('the digit in a place is asked',  shape(/which digit is in the (tenths|hundredths|thousandths) place/i) > 0);
ok('the value of a digit is asked',  shape(/what is the value of the \d/i) > 0);
ok('decimal to fraction is asked',   shape(/write 0\.\d as a fraction/i) > 0);

console.log('\n== every generated question is answerable ==\n');

// "Which digit is in the hundredths place" must have exactly one answer, and
// the value of a digit must never be 0 — a zero digit makes both questions
// read as broken to the student rather than as a trick.
//
// Scoped to the place-value questions on purpose. The comparison branch is
// untouched and legitimately produces "4.0", where a trailing zero is the
// point rather than a defect.
const threeDp = sample
  .filter(q => /which place is the|which digit is in|value of the/i.test(q.question))
  .flatMap(q => q.question.match(/\d+\.\d+/g) || []);
ok('the place-value numbers were generated at all', threeDp.length > 100);
ok('none of them has a zero after the point',
  threeDp.every(n => !/\.\d*0/.test(n)));
ok('  and all three places are present to ask about',
  threeDp.every(n => n.split('.')[1].length === 3));

const placeNames = sample.filter(q => /which place is the/i.test(q.question));
ok('naming the place offers all three places',
  placeNames.every(q => Array.isArray(q.options) && q.options.length === 3));
ok('  and the answer is one of them',
  placeNames.every(q => q.options.includes(q.answer)));

const values = sample.filter(q => /what is the value of the/i.test(q.question));
ok('a digit value is a number, never zero',
  values.every(q => typeof q.answer === 'number' && q.answer > 0));
ok('  and the fraction form is accepted too',
  values.every(q => Array.isArray(q.acceptableAnswers)
                 && q.acceptableAnswers.some(a => /^\d+\/\d+$/.test(a))));

const fracs = sample.filter(q => /as a fraction/i.test(q.question));
ok('a decimal-to-fraction answer is over ten',
  fracs.every(q => /^\d\/10$/.test(q.answer)));
ok('  with the spaced form accepted',
  fracs.every(q => q.acceptableAnswers.some(a => a.includes(' / '))));

const compares = sample.filter(q => /which is greater/i.test(q.question));
ok('comparison still offers its three options',
  compares.every(q => Array.isArray(q.options) && q.options.length >= 2 && q.options.includes(q.answer)));

ok('every question explains itself', sample.every(q => typeof q.explanation === 'string' && q.explanation.length > 10));

console.log('\n== the sub-skill is no longer wired to comparison ==\n');

const map = body.slice(body.indexOf('const subSkillToOp'), body.indexOf('subSkillOrder'));
check("'understanding' no longer maps to compare", /understanding':\s*'compare'/.test(map), false);
ok("it maps to its own branch", /understanding':\s*'understand'/.test(map));
ok('the arithmetic sub-skills are untouched',
  /'add':\s*'\+'/.test(map) && /'subtract':\s*'-'/.test(map) && /'multiply'/.test(map));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
