// Math Dojo: practice must only ask what the lesson taught, with one right answer.
//
// The teacher's report: practice questions asked about things the skill's
// lesson never covered (Precision Measurement asked for metric micrometer
// readings when only the inch one was taught). An audit of the legacy
// generators found the same fault across ~60 skills; most were fixed by
// teaching the missing step, a few by dropping practice beyond the skill's
// grade. Along the way it found answers that were simply wrong. This holds
// both kinds of fix in place:
//
//   - the four answer bugs (Rational Functions, Box Plots, Scientific
//     Notation, Conic Sections) and the "two right answers" distractors
//     (Mixed Numbers, Fraction Word Problems);
//   - every subtype that was dropped or reworded stays dropped;
//   - every lesson still carries the step that teaches what its practice asks.
//
// Generators and lessons are evaluated from the page, as
// tools/dojo-lesson-audit.js does, under a seeded PRNG.
//
// Run: node tests/dojo-taught-gaps-a.test.js

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

// ---------------------------------------------------------------- extraction
const lineOf = re => lines.findIndex(l => re.test(l));
function sliceTable(startLine) {
  for (let i = startLine + 1; i < lines.length; i++) {
    if (/^};\s*$/.test(lines[i])) return lines.slice(startLine, i + 1).join('\n');
  }
  throw new Error('unterminated table at ' + startLine);
}
function fnSource(name) {
  const at = lineOf(new RegExp('^function ' + name + '\\b'));
  for (let i = at + 1; i < lines.length; i++) {
    if (/^}\s*$/.test(lines[i])) return lines.slice(at, i + 1).join('\n');
  }
  throw new Error(name + ' not found');
}
const helpers = [
  lines[lineOf(/^const rand = /)], lines[lineOf(/^const pick = /)],
  lines[lineOf(/^const shuffle = /)], lines[lineOf(/^const cap = /)],
  lines[lineOf(/^const gcd = /)], lines[lineOf(/^const simplifyFrac = /)],
  fnSource('tallyMarks'), fnSource('generateDistractors'), fnSource('backfillOptions'),
  fnSource('answerValue'), fnSource('uniqOpts'), fnSource('getUnlockedSubSkillTypes'),
].join('\n');

// placement mode: every sub-skill's question types are in play.
const { generators, lessons } = new Function(`"use strict";
  let __seed = 7;
  Math.random = () => { __seed = (__seed * 1103515245 + 12345) & 0x7fffffff; return __seed / 0x7fffffff; };
  const state = { mode: 'placement', completedSubSkills: {} };
  ${helpers}
  ${sliceTable(lineOf(/^const generators = \{/))}
  ${sliceTable(lineOf(/^const lessons = \{/))}
  return { generators, lessons };`)();

const draw = (tier, skill, n = 1500) => {
  const g = generators[tier][skill];
  if (!g) throw new Error('no generator ' + tier + ' ' + skill);
  return Array.from({ length: n }, () => g());
};
// Every teaching step and key point a lesson shows, sub-skills included.
function lessonText(tier, skill) {
  const l = lessons[tier][skill]();
  const units = l.hasSubSkills ? l.subSkills : [l];
  return units.map(u => [
    ...(u.teachingSteps || []).map(s => `${s.title} ${s.explanation} ${typeof s.visual === 'string' ? s.visual : ''}`),
    ...(u.keyPoints || []),
  ].join('\n')).join('\n');
}
const fracVal = s => { const m = /^(-?\d+)\/(\d+)$/.exec(String(s).trim()); return m ? +m[1] / +m[2] : NaN; };
const mixedVal = s => {
  const t = String(s).replace(/ cup$/, '').trim();
  let m = /^(\d+) (\d+)\/(\d+)$/.exec(t); if (m) return +m[1] + m[2] / m[3];
  m = /^(\d+)\/(\d+)$/.exec(t); if (m) return m[1] / m[2];
  return Number(t);
};

