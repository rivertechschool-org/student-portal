// Math Dojo generator content: answer keys a math teacher would mark wrong.
//
// Follows dojo-angle-line-banks.test.js. After the table-top angle report, an
// audit of the practice generators found more of the same kind: a correct
// option graded wrong ("4 triangles" for a square, "-k/x²" for xy = k, "is
// bounded" for a Cauchy sequence, "ED" beside "DE"), a key that is simply wrong
// ("sleep missed vs. reaction time" keyed negative, 60/60/60 keyed acute
// isosceles), questions with two honest answers (football field vs. city block,
// a bicycle vs. a small dog), and an equation that was false (5(x + 2) = 5x + 15,
// because rand() was called twice).
//
// Each generator is extracted from the page by name and run many times with a
// seeded random source, so a fix that only covers one draw does not pass.
//
// Run: node tests/dojo-generator-content.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');
const GEN_START = html.indexOf('const generators = {');

let pass = 0;
let fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

// Generator keys are quoted ("Line Symmetry") or bare (Shapes, Proofs).
function generatorSource(name) {
  const re = new RegExp(`\\n\\s+(?:"${name}"|${/^\w+$/.test(name) ? name : '(?!)'}): \\(\\) => \\{`, 'g');
  re.lastIndex = GEN_START;
  const m = re.exec(html);
  if (!m) throw new Error(name + ' not found');
  let i = m.index + m[0].length - 1, depth = 0;
  const start = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(start, i);
}

let seed = 9001;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const rand = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const uniqOpts = arr => arr.filter((v, i) => arr.findIndex(w => String(w).trim().toLowerCase() === String(v).trim().toLowerCase()) === i);
// Every sub-skill unlocked, so every question type is drawn.
const getUnlockedSubSkillTypes = (_key, map) => Array.from(new Set(Object.values(map).flat()));
const state = { mode: 'practice' };
Math.random = rnd;

const build = name => new Function('pick', 'rand', 'cap', 'shuffle', 'uniqOpts', 'getUnlockedSubSkillTypes', 'state',
  '"use strict"; return (() => ' + generatorSource(name) + ')();');
const draw = (name, n = 3000) => {
  const g = build(name);
  return Array.from({ length: n }, () => g(pick, rand, cap, shuffle, uniqOpts, getUnlockedSubSkillTypes, state));
};
const has = (q, re) => re.test(q.question + ' ' + (q.options || []).join(' | '));
const first = (arr, f) => { const x = arr.find(f); return x ? x.question + ' -> ' + x.answer + ' [' + (x.options || []).join(' | ') + ']' : ''; };

// ---- Shapes (polygons) -----------------------------------------------------
{
  const qs = draw('Shapes');
  const bad = /sheriff|ten-sided die|crown rim|snowflake|window pane|cracker/;
  ok('Shapes: no misleading polygon examples', !qs.some(q => has(q, bad)), first(qs, q => has(q, bad)));
  ok('Shapes: no "A <vowel>" in questions', !qs.some(q => /\bA [aeiou]/.test(q.question)), first(qs, q => /\bA [aeiou]/.test(q.question)));
}

// ---- 3D Shapes / Nets ------------------------------------------------------
{
  const qs = draw('3D Shapes');
  const bad = /^(box|gift box|paperweight|tent top)$/;
  const items = q => [q.answer, ...(q.options || []), (/^An? (.+) is shaped/.exec(q.question) || [])[1]];
  ok('3D Shapes: no box/paperweight/tent-top examples', !qs.some(q => items(q).some(x => bad.test(x))), first(qs, q => items(q).some(x => bad.test(x))));
  const cyl = qs.find(q => q.subType === 'faces' && /cylinder/.test(q.question));
  ok('3D Shapes: cylinder has 2 flat faces', cyl && cyl.answer === 2);
  const nets = draw('Nets of 3D Shapes');
  const ncyl = nets.filter(q => q.subType === 'count_faces' && /cylinder/.test(q.question));
  ok('Nets: cylinder flat faces agree with 3D Shapes (2)', ncyl.length > 0 && ncyl.every(q => q.answer === 2 && /flat faces/.test(q.question)));
}

