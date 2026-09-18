// Where the answer sits among the numbers.
//
// Reported on Pythagorean: the wrong answers were always one above and one
// below the right one, so the answer was the only value with a neighbour on
// each side. Sort the four numbers, take the one in the middle of the tight
// pair, and you have it without doing any maths.
//
// It was not one generator. Measured across all 62 that produce numeric
// options:
//
//   * 14 were bracketed on 100% of draws - Pythagorean, Area, Volume, Vectors,
//     Logarithms, Series, Picture Graphs, Nets of 3D Shapes and more.
//   * 17 put the answer in the SAME sorted slot on 100% of draws, so "always
//     pick the second smallest" scored full marks on them.
//
// The fix sits at generateQuestion, the one funnel every question passes
// through, rather than in 17 generators. It replaces only the bracketing PAIR,
// and only when both halves are present. A distractor the generator chose on
// purpose - 7+24 offered for a hypotenuse, or the input handed straight back -
// is a misconception worth showing and is left alone.
//
// WHY A MANUFACTURED NEAR-MISS IS SAFE HERE. It would not be, if any of these
// asked "which of these is prime": a near-miss could then be a second correct
// answer. Sampling every bracketed generator showed they all ask for a
// computed value - "how many corners does a rectangle have", "how many primes
// are there from 11 to 20", "find the hypotenuse" - where exactly one number
// is right and every other number is wrong. That is why this file checks the
// answer survives every transformation rather than trusting it.
//
// Run: node tests/dojo-answer-position.test.js

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

// ---- the real helpers ---------------------------------------------------
function fnSource(name) {
  const i = html.indexOf(`function ${name}(`);
  if (i === -1) throw new Error(name + ' not found');
  let j = html.indexOf('{', i), depth = 0;
  for (; j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return html.slice(i, j);
}

let seed = 987654321;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const shuffle = arr => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const vary = new Function('shuffle',
  `"use strict";\n${fnSource('answerValue')}\n${fnSource('varyBracketedOptions')}\nreturn varyBracketedOptions;`
)(shuffle);

const val = v => { const t = String(v).trim(); return /^-?\d+(?:\.\d+)?$/.test(t) ? parseFloat(t) : NaN; };
const rank = (answer, opts) => {
  const s = opts.map(val).sort((x, y) => x - y);
  return s.indexOf(val(answer));
};

console.log('\n== the answer always survives ==\n');

// The transformation may never lose the answer, duplicate an option, change
// how many there are, or invent a negative count.
let lost = 0, dupes = 0, sizeChanged = 0, negative = 0, runs = 0;
for (let i = 0; i < 4000; i++) {
  const a = 1 + Math.floor(rnd() * 60);
  const far = a + 5 + Math.floor(rnd() * 20);      // a meaningful distractor
  const before = [a, a + 1, a - 1, far];
  const after = vary(a, before);
  runs++;
  const vals = after.map(val);
  if (!vals.includes(a)) lost++;
  if (new Set(vals).size !== vals.length) dupes++;
  if (after.length !== before.length) sizeChanged++;
  if (vals.some(v => v < 0)) negative++;
}
check(`the answer is never lost (${runs} draws)`, lost, 0);
check('options are never duplicated', dupes, 0);
check('the number of options never changes', sizeChanged, 0);
check('a count-style answer never gets a negative distractor', negative, 0);

console.log('\n== the bracket is broken, but not always ==\n');

// The distribution that matters: the answer must not land in the same sorted
// slot every time, and it must STILL sometimes sit in the middle - which is
// what was asked for, not merely "never in the middle".
const slots = {};
let straddled = 0;
for (let i = 0; i < 4000; i++) {
  const a = 20 + Math.floor(rnd() * 40);
  const far = a + 6 + Math.floor(rnd() * 20);
  const after = vary(a, [a, a + 1, a - 1, far]);
  const vals = new Set(after.map(val));
  if (vals.has(a - 1) && vals.has(a + 1)) straddled++;
  slots[rank(a, after)] = (slots[rank(a, after)] || 0) + 1;
}
const pct = k => (slots[k] || 0) / 4000 * 100;
ok(`the answer is sometimes the smallest (${pct(0).toFixed(0)}%)`, pct(0) > 10);
ok(`sometimes has one below it (${pct(1).toFixed(0)}%)`, pct(1) > 10);
ok(`sometimes has two below it (${pct(2).toFixed(0)}%)`, pct(2) > 10);
ok(`and is still sometimes bracketed (${(straddled / 4000 * 100).toFixed(0)}%)`,
   straddled > 40 && straddled < 4000 * 0.35);
ok('no single slot takes more than half the draws',
   Math.max(pct(0), pct(1), pct(2), pct(3)) < 50);

console.log('\n== what it leaves alone ==\n');

// Not bracketed: nothing to fix, so nothing is touched.
check('an option set with no bracket is returned unchanged',
      vary(10, [10, 12, 15, 20]), [10, 12, 15, 20]);
check('only one side present is not a bracket',
      vary(10, [10, 11, 15, 20]), [10, 11, 15, 20]);

// Anything that is not a plain number is left alone: fractions, expressions,
// units and words are not safe to step around blindly.
check('word options are untouched',
      vary('north', ['north', 'south', 'east', 'west']), ['north', 'south', 'east', 'west']);
check('a set with one non-numeric option is untouched',
      vary(5, [5, 6, 4, '5 cm']), [5, 6, 4, '5 cm']);

// The meaningful distractor is the point of the question; it must survive.
{
  let kept = 0;
  for (let i = 0; i < 500; i++) {
    const after = vary(25, [25, 26, 24, 31]);   // 31 = 7+24, the classic error
    if (after.map(val).includes(31)) kept++;
  }
  check('the generator\'s own distractor is always kept', kept, 500);
}

// A string option stays a string, so nothing downstream sees a type change.
{
  const after = vary('25', ['25', '26', '24', '31']);
  ok('string options stay strings', after.every(o => typeof o === 'string'));
  ok('  and the answer is still among them', after.includes('25'));
}

console.log('\n== it is actually wired in ==\n');

ok('generateQuestion runs options through it',
   /varyBracketedOptions\(q\.answer, opts\)/.test(html));
ok('  before they are shuffled, not after',
   /shuffle\(varyBracketedOptions\(/.test(html));
ok('  and after the backfill, so a topped-up set is judged too',
   html.indexOf('backfillOptions(q.answer, opts, seen, 4)') <
   html.indexOf('shuffle(varyBracketedOptions('));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