// ---------------------------------------------------------------- answer bugs
{
  // 1. Every polynomial is rational - the lesson says so.
  const qs = draw(7, 'Rational Functions').filter(q => q.subType === 'identify');
  const poly = qs.filter(q => /x² \+ 3x - 5 a rational/.test(q.question));
  ok('Rational Functions: the polynomial is drawn', poly.length > 0);
  ok('Rational Functions: "is x² + 3x - 5 rational?" answers Yes',
    poly.every(q => q.answer === 'Yes'), poly.map(q => q.answer).join(','));
}
{
  // 2. Box plot quartiles leave the median out of both halves.
  const qs = draw(4, 'Box Plots');
  let bad = null;
  for (const q of qs) {
    const data = q.question.match(/Data: ([\d, ]+)\./)[1].split(', ').map(Number);
    const part = q.question.match(/What is the (\w+)\?/)[1];
    const n = data.length, med = (n - 1) / 2;
    const median = a => a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
    const lower = data.slice(0, med), upper = data.slice(med + 1);
    const v = { minimum: data[0], maximum: data[n - 1], median: data[med],
      Q1: median(lower), Q3: median(upper), IQR: median(upper) - median(lower), range: data[n - 1] - data[0] }[part];
    if (n % 2 !== 1 || v !== q.answer) { bad = `${q.question} -> ${q.answer}, expected ${v}`; break; }
  }
  ok('Box Plots: Q1/Q3/IQR use halves that exclude the median', !bad, bad);
  ok('Box Plots: lesson teaches finding Q1 and Q3 from a list',
    /Finding Q1 and Q3 from a list/.test(lessonText(4, 'Box Plots')));
}
{
  // 3. A product in scientific notation is itself in scientific notation.
  const qs = draw(3, 'Scientific Notation').filter(q => q.subType === 'multiply');
  let bad = null;
  for (const q of qs) {
    const [, a, ea, b, eb] = q.question.match(/\((\d+) × 10\^(\d+)\) × \((\d+) × 10\^(\d+)\)/).map(Number);
    const [, c, e] = String(q.answer).match(/^([\d.]+) × 10\^(\d+)$/).map(Number);
    if (!(c >= 1 && c < 10) || Math.abs(c * 10 ** e - a * 10 ** ea * b * 10 ** eb) > 1e-6 * c * 10 ** e) { bad = q.question + ' -> ' + q.answer; break; }
    if (!q.options.includes(q.answer) || new Set(q.options).size !== q.options.length) { bad = 'options ' + q.options.join(' | '); break; }
  }
  ok('Scientific Notation: multiply answers satisfy 1 ≤ a < 10 and are correct', qs.length > 50 && !bad, bad);
  ok('Scientific Notation: 15 × 10^7 is never offered as an answer',
    qs.every(q => !/^1\d × /.test(q.answer)));
  const from = draw(3, 'Scientific Notation').filter(q => q.subType === 'convert_from');
  ok('Scientific Notation: standard form is a clean integer (no 110.00000000000001)',
    from.every(q => Number.isInteger(q.answer)), from.find(q => !Number.isInteger(q.answer))?.answer);
}
{
  // 4. The ellipse focus question belongs to the ellipse sub-skill.
  const qs = draw(7, 'Conic Sections', 3000);
  const foci = qs.filter(q => /focus/.test(q.question));
  ok('Conic Sections: focus questions are drawn', foci.length > 0);
  ok('Conic Sections: focus questions are only in the ellipse sub-skill',
    foci.every(q => q.subType === 'ellipse'), [...new Set(foci.map(q => q.subType))].join(','));
}

// ---------------------------------------------------------------- one right answer
{
  const qs = draw(2, 'Mixed Numbers', 3000).filter(q => q.subType === 'add_mixed');
  const clash = qs.find(q => q.options.filter(o => Math.abs(mixedVal(o) - mixedVal(q.answer)) < 1e-9).length !== 1);
  ok('Mixed Numbers: no add_mixed option equals the answer in value (3 5/4 beside 4 1/4)', !clash,
    clash && clash.question + ' [' + clash.options.join(' | ') + ']');
}
{
  const qs = draw(2, 'Fraction Word Problems', 3000).filter(q => q.question.startsWith('Mom pours'));
  const clash = qs.find(q => q.options.filter(o => Math.abs(mixedVal(o) - mixedVal(q.answer)) < 1e-9).length !== 1);
  ok('Fraction Word Problems: "4/4 cup" is not offered beside "1 cup"', !clash,
    clash && clash.question + ' [' + clash.options.join(' | ') + ']');
}
{
  const qs = draw(4, 'Irrational Numbers', 3000).filter(q => q.subType === 'approximate');
  ok('Irrational Numbers: approximations are to 1 decimal place',
    qs.length > 0 && qs.every(q => /to 1 decimal place/.test(q.question) && Math.abs(q.answer * 10 - Math.round(q.answer * 10)) < 1e-9
      && Math.abs(q.answer - Math.sqrt(+q.question.match(/√(\d+)/)[1])) <= 0.05 + 1e-9));
  ok('Irrational Numbers: the approximation options are distinct and include the answer',
    qs.every(q => q.options.includes(q.answer) && new Set(q.options).size === q.options.length));
}
{
  const qs = draw(3, 'Powers of 10', 3000).filter(q => q.subType === 'decimal' || q.subType === 'scientific');
  const noisy = qs.find(q => /\d\.\d*0000000|\d\.\d*9999999/.test(String(q.answer)));
  ok('Powers of 10: no floating-point noise in answers (7.000000000000001)', !noisy, noisy && noisy.question + ' -> ' + noisy.answer);
}
{
  const qs = draw(5, 'Systems by Elimination', 2000).filter(q => q.subType === 'multiply');
  let bad = null;
  for (const q of qs) {
    const m = q.question.match(/x \+ y = (-?\d+) and (\d+)x \+ (\d+)y = (-?\d+)\. Multiply the first equation by (\d+)/);
    if (!m) { bad = q.question; break; }
    const [, S, a, b, T, k] = m.map(Number);
    const x = q.answer, y = S - x;
    if (k < 2 || b !== k || a * x + b * y !== T) { bad = q.question + ' -> ' + x; break; }
  }
  ok('Systems by Elimination: the "multiply" question needs a multiplication and is correct', qs.length > 0 && !bad, bad);
}

