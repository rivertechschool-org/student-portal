// Math Dojo: practice must only ask what the skill's lesson taught (part B:
// the tier 7-10 generators that sit before the lesson table).
//
// Reported by the teacher who runs the school: practice questions asked about
// things the lesson never taught. An audit of these generators against their
// lessons found whole question kinds with no teaching behind them - Advanced
// Statistics taught the Central Limit Theorem and then asked R² and Bayes'
// theorem, Advanced Computational Methods taught Big-O and asked the Master
// Theorem, Unit Circle's first sub-skill taught no values at all and asked
// cos(7π/6). Most gaps were fixed by teaching (a new lesson step); the kinds
// that were out of scope were replaced with ones the lesson covers. Two
// rulings shaped the replacements: every question has exactly ONE right
// answer, and no non-maths content.
//
// This test runs the real generators and lessons (extracted from the page the
// way tools/dojo-lesson-audit.js does) and checks:
//   - dropped kinds can no longer be drawn
//   - the new procedural kinds compute the right answer, and only one option
//     is right
//   - options that were a second right answer are gone
//   - each lesson now carries the step that teaches what is practised
//
// Run: node tests/dojo-taught-gaps-b.test.js

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
  + 'let __seed = 9091; Math.random = () => { __seed = (__seed * 1103515245 + 12345) & 0x7fffffff; return __seed / 0x7fffffff; };\n'
  + helpers + '\n' + sliceTable(/^const generators = \{/) + '\n' + sliceTable(/^const lessons = \{/)
  + '\nreturn { generators, lessons };');

// A Belt Test exposes every question type of a skill, which is what we want
// for "can this kind still be drawn".
const placement = { mode: 'placement', completedSubSkills: {} };
const { generators, lessons } = factory(placement);

const draw = (tier, skill, n = 600) => Array.from({ length: n }, () => generators[tier][skill]());
const kinds = qs => new Set(qs.map(q => q.subType));
const text = q => [q.question, ...(q.options || []), q.explanation].join(' | ');
const has = (qs, re) => qs.find(q => re.test(text(q)));
const num = v => Number(v);

// ---- Advanced Statistics ---------------------------------------------------
{
  const qs = draw(10, 'Advanced Statistics');
  ok('Advanced Statistics: R² and Bayes are no longer asked', !has(qs, /R²|Bayes/), has(qs, /R²|Bayes/)?.question);
  ok('Advanced Statistics: kinds are p-value, CI, standard error, CLT',
    [...kinds(qs)].sort().join() === 'clt,confidence,hypothesis,standard_error', [...kinds(qs)].join());
  const se = qs.filter(q => q.subType === 'standard_error');
  ok('Advanced Statistics: standard error = σ/√n, and only one option is it',
    se.length > 50 && se.every(q => {
      const [, sigma, n] = /σ = (\d+).*n = (\d+)/.exec(q.question).map(Number);
      const want = sigma / Math.sqrt(n);
      return q.answer === want && q.options.filter(o => Math.abs(num(o) - want) < 1e-9).length === 1;
    }), se.find(q => true)?.question);
}

// ---- Abstract Algebra --------------------------------------------------------
{
  const qs = draw(10, 'Abstract Algebra');
  ok('Abstract Algebra: rings are no longer asked', !has(qs, /\bring\b/i), has(qs, /\bring\b/i)?.question);
  const inv = qs.filter(q => q.subType === 'inverse');
  ok('Abstract Algebra: inverse in ℤ/nℤ is right and unique among the options',
    inv.length > 50 && inv.every(q => {
      const [, n, a] = /ℤ\/(\d+)ℤ.*inverse of (\d+)/.exec(q.question).map(Number);
      const right = v => Number.isInteger(num(v)) && num(v) >= 0 && num(v) < n && (a + num(v)) % n === 0;
      return right(q.answer) && q.options.filter(right).length === 1;
    }), inv[0]?.question);
}

// ---- Advanced Number Theory ----------------------------------------------------
{
  const qs = draw(10, 'Advanced Number Theory');
  ok('Advanced Number Theory: totient and quadratic residues are no longer asked',
    !has(qs, /totient|quadratic residue/i), has(qs, /totient|quadratic residue/i)?.question);
  const inv = qs.filter(q => q.subType === 'inverse');
  ok('Advanced Number Theory: a⁻¹ mod p is right and unique in 1..p−1',
    inv.length > 50 && inv.every(q => {
      const [, a, p] = /Find (\d+)⁻¹ mod (\d+)/.exec(q.question).map(Number);
      const right = v => num(v) >= 1 && num(v) < p && (a * num(v)) % p === 1;
      return right(q.answer) && q.options.filter(right).length === 1;
    }), inv[0]?.question);
  const red = qs.filter(q => q.subType === 'fermat_reduce');
  ok('Advanced Number Theory: Fermat reductions give the true remainder',
    red.length > 50 && red.every(q => {
      const [, a, e, p] = /(\d+)\^(\d+) is divided by (\d+)/.exec(q.question).map(Number);
      const want = Number((BigInt(a) ** BigInt(e)) % BigInt(p));
      return num(q.answer) === want && q.options.filter(o => num(o) === want).length === 1;
    }), red[0]?.question);
}

// ---- Advanced Computational Methods -------------------------------------------
{
  const qs = draw(10, 'Advanced Computational Methods');
  ok('Advanced Computational Methods: every kind is Big-O',
    [...kinds(qs)].sort().join() === 'growth,halving,order', [...kinds(qs)].join());
  ok('Advanced Computational Methods: Master Theorem / Newton / Monte Carlo / sorting bound gone',
    !has(qs, /Master Theorem|Newton|Monte Carlo|comparison-based/), has(qs, /Master|Newton|Monte/)?.question);
  ok('Advanced Computational Methods: halving count is log₂ n',
    qs.filter(q => q.subType === 'halving').every(q => 2 ** num(q.answer) === Number(/take (\d+) items/.exec(q.question)[1])));
  const rank = ['O(1)', 'O(log n)', 'O(n)', 'O(n²)', 'O(2ⁿ)'];
  ok('Advanced Computational Methods: fastest / slowest is the extreme option',
    qs.filter(q => q.subType === 'order').every(q => {
      const idx = q.options.map(o => rank.indexOf(o));
      const want = /fastest/.test(q.question) ? Math.max(...idx) : Math.min(...idx);
      return rank.indexOf(q.answer) === want;
    }));
}

// ---- Differential Geometry -----------------------------------------------------
{
  const qs = draw(10, 'Differential Geometry');
  ok('Differential Geometry: tangent spaces are no longer asked', !has(qs, /tangent space|TₚM/), has(qs, /TₚM/)?.question);
  const par = qs.filter(q => q.subType === 'parabola');
  ok('Differential Geometry: κ of y = ax² at the origin is 2|a|',
    par.length > 50 && par.every(q => {
      const m = /y = (−?)(\d*)x²/.exec(q.question);
      const a = m[2] === '' ? 1 : Number(m[2]);
      return num(q.answer) === 2 * a && q.options.filter(o => num(o) === 2 * a).length === 1;
    }), par[0]?.question);
}

// ---- single options that were a second right answer ----------------------------
{
  const ra = draw(10, 'Real Analysis');
  ok('Real Analysis: "f has no jumps" is no longer offered for continuity', !has(ra, /no jumps/));
  const tm = draw(10, 'Theoretical Mathematics');
  const card = tm.filter(q => q.subType === 'set_theory');
  ok('Theoretical Mathematics: ℵ₀ question no longer offers "∞" or "ω"',
    card.length > 50 && card.every(q => !q.options.includes('∞') && !q.options.includes('ω')));
  const mr = draw(10, 'Mathematical Research Techniques', 1500);
  ok('Research Techniques: BSD, Hodge and Yang–Mills are no longer asked',
    !has(mr, /Swinnerton|Hodge|Yang-Mills|Yang–Mills/), has(mr, /Hodge|Yang/)?.question);
  ok('Research Techniques: "proving the negation" is no longer a wrong answer for counterexamples',
    !mr.some(q => /counterexample disproves/.test(q.question) && q.options.includes('proving the negation')));
}

// ---- Mathematical Logic ------------------------------------------------------------
{
  const qs = draw(10, 'Mathematical Logic');
  ok('Mathematical Logic: the Completeness theorem is no longer asked', !has(qs, /Completeness/));
  const forms = { converse: 'q → p', inverse: '¬p → ¬q', contrapositive: '¬q → ¬p' };
  const rel = qs.filter(q => q.subType === 'related');
  ok('Mathematical Logic: converse / inverse / contrapositive keyed right',
    rel.length > 50 && rel.every(q => q.answer === forms[/The (\w+) of/.exec(q.question)[1]]));
  ok('Mathematical Logic: ¬∃x P(x) ≡ ∀x ¬P(x)',
    qs.filter(q => /^¬∃/.test(q.question)).every(q => q.answer === '∀x ¬P(x)'));
}

// ---- Applied Mathematics -------------------------------------------------------------
{
  const qs = draw(10, 'Applied Mathematics');
  ok('Applied Mathematics: the heat equation is no longer asked', !has(qs, /heat equation|parabolic PDE/));
  const eu = qs.filter(q => q.subType === 'euler_step');
  ok('Applied Mathematics: one Euler step is y₀ + 0.1·k·y₀',
    eu.length > 50 && eu.every(q => {
      const m = /y' = (\d*)y, y\(0\) = (\d+)/.exec(q.question);
      const k = m[1] === '' ? 1 : Number(m[1]), y0 = Number(m[2]);
      const want = Math.round((y0 + 0.1 * k * y0) * 100) / 100;
      return q.answer === want && q.options.filter(o => Math.abs(num(o) - want) < 1e-9).length === 1;
    }), eu[0]?.question);
}

// ---- Parametric Equations --------------------------------------------------------------
{
  const qs = draw(8, 'Parametric Equations', 1500);
  ok('Parametric Equations: sec/tan → hyperbola is no longer asked', !qs.some(q => /sec\(t\)/.test(q.question)));
  const circ = qs.filter(q => q.subType === 'identify' && /circle/.test(q.answer));
  ok('Parametric Equations: "ellipse" is not offered beside a circle (a circle is an ellipse)',
    circ.length > 20 && circ.every(q => !q.options.includes('ellipse')));
}

// ---- Series (tier 10) -----------------------------------------------------------------
{
  const qs = draw(10, 'Series', 1500);
  ok('Series: alternating, ratio-test and integral-test items are gone',
    !qs.some(q => /\(-1\)ⁿ|n!|ln n/.test(q.question)), qs.find(q => /\(-1\)ⁿ|n!|ln n/.test(q.question))?.question);
}

// ---- Advanced Polynomials: the de-duplicated candidate count -------------------------
{
  const qs = draw(7, 'Advanced Polynomials', 1500).filter(q => q.subType === 'rational_root');
  ok('Advanced Polynomials: rational-root count is the number of DIFFERENT ±p/q',
    qs.length > 50 && qs.every(q => {
      const [, lead, cst] = /(\d)x³ \+ x² − x \+ (\d)/.exec(q.question);
      const divs = n => Array.from({ length: n }, (_, i) => i + 1).filter(d => n % d === 0);
      const set = new Set();
      for (const pp of divs(Number(cst))) for (const qq of divs(Number(lead))) set.add(pp / qq);
      return num(q.answer) === set.size * 2 && !/before removing duplicates/.test(q.question);
    }), qs[0]?.question);
  ok('Advanced Polynomials: 2x³ … + 6 counts 12 (the lesson example)',
    (() => { const q = qs.find(x => /2x³ \+ x² − x \+ 6/.test(x.question)); return !q || num(q.answer) === 12; })());
}

// ---- Unit Circle: first sub-skill stays in what its lesson teaches -----------------
{
  const gated = factory({ completedSubSkills: { '8_Unit Circle': [] } }).generators;
  const first = Array.from({ length: 800 }, () => gated[8]['Unit Circle']());
  const taughtAngles = new Set(['0', 'π/6', 'π/4', 'π/3', 'π/2', 'π', '3π/2']);
  const angleOf = q => { const m = /(?:sin|cos)\(([^)]+)\)|at angle (\S+?)\?/.exec(q.question); return m && (m[1] || m[2]); };
  ok('Unit Circle: before reference angles, coordinates asks only the axes and π/6, π/4, π/3',
    first.every(q => q.subType === 'coordinates' && taughtAngles.has(angleOf(q))),
    first.find(q => !taughtAngles.has(angleOf(q)))?.question);
  const later = factory({ completedSubSkills: { '8_Unit Circle': ['coordinates', 'quadrant'] } }).generators;
  const after = Array.from({ length: 1500 }, () => later[8]['Unit Circle']()).filter(q => q.subType === 'coordinates');
  ok('Unit Circle: once reference angles are open, other quadrants come back',
    after.some(q => /7π\/6|5π\/4|11π\/6|2π\/3/.test(q.question)));
}

