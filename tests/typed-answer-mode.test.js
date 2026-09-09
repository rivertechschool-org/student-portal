// Tier 5+ renders answers as typed input, so every question up there must be
// answerable without its option buttons. That rule was violated three ways,
// found by sweeping all 165 tier-5+ generators that emit typed questions:
//
//  1. Questions with infinitely many right answers graded against the one the
//     generator drew ("Which point lies on the line...") - fixed with
//     validate() predicates, like Systems of Inequalities before them.
//  2. Prose and untypeable-symbol answers ("f(a) exists, lim f(x) exists...",
//     "x = 4 sin θ", "uv − ∫v du") rendered as a text box the student had to
//     reproduce glyph for glyph - fixed by answerIsTypeable guards that send
//     them back to their (still-generated) options.
//  3. Selection tasks ("Which expression NEEDS the product rule?") that have
//     no answer without candidates on screen - fixed with q.forceChoice.
//
// This locks all three in, plus the acceptableAnswers added for equivalent
// typed forms ("7" for "x = 7", "f(-x)" for "y = f(-x)").
//
// Run: node tests/typed-answer-mode.test.js

const fs = require('fs');
const path = require('path');
const AnswerInterpreter = require('./ai.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');
const lines = src.split('\n');

// ---- extraction: same approach as tools/dojo-lesson-audit.js, plus the five
// V2 _addSkill IIFEs that tool does not cover.
function lineOf(re, from = 0) {
  for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i;
  return -1;
}
function sliceBalanced(start) {
  for (let i = start + 1; i < lines.length; i++)
    if (/^};\s*$/.test(lines[i])) return lines.slice(start, i + 1).join('\n');
  throw new Error('unterminated table at ' + (start + 1));
}
function fnSource(name) {
  const at = lineOf(new RegExp('^function ' + name + '\\b'));
  for (let i = at + 1; i < lines.length; i++)
    if (/^}\s*$/.test(lines[i])) return lines.slice(at, i + 1).join('\n');
  throw new Error(name + ' unterminated');
}
function grab(re, what) {
  const m = src.match(re);
  if (!m) throw new Error('could not extract ' + what);
  return m[0];
}

const helpers = [
  lines[lineOf(/^const rand = /)], lines[lineOf(/^const pick = /)],
  lines[lineOf(/^const shuffle = /)], lines[lineOf(/^const cap = /)],
  lines[lineOf(/^const gcd = /)], lines[lineOf(/^const simplifyFrac = /)],
  fnSource('generateDistractors'), fnSource('backfillOptions'),
  fnSource('answerValue'), fnSource('uniqOpts'), fnSource('getUnlockedSubSkillTypes'),
].join('\n');

const iifes = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trimEnd() === '(function(){') {
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trimEnd() === '})();') { iifes.push(lines.slice(i, j + 1).join('\n')); i = j; break; }
    }
  }
}
if (iifes.length !== 5) throw new Error('expected 5 V2 IIFEs, found ' + iifes.length);

