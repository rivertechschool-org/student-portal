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
// Reported: "2 triangles can make a square, so how many triangles make a
// square?" has no one answer, and "2 circles" was offered for building a square.
// Every question now names an arrangement from the lesson, and a square is never
// offered as wrong beside a rectangle (or the other way round).
{
  const qs = draw('Composing Shapes', 4000);
  ok('Composing: no circles anywhere', !qs.some(q => /circle/i.test(q.question + ' ' + (q.options || []).join(' '))),
    first(qs, q => /circle/i.test(q.question + ' ' + (q.options || []).join(' '))));
  const combine = qs.filter(q => q.subType === 'combine');
  const twin = q => (q.answer === 'square' && q.options.includes('rectangle')) || (q.answer === 'rectangle' && q.options.includes('square'));
  ok('Composing combine: a square answer never has rectangle as a wrong option, or vice versa', combine.length > 1000 &&
    !combine.some(twin), first(combine, twin));
  ok('Composing combine: every piece set is arranged (side by side / block / meet / cut)',
    combine.every(q => /side by side|2-by-2|meet in the middle|corner to corner/.test(q.question)));
  // The halves of a square make a square, a bigger triangle or a parallelogram
  // depending on which sides meet (2026-10-28), so those questions must say.
  const halves = combine.filter(q => /corner to corner/.test(q.question));
  ok('Composing combine: halves of a square always say which sides are joined', halves.length > 100 &&
    halves.every(q => /along the cut|on a short side/.test(q.question)), first(halves, q => !/along the cut|on a short side/.test(q.question)));
  ok('Composing combine: both arrangements are asked, each with its own answer',
    halves.some(q => /along the cut/.test(q.question) && q.answer === 'square')
    && halves.some(q => /on a short side/.test(q.question) && q.answer === 'triangle')
    && halves.every(q => /along the cut/.test(q.question) ? q.answer === 'square' : q.answer === 'triangle'));
  const counts = qs.filter(q => q.subType === 'count_pieces');
  ok('Composing count: never the bare "how many triangles make a square"', counts.length > 500 &&
    !counts.some(q => /how many triangles (make|in) a square/i.test(q.question)));
  ok('Composing: answer always among the options', qs.every(q => q.options.map(String).includes(String(q.answer))));
}

// ---- Decimal Operations: place value -----------------------------------------
// Reported: "In 1.114, which place is the 1 in?" - three right answers.
{
  const qs = draw('Decimal Operations', 6000);
  const ask = qs.map(q => /^In (\d\.\d{3}), which place is the (\d) in\?|^What is the value of the (\d) in (\d\.\d{3})\?/.exec(q.question)).filter(Boolean);
  const once = m => { const num = m[1] || m[4], d = m[2] || m[3]; return num.split(d).length === 2; };
  ok('Decimal place value: the asked digit appears once in the number', ask.length > 100 && ask.every(once), (ask.find(m => !once(m)) || [])[0]);
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
  // 2026-10-21: measuring and calculating, not "Which is heavier: a feather or
  // an elephant?". Every number is in the question, and the answer is worked
  // out from those numbers here, independently of the generator.
  const qs = draw('Mass and Capacity');
  const nums = q => (q.question.match(/\d[\d,]*/g) || []).map(s => +s.replace(/,/g, ''));
  const want = q => {
    const n = nums(q), t = q.question;
    if (/Which is heavier|Which holds more/.test(t)) {
      const m = /^An? (.+?) (?:has a mass of|holds) [\d,]+ \w+\. An? (.+?) (?:has a mass of|holds)/.exec(t);
      return n[0] > n[1] ? m[1] : m[2];
    }
    if (/You add/.test(t)) return n[0] + n[1];
    if (/heavier is|more .* does the/.test(t)) return Math.abs(n[0] - n[1]);
    if (/^Each /.test(t)) return n[0] * n[1];
    if (/identical/.test(t)) return n[1] / n[0];
    if (/glasses of/.test(t)) return n[0] - n[1] * n[2];
    if (/full buckets/.test(t)) return n[0] / n[1];
    return '(unrecognised)';
  };
  ok('Mass/Capacity: every answer follows from the numbers given', qs.every(q => String(want(q)) === String(q.answer)),
    first(qs, q => String(want(q)) !== String(q.answer)));
  ok('Mass/Capacity: no comparison without measurements', !qs.some(q => /Which/.test(q.question) && nums(q).length < 2),
    first(qs, q => /Which/.test(q.question) && nums(q).length < 2));
  ok('Mass/Capacity: numeric choices are all positive', qs.every(q => typeof q.answer !== 'number' || (q.options || []).every(o => o > 0)),
    first(qs, q => typeof q.answer === 'number' && (q.options || []).some(o => !(o > 0))));
  ok('Mass/Capacity: no "A <vowel>"', !qs.some(q => /\bA [aeiou]/.test(q.question)), first(qs, q => /\bA [aeiou]/.test(q.question)));
  ok('Mass/Capacity: all seven question forms appear',
    ['heavier is', 'Which is heavier', 'You add', 'Each ', 'identical', 'glasses of', 'full buckets', 'Which holds more', 'more .* does the'].every(s => qs.some(q => new RegExp(s).test(q.question))));
}

// ---- Classifying Objects / Estimation --------------------------------------
{
  const qs = draw('Classifying Objects', 4000);
  // Sorting is by shape, size, or number vs shape: colour, fruit, weather and
  // body parts were not maths.
  ok('Classifying: no colour questions', !qs.some(q => /colou?r/i.test(q.question)), first(qs, q => /colou?r/i.test(q.question)));
  ok('Classifying: no fruit/weather/body-part odd-one-out', !qs.some(q => /\b(banana|mango|hail|elbow|scooter)\b/.test(q.question)));
  // 2026-10-21: "Is a bus big or small?" is general knowledge, and depends on what you compare it with. Sorting by number of sides replaced it.
  ok('Classifying: no big/small questions', !qs.some(q => /\b(big|small)\b/.test(q.question + ' ' + (q.options || []).join(' '))),
    first(qs, q => /\b(big|small)\b/.test(q.question + ' ' + (q.options || []).join(' '))));
  const sides = { triangle: '3 sides', square: '4 sides', rectangle: '4 sides', circle: 'no sides (round)' };
  const bySides = qs.filter(q => q.subType === 'by_sides');
  ok('Classifying by_sides: the group matches the shape', bySides.length > 300 && bySides.every(q => sides[/the \S+ (\w+) go in/.exec(q.question)[1]] === q.answer));
  const counts = qs.filter(q => q.subType === 'count_sort');
  ok('Classifying count_sort: answer matches the shapes shown', counts.length > 500 && counts.every(q => {
    const row = /these shapes: (.+?)\. /.exec(q.question)[1].split(' ');
    const n = s => row.filter(x => x === s).length;
    if (typeof q.answer === 'number') return n(/\((.)\)/.exec(q.question)[1]) === q.answer;
    const sym = { triangles: '▲', squares: '■', circles: '●' };
    return Object.keys(sym).every(k => k === q.answer || n(sym[k]) < n(sym[q.answer]));
  }));
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