// ---- every lesson now teaches what is practised -------------------------------------
function steps(tier, skill, subId) {
  const l = lessons[tier][skill]();
  const body = subId ? l.subSkills.find(s => s.id === subId) : l;
  return body.teachingSteps.map(s => s.title + ' ' + s.explanation + ' ' + s.visual).join('\n');
}
const taught = [
  [10, 'Advanced Statistics', null, /p-value/], [10, 'Advanced Statistics', null, /confidence interval/],
  [10, 'Abstract Algebra', null, /Homomorphism/], [10, 'Abstract Algebra', null, /subgroup/],
  [10, 'Advanced Number Theory', null, /Fermat/], [10, 'Advanced Number Theory', null, /Bézout/],
  [10, 'Advanced Computational Methods', null, /Reading Big-O/],
  [10, 'Differential Geometry', null, /κ = 1\/r/], [10, 'Differential Geometry', null, /great circle/],
  [10, 'Real Analysis', null, /Cauchy/], [10, 'Real Analysis', null, /ε-δ/],
  [10, 'Theoretical Mathematics', null, /ZFC/], [10, 'Theoretical Mathematics', null, /Continuum Hypothesis/],
  [10, 'Mathematical Research Techniques', null, /Lemma/], [10, 'Mathematical Research Techniques', null, /Collatz/],
  [10, 'Mathematical Research Techniques', null, /Strong induction/],
  [10, 'Mathematical Logic', null, /¬P ∨ Q/], [10, 'Mathematical Logic', null, /¬∀x P\(x\) ≡ ∃x ¬P\(x\)/],
  [10, 'Applied Mathematics', null, /Euler's method/], [10, 'Applied Mathematics', null, /∇f = 0/],
  [10, 'Complex Analysis', null, /Cauchy–Riemann/],
  [10, 'Number Theory', null, /a \| b/], [10, 'Discrete Math', 'subsets', /proper subset/],
  [10, 'Linear Algebra', 'independence', /zero vector/],
  [10, 'Series', 'convergence', /nth-term test/],
  [8, 'Trig Functions', null, /Reference Angle \+ Sign/],
  [8, 'Unit Circle', 'coordinates', /Radians and the key points/],
  [8, 'Unit Circle', 'reference', /in radians/], [8, 'Unit Circle', 'special', /Which side faces which angle/],
  [8, 'Parametric Equations', null, /Eliminating the Parameter/], [8, 'Parametric Equations', null, /ellipse/],
  [8, 'Polar Coordinates', null, /r = constant/], [8, 'Normal Distribution', null, /z-scores/],
  [8, 'Inverse Trig', 'evaluate', /Negative inputs/], [8, 'Advanced Functions', null, /Composition/],
  [8, 'Advanced Functions', null, /Domain of a square root/],
  [8, 'Series Convergence', 'harmonic', /The nth-term test/], [8, 'Series Convergence', 'comparison', /Constant multiples/],
  [8, 'Graphing Trig Functions', 'amplitude', /Midline and range/], [8, 'Radian Measure', 'arc_length', /Decimal answers/],
  [9, 'Applications', 'critical', /Increasing and decreasing/], [9, 'Applications', 'maxmin', /inflection/],
  [9, 'Applications', 'maxmin', /at rest/], [9, 'Derivatives', 'power', /Sums: one term at a time/],
  [9, 'Derivatives', 'trig', /ln x/], [9, 'Integrals', 'power', /∫eˣ dx = eˣ \+ C/],
  [9, 'Integrals', 'trig', /csc²\(x\) dx = −cot\(x\)/], [9, 'Integration Techniques', 'trig', /∫tan\(x\) dx/],
  [9, 'Implicit Differentiation', 'circle', /vertical tangent/], [9, 'Implicit Differentiation', 'product', /factor it out/],
  [7, 'Binomial Theorem', 'expand_simple', /\(x − 3\)² = x² − 6x \+ 9/],
  [7, 'Advanced Polynomials', 'rational_root', /12<\/strong> different candidates/],
];
for (const [tier, skill, sub, re] of taught) {
  let body = '';
  try { body = steps(tier, skill, sub); } catch (e) { body = 'ERROR ' + e.message; }
  ok(`lesson teaches it: ${skill}${sub ? ' / ' + sub : ''} ${re}`, re.test(body), body.slice(0, 120));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
