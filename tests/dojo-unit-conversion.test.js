// Math Dojo, Tier 3 Unit Conversion.
//
// 2026-11-06, two reports on one skill:
//   - Practice only ever asked feet to inches, pounds to ounces and gallons to
//     quarts, always multiplying. The lesson teaches yards, miles, tons, pints,
//     cups and converting back the other way, and the skill's goal is converting
//     between units within a system. Every taught conversion is now asked, in
//     both directions.
//   - Cup, pint and quart were drawn the same height. Scaled to a 16-cup gallon
//     they came out under a 30px minimum, so 1, 2 and 4 cups all looked equal.
//
// Run: node tests/dojo-unit-conversion.test.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

function block(from) {
  let i = html.indexOf('{', from), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(html.indexOf('{', from), i + 1);
}

// ---- the real generator, on a seeded random source ---------------------------
let seed = 4242;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const rand = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const start = html.indexOf('"Unit Conversion": () => {', html.indexOf('const generators = {'));
if (start < 0) throw new Error('generator not found');
const getUnlockedSubSkillTypes = (key, map, order) => order.map(id => map[id]);
const generate = new Function('pick', 'rand', 'getUnlockedSubSkillTypes', block(start));
const draw = () => generate(pick, rand, getUnlockedSubSkillTypes);

// Worked out separately from the page: each unit in its smallest unit.
const SIZE = {
  length: { inch: 1, inches: 1, foot: 12, feet: 12, yard: 36, yards: 36, mile: 63360, miles: 63360 },
  weight: { ounce: 1, ounces: 1, pound: 16, pounds: 16, ton: 32000, tons: 32000 },
  volume: { cup: 1, cups: 1, pint: 2, pints: 2, quart: 4, quarts: 4, gallon: 16, gallons: 16 },
};
const NAME = { inches: 'inch', feet: 'foot', yards: 'yard', miles: 'mile', ounces: 'ounce', pounds: 'pound',
  tons: 'ton', cups: 'cup', pints: 'pint', quarts: 'quart', gallons: 'gallon' };
const one = u => NAME[u] || u;

const seen = new Set();
const types = new Set();
let badKey = '', badGrammar = '', badExplain = '', badShape = '', badOptions = '';
for (let i = 0; i < 20000; i++) {
  const q = draw();
  types.add(q.subType);
  const m = q.question.match(/^Convert ([\d,]+) ([a-z]+) to ([a-z]+)\.$/);
  if (!m) { badShape = q.question; continue; }
  const value = Number(m[1].replace(/,/g, '')), from = m[2], to = m[3];
  const sizes = SIZE[q.subType];
  const right = value * sizes[from] / sizes[to];
  if (right !== q.answer || !Number.isInteger(q.answer) || q.answer < 1) badKey = `${q.question} keyed ${q.answer}`;
  if ((value === 1) !== (from === one(from))) badGrammar = q.question;
  if (to === one(to)) badGrammar = q.question;
  const answerUnit = q.answer === 1 ? one(to) : to;
  if (!q.explanation.includes(`${q.answer.toLocaleString('en-US')} ${answerUnit}`)) badExplain = `${q.question} / ${q.explanation}`;
  if (!q.explanation.includes(sizes[from] > sizes[to] ? '×' : '÷')) badExplain = `${q.question} / ${q.explanation}`;
  seen.add(`${one(from)}>${one(to)}`);
  // The automatic choices offered 0 and -1 when the answer was small.
  const o = q.options || [];
  if (o.length !== 4 || new Set(o).size !== 4 || !o.includes(q.answer) || !o.every(v => Number.isInteger(v) && v > 0)) {
    badOptions = `${q.question} ${JSON.stringify(o)}`;
  }
}

ok('every question has the same wording', !badShape, badShape);
ok('every answer is right and a whole number', !badKey, badKey);
ok('1 is singular, everything else plural', !badGrammar, badGrammar);
ok('four different choices, all positive whole numbers, one of them right', !badOptions, badOptions);
ok('the explanation names the answer and multiplies or divides the right way', !badExplain, badExplain);
ok('the sub-skill names are unchanged, because scores are stored against them',
  [...types].sort().join() === 'length,volume,weight', [...types].join());

const pairs = [
  ['foot', 'inch'], ['yard', 'foot'], ['yard', 'inch'], ['mile', 'foot'],
  ['pound', 'ounce'], ['ton', 'pound'],
  ['gallon', 'quart'], ['gallon', 'pint'], ['gallon', 'cup'], ['quart', 'pint'], ['quart', 'cup'], ['pint', 'cup'],
];
for (const [big, small] of pairs) {
  ok(`asks ${big} to ${small}`, seen.has(`${big}>${small}`));
  ok(`asks ${small} to ${big}`, seen.has(`${small}>${big}`));
}
ok('asks nothing the lesson does not teach', seen.size === pairs.length * 2, [...seen].join(' '));

// ---- the capacity drawing ----------------------------------------------------
const scaleAt = html.indexOf('function containerScale(');
if (scaleAt < 0) throw new Error('containerScale not found');
const containerScale = eval(`(${html.slice(scaleAt, scaleAt + 'function containerScale(vessels) '.length)}${block(scaleAt)})`);

const cups = containerScale([1, 2, 4, 16].map(capacity => ({ capacity })));
const [c, p, qt, g] = [1, 2, 4, 16].map(cups.height);
ok('a pint is twice as tall as a cup', p === 2 * c, `${c} ${p}`);
ok('a quart is twice as tall as a pint', qt === 2 * p, `${p} ${qt}`);
ok('a gallon is four times as tall as a quart', g === 4 * qt, `${qt} ${g}`);
ok('each line marks exactly 1 cup', cups.unitPx === c, `${cups.unitPx} ${c}`);
ok('a cup is tall enough to see', c >= 8, String(c));

const ml = containerScale([{ capacity: 250 }, { capacity: 1500 }]);
ok('milliliters get no line per unit', ml.unitPx === 0);
ok('  and the bigger one is still drawn taller, in proportion', ml.height(1500) === 6 * ml.height(250));
ok('a tiny amount beside a huge one can still be seen', containerScale([{ capacity: 5 }, { capacity: 5000 }]).height(5) >= 8);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