const body = [
  'let __seed = 42; Math.random = () => { __seed = (__seed*1103515245+12345) & 0x7fffffff; return __seed/0x7fffffff; };',
  'const state = new Proxy({ completedSubSkills: new Proxy({}, {',
  "  get: () => ['setup','divide','remainder','understanding','compare','add','subtract','identify','solve','evaluate','simplify','graph','slope','intercept','convert']",
  '}) }, { get: (t, k) => k in t ? t[k] : {} });',
  helpers,
  grab(/const NON_TYPEABLE_ANSWER_TYPES = new Set\(\[[\s\S]*?\]\);/, 'NON_TYPEABLE_ANSWER_TYPES'),
  grab(/function answerIsTypeable\(answer\) \{[\s\S]*?\n\}/, 'answerIsTypeable'),
  grab(/function shouldTypeAnswer\(q, tier\) \{[\s\S]*?\n\}/, 'shouldTypeAnswer'),
  grab(/function typedAnswerIsCorrect\(userInput, expectedOrQuestion\) \{[\s\S]*?\n\}/, 'typedAnswerIsCorrect'),
  sliceBalanced(lineOf(/^const TIERS = \{/)),
  sliceBalanced(lineOf(/^const Q_MATRIX = \{/)),
  sliceBalanced(lineOf(/^const generators = \{/)),
  sliceBalanced(lineOf(/^const lessons = \{/)),
  iifes.join('\n'),
  'return { generators, answerIsTypeable, shouldTypeAnswer, typedAnswerIsCorrect };',
].join('\n');

const { generators, answerIsTypeable, shouldTypeAnswer, typedAnswerIsCorrect } =
  new Function('AnswerInterpreter', '"use strict";' + body)(AnswerInterpreter);

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  if (ok) pass++;
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
};

// ---- 1. validate() generators grade the property, not the drawn instance.
for (let t = 0; t < 200; t++) {
  const q = generators[5]['Graphing Linear Equations']();
  if (q.subType !== 'point') continue;
  const m = q.question.match(/y = (-?\d+)x (?:\+ (\d+)|− (\d+))?/);
  check('point question states the line', !!m, q.question);
  if (!m) continue;
  const slope = Number(m[1]), b = m[2] ? Number(m[2]) : (m[3] ? -Number(m[3]) : 0);
  check('point wording asks to give, not pick', !/\bwhich\b/i.test(q.question), q.question);
  let allOk = true;
  for (let x = -3; x <= 3; x++) {
    if (!typedAnswerIsCorrect('(' + x + ', ' + (slope * x + b) + ')', q)) allOk = false;
    if (typedAnswerIsCorrect('(' + x + ', ' + (slope * x + b + 1) + ')', q)) allOk = false;
  }
  check('every on-line point accepted, every off-line rejected', allOk, q.question);
}

for (let t = 0; t < 200; t++) {
  const q = generators[10]['Modular Arithmetic']();
  if (q.subType !== 'congruence') continue;
  const m = q.question.match(/other than (\d+) that is congruent to \1 modulo (\d+)/);
  check('congruence wording asks for any representative', !!m, q.question);
  if (!m) continue;
  const r = Number(m[1]), n = Number(m[2]);
  check('r + n, r + 2n and r - n all accepted',
        [n, 2 * n, -n].every(k => typedAnswerIsCorrect(String(r + k), q)), q.question);
  check('the trivial r itself is rejected', !typedAnswerIsCorrect(String(r), q), q.question);
  check('a wrong residue is rejected', !typedAnswerIsCorrect(String(r + 1), q), q.question);
}

// ---- 2. answerIsTypeable: computed answers type, prose and orphan glyphs do not.
for (const [a, want] of [
  ['7√3', true], ['(4, 3)', true], ['x ≤ 2', true], ['log(48)/log(5)', true],
  ['x = 7 or x = -4', true], ['-1 and 1', true], ['{1, 2, 4}', true],
  ['⟨4, 0⟩', true], ['1157.63', true], ['x^2+2x+1', true],
  ['Reflexive Property', false], ['x = 4 sin θ', false], ['uv − ∫v du', false],
  ['split into two integrals at x = c', false], ['Two complex solutions', false],
  ['(θ/360) × 2πr', false], ['Exactly one', false], ['best fit', false],
  ['f(a) exists, lim f(x) exists, and they are equal', false],
]) {
  check('answerIsTypeable(' + JSON.stringify(a) + ') === ' + want, answerIsTypeable(a) === want);
}

// ---- 3. forceChoice always wins, whatever the answer looks like.
check('forceChoice beats a typeable answer',
      !shouldTypeAnswer({ answer: '(1, 2)', forceChoice: true }, 9));
for (let t = 0; t < 100; t++) {
  const q = generators[9]['Product Rule']();
  if (/NEEDS the product rule/.test(q.question)) {
    check('the NEEDS-product-rule item is forceChoice', q.forceChoice === true, q.question);
  }
}

// ---- 4. acceptableAnswers give equivalent typed forms.
for (let t = 0; t < 200; t++) {
  const q7 = generators[7]['Solving Exponential and Logarithmic Equations']();
  if (q7.subType === 'extraneous') {
    const n = q7.answer.match(/\d+/)[0];
    check('bare number accepted for "x = n"', typedAnswerIsCorrect(n, q7), q7.answer);
    check('extraneous wording asks for the solution', !/\bwhich\b/i.test(q7.question), q7.question);
  }
  const qf = generators[7]['Function Transformations']();
  if (qf.subType === 'write') {
    check('form without "y =" accepted', typedAnswerIsCorrect(qf.answer.replace(/^y = /, ''), qf), qf.answer);
    check('write wording has no dangling "which"', !/\bwhich\b/i.test(qf.question), qf.question);
  }
}

// ---- 5. No tier-5+ generator emits a typed question worded for options.
// "choose k items" is the combinatorics term, not a UI instruction, so
// "choose" is deliberately not in this pattern.
const MC_WORDING = /\bwhich\b|of the following|of these|\bselect\b/i;
const offenders = new Set();
for (const [tierStr, skills] of Object.entries(generators)) {
  const tier = Number(tierStr);
  if (tier < 5) continue;
  for (const [skill, gen] of Object.entries(skills)) {
    if (typeof gen !== 'function') continue;
    for (let t = 0; t < 60; t++) {
      let q; try { q = gen(); } catch (e) { break; }
      if (!q) continue;
      let typed = false; try { typed = shouldTypeAnswer(q, tier); } catch (e) {}
      if (typed && MC_WORDING.test(String(q.question))) {
        offenders.add('T' + tier + ' ' + skill + ': ' + String(q.question).slice(0, 90));
      }
    }
  }
}
check('no typed question is worded for options (' + offenders.size + ' offenders)', offenders.size === 0,
      [...offenders].slice(0, 6).join('\n        '));

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
