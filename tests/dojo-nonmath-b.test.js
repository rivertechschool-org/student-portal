// Math Dojo: prune non-math content (part B: tier 6-10 legacy generators and
// their lessons).
//
// Ruling from the teacher who runs the school: keep pruning non-math content
// from the dojo. A question is non-math when it can be answered with no
// mathematical reasoning - recall of a name, an acronym or who said what.
// Tiers 6-9 had none. Tier 10 had:
//   - Theoretical Mathematics: "ZFC stands for", "Gödel's Incompleteness
//     Theorem states", "The Continuum Hypothesis states". Replaced with the
//     lesson's pairing (n <-> 2n), listing (position of k in 0, 1, -1, 2, ...)
//     and countable/uncountable reasoning; the lesson was rebuilt around them.
//   - Mathematical Research Techniques: "The Riemann Hypothesis concerns",
//     "P vs NP asks", "Goldbach's Conjecture states", ... and "WLOG stands
//     for". The conjecture kind now tests Collatz, Goldbach and twin primes
//     on numbers.
//
// This test runs the real generators and lessons and checks the recall is
// gone, every new kind computes the right answer, and exactly one option is
// right.
//
// Run: node tests/dojo-nonmath-b.test.js

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');
const lines = src.split('\n');

let pass = 0;
let fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

// ---- extraction (same anchors as tools/dojo-lesson-audit.js) ---------------
const lineOf = re => lines.findIndex(l => re.test(l));
function sliceTable(re) {
  const at = lineOf(re);
  for (let i = at + 1; i < lines.length; i++) {
    if (/^};\s*$/.test(lines[i])) return lines.slice(at, i + 1).join('\n');
  }
  throw new Error('unterminated table ' + re);
}
function fnSource(name) {
  const at = lineOf(new RegExp('^function ' + name + '\\b'));
  for (let i = at + 1; i < lines.length; i++) {
    if (/^}\s*$/.test(lines[i])) return lines.slice(at, i + 1).join('\n');
  }
  throw new Error(name + ' unterminated');
}
const helpers = [
  lines[lineOf(/^const rand = /)], lines[lineOf(/^const pick = /)],
  lines[lineOf(/^const shuffle = /)], lines[lineOf(/^const cap = /)],
  lines[lineOf(/^const gcd = /)], lines[lineOf(/^const simplifyFrac = /)],
  fnSource('tallyMarks'), fnSource('generateDistractors'), fnSource('backfillOptions'),
  fnSource('answerValue'), fnSource('uniqOpts'), fnSource('getUnlockedSubSkillTypes'),
].join('\n');