// ---- Composing Shapes ------------------------------------------------------
{
  const sides = { 'large triangle': 3, square: 4, rectangle: 4, rhombus: 4, parallelogram: 4, trapezoid: 4, hexagon: 6, octagon: 8 };
  // Independent of the page: n triangles can form any polygon with <= n + 2 sides.
  const canMake = (n, part, whole) => {
    if (!(whole in sides)) return false;
    if (part === 'triangles') return n >= sides[whole] - 2;
    if (part === 'squares') return whole === 'square' ? Number.isInteger(Math.sqrt(n)) : whole !== 'large triangle' && whole !== 'hexagon' && whole !== 'octagon';
    return false;
  };
  const qs = draw('Composing Shapes', 4000);
  const combine = qs.filter(q => q.subType === 'combine');
  const wrongCombine = combine.filter(q => {
    const [, n, part] = /make with (\d+) (?:smaller )?(\w+)\?/.exec(q.question);
    return q.options.some(o => o !== q.answer && canMake(+n, part, o));
  });
  ok('Composing combine: no option that the pieces CAN make is graded wrong', combine.length > 200 && !wrongCombine.length, first(wrongCombine, () => true));
  const build_ = qs.filter(q => q.subType === 'build');
  const wrongBuild = build_.filter(q => {
    const whole = /build an? (.+), you/.exec(q.question)[1];
    return q.options.some(o => o !== q.answer && canMake(parseInt(o, 10), o.replace(/^\d+ /, ''), whole));
  });
  ok('Composing build: no piece set that CAN build the whole is graded wrong', build_.length > 200 && !wrongBuild.length, first(wrongBuild, () => true));
  ok('Composing: every question has 4 options', qs.filter(q => q.options).every(q => q.options.length === 4), first(qs, q => q.options && q.options.length !== 4));
}

// ---- Comparing Lengths -----------------------------------------------------
{
  const qs = draw('Comparing Lengths');
  ok('Lengths estimate: football field never beside "about 300 feet"', !qs.some(q => q.subType === 'estimate' && has(q, /300 feet/)));
  const cmp = qs.filter(q => q.subType === 'compare').map(q => /: (\d+) in, .*: (\d+) in/.exec(q.explanation)).filter(Boolean);
  ok('Lengths compare: the two items are at least 2x apart', cmp.length > 200 && cmp.every(m => Math.max(+m[1], +m[2]) >= 2 * Math.min(+m[1], +m[2])));
}

// ---- Mass and Capacity -----------------------------------------------------
{
  const qs = draw('Mass and Capacity');
  const pairs = qs.map(q => /\(~([\d.]+) (?:g|mL)\).*\(~([\d.]+) (?:g|mL)\)/.exec(q.explanation)).filter(Boolean);
  ok('Mass/Capacity: compared items are at least 3x apart', pairs.length > 1000 && pairs.every(m => +m[1] >= 3 * +m[2]),
    first(qs, q => { const m = /\(~([\d.]+) (?:g|mL)\).*\(~([\d.]+) (?:g|mL)\)/.exec(q.explanation); return m && +m[1] < 3 * +m[2]; }));
}

// ---- Classifying Objects / Estimation --------------------------------------
{
  const qs = draw('Classifying Objects');
  const bad = /\b(a|an) (window|cracker|sandwich half|apple|grape|rose)\?/;
  ok('Classifying: no ambiguous colour/shape items', !qs.some(q => bad.test(q.question)), first(qs, q => bad.test(q.question)));
  const est = draw('Estimation');
  ok('Estimation: no jelly-bean jar or parking lot', !est.some(q => /jelly beans|parking lot/.test(q.question)));
}

// ---- Line Symmetry ---------------------------------------------------------
{
  const qs = draw('Line Symmetry');
  ok('Symmetry: no "a <vowel>", "a the", "a most"', !qs.some(q => /\ba (the|most|[aeiou])/i.test(q.question)), first(qs, q => /\ba (the|most|[aeiou])/i.test(q.question)));
  const noKeyed = qs.filter(q => q.answer === 'No' || q.answer === 'no line');
  ok('Symmetry: plain trapezoid, mug and guitar are never "not symmetric"',
    !noKeyed.some(q => /\b(a|an) (trapezoid|coffee mug|guitar)/.test(q.question)), first(noKeyed, q => /\b(a|an) (trapezoid|coffee mug|guitar)/.test(q.question)));
}