// ---------------------------------------------------------------- dropped / reworded subtypes
{
  const qs = draw(3, 'Coordinate Plane');
  ok('Coordinate Plane: midpoint dropped', qs.every(q => q.subType !== 'midpoint' && !/midpoint/i.test(q.question)));
  const dist = qs.filter(q => q.subType === 'distance');
  let bad = null;
  for (const q of dist) {
    const [, ax, ay, bx, by] = q.question.match(/A\((-?\d+), (-?\d+)\) to B\((-?\d+), (-?\d+)\)/).map(Number);
    if (!(ax === bx || ay === by) || q.answer !== Math.abs(ax - bx) + Math.abs(ay - by)) { bad = q.question + ' -> ' + q.answer; break; }
  }
  ok('Coordinate Plane: distance is along a grid line and counts correctly', dist.length > 0 && !bad, bad);
}
{
  const qs = draw(3, 'Square Roots');
  ok('Square Roots: simplifying radicals dropped', qs.every(q => q.subType !== 'simplify' && !/Simplify/.test(q.question)));
}
{
  const qs = draw(1, '3D Shapes', 4000);
  const curvedEdges = qs.filter(q => /edge/.test(q.question) && /cylinder|cone|sphere/.test(q.question + ' ' + q.answer)
    && (q.subType === 'edges' || q.subType === 'name_from_property'));
  ok('3D Shapes: no edge questions about curved shapes', curvedEdges.length === 0, curvedEdges[0]?.question);
  ok('3D Shapes: "1 faces" never appears', qs.every(q => !/\b1 (faces|edges|vertices)\b/.test(q.question)));
}
{
  const qs = draw(2, 'Line Symmetry', 4000);
  const untaught = /rhombus|\bkite\b(?! )|ellipse|parallelogram|trapezoid|irregular|scalene hexagon/;
  const hit = qs.find(q => (q.subType === 'identify' || q.subType === 'count_lines') && untaught.test(q.question));
  ok('Line Symmetry: untaught shapes dropped from identify/count', !hit, hit?.question);
}
{
  const qs = draw(4, 'Scatter Plots', 3000).filter(q => q.subType === 'trend');
  ok('Scatter Plots: physics/economics scenarios dropped',
    qs.every(q => !/altitude|quantity demanded/.test(q.question)));
}
{
  const qs = draw(1, 'Ordering Numbers').filter(q => /put in order/.test(q.question));
  ok('Ordering Numbers: asks "smallest to largest", the lesson\'s words',
    qs.length > 0 && qs.every(q => /smallest to largest/.test(q.question)));
}
{
  const qs = draw(6, 'Triangle Centers', 3000).filter(q => q.subType === 'centroid_coord');
  const flat = qs.find(q => {
    const p = [...q.question.matchAll(/\((-?\d+), (-?\d+)\)/g)].map(m => [+m[1], +m[2]]);
    return (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]) === 0;
  });
  ok('Triangle Centers: centroid vertices are never in a line', !flat, flat?.question);
}

