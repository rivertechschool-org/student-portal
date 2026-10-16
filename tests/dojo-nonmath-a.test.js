// Math Dojo, legacy generators tiers 1-5: no non-math questions.
//
// The teacher's rulings: every question has one right answer, practice asks
// only what the skill's lesson teaches, and a question a student can answer
// with no mathematics at all (general knowledge, colours, names) does not
// belong in the Dojo.
//
// What this pass removed from tiers 1-5:
// - Estimation "estimate_count": "About how many eggs in a carton / crayons in
//   a new box / seats in a movie theater?" The answer is a fact about the
//   world, rounding never gets you there, and the lesson never teaches it.
//   Replaced by "check_answer": estimate a sum by rounding, then judge whether
//   a given answer is close - the lesson's own last step.
// - Scatter Plots "trend": "shoe size vs. favorite ice cream flavor" and
//   "hair color vs. weekly screen time". A flavour and a colour are not
//   numbers, so neither pair can be a scatter plot.
//
// It also samples every tier 1-5 generator and checks that none of the known
// non-math shapes (colour sorting, acronym/name recall, world trivia) is back.
//
// Run: node tests/dojo-nonmath-a.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');

let pass = 0;
let fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

let seed = 9157;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const rand = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const shuffle = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const cap = s => String(s).length === 0 ? s : String(s).charAt(0).toUpperCase() + String(s).slice(1);
const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
const simplifyFrac = (n, d) => { const g = gcd(Math.abs(n), Math.abs(d)); return [n / g, d / g]; };
const uniqOpts = c => c.filter((v, i, a) => a.findIndex(w => String(w) === String(v)) === i).slice(0, 4);
// Every sub-skill unlocked, so every subtype can be drawn.
const getUnlockedSubSkillTypes = (key, map) => [].concat(...Object.values(map)).filter((v, i, a) => a.indexOf(v) === i);

// Tiers 1-5 of `const generators = {`, closed off so it parses as an object.
const start = html.indexOf('const generators = {');
const tier6 = html.indexOf('// TIER 6: Geometry', start);
ok('generators and tier 6 marker found', start !== -1 && tier6 > start);
const body = html.slice(start + 'const generators = '.length, tier6).replace(/,\s*$/, '') + '\n}';
const generators = new Function('pick', 'rand', 'shuffle', 'cap', 'simplifyFrac', 'uniqOpts',
  'getUnlockedSubSkillTypes', 'state',
  '"use strict"; return (' + body + ');')(pick, rand, shuffle, cap, simplifyFrac, uniqOpts,
  getUnlockedSubSkillTypes, { mode: 'practice' });

// ---- Estimation ------------------------------------------------------------
const est = Array.from({ length: 3000 }, () => generators[2].Estimation());
ok('Estimation never draws estimate_count', est.every(q => q.subType !== 'estimate_count'));
ok('no world-fact counting question',
  est.every(q => !/eggs in a carton|crayons in a new box|movie theater|chapter book|grocery bag|elementary school/i.test(q.question)),
  est.find(q => /carton|theater/.test(q.question))?.question);
const subs = new Set(est.map(q => q.subType));
ok('Estimation still has three question shapes', ['round_add', 'round_mult', 'check_answer'].every(s => subs.has(s)),
  [...subs].join(', '));

// check_answer: one right answer, decided by the estimate.
const checks = est.filter(q => q.subType === 'check_answer');
let checkBad = null;
for (const q of checks) {
  const m = /worked out (\d+) \+ (\d+) and got (-?\d+)/.exec(q.question);
  if (!m) { checkBad = 'unparsed: ' + q.question; break; }
  const [a, b, claim] = [+m[1], +m[2], +m[3]];
  const estimate = Math.round(a / 10) * 10 + Math.round(b / 10) * 10;
  const want = claim === a + b ? 'Yes' : 'No';
  const gap = Math.abs(claim - estimate);
  if (q.answer !== want) { checkBad = `${q.question} -> ${q.answer}`; break; }
  // A right answer is near the estimate and a wrong one far from it, so the
  // estimate alone decides it.
  if ((want === 'Yes' && gap > 10) || (want === 'No' && gap < 30)) { checkBad = `gap ${gap}: ${q.question}`; break; }
  if (claim <= 0) { checkBad = 'non-positive claim: ' + q.question; break; }
}
ok('check_answer is keyed right and decided by the estimate', checks.length > 300 && !checkBad, checkBad || String(checks.length));
ok('both Yes and No occur', checks.some(q => q.answer === 'Yes') && checks.some(q => q.answer === 'No'));
ok('check_answer has a difficulty registry entry', html.includes('"T2::Estimation::check_answer"'));

// ---- Scatter Plots ---------------------------------------------------------
const sp = Array.from({ length: 3000 }, () => generators[4]['Scatter Plots']());
const trend = sp.filter(q => q.subType === 'trend');
ok('trend questions are drawn', trend.length > 500, String(trend.length));
ok('no non-numeric variable in a scatter-plot scenario',
  trend.every(q => !/flavor|flavour|hair colou?r|colou?r/i.test(q.question)),
  trend.find(q => /flavor|colou?r/i.test(q.question))?.question);
ok('"none" scenarios are still asked', trend.some(q => q.answer === 'none'));

// ---- Every tier 1-5 generator ------------------------------------------------
// Shapes that mean a question needs no mathematics. Colour as a LABEL on a
// tally or a bag of marbles is fine (the counting is the maths); sorting or
// classifying BY colour is not.
const NONMATH = [
  /what colou?r is/i, /which colou?r/i, /sort .* by colou?r/i, /\bcolou?r group\b/i,
  /stands for/i, /\bacronym\b/i, /who (proved|discovered|invented)/i, /named after/i,
  /\bfruit or vegetable\b/i, /\bis it alive\b/i, /\bliving or non-?living\b/i,
  /which planet/i, /\bbody part\b/i, /\bweather\b.*\bgroup\b/i,
  /eggs in a carton/i, /crayons in a new box/i
];
let total = 0;
const hits = [];
const failures = [];
for (const tier of [1, 2, 3, 4, 5]) {
  for (const [name, gen] of Object.entries(generators[tier])) {
    for (let i = 0; i < 400; i++) {
      let q;
      try { q = gen(); } catch (e) { failures.push(`T${tier} ${name}: ${e.message}`); break; }
      if (!q) continue;
      total++;
      const text = String(q.question) + ' ' + (q.options || []).join(' | ');
      const bad = NONMATH.find(re => re.test(text));
      if (bad) hits.push(`T${tier} ${name} [${q.subType}]: ${q.question}`);
    }
  }
}
ok('every tier 1-5 generator runs', failures.length === 0, failures.slice(0, 5).join('\n        '));
ok(`no non-math question shape in ${total} tier 1-5 draws`, hits.length === 0, hits.slice(0, 5).join('\n        '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
