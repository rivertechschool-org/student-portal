// Math Dojo, skills from "Separable Differential Equations" to the end of the
// file: practice asked things the lesson never taught. Each skill now teaches
// what its practice asks; this suite holds the one generator that changed and
// checks the new teaching steps are still there.
//
//   - Waste Factors: pieces_per_board allowed n pieces with n − 1 saw cuts,
//     while offcut charged n cuts for n pieces. Both now count ONE CUT PER
//     PIECE (each piece costs its length + 1/8 in) and both questions say so,
//     matching the lesson's new "Kerf in the calculation" step.
//   - Lesson steps: every gap the audit found has a teaching step; a later
//     edit that drops one should fail here, not in a classroom.
//
// Extraction mirrors tests/dojo-late-content.test.js.
//
// Run: node tests/dojo-taught-gaps-d.test.js

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

let seed = 11;
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
const typed = (input, q) => ctx.typedAnswerIsCorrect(input, q);
// "22 1/2" → 22.5
const mixedNum = s => { const m = /^(\d+)(?: (\d+)\/(\d+))?$/.exec(s.trim()) || /^(\d+)\/(\d+)$/.exec(s.trim());
  if (!m) return NaN; return m.length === 4 ? Number(m[1]) + (m[2] ? Number(m[2]) / Number(m[3]) : 0) : Number(m[1]) / Number(m[2]); };

// ---- Waste Factors: one cut per piece in both kerf questions ----------------
{
  const qs = draw(7, 'Waste Factors', 6000);
  const ppb = qs.filter(q => q.subType === 'pieces_per_board' && /saw cut/.test(q.question));
  const badP = ppb.filter(q => {
    const [, p, S] = /How many ([\d.]+) in pieces can you cut from an? (\d+) ft board/.exec(q.question).map(Number);
    const L = 12 * S, n = Number(q.answer), each = p + 0.125;
    // n pieces, each with its own cut, fit; one more does not.
    return !(n * each <= L + 1e-9 && (n + 1) * each > L + 1e-9) || !/one cut per piece/.test(q.question) || !typed(q.answer, q);
  });
  ok(`pieces_per_board charges one kerf per piece and says so (${ppb.length} drawn)`, ppb.length > 50 && badP.length === 0,
    badP[0] && badP[0].question + ' → ' + badP[0].answer);

  const off = qs.filter(q => q.subType === 'offcut');
  const badO = off.filter(q => {
    const [, k, pTxt, S] = /You cut (\d+) pieces, each ([\d /]+) in long, from an? (\d+) ft board/.exec(q.question);
    const left = 12 * Number(S) - Number(k) * (mixedNum(pTxt) + 0.125);
    return Math.abs(Number(q.answer) - left) > 1e-6 || !/one cut per piece/.test(q.question);
  });
  ok(`offcut charges one kerf per piece and says so (${off.length} drawn)`, off.length > 50 && badO.length === 0,
    badO[0] && badO[0].question + ' → ' + badO[0].answer);

  const L = JSON.stringify(lesson(7, 'Waste Factors'));
  ok('Waste Factors lesson teaches kerf in the calculation, one cut per piece',
    /Kerf in the calculation/.test(L) && /one cut per piece/.test(L));
}

// ---- Every gap now has a teaching step ---------------------------------------
{
  const want = [
    [9, 'Separable Differential Equations', 'Doubling time and half-life'],
    [6, 'Credit Card Math', 'Finance charge on the average daily balance'],
    [6, 'Investment Returns', 'Quarterly dividends'],
    [6, 'Tax Calculations', 'Deductions come off first'],
    [6, 'Revenue and Expenses', 'Staying inside a budget'],
    [6, 'Profit and Break-Even', 'The lowest price to break even'],
    [7, 'Financial Spreadsheets', 'Percents, powers and AVERAGE'],
    [6, 'Experimental Design', 'Comparing the groups: rates, not counts'],
    [7, 'Probability Distributions', 'Expected net gain of a game'],
    [7, 'Expected Value Decisions', 'Premiums and deductibles'],
    [6, 'Decimal Tolerances', 'Metric tolerances work the same way'],
    [6, 'Decimal Tolerances', 'From limits back to nominal ± tolerance'],
    [6, 'Decimal Tolerances', 'Rework: how much to take off'],
    [6, 'Technical Drawings', 'Finding the scale'],
    [6, 'Mixtures and Material Ratios', 'Starting from one ingredient'],
    [6, 'Trade Formulas', 'Gears: count teeth'],
    [8, 'Load and Rate Calculations', 'Items on a moving line'],
    [8, 'Production Rates', "Finding the partner's time"],
    [8, 'Efficiency', 'Labour efficiency'],
    [6, 'Binary Numbers', 'Decimal to hex: divide by 16'],
    [6, 'Boolean Logic', 'Counting calls'],
    [6, 'Boolean Logic', 'Even and odd with %'],
    [6, 'Functions in Code', 'Steps, countdowns and while loops'],
    [7, 'Randomness in Code', 'A chance check: Math.random() &lt; p'],
    [7, 'Computational Estimation', 'Triangle loops and exact doubling or halving counts'],
    [7, 'Probability Systems', 'How many tries for a target chance'],
    [7, 'Difficulty Scaling', 'When does it hit the cap?'],
    [8, '3D Coordinates', 'Right-handed or left-handed'],
    [8, 'Graph Theory', 'Spanning trees: the fewest edges that still connect'],
    [8, 'Algorithmic Complexity', 'Triangle loops and pairs'],
    [8, 'Algorithmic Complexity', 'Reading a described algorithm'],
    [8, 'Simulation and Modeling', 'Simulating in a spreadsheet'],
    [9, 'Nonlinear Function Analysis', 'Finding the vertex in other forms'],
    [9, 'Nonlinear Function Analysis', 'Reading a·bˣ + k from a table'],
  ];
  const tierOf = name => Object.keys(ctx.lessons).find(t => ctx.lessons[t] && ctx.lessons[t][name]);
  for (const [, name, title] of want) {
    const t = tierOf(name);
    const L = t && lesson(t, name);
    ok(`${name}: teaches "${title}"`, !!L && L.teachingSteps.some(s => s.title === title), t ? '' : 'skill not found');
  }
  // Text the lesson now teaches for the remaining items (inside existing steps).
  const has = (name, re) => { const t = tierOf(name); return !!t && re.test(JSON.stringify(lesson(t, name))); };
  ok('Matrix Transformations teaches the y = −x reflection', has('Matrix Transformations', /\(−y, −x\)/));
  ok('Matrix Transformations gives cos/sin past 90°', has('Matrix Transformations', /cos 120° = −1\/2/));
  ok('Measurement Fractions teaches a 3/32 kerf in thirty-seconds', has('Measurement Fractions', /3\/32 in<\/strong> kerf/));
  ok('Spreadsheet Data Analysis teaches two-argument SUMIF', has('Spreadsheet Data Analysis', /two<\/strong> arguments/));
  ok('Error and Tolerance teaches the highest passing reading', has('Error and Tolerance', /highest<\/strong> \(or lowest\) reading/));
  ok('Collision Detection teaches circle overlap depth', has('Collision Detection', /\(r1 \+ r2\) − d/));
  ok('Trade Formulas names V, A, Ω and W', has('Trade Formulas', /volts V, amps A, ohms Ω/));
  ok('Efficiency no longer says every efficiency is under 100%', has('Efficiency', /A machine's efficiency can't be over 100%/));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
