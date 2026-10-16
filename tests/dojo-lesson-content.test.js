// Math Dojo lessons: the guided answer keys and the maths they teach must agree.
//
// An audit of the lessons table found keys that marked right answers wrong and
// text that taught something false. Each block below pins one of them:
//
//   Pythagorean        legs 4 and 7 give c = √65; the prompt never said to round,
//                      and "√65" or "8.06" was rejected.
//   Inequalities       "3x + 5 ≥ 12" was keyed "x ≥ 3" (Math.ceil of 7/3).
//   Radicals           √16 keyed "2√4"; √2 × √8 keyed "√16" under "Always simplify".
//   Arc / Sector       "simplified fraction or decimal" rejected 5/18; the exact
//                      multiple of π was rejected.
//   Implicit diff      r = 3 printed "(3, 0.00) ... −3 / 0.00 ≈ -Infinity".
//   Radian arc length  printed "4π/4" while its own step calls that unsimplified.
//   Vector magnitude   presented √128 as the exact answer.
//   Double integrals   0 ≤ x ≤ y was keyed "below" the diagonal.
//   Quotient rule      taught with f/g, summarised as (g'h − gh')/h².
//   Unit conversion    "1 fee = 12 inches".
//
// The lessons are evaluated the way tools/dojo-lesson-audit.js does it: the
// table is extracted by anchor and run with its real helpers under a seeded
// PRNG, so every lesson is drawn many times.
//
// Run: node tests/dojo-lesson-content.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');
const lines = html.split('\n');

let pass = 0;
let fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};
// Lessons are drawn hundreds of times. `each` folds those per-draw checks into
// one result per group (keeping the first failing draw as the detail), and
// `flush` reports them, so the output stays one line per property.
const groups = new Map();
const each = (group, cond, detail) => {
  const g = groups.get(group) || { n: 0, bad: null };
  g.n++;
  if (!cond && g.bad === null) g.bad = String(detail);
  groups.set(group, g);
};
const flush = () => {
  for (const [group, g] of groups) ok(`${group} (${g.n} draws)`, g.bad === null, g.bad);
  groups.clear();
};

// ---- extraction (same anchors as tools/dojo-lesson-audit.js) ---------------
const lineOf = re => lines.findIndex(l => re.test(l));
function tableSource(re) {
  const at = lineOf(re);
  for (let i = at + 1; i < lines.length; i++) {
    if (/^};\s*$/.test(lines[i])) return lines.slice(at, i + 1).join('\n');
  }
  throw new Error('unterminated table');
}
const helpers = ['rand', 'pick', 'shuffle', 'cap', 'gcd', 'simplifyFrac']
  .map(n => lines[lineOf(new RegExp('^const ' + n + ' = '))]).join('\n');
const seeded = `let __seed = 7; Math.random = () => { __seed = (__seed * 1103515245 + 12345) & 0x7fffffff; return __seed / 0x7fffffff; };`;
const lessons = new Function('"use strict";' + seeded + '\nconst state = {};\n' + helpers + '\n'
  + tableSource(/^const lessons = \{/) + '\nreturn lessons;')();

// Draw a lesson (or one of its sub-skills) many times.
function draws(tier, name, subId, n = 200) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const L = lessons[tier][name]();
    out.push(subId ? L.subSkills.find(s => s.id === subId) : L);
  }
  return out;
}
const finalKeys = g => [g.answer, ...(g.acceptableAnswers || [])].map(String);
const stepWith = (g, re) => g.interactiveSteps.find(s => re.test(s.prompt));
const near = (a, b) => Math.abs(a - b) < 1e-9;
const isSquareFree = n => { for (let k = 2; k * k <= n; k++) if (n % (k * k) === 0) return false; return true; };
const allText = o => JSON.stringify(o);

// ---- Pythagorean: hypotenuse ----------------------------------------------
for (const u of draws(4, 'Pythagorean', 'hyp')) {
  const [, a, b] = /legs (\d+) and (\d+)/.exec(u.guided.problem).map(Number);
  const c = Math.sqrt(a * a + b * b);
  if (Number.isInteger(c)) continue;
  const keys = finalKeys(u.guided);
  const root = stepWith(u.guided, /Take the square root/);
  const label = `hypotenuse legs ${a}, ${b}`;
  each('hypotenuse: says to round', /nearest tenth/.test(u.guided.problem) && /nearest tenth/.test(root.prompt), label);
  each('hypotenuse: accepts the exact √N', keys.includes(`√${a * a + b * b}`) && root.acceptableAnswers.includes(`√${a * a + b * b}`), label);
  each('hypotenuse: accepts 2 places', keys.includes(c.toFixed(2)) && root.acceptableAnswers.includes(c.toFixed(2)), label);
  each('hypotenuse: keyed tenth is right', near(Number(u.guided.answer), Math.round(c * 10) / 10), label);
}
flush();

// ---- Inequalities: the boundary is the true quotient ----------------------
for (const u of draws(5, 'Inequalities')) {
  const [, a, b, t] = /(\d+)x \+ (\d+) ≥ (\d+)/.exec(u.guided.problem).map(Number);
  const boundary = (t - b) / a;
  const label = `${a}x + ${b} ≥ ${t}`;
  each('inequality: boundary is a whole number', Number.isInteger(boundary), label);
  each('inequality: keys the true boundary', near(Number(u.guided.answer), boundary), label + ' keyed ' + u.guided.answer);
  const div = stepWith(u.guided, /÷/);
  each('inequality: division step keys only the quotient', div.acceptableAnswers.every(x => near(Number(x), boundary)), label);
}
flush();

