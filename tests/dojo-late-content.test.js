// Late-added Math Dojo content (V2 _addSkill block + graduation-plan blocks):
// answer keys and explanations that contradicted the math they posed.
//
// Each check samples the real generator, extracted from the page and run with
// the page's own helpers (same load order as debug-tools/typed-answer-coverage.js:
// literals, then the V2 block, then every graduation-plan block).
//
//   - Rounding Decimals: the explanation named the digit AT the rounding place
//     ("3.847 … followed by 8, rounds up → 3.8"), not the one to its right.
//   - Writing Linear Equations: b = 0 was nudged to ±1 without moving the
//     point, so "slope 2 through (2, 4)" keyed y = 2x + 1.
//   - Polygon Properties: a square was offered Rectangle and Rhombus, both true.
//   - Nonlinear Modeling: "more players than people on Earth" after 60-100
//     months never exceeded 8 billion.
//   - Difference of Squares / Factoring by Grouping: "factor completely" keyed
//     answers with a GCF still inside, e.g. (2x − 4)(2x + 4).
//   - Exponential equations: "81 is not a power of 3".
//   - Rational Exponents: x^(2/2) and x^(2/4) keyed as answers.
//   - Technical Capstone fence: pickets were gaps, not gaps + 1.
//   - Profit and Break-Even: lowest break-even price rounded to nearest, not up.
//   - Logarithm Properties: log(24) accepted only one factor pair.
//   - Mathematical Communication: "Combining like terms" offered against
//     "Distributive Property", which also justifies the step.
//   - Tax Calculations: marginal rate asked at exactly a bracket cap.
//   - Percent Change: "$25.5".
//
// Run: node tests/dojo-late-content.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

// ---- extraction (mirrors debug-tools/typed-answer-coverage.js) -------------
function findMatchingBrace(text, openIdx) {
  const stack = [{ mode: 'code', depth: 1 }];
  let i = openIdx + 1;
  while (i < text.length && stack.length > 0) {
    const top = stack[stack.length - 1];
    const c = text[i], n = text[i + 1];
    if (top.mode === 'code') {
      if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
      if (c === '/' && n === '*') { i += 2; while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
      if (c === '"') { stack.push({ mode: 'dq' }); i++; continue; }
      if (c === "'") { stack.push({ mode: 'sq' }); i++; continue; }
      if (c === '`') { stack.push({ mode: 'tpl' }); i++; continue; }
      if (c === '{') { top.depth++; i++; continue; }
      if (c === '}') { top.depth--; i++; if (top.depth === 0) { stack.pop(); if (!stack.length) return i - 1; } continue; }
      i++; continue;
    }
    if (top.mode === 'dq') { if (c === '\\') { i += 2; continue; } if (c === '"') stack.pop(); i++; continue; }
    if (top.mode === 'sq') { if (c === '\\') { i += 2; continue; } if (c === "'") stack.pop(); i++; continue; }
    if (c === '\\') { i += 2; continue; }
    if (c === '`') { stack.pop(); i++; continue; }
    if (c === '$' && n === '{') { stack.push({ mode: 'code', depth: 1 }); i += 2; continue; }
    i++;
  }
  return -1;
}
function literal(decl) {
  const o = src.indexOf('{', src.indexOf(decl));
  return src.slice(o, findMatchingBrace(src, o) + 1);
}
function sliceByLine(startsWith) {
  const lines = src.split('\n');
  const s = lines.findIndex(l => l.startsWith(startsWith));
  let e = s + 1;
  while (e < lines.length && !/^\};/.test(lines[e])) e++;
  return lines.slice(s, e + 1).join('\n');
}
function fnSource(name) {
  const d = src.indexOf(`function ${name}(`);
  return src.slice(d, findMatchingBrace(src, src.indexOf('{', d)) + 1);
}
const grad = (() => {
  const re = /\/\/ ==== GRADUATION PLAN CONTENT: ([A-Z-]+) ====\n([\s\S]*?)\/\/ ==== END GRADUATION PLAN CONTENT: \1 ====/g;
  let m, out = '';
  while ((m = re.exec(src))) out += '\n' + m[2];
  return out;
})();
const V2 = src.slice(src.indexOf('// ===== V2 NEW-SKILL CONTENT'),
  src.lastIndexOf('// ===== end V2 NEW-SKILL CONTENT =====') + '// ===== end V2 NEW-SKILL CONTENT ====='.length) + grad;

