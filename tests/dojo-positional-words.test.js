// Positional Words: one question, one right answer.
//
// Reported from the dojo: "The book was placed ___ the bookcase" wanted
// "beside", and "inside" was on the list. Inside is at least as good an answer
// for a book and a bookcase, and the sentence says nothing that rules it out.
//
// Sampling the real generator found two separate faults behind that.
//
//   * A SYNONYM OF THE ANSWER COULD BE OFFERED ALONGSIDE IT. beside/next to
//     mean the same thing; so do below/underneath; and a thing on top of
//     something is also above it. 11.2% of 4000 draws put two of those in one
//     option list - across ALL FOUR question types, not just the reported one.
//     The generator already had a guard of this shape on the "opposite" type,
//     with a comment explaining why, so the idea was understood; it just was
//     not applied to the other three, or to that type's distractors.
//
//   * A FILL-IN SENTENCE DOES NOT DETERMINE A PREPOSITION. "The book was
//     placed ___ the bookcase" is equally true of beside, inside, behind and
//     above. That is not a hard question, it is an unanswerable one, and no
//     amount of distractor filtering fixes it - the sentence has to carry
//     something that decides the answer. Each word now has a clue, and the
//     words with no clue that discriminates (there is one, "outside") are not
//     used for fill-ins at all.
//
// The existing dojo audit cannot catch either: it checks that options are
// distinct STRINGS, and "beside" and "next to" are distinct strings.
//
// Run: node tests/dojo-positional-words.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}, got ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

// ---- the real generator, with only the two helpers it uses ---------------
function generatorSource(name) {
  const marker = `"${name}": () => {`;
  const start = html.indexOf(marker);
  if (start === -1) throw new Error(name + ' not found');
  let i = html.indexOf('{', start + marker.length - 1), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(html.indexOf('{', start + marker.length - 1), i);
}

const body = generatorSource('Positional Words');
const make = new Function(
  'pick', 'shuffle',
  '"use strict"; return (() => ' + body + ')();'
);
// Deterministic, so a failure is reproducible.
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const shuffle = arr => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const draw = () => make(pick, shuffle);

// Words that can BOTH be true of one arrangement. Written out here rather than
// read from the page, so that quietly dropping a group from the generator
// fails this file instead of silently widening what may be offered.
const SAME = [['beside', 'next to'], ['below', 'underneath'], ['above', 'on top of']];
const sameAs = (a, b) => a !== b && SAME.some(g => g.includes(a) && g.includes(b));

// ---- the sweep ----------------------------------------------------------
const N = 6000;
const seen = {};
const bad = { synonym: [], missingAnswer: [], dupe: [], noClue: [], emptyOption: [] };

for (let i = 0; i < N; i++) {
  const q = draw();
  seen[q.subType] = (seen[q.subType] || 0) + 1;

  if (!q.options.includes(q.answer)) bad.missingAnswer.push(q.question);
  if (new Set(q.options).size !== q.options.length) bad.dupe.push(q.question);
  if (q.options.some(o => !o || !String(o).trim())) bad.emptyOption.push(q.question);

  const clash = q.options.find(o => sameAs(o, q.answer));
  if (clash) bad.synonym.push(`${q.subType}: "${q.answer}" alongside "${clash}" - ${q.question}`);

  // A fill-in must say what decides it, or it is the reported bug again.
  if (q.subType === 'fill_in' && !/—/.test(q.question)) bad.noClue.push(q.question);
}

console.log('\n== every draw has exactly one right answer ==\n');

check(`no option list offers a synonym of the answer (${N} draws)`, bad.synonym.slice(0, 3), []);
check('the answer is always among the options', bad.missingAnswer.slice(0, 3), []);
check('no option appears twice', bad.dupe.slice(0, 3), []);
check('no option is blank', bad.emptyOption.slice(0, 3), []);

console.log('\n== a fill-in says what decides it ==\n');

check('every fill-in carries a clue', bad.noClue.slice(0, 3), []);
ok('all four question types were exercised',
   ['fill_in', 'identify', 'opposite', 'which_word'].every(t => seen[t] > 50));

// "outside" has no clue that separates it from beside or behind - anything not
// within something is also outside it - so it must not be a fill-in answer.
const fillAnswers = new Set();
for (let i = 0; i < N; i++) { const q = draw(); if (q.subType === 'fill_in') fillAnswers.add(q.answer); }
check('"outside" is never the answer to a fill-in', fillAnswers.has('outside'), false);
ok('but the other words still are', fillAnswers.size >= 8);

console.log('\n== the reported question ==\n');

// The exact shape that was reported: a fill-in whose answer is a side-by-side
// word. It must never offer the other one, and must never be bare.
let checkedBeside = 0;
for (let i = 0; i < N; i++) {
  const q = draw();
  if (q.subType !== 'fill_in') continue;
  if (q.answer !== 'beside' && q.answer !== 'next to') continue;
  checkedBeside++;
  const other = q.answer === 'beside' ? 'next to' : 'beside';
  if (q.options.includes(other)) { fail++; console.log(`  FAIL  "${q.answer}" offered with "${other}"`); break; }
  if (!/side by side/.test(q.question)) { fail++; console.log(`  FAIL  no clue: ${q.question}`); break; }
}
ok(`side-by-side fill-ins checked (${checkedBeside}) and none was ambiguous`, checkedBeside > 20);

// And the vocabulary itself: if a group is dropped from the page, the pairs
// above stop being enforced and this file would go quietly green.
for (const [a, b] of SAME) {
  ok(`"${a}" and "${b}" are both still in the word pool`,
     html.includes(`"${a}"`) && html.includes(`"${b}"`));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