const factory = new Function('state',
  '"use strict";\n'
  + 'let __seed = 7177; Math.random = () => { __seed = (__seed * 1103515245 + 12345) & 0x7fffffff; return __seed / 0x7fffffff; };\n'
  + helpers + '\n' + sliceTable(/^const generators = \{/) + '\n' + sliceTable(/^const lessons = \{/)
  + '\nreturn { generators, lessons };');

const { generators, lessons } = factory({ mode: 'placement', completedSubSkills: {} });
const draw = (tier, skill, n = 1500) => Array.from({ length: n }, () => generators[tier][skill]());
const text = q => [q.question, ...(q.options || []), q.explanation].join(' | ');
const has = (qs, re) => qs.find(q => re.test(text(q)));
const kinds = qs => [...new Set(qs.map(q => q.subType))].sort().join();
const isPrime = n => { if (n < 2) return false; for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
const oneRight = (q, right) => q.options.filter(right).length === 1 && q.options.some(o => String(o) === String(q.answer));

// ---- no recall of names anywhere in tiers 6-10 --------------------------------
const recall = /stands for|Zermelo|Gödel|Godel|Continuum Hypothesis|Riemann Hypothesis|P vs NP|WLOG|Incompleteness/;
// (No bare /ZFC/: Congruence names a triangle △ZFC.)
for (const tier of [6, 7, 8, 9, 10]) {
  for (const skill of Object.keys(generators[tier])) {
    let qs;
    try { qs = draw(tier, skill, 300); } catch (e) { ok(`T${tier} ${skill} draws`, false, e.message); continue; }
    const q = qs.find(q => recall.test(q.question));
    ok(`T${tier} ${skill}: no name/acronym recall in questions`, !q, q && q.question);
  }
}

// ---- Theoretical Mathematics --------------------------------------------------
{
  const qs = draw(10, 'Theoretical Mathematics');
  ok('Theoretical Mathematics: kinds are pairing, listing, set_theory, countable',
    kinds(qs) === 'countable,listing,pairing,set_theory', kinds(qs));

  const pair = qs.filter(q => q.subType === 'pairing');
  ok('pairing: n is half the even number, and only one option is it',
    pair.length > 100 && pair.every(q => {
      const even = Number(/paired with (\d+)/.exec(q.question)[1]);
      return q.answer === even / 2 && oneRight(q, o => Number(o) === even / 2);
    }), pair[0] && pair[0].question);

  // Rebuild the listing 0, 1, -1, 2, -2, ... and look the number up.
  const list = [0]; for (let k = 1; k <= 20; k++) list.push(k, -k);
  const listing = qs.filter(q => q.subType === 'listing');
  ok('listing: position of k in 0, 1, −1, 2, −2, … is right and unique',
    listing.length > 100 && listing.every(q => {
      const m = /position is (−?)(\d+)\?/.exec(q.question);
      const v = (m[1] ? -1 : 1) * Number(m[2]);
      const want = list.indexOf(v) + 1;
      return q.answer === want && oneRight(q, o => Number(o) === want);
    }), listing[0] && listing[0].question);
  ok('listing: both signs are asked',
    listing.some(q => /position is −/.test(q.question)) && listing.some(q => /position is \d/.test(q.question)));

  const cnt = qs.filter(q => q.subType === 'countable');
  ok('countable: ℝ and intervals are uncountable, the rest countable',
    cnt.length > 100 && cnt.every(q => (/real numbers/.test(q.question) ? 'uncountable' : 'countable') === q.answer),
    cnt.map(q => q.question + ' → ' + q.answer).find(Boolean));
  ok('countable: both answers occur',
    cnt.some(q => q.answer === 'countable') && cnt.some(q => q.answer === 'uncountable'));

  const l = lessons[10]['Theoretical Mathematics']();
  const body = l.teachingSteps.map(s => s.title + ' ' + s.explanation + ' ' + s.visual).join('\n');
  ok('lesson teaches the pairing n ↔ 2n', /2n/.test(body) && /one-to-one/.test(body));
  ok('lesson teaches the listing positions 2k and 2k + 1', /2k \+ 1/.test(body));
  ok('lesson teaches that intervals of ℝ are uncountable', /\[0, 1\]/.test(body) && /uncountable/.test(body));
  ok('lesson no longer teaches "ZFC stands for" or Gödel', !/Zermelo|Gödel/.test(body));
  ok('lesson goal answer is right: −3 is in position 7', l.finalAnswer === '7' && list.indexOf(-3) + 1 === 7);
}

// ---- Mathematical Research Techniques ----------------------------------------------
{
  const qs = draw(10, 'Mathematical Research Techniques', 4000);
  ok('Research Techniques: no "concerns / asks whether / states" open-problem recall',
    !has(qs, /concerns the zeros|asks whether|Conjecture states/), (has(qs, /concerns the zeros|asks whether|Conjecture states/) || {}).question);
  ok('Research Techniques: WLOG is no longer asked', !has(qs, /WLOG/));

  const conj = qs.filter(q => q.subType === 'conjecture');
  const collatz = conj.filter(q => /Collatz/.test(q.question));
  ok('Collatz: step count is right and unique',
    collatz.length > 50 && collatz.every(q => {
      let n = Number(/Starting from (\d+)/.exec(q.question)[1]), s = 0;
      while (n !== 1) { n = n % 2 ? 3 * n + 1 : n / 2; s++; }
      return q.answer === s && oneRight(q, o => Number(o) === s);
    }), collatz[0] && collatz[0].question);

  const gold = conj.filter(q => /Goldbach/.test(q.question));
  const primeSum = (o, N) => { const [a, b] = String(o).split(' + ').map(Number); return a + b === N && isPrime(a) && isPrime(b); };
  ok('Goldbach: the answer is two primes, and every option adds to N but only one is two primes',
    gold.length > 50 && gold.every(q => {
      const N = Number(/writes (\d+) as/.exec(q.question)[1]);
      return primeSum(q.answer, N) && q.options.length === 4
        && q.options.every(o => String(o).split(' + ').map(Number).reduce((x, y) => x + y) === N)
        && oneRight(q, o => primeSum(o, N));
    }), gold[0] && gold[0].question + ' ' + gold[0].options.join(', '));

  const twin = conj.filter(q => /Twin primes/.test(q.question));
  const isTwin = o => { const [a, b] = String(o).split(' and ').map(Number); return b === a + 2 && isPrime(a) && isPrime(b); };
  ok('twin primes: exactly one option is a twin-prime pair, and it is the answer',
    twin.length > 50 && twin.every(q => isTwin(q.answer) && q.options.length === 4 && oneRight(q, isTwin)),
    twin[0] && twin[0].options.join(', '));

  const l = lessons[10]['Mathematical Research Techniques']();
  const body = l.teachingSteps.map(s => s.title + ' ' + s.explanation + ' ' + s.visual).join('\n');
  ok('lesson: Collatz, Goldbach and twin primes are taught with worked numbers',
    /6 → 3 → 10/.test(body) && /5 \+ 23/.test(body) && /11 and 13/.test(body));
  ok('lesson: Riemann Hypothesis, P vs NP and WLOG are no longer taught', !/Riemann Hypothesis|P vs NP|WLOG/.test(body));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