// ---- GCF and LCM -----------------------------------------------------------
{
  const qs = draw('GCF and LCM');
  ok('LCM word: bus problem reads as a sentence', !qs.some(q => /come in minutes/.test(q.question)));
  ok('LCM word: bus problem is drawn', qs.some(q => /Bus A comes every \d+ minutes/.test(q.question)));
}

// ---- Scatter Plots / Irrational / Sampling ---------------------------------
{
  const qs = draw('Scatter Plots');
  ok('Scatter: no "sleep missed" keyed negative', !qs.some(q => /sleep missed/.test(q.question) && q.answer === 'negative'));
  const irr = draw('Irrational Numbers');
  const bare = irr.filter(q => /^Classify: 0\.\d+\.\.\.$/.test(q.question) && q.answer === 'Irrational');
  ok('Irrational: no bare "0.4927163..." keyed irrational', !bare.length, first(bare, () => true));
  const smp = draw('Sampling Methods');
  ok('Sampling: no "-related behavior" text', !smp.some(q => /-related behavior/.test(q.question)));
  ok('Sampling: systematic sample states the list size', smp.filter(q => q.subType === 'best_method' && q.answer === 'Systematic').every(q => /list of \d+ .* sample of \d+/.test(q.question)));
  ok('Sampling: unbiased stratified scenario is proportional', smp.filter(q => q.subType === 'bias_check' && /Split /.test(q.question)).every(q => /in proportion/.test(q.question)));
}

// ---- Triangles / Congruence / Proofs / Law of Sines ------------------------
{
  const tri = draw('Triangles');
  ok('Triangles: "acute isosceles" never 60-60-60', !tri.some(q => q.answer === 'acute isosceles' && /60°, 60° and 60°/.test(q.question)));
  const con = draw('Congruence');
  const side = con.filter(q => q.subType === 'corresponding_side');
  ok('Congruence: the reversed answer (same segment) is never a wrong option',
    side.length > 100 && !side.some(q => q.options.includes(q.answer.split('').reverse().join(''))), first(side, q => q.options.includes(q.answer.split('').reverse().join(''))));
  const pr = draw('Proofs', 6000).filter(q => /Distributive Property/.test(q.answer) && /\(/.test(q.question));
  const badEq = pr.filter(q => { const m = /(\d)\((\w) \+ (\d)\) = \1\2 \+ (\d+)/.exec(q.question); return !m || +m[4] !== +m[1] * +m[3]; });
  ok('Proofs: every distributive statement is a true equation', pr.length > 20 && !badEq.length, first(badEq, () => true));
  const los = draw('Law of Sines').filter(q => q.subType === 'find_angle' && /a=(\d+), b=(\d+)/.test(q.question));
  ok('Law of Sines find_angle: b <= a (not the ambiguous SSA case)',
    los.length > 100 && los.every(q => { const m = /a=(\d+), b=(\d+)/.exec(q.question); return +m[2] <= +m[1]; }));
}

// ---- Calculus / Analysis ---------------------------------------------------
{
  const par = draw('Parametric Equations').filter(q => /t⁴/.test(q.question));
  ok('Parametric: x = t², y = t⁴ asks for "part of" a curve', par.length > 0 && par.every(q => /part of/.test(q.question)));
  const imp = draw('Implicit Differentiation').filter(q => /^xy = (\d+)\./.test(q.question));
  ok('Implicit: xy = k never offers the equivalent -k/x² as wrong',
    imp.length > 20 && !imp.some(q => { const k = /^xy = (\d+)/.exec(q.question)[1]; return q.options.includes(`-${k}/x²`); }));
  const ibp = draw('Integration by Parts').filter(q => q.subType === 'choose_u');
  ok('IBP choose_u: the answer is always an option', ibp.length > 200 && ibp.every(q => q.options.includes(q.answer)), first(ibp, q => !q.options.includes(q.answer)));
  const exs = ibp.filter(q => /e\^x·sin/.test(q.question));
  ok('IBP choose_u: ∫e^x·sin(x) follows LIATE and does not mark u = e^x wrong',
    exs.length > 0 && exs.every(q => q.answer === 'sin(x)' && !q.options.includes('e^x')));
  const ra = draw('Real Analysis').filter(q => /every Cauchy sequence/.test(q.question));
  ok('Real Analysis: "is bounded" (also true) is not a wrong option', ra.length > 0 && ra.every(q => !q.options.includes('is bounded')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
