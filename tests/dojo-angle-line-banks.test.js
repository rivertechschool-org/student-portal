// Types of Angles / Types of Lines: real-world examples must have the right answer.
//
// Reported from the dojo: "The corner of a flat table top is most likely what
// type of angle?" wanted "straight". A table corner is a right angle.
//
// The cause was the question template, not one bad word. Every bank entry was
// dropped into "The corner of a <item>", so the straight bucket ("flat ruler
// edge", "a straight road horizon", "a flat table top") could only ever produce
// nonsense, and "a wide-open book lying flat" (180°) sat in the obtuse bucket.
// Each entry now names the angle itself, and the question is "What type of angle
// is <entry>?".
//
// Types of Lines had the same shape of fault: its "not perpendicular" pool was
// the whole parallel bank, so "Do the lines in 'rungs on a ladder' form
// perpendicular lines?" answered No - but rungs meet the rails at 90°.
//
// Run: node tests/dojo-angle-line-banks.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'math-dojo.html'), 'utf8');

let pass = 0;
let fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

function generatorSource(name) {
  const marker = `"${name}": () => {`;
  const start = html.indexOf(marker);
  if (start === -1) throw new Error(name + ' not found');
  let i = html.indexOf('{', start + marker.length - 1), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(html.indexOf('{', start + marker.length - 1), i);
}

let seed = 4242;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const rand = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const build = name => new Function('pick', 'rand', 'cap',
  '"use strict"; return (() => ' + generatorSource(name) + ')();');

// ---- Types of Angles -------------------------------------------------------
const angles = build('Types of Angles');
const draws = Array.from({ length: 4000 }, () => angles(pick, rand, cap));
const classify = draws.filter(q => q.subType === 'classify');
ok('classify questions are drawn', classify.length > 500, `${classify.length}`);

const typeOf = deg => deg < 90 ? 'acute' : deg === 90 ? 'right' : deg < 180 ? 'obtuse' : 'straight';
const example = q => q.question.replace(/^What type of angle is /, '').replace(/\?$/, '');
const seen = new Map();
for (const q of classify) seen.set(example(q), q.answer);

ok('the reported table-top question now answers right',
  seen.get('the corner of a table top') === 'right', String(seen.get('the corner of a table top')));
ok('no corner of anything is a straight angle',
  [...seen].every(([e, a]) => !(a === 'straight' && /corner/.test(e))),
  [...seen].filter(([e, a]) => a === 'straight' && /corner/.test(e)).map(([e]) => e).join('; '));
ok('a book opened flat is straight, not obtuse',
  [...seen].every(([e, a]) => !/book .*flat/.test(e) || a === 'straight'));

// Clock examples can be checked exactly: the hands are 30° apart per hour.
for (const [e, a] of seen) {
  const m = /clock at (\d+):00/.exec(e);
  if (!m) continue;
  const h = +m[1] % 12, deg = Math.min(h, 12 - h) * 30;
  ok(`clock at ${m[1]}:00 is ${typeOf(deg)}`, a === typeOf(deg), `answered ${a}`);
}

ok('every classify question reads as a sentence about an angle',
  classify.every(q => /^What type of angle is (the|a) /.test(q.question)),
  classify.find(q => !/^What type of angle is (the|a) /.test(q.question))?.question);

// "This shape shows a 150° angle" over a fixed acute triangle contradicted itself.
const identify = draws.filter(q => q.subType === 'identify');
ok('identify questions carry no mismatched picture', identify.every(q => !q.visual));
ok('identify answers match the measure', identify.every(q => q.answer === typeOf(+/(\d+)°/.exec(q.question)[1])));

// ---- Types of Lines --------------------------------------------------------
const lines = build('Types of Lines');
const lineDraws = Array.from({ length: 4000 }, () => lines(pick, rand, cap));
// Items with a right angle somewhere in them: "No, not perpendicular" is wrong.
const hasRightAngle = /ladder|notebook|picket fence|bookcase|railroad tracks|sheet music|venetian/;
const badNo = lineDraws.filter(q => q.subType === 'perpendicular' && q.answer === 'No' && hasRightAngle.test(q.question));
ok('nothing with a square crossing is called "not perpendicular"', badNo.length === 0, badNo[0]?.question);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