// mulberry32, not a bare LCG: the LCG's short cycle gave only ~190 distinct
// incomes in thousands of tax draws, so rare edge cases were never sampled.
let seed = 7;
function seeded() {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const sandbox = {
  Math: Object.create(Math), JSON, String, Number, Array, Object, RegExp, Set, Map,
  isNaN, parseInt, parseFloat, console,
  rand: (a, b) => { if (b === undefined) { b = a; a = 0; } return Math.floor(seeded() * (b - a + 1)) + a; },
  shuffle: arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(seeded() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
  gcd: (a, b) => { while (b) { [a, b] = [b, a % b]; } return a; },
  state: { completedSubSkills: {}, history: [], mode: 'arcade', currentTier: 5 },
  answerValue: s => parseFloat(s), backfillOptions: (a, o) => o,
  uniqOpts: c => [...new Set(c)],
  getUnlockedSubSkillTypes: (k, map, ord) => ord.flatMap(id => [].concat(map[id] || [])),
};
sandbox.Math.random = seeded;
sandbox.pick = a => a[sandbox.rand(0, a.length - 1)];
sandbox.cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
sandbox.simplifyFrac = (n, d) => { const g = sandbox.gcd(Math.abs(n), Math.abs(d)); return [n / g, d / g]; };
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(
  `${src.split('\n').filter(l => /^const [A-Z_]+_RE = \//.test(l)).join('\n')}\n${sliceByLine('const AnswerInterpreter = {')}\n${fnSource('isFactoredForm')}\n${fnSource('typedAnswerIsCorrect')}\n` +
  `const TIERS = ${literal('const TIERS = {')};\nconst Q_MATRIX = ${literal('const Q_MATRIX = {')};\n` +
  `const generators = ${literal('const generators = {')};\nconst lessons = ${literal('const lessons = {')};\n` +
  `globalThis.typedAnswerIsCorrect = typedAnswerIsCorrect; globalThis.generators = generators; globalThis.lessons = lessons;\n`,
  ctx, { filename: 'dojo-literals.js' });
vm.runInContext(V2, ctx, { filename: 'dojo-late.js' });

const draw = (tier, name, n = 1500) => {
  const gf = ctx.generators[tier] && ctx.generators[tier][name];
  if (typeof gf !== 'function') throw new Error(`no generator T${tier} ${name}`);
  return Array.from({ length: n }, () => gf()).filter(Boolean);
};
const lesson = (tier, name) => { const L = ctx.lessons[tier][name]; return typeof L === 'function' ? L() : L; };
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
const typed = (input, q) => ctx.typedAnswerIsCorrect(input, q);

// ---- Comparing and Rounding Decimals ---------------------------------------
{
  const qs = draw(3, 'Comparing and Rounding Decimals').filter(q => q.subType === 'round');
  ok('rounding questions drawn', qs.length > 200, String(qs.length));
  const bad = qs.filter(q => {
    const [, num, place] = /^Round (\d\.\d{3}) to the nearest (tenth|hundredth)/.exec(q.question);
    const digits = num.replace('.', '');                  // "3847"
    const look = Number(place === 'tenth' ? digits[2] : digits[3]);
    const said = Number(/followed by (\d)/.exec(q.explanation)[1]);
    const dir = /rounds (up|down)/.exec(q.explanation)[1];
    return said !== look || dir !== (look >= 5 ? 'up' : 'down');
  });
  ok('explanation names the digit to the RIGHT of the rounding place', bad.length === 0,
    bad[0] && bad[0].question + ' / ' + bad[0].explanation);
}

// ---- Writing Linear Equations ----------------------------------------------
{
  const qs = draw(5, 'Writing Linear Equations').filter(q => q.subType === 'point_slope');
  const bad = qs.filter(q => {
    const [, m, x, y] = /slope (-?\d+) through \((\d+), (\d+)\)/.exec(q.question).map(Number);
    const [, sign, b] = /^y = -?\d+x ([+-]) (\d+)$/.exec(q.answer);
    return y !== m * x + (sign === '-' ? -1 : 1) * Number(b);
  });
  ok(`keyed line passes through the given point (${qs.length} drawn)`, qs.length > 200 && bad.length === 0,
    bad[0] && bad[0].question + ' → ' + bad[0].answer);
}

// ---- Polygon Properties -----------------------------------------------------
{
  const qs = draw(6, 'Polygon Properties', 3000).filter(q => q.subType === 'classify_quad');
  // Every option that is ALSO true of the described shape is a second right answer.
  const alsoTrue = { Square: ['Rectangle', 'Rhombus', 'Parallelogram'], Rectangle: ['Parallelogram'], Rhombus: ['Parallelogram'] };
  const bad = qs.filter(q => (alsoTrue[q.answer] || []).some(o => q.options.includes(o)));
  ok(`classify_quad offers exactly one true name (${qs.length} drawn)`, qs.length > 50 && bad.length === 0,
    bad[0] && bad[0].answer + ': ' + bad[0].options.join(', '));
}

// ---- Nonlinear Modeling -----------------------------------------------------
{
  const qs = draw(7, 'Nonlinear Modeling', 6000).filter(q => /phone game/.test(q.question));
  const bad = qs.filter(q => {
    const [, a, m] = /had (\d+) players.*After (\d+) months/.exec(q.question).map(Number);
    return !(a * Math.pow(1.15, m) > 8.2e9);
  });
  ok(`phone-game model really passes Earth's population (${qs.length} drawn)`, qs.length > 5 && bad.length === 0,
    bad[0] && bad[0].question);
}

// ---- Difference of Squares / Factoring by Grouping -------------------------
{
  const qs = draw(5, 'Difference of Squares');
  const bad = qs.filter(q => {
    const m = /^\((\d*)x - (\d+)\)/.exec(q.answer);
    return gcd(Number(m[1] || 1), Number(m[2])) !== 1;
  });
  ok('difference of squares: no GCF left inside the factors', bad.length === 0, bad[0] && bad[0].question + ' → ' + bad[0].answer);

  const gq = draw(5, 'Factoring by Grouping');
  const badG = gq.filter(q => {
    const [, a, b, s] = /^\((\d+)x \+ (\d+)\)\(x\^2 \+ (\d+)\)$/.exec(q.answer).map(Number);
    return gcd(a, b) !== 1 || b === s;
  });
  ok('grouping: first pair GCF is exactly x² and no distractor equals the answer', badG.length === 0,
    badG[0] && badG[0].question + ' → ' + badG[0].answer);
}

// ---- Exponential equations / Rational exponents / Log properties -----------
{
  const isPow = (v, b) => { while (v % b === 0) v /= b; return v === 1; };
  const qs = draw(7, 'Solving Exponential and Logarithmic Equations', 4000).filter(q => q.subType === 'take_log');
  const bad = qs.filter(q => { const [, b, v] = /Solve (\d+)\^x = (\d+)/.exec(q.question).map(Number); return isPow(v, b); });
  ok(`take_log never poses a power of the base (${qs.length} drawn)`, qs.length > 100 && bad.length === 0, bad[0] && bad[0].question);

  const rq = draw(7, 'Rational Exponents', 4000);
  const fracs = rq.flatMap(q => [...(q.question + ' ' + q.answer).matchAll(/x\^\((\d+)\/(\d+)\)/g)].map(m => [+m[1], +m[2], q]));
  const badR = fracs.filter(([m, n]) => m === n || gcd(m, n) !== 1);
  ok('rational exponents are always in lowest terms and never n/n', badR.length === 0,
    badR[0] && badR[0][2].question + ' → ' + badR[0][2].answer);

  const lq = draw(7, 'Logarithm Properties').filter(q => q.subType === 'product');
  const q24 = lq.find(q => /log\(24\)/.test(q.question));
  ok('log(24) product rule accepts log(3) + log(8) and log(2) + log(12)',
    q24 && typed('log(3) + log(8)', q24) && typed('log(2) + log(12)', q24) && typed('log(4) + log(6)', q24),
    q24 ? '' : 'no log(24) drawn');
}

// ---- Technical Capstone fence ----------------------------------------------
{
  const qs = draw(8, 'Technical Capstone', 4000).filter(q => q.subType === 'fence_cost');
  const bad = qs.filter(q => {
    const n = s => Number(s.replace(/[$,]/g, ''));
    const [, F] = /A straight (\d+) ft fence/.exec(q.question);
    const [, sp] = /pickets every (\d+) in/.exec(q.question);
    const [, pp, pr, pk] = /post (\$[\d.,]+), rail (\$[\d.,]+), picket (\$[\d.,]+)/.exec(q.question);
    const [, tx] = /Sales tax (\d+)%/.exec(q.question);
    const sections = Math.ceil(F / 8), pickets = Math.ceil(F * 12 / sp) + 1;
    const total = ((sections + 1) * n(pp) + sections * 2 * n(pr) + pickets * n(pk)) * (1 + tx / 100);
    return Math.abs(Number(q.answer) - total) > 0.006 || !/one at each end\)\. Prices/.test(q.question);
  });
  ok(`fence pickets counted as gaps + 1, stated in the question (${qs.length} drawn)`, qs.length > 50 && bad.length === 0,
    bad[0] && bad[0].question + ' → ' + bad[0].answer);
}

// ---- Profit and Break-Even ---------------------------------------------------
{
  const qs = draw(6, 'Profit and Break-Even', 4000).filter(q => q.subType === 'price_to_break_even');
  const bad = qs.filter(q => {
    const [, F] = /fixed costs of \$([\d,]+)/.exec(q.question);
    const [, v] = /spends \$([\d.]+)/.exec(q.question);
    const [, n] = /expects to sell (\d+)/.exec(q.question);
    const exact = Number(v) + Number(F.replace(/,/g, '')) / Number(n);
    const up = Math.ceil(exact * 100 - 1e-6) / 100;
    return Number(q.answer) !== up || !typed(up.toFixed(2), q);
  });
  ok(`lowest break-even price is rounded UP to the cent (${qs.length} drawn)`, qs.length > 50 && bad.length === 0,
    bad[0] && bad[0].question + ' → ' + bad[0].answer);
}

// ---- Mathematical Communication ------------------------------------------
{
  const qs = draw(6, 'Mathematical Communication', 8000).filter(q => q.subType === 'justify_algebra' && q.answer === 'Combining like terms');
  const bad = qs.filter(q => q.options.includes('Distributive Property'));
  ok(`combining like terms is never offered against the distributive property (${qs.length} drawn)`, qs.length > 5 && bad.length === 0);
}

// ---- Tax Calculations ---------------------------------------------------------
{
  const qs = draw(6, 'Tax Calculations', 30000).filter(q => q.subType === 'marginal_rate');
  const bad = qs.filter(q => {
    const caps = [...q.question.matchAll(/(?:first|to) \$([\d,]+)/g)].map(m => Number(m[1].replace(/,/g, '')));
    const [, Y] = /taxable income of \$([\d,]+)/.exec(q.question);
    return caps.includes(Number(Y.replace(/,/g, '')));
  });
  ok(`marginal rate is never asked at exactly a bracket cap (${qs.length} drawn)`, qs.length > 100 && bad.length === 0, bad[0] && bad[0].question);
  ok('effective rate is "at or below" the marginal rate, not always below',
    !/always below the marginal rate/.test(JSON.stringify(lesson(6, 'Tax Calculations'))));
}

// ---- Percent Change -------------------------------------------------------------
{
  const qs = draw(4, 'Percent Change', 3000).filter(q => q.subType === 'discount' || q.subType === 'tax');
  const badly = s => /^\$\d+\.\d$/.test(String(s));
  const bad = qs.filter(q => badly(q.answer) || (q.options || []).some(badly) || /\$?\d+\.\d(?!\d)/.test(q.explanation));
  ok(`money is shown to the cent, never "$25.5" (${qs.length} drawn)`, qs.length > 100 && bad.length === 0,
    bad[0] && bad[0].answer + ' | ' + bad[0].explanation);
  const cents = qs.find(q => /\.50$/.test(q.answer));
  ok('a "$x.50" key is accepted typed both ways',cents && typed(cents.answer, cents) && typed(cents.answer.replace(/0$/, ''), cents));
}

// ---- lesson / bank text that was simply wrong -----------------------------------
{
  const trig = JSON.stringify(lesson(8, 'Trig Equations'));
  ok('trig lesson no longer says 0 happens once', !/other than ±1 and 0/.test(trig));
  const trade = lesson(6, 'Trade Formulas');
  const steps = JSON.stringify(trade);
  ok('pulley guided step asks only for the number', !/faster or slower than the motor\? Type/.test(steps));
  ok('the borrow-10 mistake shows what borrowing 10 really gives (3\'-8")',
    /= 3'-8\\" \(borrowing 10/.test(src) && !/= 4'-8\\" \(borrowing 10\)/.test(src));
  const sets = draw(10, 'Set Theory', 600).filter(q => q.subType === 'complement');
  ok('set complement question names set A', sets.length > 20 && sets.every(q => /A = \{/.test(q.question)));
  ok('decimal carry goes into the ones', !/1 is carried into the tenths/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