// ---------------------------------------------------------------- lessons teach it
const taught = [
  [2, 'Long Division', /doesn't come out even[\s\S]*Use two[\s\S]*A zero in the answer/],
  [3, 'Expressions with Variables', /Combining like terms[\s\S]*Words to expressions/],
  [4, 'Transformations', /Translations on a grid[\s\S]*Reflecting over an axis[\s\S]*Rotating around the origin/],
  [4, 'Cube Roots', /9³ = 729, 10³ = 1000[\s\S]*Negative numbers have cube roots[\s\S]*Cube root of a fraction/],
  [2, 'Fractions (Concepts)', /different bottom numbers[\s\S]*A fraction of a number[\s\S]*number line/],
  [3, 'Coordinate Plane', /The four quadrants[\s\S]*Distance along a grid line/],
  [3, 'Nets of 3D Shapes', /Prism and pyramid nets[\s\S]*Surface area = add every face/],
  [1, '3D Shapes', /Faces, edges and corners[\s\S]*Boxes, tents, pyramids and cones/],
  [2, 'Fraction Operations', /Subtracting, same denominator/],
  [5, 'Correlation and Trend Lines', /correlation coefficient r[\s\S]*not causation/],
  [5, 'Compound Interest', /P\(1 \+ r\/n\)\^\(nt\)/],
  [6, 'Perpendicular Bisectors', /negative reciprocals[\s\S]*vertical line/],
  [2, 'Line Symmetry', /n sides → n lines[\s\S]*Triangle names/],
  [2, 'Factors and Multiples', /What is a multiple\?[\s\S]*Greatest common factor/],
  [5, 'Literal Equations', /P = 2l \+ 2w[\s\S]*Clearing a fraction/],
  [1, 'Comparing Lengths', /Inches, feet and yards/],
  [1, 'Positional Words', /A tower: top and bottom[\s\S]*A row: next to[\s\S]*Between/],
  [1, 'Picture Graphs', /How many in all\? How many more\?/],
  [1, 'Number Lines', /Jumping forward/],
  [2, 'Mixed Numbers', /improper → mixed[\s\S]*Adding mixed numbers/],
  [2, 'Fraction Word Problems', /A fraction of a group[\s\S]*Sharing equally/],
  [2, 'Multiplication Properties', /Distributive Property/],
  [2, 'Area', /find the side/],
  [2, 'Simplifying Fractions', /When it's a whole number/],
  [2, 'Line Plots', /The range/],
  [3, 'Square Roots', /Between two whole numbers/],
  [3, 'Statistics Basics', /range/i],   // Mean Median Mode merged in, 2026-10-21
  [3, 'Data Collection', /Most, least and range/],
  [3, 'Comparing Distributions', /Comparing spread[\s\S]*Skewed right[\s\S]*Bimodal/],
  [3, 'Simple Probability', /P\(not A\) = 1 − P\(A\)/],
  [3, 'Absolute Value', /\|x\| = 5 → x = 5 or x = −5/],
  [3, 'Powers of 10', /Dividing by 10ⁿ/],
  [3, 'Volume', /a missing side/],
  [3, 'Scientific Notation', /Multiplying in scientific notation/],
  [3, 'GCF and LCM', /LCM: the first multiple they share[\s\S]*GCF or LCM\?/],
  [3, 'One-Step Equations', /Multiplying and dividing/],
  [3, 'Basic Graphing', /Distance along a line/],
  [4, 'Irrational Numbers', /Approximating a square root[\s\S]*Comparing √a with a fraction/],
  [4, 'Compound Probability', /Without replacement[\s\S]*OR: add/],
  [4, 'Sampling Methods', /Cluster and convenience[\s\S]*Biased or representative/],
  [4, 'Angles and Lines', /Parallel lines and a transversal/],
  [5, 'Multi-Step Equations', /x on both sides/],
  [5, 'Absolute Value Equations', /Something inside the bars/],
  [5, 'Graphing Linear Inequalities', /Two inequalities at once/],
  [4, 'Two-Way Tables', /Turning a cell into a percent/],
  [5, 'Domain and Range', /start from the vertex[\s\S]*no dividing by zero/],
  [4, 'Similar Figures', /Perimeter scales too/],
  [4, 'Scatter Plots', /Outliers/],
  [4, 'Parallel Lines and Transversals', /Alternate exterior angles/],
  [4, 'Algebraic Expressions', /"Times the sum" needs brackets/],
  [6, 'Triangle Centers', /Finding the centroid[\s\S]*Inside or outside\?/],
  [6, 'Tangent Lines', /r² \+ PT² = OP²[\s\S]*∠APB \+ ∠AOB = 180°/],
  [6, 'Law of Sines', /sin⁻¹/],
  [6, 'Angle Bisectors', /Ray BD bisects ∠ABC[\s\S]*Equally far from both sides[\s\S]*1 : 3/],
  [6, 'Triangle Inequality', /Range for the third side/],
  [6, 'Midsegments', /Trapezoids: average the bases/],
  [6, 'Inscribed Angles', /cyclic quadrilateral/],
  [6, 'Dilations', /multiply both coordinates/],
  [7, 'Piecewise Functions', /union/],
  [7, 'Conic Sections', /c² = a² − b²/],
  [7, 'Rational Functions', /every polynomial IS rational/],
  [2, 'Multi-Digit Subtraction', /Borrowing across a zero/],
  [5, 'Systems by Elimination', /Subtract, or multiply first/],
];
for (const [tier, skill, re] of taught) {
  let text = '';
  try { text = lessonText(tier, skill); } catch (e) { text = 'THREW ' + e.message; }
  ok(`${skill}: lesson teaches what practice asks`, re.test(text), text.slice(0, 120));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