// ---- Radicals: every keyed radical is simplified --------------------------
for (const id of ['simplify', 'add', 'multiply']) {
  for (const u of draws(5, 'Radicals', id)) {
    const m = /√(\d+)$/.exec(String(u.guided.answer));
    each(`Radicals/${id}: keyed radical is simplified`, m && isSquareFree(Number(m[1])),
      `${u.guided.problem} -> ${u.guided.answer}`);
  }
}
flush();

// ---- Arc length and sector area -------------------------------------------
const piValue = s => {
  const m = /^(\d*)(?:π|pi)(?:\/(\d+))?$/.exec(s);
  return m ? (m[1] ? +m[1] : 1) * Math.PI / (m[2] ? +m[2] : 1) : null;
};
for (const u of draws(6, 'Arc Length')) {
  const [, r, angle] = /radius = (\d+) cm, central angle = (\d+)/.exec(u.guided.problem).map(Number);
  const frac = stepWith(u.guided, /fraction of the circle/);
  const fracKeys = frac.acceptableAnswers.filter(k => /^\d+\/\d+$/.test(k));
  each('arc length: reduced fraction of the circle accepted',
    fracKeys.some(k => { const [n, d] = k.split('/').map(Number); return n / d === angle / 360 && gcdN(n, d) === 1; }), `${angle}°`);
  const exact = finalKeys(u.guided).map(piValue).filter(v => v !== null);
  each('arc length: exact π form accepted and correct',
    exact.length > 0 && exact.every(v => near(v, 2 * Math.PI * r * angle / 360)), `r=${r} ${angle}°`);
}
function gcdN(a, b) { return b ? gcdN(b, a % b) : a; }
for (const u of draws(6, 'Sector Area')) {
  const [, r, angle] = /radius = (\d+) cm, central angle = (\d+)/.exec(u.guided.problem).map(Number);
  const exact = finalKeys(u.guided).map(piValue).filter(v => v !== null);
  each('sector area: exact π form accepted and correct',
    exact.length > 0 && exact.every(v => near(v, Math.PI * r * r * angle / 360)), `r=${r} ${angle}°`);
}

// ---- Implicit differentiation: no division by zero in the worked point ----
for (const u of draws(9, 'Implicit Differentiation', 'circle', 60)) {
  const t = allText(u);
  each('implicit diff: no Infinity / 0.00 sample point', !/Infinity|, 0\.00\)/.test(t), (/Try \([^)]*\)[^.]*/.exec(t) || [''])[0]);
}
flush();

// ---- Trig identities: the sign rule is stated correctly -------------------
const sumDiff = lessons[8]['Trig Identities']().subSkills.find(s => s.id === 'sum_diff');
ok('sum/difference no longer claims cos(A−B) ≠ cos(B−A)', !/cos\(A−B\) ≠ cos\(B−A\)/.test(allText(sumDiff)));
ok('sum/difference says sin keeps the sign', /sin keeps the sign/.test(allText(sumDiff)));

// ---- Radian arc length is reduced -----------------------------------------
for (const u of draws(8, 'Radian Measure', 'arc_length', 100)) {
  const m = /^(\d*)π(?:\/(\d+))?$/.exec(u.finalAnswer);
  each('radian arc length is reduced',
    m && (!m[2] || gcdN(m[1] ? +m[1] : 1, +m[2]) === 1) && m[1] !== '1', u.finalAnswer);
}

// ---- Vector magnitude is a simplified radical -----------------------------
for (const u of draws(8, 'Vectors', 'magnitude', 100)) {
  const m = /√(\d+)$/.exec(u.finalAnswer);
  each('vector magnitude is a simplified radical', !m || isSquareFree(+m[1]), u.finalAnswer);
}
flush();

// ---- Double integral region -----------------------------------------------
const region = lessons[10]['Double Integrals']().subSkills.find(s => s.id === 'region');
ok('0 ≤ x ≤ y is the triangle ABOVE y = x', /above/.test(region.guided.answer) && !/below/.test(region.guided.answer));

// ---- Quotient rule uses one notation --------------------------------------
const qr = lessons[9]['Quotient Rule']().subSkills;
ok('quotient rule never switches to g/h notation', !/g'h|gh'|\/h²/.test(allText(qr.slice(0, 2))));
ok('quotient rule summary is (f\'g - fg\')/g²', qr[0].finalAnswer === "(f'g - fg')/g²");

// ---- Series: geometric sum shown exactly ----------------------------------
for (const u of draws(8, 'Series Convergence', 'geometric', 60)) {
  each('geometric series sum is exact', /^Converges to \d+(\/\d+)?$/.test(u.finalAnswer), u.finalAnswer);
}

// ---- Unit conversion singulars --------------------------------------------
for (const u of draws(3, 'Unit Conversion', 'length', 60)) {
  const t = allText(u);
  each('unit conversion says "1 foot" / "1 inch", never "1 fee" / "1 inche"', !/1 fee\b|1 inche\b|1 yar\b/.test(t),
    (/1 (fee|inche|yar)\b[^"]*/.exec(t) || [''])[0]);
}
flush();

// ---- Text fixes -----------------------------------------------------------
ok('scientific notation: 3,500,000 does not "have 6 zeros"', !/3,500,000 has 6 zeros/.test(html));
ok('√9 is 3, not ±3', !/x = √9 = ±3/.test(html));
ok('lim (1 + 1/x)^x is a 1^∞ form', !/or ∞⁰ for #5/.test(html));
ok('dilation is not called rigid', !/The four rigid transformations/.test(html));
ok('harmonic H_n = 20 needs ≈ 272 million terms', !/e\^20 ≈ 485 million/.test(html));
ok('sin(x)/x does not "rise slightly"', !/rises slightly, then falls/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
